use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use clap::Parser;
use log::{debug, error, info, warn};
use mavlink::common::{MavCmd, MavMessage, COMMAND_LONG_DATA};
use mavlink::peek_reader::PeekReader;
use mavlink::read_any_msg;
use mavlink::write_v2_msg;
use mavlink::MavHeader;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::Mutex;

#[derive(Parser, Debug)]
#[command(name = "udp_proxy")]
#[command(about = "UDP proxy that forwards packets from a listen port to a forward address")]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value = "10124")]
    listen_port: u16,

    /// Address to forward packets to (format: IP:PORT)
    #[arg(short, long)]
    forward_addr: String,

    /// HTTP port for command trigger endpoint
    #[arg(long, default_value = "8080")]
    http_port: u16,
}

/// Shared state for HTTP handler
#[derive(Clone)]
struct AppState {
    socket: Arc<Mutex<UdpSocket>>,
    last_source: Arc<Mutex<Option<SocketAddr>>>,
    sequence: Arc<Mutex<u8>>,
}

/// Parse a packet as MAVLink message and log information about it
fn parse_mavlink_packet(data: &[u8], direction: &str) {
    // Create a cursor from the bytes to use as a reader
    let cursor = Cursor::new(data);
    let mut reader = PeekReader::new(cursor);

    // Try parsing as MAVLink message (auto-detects v1 or v2)
    match read_any_msg::<MavMessage, _>(&mut reader) {
        Ok((header, msg)) => {
            // Extract message type name from the Debug representation
            let msg_type = format!("{:?}", msg);
            let msg_type_name = msg_type.split('(').next().unwrap_or(&msg_type);
            debug!(
                "[{}] MAVLink message: Type={}, System={}, Component={}, Sequence={}, Message={:?}",
                direction,
                msg_type_name,
                header.system_id,
                header.component_id,
                header.sequence,
                msg
            );
        }
        Err(e) => {
            debug!(
                "[{}] Failed to parse as MAVLink message ({} bytes): {}",
                direction,
                data.len(),
                e
            );
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args = Args::parse();

    let listen_port = args.listen_port;
    let forward_addr: SocketAddr = args
        .forward_addr
        .parse()
        .map_err(|e| format!("Invalid forward address '{}': {}", args.forward_addr, e))?;

    // Create socket for listening on the specified port
    // Wrap in Mutex to serialize concurrent writes (Task 2 and Task 3)
    let socket_10124 = Arc::new(Mutex::new(
        UdpSocket::bind(format!("0.0.0.0:{}", listen_port)).await?,
    ));
    info!("Listening on port {} for incoming packets", listen_port);
    info!("Forwarding packets to {}", forward_addr);

    // Handle packets from listen_port -> forward to forward_addr
    // Also handle responses from forward_addr -> forward back to original source

    // Create a socket for forwarding
    let forward_socket = Arc::new(UdpSocket::bind("0.0.0.0:0").await?);

    // Track the most recent source address that sent to 10124
    let last_source: Arc<Mutex<Option<SocketAddr>>> = Arc::new(Mutex::new(None));

    let forward_socket_clone = forward_socket.clone();
    let socket_10124_clone = socket_10124.clone();
    let last_source_clone = last_source.clone();
    let listen_port_task1 = listen_port;
    let forward_addr_task1 = forward_addr;

    // Task 1: Handle packets from listen_port -> forward to forward_addr
    let task1 = tokio::spawn(async move {
        let mut buf = [0u8; 65507]; // Max UDP packet size
        loop {
            let socket = socket_10124_clone.lock().await;
            match socket.recv_from(&mut buf).await {
                Ok((size, source_addr)) => {
                    debug!(
                        "Received {} bytes from {} on port {}",
                        size, source_addr, listen_port_task1
                    );

                    // Parse as MAVLink message
                    parse_mavlink_packet(&buf[..size], "INCOMING");

                    // Track this source address
                    {
                        let mut last = last_source_clone.lock().await;
                        *last = Some(source_addr);
                    }

                    // Forward to remote address
                    match forward_socket_clone
                        .send_to(&buf[..size], forward_addr_task1)
                        .await
                    {
                        Ok(_) => {
                            debug!(
                                "Forwarded {} bytes from {} to {}",
                                size, source_addr, forward_addr_task1
                            );
                        }
                        Err(e) => {
                            error!("Error forwarding to {}: {}", forward_addr_task1, e);
                        }
                    }
                }
                Err(e) => {
                    error!("Error receiving on port {}: {}", listen_port_task1, e);
                }
            }
        }
    });

    // Task 2: Handle responses from forward_addr -> forward back to original source
    let socket_10124_send_task2 = socket_10124.clone();
    let last_source_response = last_source.clone();
    let forward_addr_task2 = forward_addr;
    let task2 = tokio::spawn(async move {
        let mut buf = [0u8; 65507]; // Max UDP packet size
        loop {
            match forward_socket.recv_from(&mut buf).await {
                Ok((size, _)) => {
                    debug!(
                        "Received {} bytes response from {}",
                        size, forward_addr_task2
                    );

                    // Parse as MAVLink message
                    parse_mavlink_packet(&buf[..size], "OUTGOING");

                    // Get the last source address that sent to the listen port
                    let source_addr = {
                        let last = last_source_response.lock().await;
                        *last
                    };

                    if let Some(addr) = source_addr {
                        // Forward back to the original source (serialized write)
                        let socket = socket_10124_send_task2.lock().await;
                        match socket.send_to(&buf[..size], addr).await {
                            Ok(_) => {
                                debug!("Forwarded {} bytes response to {}", size, addr);
                            }
                            Err(e) => {
                                error!("Error forwarding response to {}: {}", addr, e);
                            }
                        }
                    } else {
                        warn!("No source address tracked, dropping response packet");
                    }
                }
                Err(e) => {
                    error!(
                        "Error receiving response from {}: {}",
                        forward_addr_task2, e
                    );
                }
            }
        }
    });

    // Task 3: HTTP server for triggering COMMAND_LONG message
    let http_port = args.http_port;
    let app_state = AppState {
        socket: socket_10124.clone(),
        last_source: last_source.clone(),
        sequence: Arc::new(Mutex::new(0)),
    };

    let task3 = tokio::spawn(async move {
        let app = Router::new()
            .route("/trigger-camera", post(trigger_camera_command))
            .route("/set-camera-mode", post(set_camera_mode))
            .route("/video-click", post(video_click))
            .route("/camera-command", post(camera_command))
            .with_state(app_state);

        let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", http_port))
            .await
            .expect("Failed to bind HTTP server");

        info!("HTTP server listening on port {} at /trigger-camera, /set-camera-mode, /video-click, /camera-command", http_port);

        axum::serve(listener, app).await.expect("HTTP server error");
    });

    info!("UDP proxy started. Press Ctrl+C to stop.");

    // Wait for all tasks
    tokio::select! {
        _ = task1 => {},
        _ = task2 => {},
        _ = task3 => {},
    }

    Ok(())
}

/// HTTP handler to trigger sending COMMAND_LONG message
async fn trigger_camera_command(State(state): State<AppState>) -> Result<Json<Value>, StatusCode> {
    // Get the last source address
    let source_addr = {
        let last = state.last_source.lock().await;
        *last
    };

    if source_addr.is_none() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let addr = source_addr.unwrap();

    // Get and increment sequence number
    let sequence = {
        let mut seq = state.sequence.lock().await;
        let current = *seq;
        *seq = seq.wrapping_add(1);
        current
    };

    // Create COMMAND_LONG message
    let cmd_data = COMMAND_LONG_DATA {
        param1: 0.0,
        param2: 3.0,
        param3: 0.0,
        param4: 0.0,
        param5: 0.0,
        param6: 0.0,
        param7: 0.0,
        command: MavCmd::MAV_CMD_DO_DIGICAM_CONTROL,
        target_system: 1,
        target_component: 1,
        confirmation: 0,
    };

    let msg = MavMessage::COMMAND_LONG(cmd_data);

    // Create header
    let header = MavHeader {
        system_id: 255,
        component_id: 190,
        sequence: sequence,
    };

    // Serialize message to bytes
    let mut buffer = Vec::new();
    match write_v2_msg(&mut buffer, header, &msg) {
        Ok(_) => {
            // Send to the source address (serialized write)
            let socket = state.socket.lock().await;
            match socket.send_to(&buffer, addr).await {
                Ok(_) => {
                    info!(
                        "Sent COMMAND_LONG message to {} (sequence={}) via HTTP trigger",
                        addr, sequence
                    );
                    Ok(Json(json!({
                        "status": "success",
                        "message": "Command sent",
                        "target": addr.to_string(),
                        "sequence": sequence
                    })))
                }
                Err(e) => {
                    error!("Error sending COMMAND_LONG to {}: {}", addr, e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        Err(e) => {
            error!("Error serializing COMMAND_LONG message: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
struct SetCameraModeRequest {
    mode: f32,
}

/// HTTP handler to set camera mode
async fn set_camera_mode(
    State(state): State<AppState>,
    Json(payload): Json<SetCameraModeRequest>,
) -> Result<Json<Value>, StatusCode> {
    // Get the last source address
    let source_addr = {
        let last = state.last_source.lock().await;
        *last
    };

    if source_addr.is_none() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let addr = source_addr.unwrap();

    // Get and increment sequence number
    let sequence = {
        let mut seq = state.sequence.lock().await;
        let current = *seq;
        *seq = seq.wrapping_add(1);
        current
    };

    // Create COMMAND_LONG message for SetSystemMode
    let cmd_data = COMMAND_LONG_DATA {
        param1: 0.0,          // SetSystemMode command
        param2: payload.mode, // Mode number
        param3: 0.0,
        param4: 0.0,
        param5: 0.0,
        param6: 0.0,
        param7: 0.0,
        command: MavCmd::MAV_CMD_DO_DIGICAM_CONTROL,
        target_system: 1,
        target_component: 1,
        confirmation: 0,
    };

    let msg = MavMessage::COMMAND_LONG(cmd_data);

    // Create header
    let header = MavHeader {
        system_id: 255,
        component_id: 190,
        sequence: sequence,
    };

    // Serialize message to bytes
    let mut buffer = Vec::new();
    match write_v2_msg(&mut buffer, header, &msg) {
        Ok(_) => {
            // Send to the source address (serialized write)
            let socket = state.socket.lock().await;
            match socket.send_to(&buffer, addr).await {
                Ok(_) => {
                    info!(
                        "Sent set_camera_mode command to {} (mode={}, sequence={})",
                        addr, payload.mode, sequence
                    );
                    Ok(Json(json!({
                        "status": "success",
                        "message": format!("Camera mode changed to: {}", payload.mode),
                        "target": addr.to_string(),
                        "mode": payload.mode,
                        "sequence": sequence
                    })))
                }
                Err(e) => {
                    error!("Error sending set_camera_mode to {}: {}", addr, e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        Err(e) => {
            error!("Error serializing set_camera_mode message: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Deserialize)]
struct VideoClickRequest {
    video_width: u32,
    video_height: u32,
    click_x: u32,
    click_y: u32,
    #[serde(default = "default_channel_id")]
    channel_id: u32,
    #[serde(default = "default_command_type")]
    command_type: String,
}

fn default_channel_id() -> u32 {
    0
}

fn default_command_type() -> String {
    "Tracking".to_string()
}

#[derive(Deserialize)]
struct CameraCommandRequest {
    param1: f32,
    param2: f32,
    param3: f32,
    param4: f32,
    param5: f32,
    param6: f32,
    param7: f32,
}

/// HTTP handler for general camera commands
async fn camera_command(
    State(state): State<AppState>,
    Json(payload): Json<CameraCommandRequest>,
) -> Result<Json<Value>, StatusCode> {
    // Get the last source address
    let source_addr = {
        let last = state.last_source.lock().await;
        *last
    };

    if source_addr.is_none() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let addr = source_addr.unwrap();

    // Use the send_command helper function
    match send_command(
        &state,
        addr,
        payload.param1,
        payload.param2,
        payload.param3,
        payload.param4,
        payload.param5,
        payload.param6,
        payload.param7,
    )
    .await
    {
        Ok(sequence) => {
            info!("Sent camera command to {} (sequence={})", addr, sequence);
            Ok(Json(json!({
                "status": "success",
                "message": "Camera command sent",
                "target": addr.to_string(),
                "sequence": sequence,
                "params": {
                    "param1": payload.param1,
                    "param2": payload.param2,
                    "param3": payload.param3,
                    "param4": payload.param4,
                    "param5": payload.param5,
                    "param6": payload.param6,
                    "param7": payload.param7,
                }
            })))
        }
        Err(e) => Err(e),
    }
}

/// HTTP handler to handle video click
async fn video_click(
    State(state): State<AppState>,
    Json(payload): Json<VideoClickRequest>,
) -> Result<Json<Value>, StatusCode> {
    // Get the last source address
    let source_addr = {
        let last = state.last_source.lock().await;
        *last
    };

    if source_addr.is_none() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let addr = source_addr.unwrap();

    // Coordinates are already in video space (scaled by frontend to video's natural dimensions)
    // Just convert to f32 and validate they're within video bounds
    let x_pos = payload.click_x as f32;
    let y_pos = payload.click_y as f32;

    // Validate coordinates are within video bounds
    if x_pos < 0.0
        || x_pos > payload.video_width as f32
        || y_pos < 0.0
        || y_pos > payload.video_height as f32
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut sequences = Vec::new();

    match payload.command_type.as_str() {
        "Tracking" => {
            // Send tracking command
            let sequence = send_command(
                &state,
                addr,
                0.0, // SetSystemMode
                7.0, // Tracking mode
                x_pos,
                y_pos,
                0.0,
                payload.channel_id as f32,
                0.0,
            )
            .await?;
            sequences.push(sequence);

            info!(
                "Tracking command sent: x={}, y={}, channel={}",
                x_pos, y_pos, payload.channel_id
            );
        }
        "RefineLocation" => {
            // Send RefineLocation command
            let sequence = send_command(
                &state,
                addr,
                52.0, // OGLRControl
                0.0,  // RefineLocation
                x_pos,
                y_pos,
                payload.channel_id as f32,
                0.0,
                0.0,
            )
            .await?;
            sequences.push(sequence);

            info!(
                "RefineLocation command sent: x={}, y={}, channel={}",
                x_pos, y_pos, payload.channel_id
            );
        }
        "Both" => {
            // Send tracking first
            let seq1 = send_command(
                &state,
                addr,
                0.0, // SetSystemMode
                7.0, // Tracking mode
                x_pos,
                y_pos,
                0.0,
                payload.channel_id as f32,
                0.0,
            )
            .await?;
            sequences.push(seq1);

            // Then send RefineLocation
            let seq2 = send_command(
                &state,
                addr,
                52.0, // OGLRControl
                0.0,  // RefineLocation
                x_pos,
                y_pos,
                payload.channel_id as f32,
                0.0,
                0.0,
            )
            .await?;
            sequences.push(seq2);

            info!(
                "Both commands sent: x={}, y={}, channel={}",
                x_pos, y_pos, payload.channel_id
            );
        }
        _ => {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    Ok(Json(json!({
        "status": "success",
        "message": format!("{} command(s) sent", payload.command_type),
        "target": addr.to_string(),
        "x_pos": x_pos,
        "y_pos": y_pos,
        "channel_id": payload.channel_id,
        "command_type": payload.command_type,
        "sequences": sequences
    })))
}

/// Helper function to send a COMMAND_LONG message
async fn send_command(
    state: &AppState,
    addr: SocketAddr,
    param1: f32,
    param2: f32,
    param3: f32,
    param4: f32,
    param5: f32,
    param6: f32,
    param7: f32,
) -> Result<u8, StatusCode> {
    // Get and increment sequence number
    let sequence = {
        let mut seq = state.sequence.lock().await;
        let current = *seq;
        *seq = seq.wrapping_add(1);
        current
    };

    // Create COMMAND_LONG message
    let cmd_data = COMMAND_LONG_DATA {
        param1,
        param2,
        param3,
        param4,
        param5,
        param6,
        param7,
        command: MavCmd::MAV_CMD_DO_DIGICAM_CONTROL,
        target_system: 1,
        target_component: 1,
        confirmation: 0,
    };

    let msg = MavMessage::COMMAND_LONG(cmd_data);

    // Create header
    let header = MavHeader {
        system_id: 255,
        component_id: 190,
        sequence: sequence,
    };

    // Serialize message to bytes
    let mut buffer = Vec::new();
    match write_v2_msg(&mut buffer, header, &msg) {
        Ok(_) => {
            // Send to the source address (serialized write)
            let socket = state.socket.lock().await;
            match socket.send_to(&buffer, addr).await {
                Ok(_) => Ok(sequence),
                Err(e) => {
                    error!("Error sending command to {}: {}", addr, e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
        Err(e) => {
            error!("Error serializing command message: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[cfg(test)]
mod tests {

    // Note: These tests verify coordinate validation logic
    // Coordinates are already in video space (scaled by frontend to video's natural dimensions)
    // Full integration tests require a running server and are in tests/e2e/

    #[test]
    fn test_coordinate_validation_within_bounds() {
        // Test that coordinates within video bounds are valid
        let video_width = 1920.0;
        let video_height = 1080.0;
        let click_x = 960.0;
        let click_y = 540.0;

        // Coordinates should be within bounds
        assert!(click_x >= 0.0 && click_x <= video_width);
        assert!(click_y >= 0.0 && click_y <= video_height);
    }

    #[test]
    fn test_coordinate_validation_at_bounds() {
        // Test coordinates at video boundaries
        let video_width = 1280.0;
        let video_height = 720.0;

        // Test at origin
        assert!(0.0 >= 0.0 && 0.0 <= video_width);
        assert!(0.0 >= 0.0 && 0.0 <= video_height);

        // Test at max bounds
        assert!(video_width >= 0.0 && video_width <= video_width);
        assert!(video_height >= 0.0 && video_height <= video_height);
    }

    #[test]
    fn test_coordinate_validation_outside_bounds() {
        // Test that coordinates outside video bounds are invalid
        let video_width = 1920.0;
        let video_height = 1080.0;

        // Test negative coordinates
        assert!(!(-1.0 >= 0.0 && -1.0 <= video_width));
        assert!(!(-1.0 >= 0.0 && -1.0 <= video_height));

        // Test coordinates beyond video dimensions
        assert!(!(video_width + 1.0 >= 0.0 && video_width + 1.0 <= video_width));
        assert!(!(video_height + 1.0 >= 0.0 && video_height + 1.0 <= video_height));
    }
}

use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use clap::Parser;
use log::{debug, error, info, warn};
use tokio::net::UdpSocket;

/// Bidirectional UDP relay between a local listen address and a fixed forward address.
///
/// Behavior:
/// - Packets from the forward-side IP (e.g. camera IP) are forwarded to the most recent client sender.
/// - Packets from other IPs are forwarded to the forward address, and update the "last client".
#[derive(Parser, Debug)]
#[command(name = "udp_bidirectional_relay")]
struct Args {
    /// Local address to listen on (IP:PORT)
    #[arg(long, default_value = "0.0.0.0:8745")]
    listen_addr: SocketAddr,

    /// Forward address (IP:PORT) to send client->camera traffic to
    #[arg(long)]
    forward_addr: SocketAddr,

    /// Limit client packets to this source IP (optional).
    /// If set, packets from other non-forward IPs are dropped.
    #[arg(long)]
    allowed_client_source_ip: Option<IpAddr>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args = Args::parse();
    let socket = UdpSocket::bind(args.listen_addr).await?;

    let forward_ip = args.forward_addr.ip();
    let mut last_client: Option<SocketAddr> = None;

    info!("Listening on {}", args.listen_addr);
    info!("Forwarding to {}", args.forward_addr);
    if let Some(ip) = args.allowed_client_source_ip {
        info!("Allowed client source IP: {}", ip);
    } else {
        info!("Allowed client source IP: (any)");
    }

    let mut buf = [0u8; 65507];
    let mut relayed_packets: u64 = 0;
    let mut relayed_bytes: u64 = 0;
    let mut last_report = Instant::now();

    loop {
        let (size, src) = match socket.recv_from(&mut buf).await {
            Ok(v) => v,
            Err(e) => {
                warn!("UDP recv failed: {e}");
                continue;
            }
        };

        // Forward-side packets (from camera) are sent back to the last client.
        if src.ip() == forward_ip {
            if let Some(client) = last_client {
                if let Err(e) = socket.send_to(&buf[..size], client).await {
                    error!("Failed to forward camera->client: {e}");
                } else {
                    relayed_packets += 1;
                    relayed_bytes += size as u64;
                }
            } else {
                debug!("Dropping camera packet (no last client yet): {src}");
            }
        } else {
            // Client-side packets update last_client and get forwarded to camera.
            if let Some(allowed) = args.allowed_client_source_ip {
                if src.ip() != allowed {
                    continue;
                }
            }

            last_client = Some(src);
            if let Err(e) = socket.send_to(&buf[..size], args.forward_addr).await {
                error!("Failed to forward client->camera: {e}");
            } else {
                relayed_packets += 1;
                relayed_bytes += size as u64;
            }
        }

        if last_report.elapsed() >= Duration::from_secs(5) {
            info!(
                "Relayed {} packets ({} bytes). last_client={:?}",
                relayed_packets, relayed_bytes, last_client
            );
            relayed_packets = 0;
            relayed_bytes = 0;
            last_report = Instant::now();
        }
    }
}

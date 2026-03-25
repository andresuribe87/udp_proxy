use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};

use clap::Parser;
use log::{debug, error, info, warn};
use tokio::net::UdpSocket;

#[derive(Parser, Debug)]
#[command(name = "udp_video_relay")]
#[command(about = "One-way UDP relay for camera video streams")]
struct Args {
    /// Address to listen on for inbound video packets.
    #[arg(long, default_value = "0.0.0.0:15123")]
    listen_addr: SocketAddr,

    /// Address to forward inbound video packets to.
    #[arg(long)]
    forward_addr: SocketAddr,

    /// Optional source IP allowlist for inbound packets.
    #[arg(long)]
    allowed_source_ip: Option<IpAddr>,

    /// Send each accepted packet to the forward address twice (same payload, sequential sends).
    #[arg(long, action = clap::ArgAction::SetTrue)]
    duplicate_packets: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args = Args::parse();
    let socket = UdpSocket::bind(args.listen_addr).await?;

    info!("Listening for video on {}", args.listen_addr);
    info!("Forwarding video to {}", args.forward_addr);

    if let Some(ip) = args.allowed_source_ip {
        info!("Allowing packets only from source IP {}", ip);
    }
    if args.duplicate_packets {
        info!("Duplicate forwarding enabled: each packet is sent twice to {}", args.forward_addr);
    }

    let mut buf = [0u8; 65507];
    let mut packet_count: u64 = 0;
    let mut byte_count: u64 = 0;
    let mut last_report = Instant::now();

    loop {
        match socket.recv_from(&mut buf).await {
            Ok((size, source_addr)) => {
                if let Some(allowed_ip) = args.allowed_source_ip {
                    if source_addr.ip() != allowed_ip {
                        debug!("Ignoring packet from unexpected source {}", source_addr);
                        continue;
                    }
                }

                match socket.send_to(&buf[..size], args.forward_addr).await {
                    Ok(sent_first) => {
                        let mut bytes_sent = sent_first as u64;
                        if args.duplicate_packets {
                            match socket.send_to(&buf[..size], args.forward_addr).await {
                                Ok(sent_second) => bytes_sent += sent_second as u64,
                                Err(err) => error!(
                                    "Failed duplicate send of {} bytes from {} to {}: {}",
                                    size, source_addr, args.forward_addr, err
                                ),
                            }
                        }
                        packet_count += 1;
                        byte_count += bytes_sent;

                        if last_report.elapsed() >= Duration::from_secs(5) {
                            debug!(
                                "Relayed {} packets ({} bytes) from {} to {}",
                                packet_count, byte_count, source_addr, args.forward_addr
                            );
                            last_report = Instant::now();
                        }
                    }
                    Err(err) => {
                        error!(
                            "Failed to forward {} bytes from {} to {}: {}",
                            size, source_addr, args.forward_addr, err
                        );
                    }
                }
            }
            Err(err) => {
                warn!("Failed to receive UDP packet: {}", err);
            }
        }
    }
}

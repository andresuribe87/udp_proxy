use std::net::SocketAddr;

use clap::Parser;
use log::{error, info, warn};
use tokio::io;
use tokio::net::{TcpListener, TcpStream};
#[derive(Parser, Debug)]
#[command(name = "tcp_bidirectional_relay")]
struct Args {
    /// Local address to listen on (IP:PORT)
    #[arg(long)]
    listen_addr: SocketAddr,

    /// Forward address to connect to for each incoming connection (IP:PORT)
    #[arg(long)]
    forward_addr: SocketAddr,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args = Args::parse();
    let listener = TcpListener::bind(args.listen_addr).await?;

    info!("Listening on {}", args.listen_addr);
    info!("Forwarding to {}", args.forward_addr);

    loop {
        let (client_stream, client_addr) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                warn!("Accept failed: {e}");
                continue;
            }
        };

        let forward_addr = args.forward_addr;
        tokio::spawn(async move {
            if let Err(e) = async {
                let server_stream = TcpStream::connect(forward_addr).await?;

                // Split into two directions and pipe concurrently.
                let (mut client_r, mut client_w) = client_stream.into_split();
                let (mut server_r, mut server_w) = server_stream.into_split();

                let client_to_server =
                    tokio::spawn(async move { io::copy(&mut client_r, &mut server_w).await });
                let server_to_client =
                    tokio::spawn(async move { io::copy(&mut server_r, &mut client_w).await });

                let _ = client_to_server.await;
                let _ = server_to_client.await;

                Ok::<(), io::Error>(())
            }
            .await
            {
                error!("TCP relay for {client_addr} failed: {e}");
            }
        });
    }
}

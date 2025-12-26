# UDP Proxy

A Rust-based UDP proxy that connects port 10999 with port 10124.

## Functionality

- **Port 10999**: Listens for incoming UDP packets and forwards them to port 10124
- **Port 10124**: Listens for incoming UDP packets and forwards them to the last 5 clients who have connected to port 10999

## Building

```bash
cd udp_proxy
cargo build --release
```

## Running

```bash
cargo run --release
```

Or run the compiled binary:
```bash
./target/release/udp_proxy
```

## How it works

1. The program listens on both ports 10999 and 10124 simultaneously
2. When a packet arrives on port 10999:
   - The client address is tracked (maintaining the last 5 unique clients)
   - The packet is forwarded to 127.0.0.1:10124
3. When a packet arrives on port 10124:
   - The packet is forwarded to all currently tracked clients (up to 5)
   - If no clients have connected yet, the packet is dropped

## Requirements

- Rust 1.70+ (or use rustup to install)
- Tokio async runtime (included as dependency)


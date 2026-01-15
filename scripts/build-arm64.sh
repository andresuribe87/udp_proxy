#!/bin/bash
# Script to build udp_proxy for ARM64 architecture
# This script cross-compiles the project for aarch64-unknown-linux-gnu target

set -e

echo "Building udp_proxy for ARM64 (aarch64-unknown-linux-gnu)..."

# Check if the target is installed
if ! rustup target list --installed | grep -q "aarch64-unknown-linux-gnu"; then
    echo "Error: ARM64 target not installed. Run: rustup target add aarch64-unknown-linux-gnu"
    exit 1
fi

# Check if the cross-compilation toolchain is available
if ! command -v aarch64-linux-gnu-gcc > /dev/null 2>&1; then
    echo "Error: ARM64 cross-compilation toolchain not found."
    echo "Install it with: sudo apt-get install -y gcc-aarch64-linux-gnu binutils-aarch64-linux-gnu"
    exit 1
fi

# Build for ARM64
cargo build --release --target aarch64-unknown-linux-gnu

if [ $? -eq 0 ]; then
    BINARY_PATH="target/aarch64-unknown-linux-gnu/release/udp_proxy"
    echo ""
    echo "✓ Build successful!"
    echo "  Binary location: $BINARY_PATH"
    echo ""
    echo "To verify the binary architecture:"
    echo "  file $BINARY_PATH"
    echo ""
    echo "To run on an ARM64 system, copy the binary and execute:"
    echo "  ./udp_proxy"
else
    echo ""
    echo "✗ Build failed!"
    exit 1
fi


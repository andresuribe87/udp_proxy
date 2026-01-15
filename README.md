# UDP Proxy

A Rust-based MAVLink UDP proxy that forwards MAVLink messages between a client and a remote address, with HTTP endpoints for camera control commands.

## Description

This proxy acts as a bidirectional UDP forwarder for MAVLink protocol messages. It listens on a configurable port for incoming MAVLink packets, forwards them to a remote address, and routes responses back to the original sender. Additionally, it provides HTTP REST endpoints for triggering camera control commands (trigger camera, set camera mode, and video click tracking).

## Functionality

- **UDP Forwarding**: Listens on a configurable port (default: 10124) and forwards incoming MAVLink packets to a specified remote address
- **Bidirectional Communication**: Tracks the last source address and automatically forwards responses from the remote address back to the original sender
- **MAVLink Parsing**: Parses and logs MAVLink messages (both v1 and v2) for debugging and monitoring
- **HTTP API**: Provides REST endpoints for camera control:
  - `/trigger-camera` - Trigger camera capture
  - `/set-camera-mode` - Set camera mode (photo/video)
  - `/video-click` - Send tracking/refine location commands based on video click coordinates

## Building

```bash
cd udp_proxy
cargo build --release
```

### Cross-Compilation for ARM64

This project can be cross-compiled for ARM64 (aarch64) architecture from an x86_64 WSL environment.

#### Prerequisites

1. **Install ARM64 Rust target:**
   ```bash
   rustup target add aarch64-unknown-linux-gnu
   ```

2. **Install cross-compilation toolchain (WSL/Ubuntu/Debian):**
   ```bash
   sudo apt-get update
   sudo apt-get install -y gcc-aarch64-linux-gnu binutils-aarch64-linux-gnu
   ```

#### Building for ARM64

**Option 1: Using the build script (recommended):**
```bash
./scripts/build-arm64.sh
```

**Option 2: Using Cargo directly:**
```bash
cargo build --release --target aarch64-unknown-linux-gnu
```

The compiled binary will be located at:
```
target/aarch64-unknown-linux-gnu/release/udp_proxy
```

#### Verifying the Binary

To verify the binary is compiled for ARM64:
```bash
file target/aarch64-unknown-linux-gnu/release/udp_proxy
```

You should see output indicating `aarch64` architecture.

#### Troubleshooting

- **"linker `aarch64-linux-gnu-gcc` not found"**: Make sure you've installed the cross-compilation toolchain packages.
- **"target not installed"**: Run `rustup target add aarch64-unknown-linux-gnu`.
- **Build errors**: Ensure all dependencies are compatible with ARM64. Most Rust crates support cross-compilation, but some native dependencies may require additional setup.

## Usage

### Command-Line Arguments

```bash
udp_proxy [OPTIONS]

Options:
  -l, --listen-port <PORT>     Port to listen on (default: 10124)
  -f, --forward-addr <ADDR>    Address to forward packets to (format: IP:PORT) [required]
      --http-port <PORT>       HTTP port for command endpoints (default: 8080)
  -h, --help                   Print help
```

### Running

**Basic usage:**
```bash
cargo run --release -- --forward-addr 127.0.0.1:14550
```

**With custom ports:**
```bash
cargo run --release -- --listen-port 10124 --forward-addr 192.168.1.100:14550 --http-port 8080
```

**Run the compiled binary:**
```bash
./target/release/udp_proxy --forward-addr 127.0.0.1:14550
```

### HTTP API Endpoints

The proxy exposes HTTP endpoints on the configured HTTP port (default: 8080):

#### 1. Trigger Camera
```bash
POST http://localhost:8080/trigger-camera
```

Triggers a camera capture command (MAV_CMD_DO_DIGICAM_CONTROL).

**Response:**
```json
{
  "status": "success",
  "message": "Command sent",
  "target": "127.0.0.1:12345",
  "sequence": 0
}
```

#### 2. Set Camera Mode
```bash
POST http://localhost:8080/set-camera-mode
Content-Type: application/json

{
  "mode": 0.0  // 0.0 = photo mode, 1.0 = video mode
}
```

Sets the camera mode (photo or video).

**Response:**
```json
{
  "status": "success",
  "message": "Camera mode set",
  "target": "127.0.0.1:12345",
  "mode": 0.0,
  "sequence": 1
}
```

#### 3. Video Click (Tracking/Refine Location)
```bash
POST http://localhost:8080/video-click
Content-Type: application/json

{
  "window_width": 1920,
  "window_height": 1080,
  "click_x": 960,
  "click_y": 540,
  "channel_id": 0,
  "command_type": "Tracking"  // "Tracking", "RefineLocation", or "Both"
}
```

Sends tracking or refine location commands based on video click coordinates. The coordinates are automatically converted from window coordinates to 1280x720 video coordinates.

**Response:**
```json
{
  "status": "success",
  "message": "Tracking command(s) sent",
  "target": "127.0.0.1:12345",
  "x_pos": 640.0,
  "y_pos": 360.0,
  "channel_id": 0,
  "command_type": "Tracking",
  "sequences": [2]
}
```

**Note:** All endpoints return `503 Service Unavailable` if no UDP client has connected yet (no source address tracked).

## How it works

1. **UDP Forwarding Task**: The proxy listens on the configured listen port (default: 10124) for incoming MAVLink packets
   - When a packet arrives, the source address is tracked (maintains the most recent source)
   - The packet is parsed as MAVLink and logged
   - The packet is forwarded to the configured forward address

2. **Response Forwarding Task**: The proxy listens for responses from the forward address
   - When a response arrives, it's parsed as MAVLink and logged
   - The response is forwarded back to the last tracked source address
   - If no source address has been tracked yet, the response is dropped

3. **HTTP Server Task**: Runs an HTTP server on the configured HTTP port (default: 8080)
   - Provides REST endpoints for camera control commands
   - Commands are serialized as MAVLink COMMAND_LONG messages
   - Messages are sent to the last tracked UDP source address
   - Sequence numbers are automatically incremented for each command

## Related Projects

- **Drone Server (Frontend)**: See `../droneserver/README.md` for instructions on running the FastAPI frontend server that serves the WebRTC video interface.

## Requirements

- Rust 1.70+ (or use rustup to install)
- Tokio async runtime (included as dependency)

## Testing

This project includes comprehensive automated tests at multiple levels:

### Prerequisites

To run all tests, you'll need:

1. **Rust toolchain** (for backend tests):
   - Rust 1.70+ (install via [rustup](https://rustup.rs/))
   - Cargo (comes with Rust)

2. **Node.js and npm** (for frontend and E2E tests):
   - Node.js 18+ and npm (install from [nodejs.org](https://nodejs.org/))
   - Or use a Node version manager like [nvm](https://github.com/nvm-sh/nvm)

3. **Playwright browsers** (for E2E tests):
   - Will be installed automatically when you install npm dependencies

### Running Tests

#### Rust Unit Tests

Tests the coordinate transformation logic and core backend functionality:

```bash
cd udp_proxy
cargo test
```

To run with output:
```bash
cargo test -- --nocapture
```

#### Frontend JavaScript Tests (Jest)

Tests the frontend video controls module:

```bash
cd droneserver
npm install
npm test
```

To run in watch mode:
```bash
npm run test:watch
```

#### End-to-End Tests (Playwright)

E2E tests verify the full user flow including video clicks and camera mode changes.

**Prerequisites for E2E tests:**
- Node.js 18+ and npm
- Playwright browsers (installed automatically on first run, or manually with `npx playwright install`)

**Running E2E tests:**

```bash
cd udp_proxy
npm install
npx playwright install chromium  # Install browser binaries (first time only)
# Note: Use 'npx playwright install' to install all browsers (chromium, firefox, webkit)
# Or install specific browsers: 'npx playwright install chromium firefox'
npm run test:e2e
```

The E2E tests automatically:
- Start a test HTTP server on port 8889 to serve the frontend files
- Mock backend API responses (`/video-click` and `/set-camera-mode`)
- Mock WebRTC/WHEP endpoints to prevent connection errors

**E2E test options:**

```bash
# Run tests in headed mode (see browser)
npm run test:e2e:headed

# Run tests with UI mode (interactive)
npm run test:e2e:ui

# Run specific test file
npx playwright test tests/e2e/video-controls.spec.ts

# Run tests for specific browser
npx playwright test --project=chromium
```

**Visual Verification:**

E2E tests automatically capture:
- **Screenshots** at key moments (stored in `test-results/screenshots/`)
- **Videos** of each test execution (stored in `test-results/`)

View test results:
```bash
# Generate and open HTML report with all screenshots and videos
# First, run tests to generate the report:
npm run test:e2e

# Then open the report (automatically finds available port):
npm run test:e2e:report
# This script will:
# - Try ports 9324, 9325, 9326 in order until one is available
# - Fall back to opening the HTML file directly if all ports are busy
# - Display the URL where the report is being served

# Alternative: Use default port (may fail if port 9323 is in use):
npm run test:e2e:open

# Or open the HTML file directly in your browser:
# macOS: open playwright-report/index.html
# Linux: xdg-open playwright-report/index.html  
# Windows: start playwright-report/index.html

# View screenshots directly
ls test-results/screenshots/

# Create animated GIFs from screenshots/videos
npm run test:e2e:gif
# or: ./scripts/create-test-gif.sh
```

**Troubleshooting:** If `npm run test:e2e:report` shows "address already in use":
- The script will automatically try other ports (9324, 9325, 9326)
- If all ports are busy, it will open the HTML file directly
- Or manually kill the process: `lsof -ti:9323 | xargs kill -9`

See `test-results/README.md` for details on creating GIFs and viewing artifacts.

**Note:** E2E tests mock backend responses by default and don't require a running backend server. To test against a real backend, you would need to:
1. Start the UDP proxy backend: `cargo run --release -- --forward-addr 127.0.0.1:14550 --http-port 8081`
2. Ensure a UDP source is connected (for the backend to have a source address)
3. Modify the test mocks to use the real backend instead

### Test Structure

- **Rust tests**: `src/main.rs` (unit tests for coordinate transformation)
- **Jest tests**: `droneserver/static/webrtc/__tests__/video-controls.test.js`
- **E2E tests**: `udp_proxy/tests/e2e/video-controls.spec.ts`

### Running All Tests

To run all test suites:

```bash
# 1. Rust tests
cd udp_proxy
cargo test

# 2. Frontend tests
cd ../droneserver
npm test

# 3. E2E tests (requires servers running)
cd ../udp_proxy
npm run test:e2e
```


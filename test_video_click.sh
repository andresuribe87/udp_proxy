#!/bin/bash
# Test script for /video-click endpoint

# Default values
WINDOW_WIDTH=${1:-1920}
WINDOW_HEIGHT=${2:-1080}
CLICK_X=${3:-960}
CLICK_Y=${4:-540}
CHANNEL_ID=${5:-0}
COMMAND_TYPE=${6:-"Tracking"}

echo "Testing /video-click endpoint on port 8081..."
echo "Window: ${WINDOW_WIDTH}x${WINDOW_HEIGHT}"
echo "Click position: (${CLICK_X}, ${CLICK_Y})"
echo "Channel ID: ${CHANNEL_ID}"
echo "Command type: ${COMMAND_TYPE}"
echo ""

curl -X POST http://localhost:8081/video-click \
  -H "Content-Type: application/json" \
  -d "{
    \"window_width\": $WINDOW_WIDTH,
    \"window_height\": $WINDOW_HEIGHT,
    \"click_x\": $CLICK_X,
    \"click_y\": $CLICK_Y,
    \"channel_id\": $CHANNEL_ID,
    \"command_type\": \"$COMMAND_TYPE\"
  }" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -v

echo ""
echo "Done."


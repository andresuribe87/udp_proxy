#!/bin/bash
# Test script for /set-camera-mode endpoint

MODE=${1:-1.0}  # Default mode is 1.0 if not provided

echo "Testing /set-camera-mode endpoint on port 8081..."
echo "Setting camera mode to: $MODE"
echo ""

curl -X POST http://localhost:8081/set-camera-mode \
  -H "Content-Type: application/json" \
  -d "{\"mode\": $MODE}" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -v

echo ""
echo "Done."


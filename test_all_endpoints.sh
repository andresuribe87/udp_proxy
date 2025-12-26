#!/bin/bash
# Test script that runs all endpoint tests

echo "=========================================="
echo "Running all endpoint tests on port 8081"
echo "=========================================="
echo ""

echo "1. Testing /trigger-camera..."
curl -X POST http://localhost:8081/trigger-camera \
  -H "Content-Type: application/json" \
  -s | jq '.' 2>/dev/null || cat
echo ""
echo ""

echo "2. Testing /set-camera-mode (mode=2.0)..."
curl -X POST http://localhost:8081/set-camera-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": 2.0}' \
  -s | jq '.' 2>/dev/null || cat
echo ""
echo ""

echo "3. Testing /video-click (Tracking)..."
curl -X POST http://localhost:8081/video-click \
  -H "Content-Type: application/json" \
  -d '{
    "window_width": 1920,
    "window_height": 1080,
    "click_x": 960,
    "click_y": 540,
    "channel_id": 0,
    "command_type": "Tracking"
  }' \
  -s | jq '.' 2>/dev/null || cat
echo ""
echo ""

echo "4. Testing /video-click (RefineLocation)..."
curl -X POST http://localhost:8081/video-click \
  -H "Content-Type: application/json" \
  -d '{
    "window_width": 1920,
    "window_height": 1080,
    "click_x": 640,
    "click_y": 360,
    "channel_id": 0,
    "command_type": "RefineLocation"
  }' \
  -s | jq '.' 2>/dev/null || cat
echo ""
echo ""

echo "=========================================="
echo "All tests completed!"
echo "=========================================="


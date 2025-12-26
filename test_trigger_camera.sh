#!/bin/bash
# Test script for /trigger-camera endpoint

echo "Testing /trigger-camera endpoint on port 8081..."
echo ""

curl -X POST http://localhost:8081/trigger-camera \
  -H "Content-Type: application/json" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -v

echo ""
echo "Done."


#!/bin/bash
# Script to open Playwright HTML report
# Tries multiple ports and falls back to opening the file directly

REPORT_FILE="playwright-report/index.html"

if [ ! -f "$REPORT_FILE" ]; then
    echo "Error: Report not found. Run 'npm run test:e2e' first to generate the report."
    exit 1
fi

# Try to start server on different ports
for port in 9324 9325 9326; do
    if ! lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "Opening Playwright report on http://localhost:$port"
        echo "Press Ctrl+C to stop the server"
        npx playwright show-report --port $port
        exit 0
    fi
done

# If all ports are busy, try to open the file directly
echo "All ports busy. Opening report file directly..."
if command -v xdg-open > /dev/null; then
    xdg-open "$REPORT_FILE"
elif command -v open > /dev/null; then
    open "$REPORT_FILE"
elif command -v start > /dev/null; then
    start "$REPORT_FILE"
else
    echo "Please open $REPORT_FILE in your browser manually"
    echo "Or kill the process using port 9323 and run: npm run test:e2e:open"
fi



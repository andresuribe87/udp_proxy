#!/bin/bash
# Script to create animated GIFs from test screenshots
# Requires ImageMagick (convert) or ffmpeg

set -e

SCREENSHOT_DIR="test-results/screenshots"
OUTPUT_DIR="test-results/gifs"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if ImageMagick is available
if command -v convert &> /dev/null; then
    echo "Using ImageMagick to create GIFs..."
    
    # Create GIF showing click marker animation
    if [ -f "$SCREENSHOT_DIR/03-before-click.png" ] && \
       [ -f "$SCREENSHOT_DIR/04-click-marker-visible.png" ] && \
       [ -f "$SCREENSHOT_DIR/05-after-marker-disappears.png" ]; then
        convert -delay 200 -loop 0 \
            "$SCREENSHOT_DIR/03-before-click.png" \
            "$SCREENSHOT_DIR/04-click-marker-visible.png" \
            "$SCREENSHOT_DIR/05-after-marker-disappears.png" \
            "$OUTPUT_DIR/click-marker-animation.gif"
        echo "✓ Created: $OUTPUT_DIR/click-marker-animation.gif"
    fi
    
    # Create GIF showing button toggle
    if [ -f "$SCREENSHOT_DIR/06-initial-tracking-off-active.png" ] && \
       [ -f "$SCREENSHOT_DIR/07-tracking-on-active.png" ]; then
        convert -delay 300 -loop 0 \
            "$SCREENSHOT_DIR/06-initial-tracking-off-active.png" \
            "$SCREENSHOT_DIR/07-tracking-on-active.png" \
            "$SCREENSHOT_DIR/09-tracking-off-active-again.png" \
            "$OUTPUT_DIR/button-toggle-animation.gif"
        echo "✓ Created: $OUTPUT_DIR/button-toggle-animation.gif"
    fi
    
    # Create comprehensive GIF showing all interactions
    if ls "$SCREENSHOT_DIR"/*.png 1> /dev/null 2>&1; then
        convert -delay 300 -loop 0 \
            "$SCREENSHOT_DIR"/*.png \
            "$OUTPUT_DIR/all-interactions.gif"
        echo "✓ Created: $OUTPUT_DIR/all-interactions.gif"
    fi
    
elif command -v ffmpeg &> /dev/null; then
    echo "Using ffmpeg to create GIFs from videos..."
    
    # Find video files and convert to GIF
    find test-results -name "video.webm" -type f | while read video; do
        test_name=$(basename $(dirname "$video"))
        output_gif="$OUTPUT_DIR/${test_name}.gif"
        
        ffmpeg -i "$video" \
            -vf "fps=10,scale=800:-1:flags=lanczos" \
            -y "$output_gif" 2>/dev/null
        
        if [ -f "$output_gif" ]; then
            echo "✓ Created: $output_gif"
        fi
    done
    
else
    echo "Error: Neither ImageMagick (convert) nor ffmpeg is installed."
    echo "Install one of them to create GIFs:"
    echo "  - ImageMagick: sudo apt-get install imagemagick"
    echo "  - ffmpeg: sudo apt-get install ffmpeg"
    exit 1
fi

echo ""
echo "GIFs created in: $OUTPUT_DIR"
echo "View them with: ls -lh $OUTPUT_DIR"



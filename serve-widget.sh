#!/bin/bash
# Serve the ChatVault widget in isolation for testing (Prompt5)
# Usage: ./serve-widget.sh
# Or specify port: PORT=4444 ./serve-widget.sh

PORT=${PORT:-4444}

echo "Serving ChatVault widget assets on http://localhost:${PORT}"
echo "Open http://localhost:${PORT}/chat-vault.html in your browser"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Check if assets directory exists
if [ ! -d "assets" ]; then
    echo "Error: assets directory not found. Run 'pnpm run build' first."
    exit 1
fi

# Check if chat-vault.html exists
if [ ! -f "assets/chat-vault.html" ]; then
    echo "Error: chat-vault.html not found in assets/. Run 'pnpm run build' first."
    exit 1
fi

# Serve the assets directory
npx serve assets -l ${PORT}


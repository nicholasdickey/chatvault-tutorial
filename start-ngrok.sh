#!/bin/bash
# Start ngrok tunnel for ChatVault MCP server
# Default port is 8000, can be overridden with PORT environment variable

PORT=${PORT:-8000}
echo "Starting ngrok tunnel for MCP server on port $PORT"
ngrok http $PORT


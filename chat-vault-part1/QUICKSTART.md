# ChatVault - Quick Start Guide

## Start ChatGPT Integration

### 1. Build Widget Assets

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1
pnpm run build
```

### 2. Start MCP Server (Terminal 1)

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1/mcp_server
pnpm start
```

You should see:

```
ChatVault MCP server listening on http://localhost:8000
  MCP endpoint: POST http://localhost:8000/mcp
```

### 3. Start Ngrok Tunnel (Terminal 2)

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1
./start-ngrok.sh
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

### 4. Configure ChatGPT

Add MCP server in ChatGPT:

- **URL**: `https://your-ngrok-url.ngrok-free.app/mcp`
- **Transport**: HTTP
- **Protocol**: MCP

### 5. Test in ChatGPT

Try these prompts:

- "Show me my saved chats"
- "Browse my saved chats"
- "What tools are available from ChatVault?"

## Expected Behavior

1. ChatGPT calls `browseSavedChats` tool
2. Widget appears inline showing 3 example chats
3. Click a chat to view details
4. Expand/collapse turns
5. Copy to clipboard works
6. Debug panel shows logs

## Troubleshooting

- **Widget doesn't appear**: Check MCP server logs and ngrok status
- **CORS errors**: Already handled, but check server logs
- **Dark mode**: Widget adapts to ChatGPT's theme automatically

## Stop Services

Press `Ctrl+C` in both terminals to stop ngrok and the MCP server.





# ChatGPT Integration Guide

## Overview

This guide walks through integrating the ChatVault MCP server with ChatGPT to test the full end-to-end flow.

## Prerequisites

- MCP server built and ready
- Widget assets built (`pnpm run build`)
- ngrok installed and configured
- ChatGPT account with Apps SDK access

## Step 1: Build Widget Assets

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1
pnpm run build
```

This generates the widget HTML, JS, and CSS in the `assets/` directory.

## Step 2: Start MCP Server

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1/mcp_server
pnpm start
```

The server will start on port 8000 (or the port specified by `PORT` environment variable).

You should see:

```
ChatVault MCP server listening on http://localhost:8000
  MCP endpoint: POST http://localhost:8000/mcp
```

## Step 3: Expose Server with Ngrok

In a new terminal:

```bash
cd /home/nick/chatvault-tutorial/chat-vault-part1
./start-ngrok.sh
# Or: PORT=8000 ./start-ngrok.sh
```

Ngrok will provide a public URL like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:8000
```

**Important:** Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

## Step 4: Configure ChatGPT

### Option A: Via ChatGPT UI (if available)

1. Open ChatGPT
2. Go to Settings → Apps SDK / MCP
3. Add new MCP server:
   - **Name**: ChatVault
   - **URL**: `https://your-ngrok-url.ngrok-free.app/mcp`
   - **Transport**: HTTP
   - **Protocol**: MCP

### Option B: Via Configuration File

If using a configuration file, add:

```json
{
  "mcpServers": {
    "chat-vault": {
      "url": "https://your-ngrok-url.ngrok-free.app/mcp",
      "transport": "http"
    }
  }
}
```

## Step 5: Test the Integration

### Test 1: List Tools

Ask ChatGPT:

```
What tools are available from ChatVault?
```

Expected: ChatGPT should list `browseSavedChats`, `loadChats`, `saveChat`, `searchChat`

### Test 2: Browse Saved Chats

Ask ChatGPT:

```
Show me my saved chats
```

or

```
Browse my saved chats
```

Expected:

- ChatGPT calls `browseSavedChats` tool
- Widget appears inline in the chat
- Widget shows the list of saved chats (3 example chats)

### Test 3: Widget Interactions

In the widget:

- Click on a chat to view details
- Expand/collapse turns
- Test copy to clipboard buttons
- Toggle debug panel
- Verify dark mode (if ChatGPT is in dark mode)

### Test 4: Load Chats via Skybridge

The widget should automatically call `loadChats` via `window.openai.callTool` when it loads.

Check the debug panel in the widget to see:

- "Widget initialized"
- "Calling loadChats via skybridge"
- "loadChats result" with chat data

## Troubleshooting

### Widget Doesn't Appear

1. **Check MCP server logs**: Look for errors in the server console
2. **Check ngrok**: Verify ngrok is forwarding correctly
3. **Check ChatGPT**: Look for errors in ChatGPT's developer console
4. **Verify widget HTML**: Check that `resources/read` returns valid HTML

### Widget Shows "Isolation Mode"

- This means `window.openai.callTool` is not available
- Check if ChatGPT has enabled skybridge for widgets
- Verify the widget is being loaded in the correct context

### Dark Mode Issues

- Widget should detect `data-theme="dark"` from ChatGPT
- If widget is too dark/light, check the theme detection logs in debug panel

### Network Errors

- Verify ngrok URL is correct
- Check that MCP server is running
- Ensure firewall allows connections
- Check ngrok tunnel status

### CORS Issues

- MCP server should handle CORS (already implemented)
- Check server logs for CORS-related errors

## Expected Behavior

### Full Flow

1. User asks ChatGPT to browse saved chats
2. ChatGPT calls `browseSavedChats` tool via MCP
3. MCP server returns widget metadata
4. ChatGPT requests widget HTML via `resources/read`
5. MCP server returns inlined HTML with embedded chat data
6. ChatGPT renders widget in iframe
7. Widget loads and displays chat list
8. Widget calls `loadChats` via skybridge (if needed)
9. User interacts with widget (expand, copy, etc.)

### Debug Panel Logs

You should see in the widget's debug panel:

- "Widget initialized"
- "Loading initial chat data"
- "Loaded chats from embedded data" (or "Calling loadChats via skybridge")
- Interaction logs (clicks, expands, copies)

## Verification Checklist

- [ ] MCP server starts without errors
- [ ] Ngrok tunnel is active and forwarding
- [ ] ChatGPT can connect to MCP server
- [ ] Tools are listed correctly
- [ ] `browseSavedChats` tool call works
- [ ] Widget HTML is returned correctly
- [ ] Widget renders in ChatGPT
- [ ] Chat list displays correctly
- [ ] Chat detail view works
- [ ] Expand/collapse works
- [ ] Copy to clipboard works
- [ ] Debug panel works
- [ ] Dark mode adapts correctly
- [ ] Skybridge calls work (if available)

## Next Steps After Integration

1. Test all widget interactions
2. Verify error handling
3. Test with different chat data
4. Test dark/light mode switching
5. Monitor performance
6. Check logs for any issues

## Notes

- Keep ngrok running while testing
- Keep MCP server running while testing
- Check both server logs and widget debug panel
- Widget should work even if skybridge is unavailable (isolation mode)
- All widget interactions should be responsive and smooth

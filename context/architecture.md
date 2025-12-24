# Architecture Overview

## System Components

```
┌─────────────────┐
│   ChatGPT UI    │
│  (Apps SDK)     │
└────────┬────────┘
         │
         │ HTTP POST /mcp
         │ JSON-RPC 2.0
         │
         ▼
┌─────────────────┐
│   MCP Server    │
│  (Node.js)      │
│  Port: 8000     │
└────────┬────────┘
         │
         │ Reads/Writes
         │
         ▼
┌─────────────────┐
│  Chat Storage   │
│  (File System)  │
└─────────────────┘
```

## MCP Protocol Flow

### 1. Initialize

```
Client → Server: POST /mcp
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "...", "version": "..." }
  }
}

Server → Client: 200 OK
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "resources": {}, "tools": {} },
    "serverInfo": { "name": "chat-vault-part1", "version": "0.1.0" }
  }
}
Headers: mcp-session-id: session-{timestamp}-{random}
```

### 2. Notification: Initialized

```
Client → Server: POST /mcp
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "params": {}
}
Headers: mcp-session-id: session-{id}

Server → Client: 204 No Content
```

### 3. List Tools

```
Client → Server: POST /mcp
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
Headers: mcp-session-id: session-{id}

Server → Client: 200 OK
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "browseMySavedChats",
        "description": "...",
        "inputSchema": { ... },
        "_meta": {
          "openai/outputTemplate": "ui://widget/chat-vault.html"
        }
      }
    ]
  }
}
```

### 4. Call Tool

```
Client → Server: POST /mcp
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "browseMySavedChats",
    "arguments": {}
  }
}
Headers: mcp-session-id: session-{id}

Server → Client: 200 OK
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{"type": "text", "text": "Opened ChatVault!"}],
    "_meta": {
      "openai/toolInvocation/invoking": "Browsing saved chats",
      "openai/toolInvocation/invoked": "ChatVault opened"
    }
  }
}
```

### 5. List Resources

```
Client → Server: POST /mcp
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/list",
  "params": {}
}
Headers: mcp-session-id: session-{id}

Server → Client: 200 OK
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "resources": [
      {
        "uri": "ui://widget/chat-vault.html",
        "name": "ChatVault",
        "mimeType": "text/html+skybridge"
      }
    ]
  }
}
```

### 6. Read Resource (Widget HTML)

```
Client → Server: POST /mcp
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "resources/read",
  "params": {
    "uri": "ui://widget/chat-vault.html"
  }
}
Headers: mcp-session-id: session-{id}

Server → Client: 200 OK
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "contents": [
      {
        "text": "<!doctype html>...<script type=\"module\">...inlined JS...</script><style>...inlined CSS...</style>..."
      }
    ]
  }
}
```

## Widget Rendering

1. ChatGPT receives widget HTML from `resources/read`
2. HTML is injected into iframe
3. Widget JavaScript executes (React app)
4. Widget reads embedded data (if any)
5. Widget renders UI

## Asset Inlining Process

```
Original HTML:
  <script src="/chat-vault-abc123.js"></script>
  <link rel="stylesheet" href="/chat-vault-abc123.css">

After Inlining:
  <script type="module">/* inlined JS content */</script>
  <style>/* inlined CSS content */</style>
```

**Key Points:**

- JavaScript preserves `type="module"` for ESM
- All assets become inline (no external requests)
- Widget is self-contained

## Session Management

- Session created on first `initialize` request
- Session ID returned in `mcp-session-id` header
- Client includes session ID in subsequent requests
- Server maintains session state (if needed)
- Session persists until client disconnects

## Error Handling

**JSON-RPC Errors:**

```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

**HTTP Errors:**

- 400: Bad Request (missing URL, invalid JSON)
- 404: Not Found (wrong endpoint)
- 500: Internal Server Error (unhandled exception)
- 204: No Content (notifications)

## Logging

All MCP operations are logged:

- Incoming request body
- Parsed request details
- Handler execution
- Response data
- Errors with stack traces

Log format: `[MCP]` or `[MCP Handler]` prefix

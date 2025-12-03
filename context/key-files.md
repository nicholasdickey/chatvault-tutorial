# Key Files Reference

## MCP Server

### `mcp_server/src/server.ts`

Main MCP server implementation. Key functions:

- `handleMcpRequest()`: Main HTTP request handler for `/mcp` endpoint
- `handleInitialize()`: MCP initialize handshake
- `handleListTools()`: Returns available tools
- `handleCallTool()`: Executes tool calls
- `handleListResources()`: Returns available resources
- `handleReadResource()`: Returns widget HTML with inlined assets
- `readWidgetHtml()`: Loads and processes widget HTML
- `localizeWidgetAssets()`: Inlines JS/CSS into HTML

**Key Features:**

- HTTP streaming transport (single POST endpoint)
- Session management via `mcp-session-id` header
- Asset inlining preserves `type="module"` for ESM
- Comprehensive logging throughout

## Widget

### `src/chat-vault/index.jsx`

React widget component (currently placeholder):

- Displays "ChatVault" header
- Shows "No chats found" message
- Placeholder for Prompt4 implementation
- Will need to implement:
  - Chat list display
  - Search/filter functionality
  - Save/load chat actions

## Test Utilities

### `tests/mcp-client.ts`

MCP client for simulating Apps SDK requests:

- `initialize()`: Initialize MCP session
- `sendNotification()`: Send notifications (no id)
- `listTools()`: List available tools
- `callTool()`: Call a tool
- `listResources()`: List available resources
- `readResource()`: Read a resource (widget HTML)

### `tests/mcp-server-helper.ts`

Server lifecycle management:

- `startMcpServer(port)`: Start server on given port
- `stopMcpServer()`: Stop server and clean up
- `cleanupTestPorts()`: Kill processes on ports 8000-8020
- `getServerPort()`: Get current server port
- `isPortAvailable(port)`: Check if port is free

**Features:**

- Automatic port conflict resolution
- Health check polling
- Comprehensive cleanup (removes listeners, destroys streams)
- Port cleanup utilities

## Configuration Files

### `jest.config.js`

Jest configuration:

- ESM support with `ts-jest`
- Test timeout: 30 seconds
- Serial execution (`maxWorkers: 1`)
- Module name mapping for `.js` imports

### `build-all.mts`

Build script:

- Only builds `chat-vault` widget
- Generates hashed asset files in `assets/`

### `start-ngrok.sh`

Ngrok startup script:

- Exposes MCP server to internet
- Default port: 8000
- Configurable via `PORT` env var

## Test Files

### `tests/browse-saved-chats.test.ts`

End-to-end test for browse action:

- Tests full MCP flow
- Validates tool metadata
- Checks resource URI and MIME type
- Verifies widget HTML is returned

### `tests/widget-module-semantics.test.ts`

Widget bundle validation:

- Checks for `type="module"` script tags
- Verifies CSS is inlined
- Ensures no external asset requests
- Validates script tag escaping

### `tests/mcp-protocol-compliance.test.ts`

JSON-RPC 2.0 protocol validation:

- Validates response format
- Tests notification handling
- Checks error responses
- Verifies session management

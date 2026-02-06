Title: Generic Vercel MCP App + Widget PROMPTS

Prerequisites:

- git
- Node.js 24+
- Vercel account (for deployment)
- ngrok (for local tunneling if you want to test from ChatGPT/Claude against localhost)
- Cursor (these prompts are tuned for running inside the Cursor editor)
- ChatGPT Plus membership

This document defines **generic prompts** for building a simple, plain-MCP HTTP server that exposes an MCP App-style widget, and deploying it to **Vercel** as a serverless function.  
Project-specific behavior (tools, data model, widget UI) should be defined in that project's own prompt file as its **Prompt4/Prompt5+**.

## Engineering Principles (for all prompts)

- **Simplicity over magic**: Prefer a straightforward MCP `Server` with explicit JSON-RPC handlers (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`) over higher-level wrappers. Avoid `registerAppTool` or other helpers that hide protocol behavior behind extra layers.
- **Plain MCP tools, even for Apps**: Treat an MCP App as “a regular MCP server that happens to serve a UI resource and tool metadata for a widget,” not a different protocol. Build on the same patterns from Part 1 (simple HTTP JSON-RPC) and only add the minimal extra `_meta`/resource wiring needed to open the widget.
- **Verify, don’t guess**: When behavior depends on external systems (Apps SDK, MCP spec, Vercel, ChatGPT/Claude), consult docs or run a minimal experiment. Don’t ship speculative workarounds unless they’re clearly logged and easy to revert.
- **Design for observability**: Log each JSON-RPC request/response on `/mcp` (method, id, params summary, response size). Make widget behavior observable via an in-widget debug log panel, so “vibe engineers” can understand what’s happening without digging into server logs.
- **Graceful degradation**: The server and widget should detect missing capabilities (for example, wrong API key, missing `window.openai`, resource 404) and fail in a bounded, understandable way—clear error text, no infinite retries or silent hangs.

project name - `${PROJECT_NAME}`

---

Prompt0: Scaffold Vercel MCP App project

- Start from an existing Apps SDK example repo or from a minimal Node/Vite setup.
- Create a new project directory for `${PROJECT_NAME}` (for example, `chat-vault-part3`) alongside any existing parts (Part 1/Part 2).
- Ensure the project structure supports:
  - A **Node entrypoint** that can be run locally (for dev and tests).
  - A **Vercel serverless function** entrypoint for `/mcp` (for production).
- Set up `package.json` with:
  - `@modelcontextprotocol/sdk` as the sole MCP dependency (no `@modelcontextprotocol/ext-apps` or `registerAppTool` usage).
  - Vite + React (or similar) to build a single HTML widget bundle (for the MCP App UI).
  - Scripts for:
    - `dev` – local MCP server.
    - `build` – compile server + widget assets.
    - `vercel-build` – Vercel build hook that runs `build`.

---

Prompt1: Implement simple HTTP JSON-RPC MCP server for Vercel

Goal: Create a **plain MCP HTTP server** that can run both:

- As a local Node process (`node server.ts` or `npm start`), and
- As a Vercel serverless function mounted at `/mcp` or `/api/mcp`.

Non‑negotiables:

- Use `@modelcontextprotocol/sdk/server/index.js` `Server` and the same patterns as in Part 1:
  - Construct one `Server` with `capabilities: { tools: {}, resources: {} }`.
  - Register handlers using `setRequestHandler` for:
    - `initialize`
    - `tools/list`
    - `tools/call`
    - `resources/list`
    - `resources/read`
- HTTP surface (both local and Vercel) must:
  - Accept **one JSON-RPC request per HTTP POST**.
  - Parse the body as a single JSON object (no NDJSON/batching).
  - Always respond with a single JSON-RPC response object and then `end()` the HTTP response.
  - Use `Content-Type: application/json` for all JSON-RPC responses.
- JSON-RPC rules:
  - For `initialize`, respond with protocol/capabilities and a `serverInfo` block. It’s fine to hardcode protocol version and capabilities for now.
  - For notifications (no `id`): return HTTP 204 No Content (or a minimal JSON-RPC success) and **do not** emit a JSON-RPC result with `id`.
  - For errors in handlers, return a proper JSON-RPC error object with `code`, `message`, and optional `data`.
- Vercel function:
  - Wrap the same core handler in a `default` export that receives `IncomingMessage` and `ServerResponse`.
  - Do **not** use `StreamableHTTPServerTransport` or any ext‑apps helper; stick to a simple “read body → JSON.parse → dispatch → write JSON-RPC response”.

---

Prompt2: Build the MCP App widget HTML bundle

Goal: Produce a **single HTML file** (for example, `assets/mcp-app.html`) that contains the ChatVault widget UI to be loaded as an MCP App.

Requirements:

- Use Vite (or similar) to:
  - Build a React-based widget (or simple vanilla JS) to a single HTML output.
  - Include JS and CSS either inline or as predictable asset filenames in `assets/`.
- Add a small `localizeWidgetAssets(html, assetsDir)` helper (similar to Part 1):
  - Read the built HTML.
  - Inline `<script src="...">` and `<link rel="stylesheet" href="...">` tags by reading the referenced JS/CSS from `assets/` and replacing them with `<script>` / `<style>` tags.
  - Preserve ES module semantics by using `<script type="module">` when needed.
- The final stored HTML (returned by `resources/read`) should be **self-contained**:
  - No external network requests for JS/CSS.
  - Safe to serve over a single Vercel route and via a single ngrok tunnel.
- Include a small debug/log panel at the bottom of the widget:
  - Track logs in state (`logs[]`).
  - Log at least: widget mount, host detection (`window.openai` / `window.tools`), tool calls, responses, and errors.

---

Prompt3: Wire MCP App UI resources and browse tool (plain MCP style)

Goal: Expose the widget as an MCP App using **plain MCP tools and resources**, without `registerAppTool`.

Non‑negotiables:

- Choose a canonical widget URI (for example, `ui://chat-vault/mcp-app.html`).
- Implement `resources/list` to include:
  - One resource entry for the MCP App widget:
    - `uri: "ui://chat-vault/mcp-app.html"`
    - `mimeType` appropriate for MCP Apps (for example, `"text/html+skybridge"` or `"text/html;profile=mcp-app"` depending on current docs).
    - `_meta` that tells the host this is widget markup (follow whatever metadata pattern is in the current Apps SDK examples).
- Implement `resources/read` to:
  - Return the inlined HTML from Prompt2 as `text`.
  - Mirror the same `uri`, `mimeType`, and `_meta` as in `resources/list`.
- Implement a **simple browse tool** (`browseMySavedChats` or project-specific name) in `tools/list` / `tools/call`:
  - `inputSchema` should be a simple JSON schema object or “no required fields” object to keep validation trivial.
  - The tool’s `_meta` must:
    - Point the host at the widget resource URI (for example, `ui://chat-vault/mcp-app.html`).
    - Include whatever additional widget hints the host expects (for example, widget description, whether it prefers a border, etc.).
  - `tools/call` for this tool can:
    - Return a simple text confirmation, and/or
    - Include additional `_meta`/structured data the widget or host might use.
- All of this should be done using the **same plain MCP server** as Prompt1:
  - No `@modelcontextprotocol/ext-apps`.
  - No `registerAppTool`.
  - No extra streaming transport layers.

---

Prompt4: Deployment, logging, and end-to-end verification

Goal: Deploy the MCP App to Vercel and verify that ChatGPT/Claude can:

- Call `initialize`, `tools/list`, `resources/list`, and `resources/read`.
- Call the browse tool and open the MCP App widget UI.

Requirements:

- Vercel deployment:
  - Configure `vercel.json` (or `vercel` UI) so that:
    - POST `/mcp` (or `/api/mcp`) routes to your serverless handler.
    - Static assets (if any) are available as needed (even though widget HTML is inlined).
  - Add a `vercel-build` script that:
    - Builds server code.
    - Builds and inlines the widget HTML.
- Logging & diagnostics:
  - Log all incoming JSON-RPC requests (method, id, keys of `params`).
  - Log all outgoing JSON-RPC responses (id, whether it’s result or error, and total bytes written).
  - Add enough widget-side logging (in the debug panel) to understand host behavior (e.g., when `window.openai.callTool` resolves or fails).
- End-to-end tests (can be minimal):
  - A Node script or Jest test that:
    - Calls the deployed `/mcp` endpoint with `initialize`, `tools/list`, `resources/list`, `resources/read`, and `tools/call` for the browse tool.
    - Asserts response shapes and confirms the widget HTML is returned and looks structurally correct (contains `<html>`, `<script>`, etc.).
  - Optionally add a local test that hits the dev server instead of Vercel to speed up iteration.


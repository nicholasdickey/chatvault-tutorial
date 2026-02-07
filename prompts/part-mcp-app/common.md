Title: Generic Vercel MCP App + Widget PROMPTS (MCP Apps SDK)

Prerequisites:

- git
- Node.js 24+
- Vercel account (for deployment)
- ngrok (for local tunneling if you want to test from ChatGPT/Claude against localhost)
- Cursor (these prompts are tuned for running inside the Cursor editor)
- ChatGPT Plus membership

This document defines **generic prompts** for building an MCP App that exposes a widget via the **MCP Apps SDK** (`@modelcontextprotocol/ext-apps`), and deploying it to **Vercel** as a serverless function.  
Project-specific behavior (tools, data model, widget UI) should be defined in that project's own prompt file as its **Prompt4/Prompt5+**.

## Engineering Principles (for all prompts)

- **Use the MCP Apps SDK (ext-apps) for App UI**: Use `@modelcontextprotocol/ext-apps` with `registerAppTool` and `registerAppResource` to expose the browse tool and widget resource. This gives correct tool/resource shape and `_meta` (e.g. `ui.resourceUri`, OpenAI CSP hints) so MCP App clients (e.g. ChatGPT, Claude) can render the widget iframe correctly.
- **Single-file widget at build time**: The widget is built as **one HTML file** (e.g. `assets/mcp-app.html`) with JS and CSS **inlined** by Vite + `vite-plugin-singlefile`. The server **reads and serves that file as-is**; there is no server-side inlining (unlike Part 1's `localizeWidgetAssets`).
- **Verify, don't guess**: When behavior depends on external systems (MCP Apps spec, Vercel, ChatGPT/Claude), consult docs or run a minimal experiment. Don't ship speculative workarounds unless they're clearly logged and easy to revert.
- **Design for observability**: Log each JSON-RPC request/response on `/mcp` (method, id, params summary, response size). Make widget behavior observable via an in-widget debug log panel.
- **Graceful degradation**: The server and widget should detect missing capabilities (wrong API key, missing client APIs, resource 404) and fail in a bounded, understandable way—clear error text, no infinite retries or silent hangs.

project name - `${PROJECT_NAME}`

---

Prompt0: Scaffold Vercel MCP App project

- Start from an existing MCP Apps example or from a minimal Node/Vite setup.
- Create a new project directory for `${PROJECT_NAME}` (for example, `chat-vault-part-mcp-app`) alongside any existing parts (Part 1/Part 2/Part 3).
- Ensure the project structure supports:
  - A **Node entrypoint** that can be run locally (for dev and tests).
  - A **Vercel serverless function** entrypoint for `/mcp` (for production).
- Set up `package.json` with:
  - `@modelcontextprotocol/sdk` and **`@modelcontextprotocol/ext-apps`** for MCP App tools and resources.
  - Vite + React + **vite-plugin-singlefile** to build the single-file widget bundle.
  - Scripts for:
    - `dev` – local MCP server.
    - `build` – compile **single-file** widget to `assets/mcp-app.html`.
    - `vercel-build` – Vercel build hook that runs `build`.

---

Prompt1: Implement HTTP JSON-RPC MCP server for Vercel

Goal: Create an MCP server that runs both:

- As a local Node process (e.g. Express or Node HTTP server), and
- As a Vercel serverless function mounted at `/mcp` or `/api/mcp`.

Non‑negotiables:

- Use `@modelcontextprotocol/sdk` to create an MCP `Server` (or `McpServer`).
- Use **`@modelcontextprotocol/ext-apps`** to register the App UI:
  - `registerAppTool(server, toolName, config, handler)` for the browse tool.
  - `registerAppResource(server, name, uri, config, readCallback)` for the widget resource.
- HTTP surface (both local and Vercel) must:
  - Accept **one JSON-RPC request per HTTP POST**.
  - Parse the body as a single JSON object (no NDJSON/batching).
  - Always respond with a single JSON-RPC response object and then end the HTTP response.
  - Use `Content-Type: application/json` for all JSON-RPC responses.
- The server can use `StreamableHTTPServerTransport` or a simple "read body → JSON.parse → dispatch → write JSON-RPC response" pattern; ensure it works with the ext-apps-registered handlers.

---

Prompt2: Build the MCP App widget as a single-file HTML bundle

Goal: Produce **one self-contained HTML file** (e.g. `assets/mcp-app.html`) that contains the full widget UI (HTML + inlined JS + inlined CSS) for the MCP App. The server will read and serve this file as-is; there is **no** server-side inlining.

Requirements:

- **HTML entry**: A root HTML file (e.g. `mcp-app.html` in the project root) that loads the app entry, for example:
  - `<script type="module" src="/src/mcp-app.ts"></script>`
  - A root element (e.g. `<div id="chat-vault-root"></div>`).
- **Build script** (e.g. in `build-all.mts` or a dedicated Vite config):
  - Use **Vite** with:
    - **React** and **Tailwind** (or equivalent) so the app entry (e.g. `src/mcp-app.ts`) and its JSX/CSS compile.
    - **vite-plugin-singlefile** so the output is one HTML file with JS and CSS inlined.
  - **Critical – output naming**: The **JS chunk must have a different name than the HTML file**. For example:
    - `rollupOptions.output.entryFileNames: "mcp-app.js"` (not `"mcp-app.html"`).
    - `rollupOptions.output.assetFileNames: "mcp-app.[ext]"` for CSS/assets.
  - If the JS chunk is named the same as the HTML (e.g. `mcp-app.html`), the build will emit a **stub** that references itself; the single-file plugin will have nothing to inline and the widget will not run in the iframe.
  - Build output: **one file** `assets/mcp-app.html` (hundreds of KB) containing inlined script and styles. A stub is only ~300 bytes and means the build is misconfigured.
- **No server-side inlining**: Do **not** add a `localizeWidgetAssets`-style step that reads separate JS/CSS and inlines them when serving. The file on disk is the final bundle.
- **Debug panel**: Include a small debug/log panel in the widget (e.g. logs for mount, client detection, tool calls, errors).

---

Prompt3: Wire MCP App UI resources and browse tool (ext-apps)

Goal: Expose the widget and browse tool using **ext-apps** helpers so the client gets correct `_meta` and can render the iframe (including CSP where needed).

Non‑negotiables:

- **Widget resource URI**: Use a canonical URI (e.g. `ui://chat-vault/mcp-app.html`).
- **registerAppResource(server, name, uri, config, readCallback)**:
  - In the read callback: read `assets/mcp-app.html` from disk (try both `__dirname`-based path and `process.cwd()/assets/` for Vercel).
  - Return `contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta }]`.
  - **`_meta` for OpenAI/ChatGPT**: Include hints so the client can render the iframe with correct permissions, for example:
    - `openai/outputTemplate`: the resource URI.
    - `openai/widgetPrefersBorder`: true.
    - `openai/widgetDomain`: your widget origin (e.g. `https://your-app.vercel.app`).
    - `openai/widgetCSP`: `{ connect_domains: [...], resource_domains: [...] }` (your app and any upstream).
  - Use `RESOURCE_MIME_TYPE` from `@modelcontextprotocol/ext-apps/server`.
- **registerAppTool(server, "browseMySavedChats", config, handler)**:
  - **inputSchema**: Use a **raw shape** (plain object of Zod schemas), e.g. `{ shortAnonId: z.string().optional(), portalLink: z.string().url().optional(), loginLink: z.string().url().optional(), isAnon: z.boolean().optional() }`. Do **not** use `z.object({...}).passthrough()` as the value for `inputSchema`; ext-apps expects `ZodRawShapeCompat` or `AnySchema`, and a passthrough ZodObject can cause type errors.
  - **config._meta.ui.resourceUri**: Set to the widget resource URI so the client knows which resource to open.
  - **Handler return**: Return an object with `content: [{ type: "text" as const, text: "..." }]` and `_meta: { ui: { resourceUri } }`. Use `type: "text" as const` so TypeScript infers the literal type expected by the API.
- **SDK version mismatch**: If the project's `@modelcontextprotocol/sdk` and ext-apps disagree on types (e.g. `registerResource(uri: string)` vs `ResourceTemplate`), use a type assertion for the server argument to `registerAppResource` (e.g. `server as unknown as Parameters<typeof registerAppResource>[0]`) so the build type-checks; at runtime the URI is a string.

---

Prompt4: Deployment, logging, and end-to-end verification

Goal: Deploy the MCP App to Vercel and verify that ChatGPT/Claude can call the server, list/read the widget resource, and open the widget when the browse tool is invoked.

Requirements:

- **Vercel deployment**:
  - Configure `vercel.json` so that POST `/mcp` (or `/api/mcp`) routes to your serverless handler.
  - Ensure the **build** runs the full widget build (e.g. `pnpm run build` or `vercel-build`) so `assets/mcp-app.html` is the **real single-file bundle**, not a stub.
  - Use **`includeFiles: "assets/**"`** (or equivalent) for the serverless function so the deployed handler can read `assets/mcp-app.html` from disk (e.g. `process.cwd()/assets/mcp-app.html`).
- **Logging**: Log incoming JSON-RPC (method, id, params keys) and outgoing responses (result vs error, byte length). Log resource read success and file size (expect hundreds of KB for the real bundle).
- **End-to-end**: A Node script or Jest test that calls the deployed `/mcp` with `initialize`, `tools/list`, `resources/list`, `resources/read`, and `tools/call` for the browse tool; assert response shapes and that the widget HTML is the single-file bundle (large size, inlined script), not a stub.

Title: Generic OpenAI Apps SDK Vibe Coding PROMPTS

Prerequisites:

- git
- ngrok
- Cursor (these prompts are tuned for running inside the Cursor editor)

This document defines **generic prompts** for building an Apps SDK + MCP + widget project.  
Project-specific behavior (tools, data model, widget UI) should be defined in that project's own prompt file as its **Prompt4** (or similar).

project name - `${PROJECT_NAME}`

Prompt0: Clone SDK

Prepare the Apps SDK examples (spec reference)

1. Clone from Apps SDK

- Check out the official Apps SDK examples:
  - `git clone https://github.com/openai/openai-apps-sdk-examples.git`
- This cloned repository will be modified in place to become `${PROJECT_NAME}` (starting in Prompt1)
- Treat the `pizzaz_server_node` example as the **canonical reference implementation** for:
  - MCP JSON-RPC request/response shapes
  - The `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read` handler behavior
  - The way UI resources and widget templates are exposed (including `ui://...` IDs and how they resolve to HTTP URIs)
  - Build process structure and file organization

2. Detach from GitHub repository

- Remove the `.git` directory to detach from the original repository
- This makes it a standalone project (a new repository will be created in a later video)
- After detaching, initialize a new Git repository for `${PROJECT_NAME}` and publish it to your own GitHub account:
  - `git init`
  - `git add .`
  - `git commit -m "Initial commit for ${PROJECT_NAME} based on OpenAI Apps SDK examples"`
  - Create an empty repository on GitHub (for example, `https://github.com/<USER>/${PROJECT_NAME}`)
  - `git remote add origin git@github.com:<USER>/${PROJECT_NAME}.git` (or the HTTPS URL if you prefer)
  - `git push -u origin main` (or `master`, depending on your default branch)

3. Rename server directory

- Rename `pizzaz_server_node/` to `mcp_server/`
- Update any references in build scripts or configuration files
- rename project directory
- remove python directories

Prompt1: Refactor SDK Example

Starting from the cloned SDK examples repository, refactor it into `${PROJECT_NAME}` by making the following changes:

Requirements (non‑negotiable):

1. Widget foundation

- Choose one widget from the SDK example as the foundation (the project-specific Prompt4 will specify which one)
- Rename that widget's source directory in `src/` to match your project's widget name (as specified in Prompt4)
- In `build-all.mts`, remove all other widgets from the `targets` array, keeping only your project's widget (as specified in Prompt4)
- The widget will be built to `assets/${WIDGET_NAME}.html`, `assets/${WIDGET_NAME}.js`, and `assets/${WIDGET_NAME}.css` (where `${WIDGET_NAME}` is specified in Prompt4)
- Remove all remaining pizza directories from the project, todo and utils too.

1a. Widget tool calling format

- When widgets call MCP tools from within the widget (using `window.openai.callTool()`), handle response metadata formats correctly:
  - **ChatGPT format**: When using `window.openai.callTool()`, ChatGPT returns tool response data in `result.meta` (not `result._meta`)
  - **MCP format**: The MCP server returns data in `result._meta` in the JSON-RPC response, but ChatGPT transforms this to `result.meta` when exposing it to widgets
  - Widget code should check `result.meta` first, then fall back to `result._meta` for backwards compatibility
  - Example: If the MCP server returns `_meta: { chats: [...], pagination: {...} }`, the widget should access it via `result.meta.chats` when called via `window.openai.callTool()`

1b. Widget debug logging (recommended)

- Because widget iframes may not expose their console in all environments, add a small in-widget **debug log panel**:
  - Maintain a `logs` state array and a `log(level, msg, meta?)` helper that also best-effort mirrors to `console`.
  - Log at least: widget mount, theme detection, MCP API detection, all `window.openai.callTool` / `window.tools.call` attempts, response-shape decisions, and errors.
  - Render logs in a collapsible panel at the bottom of the widget so issues can be diagnosed even when the iframe console is not visible.

2. MCP server structure

- Keep the `widgets` array structure in `mcp_server/src/server.ts` (for easy expansion later)
- Replace the widgets array with a single entry for your project's widget (name, templateUri, and metadata as specified in Prompt4)
- Keep all handler patterns identical to the SDK example (`tools/list`, `tools/call`, `resources/list`, `resources/get`)
- When in doubt, follow the SDK example structure exactly

3. Transport: Replace SSE with HTTP streaming

- Replace the SSE transport (`SSEServerTransport`, `GET /mcp`, `POST /mcp/messages`) with HTTP streaming
- Expose a single `POST /mcp` endpoint that:
  - Uses the `@modelcontextprotocol/sdk` `Server` instance internally for all MCP behavior
  - Speaks JSON-RPC over HTTP using streaming responses (chunked JSON lines), NOT SSE
  - Manually dispatches JSON-RPC requests to `server.request()` and formats responses
- Keep session management pattern similar to the SDK example
- Keep everything else from the SDK example structure (file organization, build process, etc.)

3a. Asset inlining for single-port deployment

- Implement asset inlining to make widgets self-contained and work with a single ngrok port
- When reading widget HTML from `assets/${WIDGET_NAME}.html`, process it to inline all external assets:
  - Create a `localizeWidgetAssets(html: string, assetsDir: string): string` function that:
    1. Reads the HTML string
    2. Uses regex to find all `<script src="...">` tags pointing to JS files in the assets directory
    3. For each script tag: read the JS file from `assets`, escape `</script>` sequences in the JS content, and replace the `<script src="...">` tag with an inline `<script>` tag containing the file contents
       - If the JS bundle is ESM (for example, Vite output with `import`/`export`), preserve module semantics by using `<script type="module">…</script>` for the inlined script instead of a plain `<script>…</script>`.
    4. Uses regex to find all `<link rel="stylesheet" href="...">` tags pointing to CSS files in the assets directory
    5. For each stylesheet link: read the CSS file from `assets/` and replace the `<link>` tag with an inline `<style>` tag containing the file contents
    6. Returns the processed HTML with all assets inlined
- Apply `localizeWidgetAssets()` when reading widget HTML (before storing it in the widget definition or returning it from `resources/read`)
- The processed HTML should be stored in the widget object so it's ready to return when `resources/read` is called
- Result: Widget HTML returned by `resources/read` should be self-contained with all JS and CSS inlined, requiring no external asset requests and enabling single-port deployment via ngrok
- Optional: Add a `GET /assets/*` route to serve raw assets for development/debugging (controlled by an env var like `INLINE_WIDGET_ASSETS=false`)

4. Project metadata

- Update server name in `mcp_server/src/server.ts`: `name: "${PROJECT_NAME}"`
- Update `package.json` name: `"${PROJECT_NAME}"`
- Keep all dependencies identical to the SDK example

---

Prompt2: Install + Server + Ngrok + Logging

Install all dependencies, start the MCP server, and create an `ngrok` script that shares the server port. Saturate the MCP path, including tools and resources, with `console.log` statements so we can observe end-to-end traffic.

Non‑negotiables:

- Ensure the MCP server can be started with a single command (for example, `npm start`).
- Add a script (or simple shell file) that starts `ngrok http <PORT>` against the MCP server port.
- Add detailed logging to:
  - The `/mcp` HTTP handler (incoming request body, handshake chunk, response chunk, errors).
  - Each MCP method handler (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/get`) logging `id`, `method`, and `params`.

---

Prompt3: Jest + e2e tests for project-specific browse action

Add Jest and create end-to-end tests to verify the project-specific **browse** action and its skybridge MCP-UI behavior.

Notes:

- The exact action name and behavior (for example, `browseSavedChats`, `browseSavedItems`, or similar) is defined in the **project-specific Prompt4**.
- When Prompt4 is implemented (adding real tools, resources, and widget behavior), you **must revisit and update these tests** so they:
  - Exercise the MCP action end-to-end via the **real MCP server** (no mocks), calling `/mcp` exactly as the Apps SDK would.
  - Validate that the skybridge widget can load and render the project’s browse view using the MCP resource and tools defined in Prompt4.
  - Emit enough logging and assertions that we can prove coverage of the live MCP server implementation (including both the HTTP layer and the JSON-RPC handlers).
  - Treat the **OpenAI MCP / Apps SDK examples as the spec for behavior and shapes**: tests should assert that JSON-RPC envelopes, method names, and tool/resource/result shapes remain compatible with the current examples, and treat any drift from those examples as a failing test to fix rather than an acceptable change.

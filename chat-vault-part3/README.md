## ChatVault Part 3 – MCP Apps Port

ChatVault Part 3 is a port of the original ChatVault widget (Part 1) from the ChatGPT Apps/skybridge protocol to the **MCP Apps** protocol using `@modelcontextprotocol/ext-apps`.[Official MCP Apps docs](https://modelcontextprotocol.github.io/ext-apps)  
It preserves the existing React UI/UX while adding a dedicated MCP App server and UI resource.

### Project layout

- `src/chat-vault/` – React widget source (unchanged from Part 1).
- `assets/` – Hashed static widget bundles built via `build-all.mts` (for static testing).
- `mcp-app.html` – MCP App HTML entry that hosts the widget inside an MCP Apps iframe.
- `src/mcp-app.ts` – MCP Apps bridge that:
  - connects to the MCP Apps host with `App.connect()`,
  - exposes a `window.openai.callTool` shim that forwards to `app.callServerTool(...)`,
  - imports and boots the existing React ChatVault widget.
- `server.ts` – MCP App server using `@modelcontextprotocol/ext-apps` and `@modelcontextprotocol/sdk` that:
  - registers the `browseMySavedChats` tool with `_meta.ui.resourceUri` pointing to `ui://chat-vault/mcp-app.html`,
  - serves the bundled MCP App HTML from `dist/mcp-app.html` as a `ui://` resource.
- `vite.config.mts` – Original multi-entry Vite config for widget development.
- `vite.mcp-app.config.mts` – Minimal Vite config for single-file MCP App bundling.

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn with equivalent commands)

Install dependencies:

```bash
pnpm install
```

### Build & test the static widget (Part 1 behavior)

These commands keep the original Part 1 behavior for static widget testing and development:

- **Build the static widget assets:**

  ```bash
  pnpm run build
  ```

  This runs `build-all.mts` and produces hashed `.html`, `.js`, and `.css` files in `assets/`, including `chat-vault.html`.  
  You can serve these assets and open `chat-vault.html` directly in a browser for isolation-mode UI testing.

- **Run the dev server for the widget gallery:**

  ```bash
  pnpm run dev
  ```

- **Serve the built static widget assets:**

  ```bash
  pnpm run serve
  ```

  The assets are available at `http://localhost:4444` with CORS enabled.

### Build the MCP App UI bundle

To build the MCP App HTML resource that will be served via `ui://chat-vault/mcp-app.html`:

```bash
pnpm run build:mcp-app
```

This uses `vite.mcp-app.config.mts` with `vite-plugin-singlefile` to bundle `mcp-app.html` (and the React widget it imports) into a single HTML file at:

- `assets/mcp-app.html`

The MCP App server reads this file when serving the `ui://chat-vault/mcp-app.html` resource.

### Run the MCP App server

Start the MCP App HTTP server:

```bash
pnpm run serve:mcp-app
```

By default it listens on:

- `http://localhost:3001/mcp`

You can change the port by setting the `PORT` environment variable before running the command.

### Testing with an MCP Apps host

1. **Build and serve the MCP App:**

   ```bash
   pnpm run build:mcp-app
   pnpm run serve:mcp-app
   ```

2. **Connect an MCP Apps-capable host** (for example, the basic host in the `ext-apps` repo or a client like Claude / VS Code that supports MCP Apps) to `http://localhost:3001/mcp`.  
   When the host calls the `browseMySavedChats` tool, it will:
   - load the `ui://chat-vault/mcp-app.html` resource,
   - render the bundled `assets/mcp-app.html` inside a sandboxed iframe,
   - allow the React ChatVault widget to call tools via `window.openai.callTool`, which is bridged to `app.callServerTool(...)`.

3. **Static widget behavior** remains available via the original Part 1 build:
   - You can open `assets/chat-vault.html` directly in a browser.
   - In this mode, if `window.openai.callTool` is not present, the widget runs in isolation mode for UI-only testing.

# Apps SDK Examples Gallery

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

This repository showcases example UI components to be used with the Apps SDK, as well as example MCP servers that expose a collection of components as tools.
It is meant to be used as a starting point and source of inspiration to build your own apps for ChatGPT.

Note: If you are on Chrome and have recently updated to version 142, you will need to disable the [`local-network-access` flag](https://developer.chrome.com/release-notes/142#local_network_access_restrictions) to see the widget UI.

How to disable it:

1. Go to chrome://flags/
2. Find #local-network-access-check
3. Set it to Disabled

⚠️ **Note 🚨 Make sure to restart Chrome after changing this flag for the update to take effect.**

## MCP + Apps SDK overview

The Model Context Protocol (MCP) is an open specification for connecting large language model clients to external tools, data, and user interfaces. An MCP server exposes tools that a model can call during a conversation and returns results according to the tool contracts. Those results can include extra metadata—such as inline HTML—that the Apps SDK uses to render rich UI components (widgets) alongside assistant messages.

Within the Apps SDK, MCP keeps the server, model, and UI in sync. By standardizing the wire format, authentication, and metadata, it lets ChatGPT reason about your connector the same way it reasons about built-in tools. A minimal MCP integration for Apps SDK implements three capabilities:

1. **List tools** – Your server advertises the tools it supports, including their JSON Schema input/output contracts and optional annotations (for example, `readOnlyHint`).
2. **Call tools** – When a model selects a tool, it issues a `call_tool` request with arguments that match the user intent. Your server executes the action and returns structured content the model can parse.
3. **Return widgets** – Alongside structured content, return embedded resources in the response metadata so the Apps SDK can render the interface inline in the Apps SDK client (ChatGPT).

Because the protocol is transport agnostic, you can host the server over Server-Sent Events or streaming HTTP—Apps SDK supports both.

The MCP servers in this demo highlight how each tool can light up widgets by combining structured payloads with `_meta.openai/outputTemplate` metadata returned from the MCP servers.

## Repository structure

- `src/` – Source for each widget example.
- `assets/` – Generated HTML, JS, and CSS bundles after running the build step.
- `mcp_server/` – MCP server implemented with the official TypeScript SDK.
- `build-all.mts` – Vite build orchestrator that produces hashed bundles for every widget entrypoint.

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm/yarn
- pre-commit for formatting

## Install dependencies

Clone the repository and install the workspace dependencies:

```bash
pnpm install
pre-commit install
```

> Using npm or yarn? Install the root dependencies with your preferred client and adjust the commands below accordingly.

## Build the components gallery

The components are bundled into standalone assets that the MCP servers serve as reusable UI resources.

```bash
pnpm run build
```

This command runs `build-all.mts`, producing versioned `.html`, `.js`, and `.css` files inside `assets/`. Each widget is wrapped with the CSS it needs so you can host the bundles directly or ship them with your own server.

To iterate on your components locally, you can also launch the Vite dev server:

```bash
pnpm run dev
```

## Serve the static assets

All of the MCP servers expect the bundled HTML, JS, and CSS to be served from the local static file server. After every build, start the server before launching any MCP processes:

```bash
pnpm run serve
```

The assets are exposed at [`http://localhost:4444`](http://localhost:4444) with CORS enabled so that local tooling (including MCP inspectors) can fetch them.

> **Note:** The Python Pizzaz server caches widget HTML with `functools.lru_cache`. If you rebuild or manually edit files in `assets/`, restart the MCP server so it picks up the updated markup.

## Run the MCP servers

The repository ships several demo MCP servers that highlight different widget bundles:

- **Pizzaz (Node & Python)** – pizza-inspired collection of tools and components
- **Solar system (Python)** – 3D solar system viewer

### MCP server

```bash
cd mcp_server
pnpm start
```

## Testing in ChatGPT

To add these apps to ChatGPT, enable [developer mode](https://platform.openai.com/docs/guides/developer-mode), and add your apps in Settings > Connectors.

To add your local server without deploying it, you can use a tool like [ngrok](https://ngrok.com/) to expose your local server to the internet.

For example, once your mcp servers are running, you can run:

```bash
ngrok http 8000
```

You will get a public URL that you can use to add your local server to ChatGPT in Settings > Connectors.

For example: `https://<custom_endpoint>.ngrok-free.app/mcp`

Once you add a connector, you can use it in ChatGPT conversations.

You can add your app to the conversation context by selecting it in the "More" options.

![more-chatgpt](https://github.com/user-attachments/assets/26852b36-7f9e-4f48-a515-aebd87173399)

You can then invoke tools by asking something related. For example, for the Pizzaz app, you can ask "What are the best pizzas in town?".

## Next steps

- Customize the widget data: edit the handlers in `mcp_server/src` to fetch data from your systems.
- Create your own components and add them to the gallery: drop new entries into `src/` and they will be picked up automatically by the build script.

### Deploy your MCP server

You can use the cloud environment of your choice to deploy your MCP server.

Include this in the environment variables:

```
BASE_URL=https://your-server.com
```

This will be used to generate the HTML for the widgets so that they can serve static assets from this hosted url.

## Contributing

You are welcome to open issues or submit PRs to improve this app, however, please note that we may not review all suggestions.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

Title: ChatVault MCP App – Vercel / MCP Vibe Coding PROMPTS

project name - chat-vault-part3

This project uses the **generic Vercel MCP App prompts** defined in:

- `prompts/part3/mcp-AppsSDK-prompt.md`

Use that file for:

- **Prompt0**: Scaffold Vercel MCP App project
- **Prompt1**: Implement HTTP JSON-RPC MCP server for Vercel (with ext-apps)
- **Prompt2**: Build the MCP App widget as a single-file HTML bundle (Vite + React + Tailwind + vite-plugin-singlefile)
- **Prompt3**: Wire MCP App UI resources and browse tool (registerAppTool, registerAppResource)
- **Prompt4**: Deployment, logging, and end-to-end verification

This file defines the **ChatVault-specific MCP App behavior** starting from Prompt5.

## Engineering Principles (ChatVault-specific)

- **Reuse Part 1 and Part 2 behavior, not their plumbing**: The Part 3 MCP App should feel like a natural extension of Part 1 (widget) and Part 2 (backend), implemented with the MCP Apps SDK (ext-apps) as in the generic Part 3 prompts. Use `registerAppTool` and `registerAppResource` for correct tool/resource shape and widget iframe behavior.
- **Simple, explicit tools**: Treat `browseMySavedChats` as an MCP App tool whose job is to open the ChatVault widget and hand it enough context to know which user/team to show. Use a flat input schema (raw Zod shape: optional `shortAnonId`, `portalLink`, `loginLink`, `isAnon`) and a handler that returns text plus `_meta.ui.resourceUri`.
- **Vibe-first UX**: The widget is for humans, not test harnesses. Prioritize fast feedback (loading states, clear empty/error messages, obvious "open portal" actions) over protocol cleverness.
- **Traceability across layers**: From A6/ChatGPT down to the Part 3 MCP server and widget, you should be able to trace a single tool call via logs and UI states. When in doubt, add a small, well-scoped log with a unique tag and keep the log volume bounded.

---

Prompt5: Define ChatVault MCP App inputs and wiring for `browseMySavedChats`

Goal: Specify how the Part 3 MCP App receives context from the host (A6 / ChatGPT) and how that flows into the widget.

Requirements:

- Tool contract:
  - `name: "browseMySavedChats"`.
  - `inputSchema`: use a **raw Zod shape** (plain object of optional fields), e.g. `shortAnonId`, `portalLink`, `loginLink`, `isAnon`, as in the generic Part 3 prompt. Avoid `z.object({...}).passthrough()` for ext-apps type compatibility.
  - Treat this as a routing tool that opens the widget; keep validation minimal.
- Expected inputs:
  - A short anon/user ID (for example, `shortAnonId` or equivalent) to identify the viewer.
  - A `portalLink` URL where the full ChatVault web app lives.
  - A `loginLink` URL to sign in or upgrade if needed.
  - Booleans for `isAnon` / `isAnonymousSubscription` as needed.
- Behavior:
  - On `tools/call` for `browseMySavedChats`, the server should:
    - Log the incoming arguments (keys only; avoid dumping secrets).
    - Return a result that:
      - Contains friendly text explaining what's happening (for example, "Opened ChatVault! Use the widget to browse your saved chats.").
      - Includes `_meta` or structured content pointing the host at the widget resource URI (for example, `ui://chat-vault/mcp-app.html`) and, if appropriate, echoing the `portalLink`/`loginLink` in a safe, clear way that the widget can read via `result.meta`.
- The focus here is on **shape clarity**: the tool should be trivially understandable by "vibe engineers" looking only at the JSON schema and a couple of log lines.

---

Prompt6: ChatVault MCP App widget behavior (hosted on Vercel)

Goal: Implement the Part 3 widget UI so it can be used as an MCP App iframe inside ChatGPT/Claude and as a regular page (for local testing).

Requirements:

- Visual behavior:
  - Reuse the high-level layout from Part 1 (a chat history browser), but simplify wherever it makes sense for "portal-style" usage.
  - Show a **header** with the user/team name (if available) and a clear title like "ChatVault – Saved Chats".
  - Provide obvious actions:
    - "Open full app" button linking to `portalLink` (in a new tab) when available.
    - "Sign in / create account" button linking to `loginLink` when appropriate.
- Data behavior:
  - For Part 3, treat the widget as **read-only** with respect to saved chats:
    - The widget talks to the host via the MCP Apps SDK (e.g. `app.callServerTool("loadMyChats", ...)` or the host's `window.openai.callTool`), so it can load chats through the same MCP server that served the widget (or via host-provided `_meta`).
  - When no chats are available, show a friendly empty state with a link to the portal.
- Debug panel:
  - Include a collapsible debug panel (similar to Part 1) that shows:
    - The raw `result.meta` (or `_meta`) from the host.
    - Any tool calls the widget makes (method, tool name, result shape).
    - Environment info (light/dark mode, host type, any MCP/App-specific flags).
- Theme:
  - Respect light/dark mode via `data-theme` and/or CSS variables, as in Part 1.

---

Prompt7: End-to-end validation from ChatGPT/Claude via A6

Goal: Prove that the full chain works:

- ChatGPT/Claude → A6 → Part 3 MCP App on Vercel → widget.

Requirements:

- Add **structured logging** in Part 3 to capture:
  - Incoming JSON-RPC request summary (method, id, `params` keys).
  - Tool dispatch events (`tools/call` → `browseMySavedChats`).
  - Outgoing JSON-RPC responses (status, result vs. error, response byte length).
- In A6 (or your upstream orchestrator), ensure there is:
  - A single place where `shortAnonId`, `portalLink`, and `loginLink` are assembled and passed to the Part 3 `browseMySavedChats` tool.
  - A log line that shows the exact tool args used for each call (without leaking secrets).
- Manual verification steps (to be run by a human or scripted later):
  - From ChatGPT, call the tool and confirm:
    - The widget opens and shows expected user/team.
    - The debug panel logs the same IDs/URLs that A6 logged.
    - Error paths (missing portal link, invalid token, rate limiting) are visible in both the widget and the Part 3 logs.

The outcome of Part 3 should be a **boring, predictable MCP App**: it uses the MCP Apps SDK (ext-apps) for tools and resources, a single-file widget build (Vite + vite-plugin-singlefile), and feels delightful at the surface while remaining easy for vibe engineers to debug and extend.

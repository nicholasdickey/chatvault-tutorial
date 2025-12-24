Title: ChatVault – Apps SDK / MCP Vibe Coding PROMPTS

project name - apps-sdk-tutorial-part1 (ChatVault)

This project uses the **generic Apps SDK prompts** defined in:

- `prompts/openai-AppsSDK-prompt.md`

Use that file for:

- **Prompt1**: Init Prompt (baseline stack, MCP server, widget, build pipeline).
- **Prompt2**: Install everything, start server, ngrok script, and logging on the MCP path.
- **Prompt3**: Jest + e2e tests for the project-specific browse action.

This file defines the **ChatVault-specific behavior** as Prompt4.

## Engineering Principles (ChatVault-specific)

- **Align with the generic prompts**: All work here inherits the engineering principles from `openai-AppsSDK-prompt.md` (verify, build-time over surgery, dual-context testing, graceful degradation). Do not introduce project-specific shortcuts that violate those principles.
- **Use Prompts 4 and 5 together**: Treat Prompt4 (MCP + widget behavior) and Prompt5 (isolated widget on port 4444) as a pair—when implementing or changing the widget, validate behavior both in isolation and through the live MCP server before assuming an issue is “host-side”.
- **Design for observability**: The ChatVault widget should surface its state clearly (loading vs. empty vs. error) and keep debug logging bounded and human-readable so future debugging sessions don’t require speculative changes.

---

Prompt4 (ChatVault-specific app/widget prompt):
--- Note: this is where the user defines the actual widget component(s) and MCP actions for ChatVault.

This is the MCP server we want to build: actions: `saveChat`, `loadMyChats`, `searchChat` and `browseMySavedChats`.

- A **Chat** is `{ title, timestamp, turns[{ prompt, response }] }`.
- `browseMySavedChats` returns the widget we are creating in this project.
- `loadMyChats` is a paged fetch, hardcoded with example data for this project.
- `saveChat` and `searchChat` are dummy functions for this project.
- The widget is like a Chrome history browser, internally calling `loadMyChats` via skybridge (window.openai.toolCall). It is a list of chats.When user clicks on a chat, it opens up, showing all the saved prompts and responses. The prompts and responses are truncated with ellipses by default, but when clicked, they show in full. Each has copy to clipboard button which changes to green checkmark for 5 secs when clicked.
- `loadMyChats` should have `userId` as a parameter, but we are not setting it inside the widget.
- at the bottom of the widget, add collapsible debug panel. Add logging to widget and show in the debug panel. Load widget initi and calling loadMyChats thoroughly.

Note: The widget must detect and adapt to dark mode (use `data-theme` attribute, CSS variables, and `dark:` Tailwind classes).

After you implement these ChatVault-specific tools, resources, and widget behavior for Prompt4, go back to **Prompt3** in `openai-AppsSDK-prompt.md` and **update the Jest + e2e tests** so they cover the actual live MCP server (including the new `browseMySavedChats` behavior) end-to-end via `/mcp`. When doing so, take into account the isolated widget behavior and failure modes you validated in Prompt5 so tests exercise both protocol-level correctness and real widget behavior.

---

Prompt5 (Isolated ChatVault widget test on port 4444):

- Set up a simple static server to serve the built widget assets from the ChatVault project root:
  - From the tutorial root:
    - `cd /home/nick/chatvault-tutorial/chat-vault-part1`
    - `npx serve assets -l 4444`
- Verify that the ChatVault widget can be loaded in isolation in a regular browser (outside ChatGPT) by opening:
  - `http://localhost:4444/chat-vault.html`
- Use this isolated page to:
  - Confirm that the widget HTML, JS, and CSS are valid and that React mounts successfully.
  - Exercise basic UI interactions (header rendering, empty-history state, expand/collapse of turns, debug panel toggle) **without** requiring `window.openai.callTool`.
  - Diagnose widget-only issues (for example, runtime errors, host-API absence, or layout/styling problems) independently of MCP transport and ChatGPT’s hosting behavior.
  - Verify that the widget handles missing or delayed host APIs (for example, `window.openai`) in a bounded, observable way (clear error or retry message, no infinite retries or unbounded logging), and that purely local interactions (such as debug panel toggling) remain responsive.

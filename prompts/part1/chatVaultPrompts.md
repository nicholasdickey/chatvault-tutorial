Title: ChatVault – Apps SDK / MCP Vibe Coding PROMPTS

project name - apps-sdk-tutorial-part1 (ChatVault)

This project uses the **generic Apps SDK prompts** defined in:

- `prompts/openai-AppsSDK-prompt.md`

Use that file for:

- **Prompt1**: Init Prompt (baseline stack, MCP server, widget, build pipeline).
- **Prompt2**: Install everything, start server, ngrok script, and logging on the MCP path.
- **Prompt3**: Jest + e2e tests for the project-specific browse action.

This file defines the **ChatVault-specific behavior** as Prompt4.

---

Prompt4 (ChatVault-specific app/widget prompt):
--- Note: this is where the user defines the actual widget component(s) and MCP actions for ChatVault.

This is the MCP server we want to build: actions: `saveChat`, `loadChats`, `searchChat` and `browseSavedChats`.

- A **Chat** is `{ title, timestamp, turns[{ prompt, response }] }`.
- `browseSavedChats` returns the widget we are creating in this project.
- `loadChats` is a paged fetch, hardcoded with example data for this project.
- `saveChat` and `searchChat` are dummy functions for this project.
- The widget is like a Chrome history browser, internally calling `loadChats` via skybridge (window.openai.toolCall). It is a list of chats.When user clicks on a chat, it opens up, showing all the saved prompts and responses. The prompts and responses are truncated with ellipses by default, but when clicked, they show in full. Each has copy to clipboard button which changes to green checkmark for 5 secs when clicked.
- `loadChats` should have `userId` as a parameter, but we are not setting it inside the widget.
- at the bottom of the widget, add collapsible debug panel. Add logging to widget and show in the debug panel. Load widget initi and calling loadChats thoroughly.

Note: The widget must detect and adapt to dark mode (use `data-theme` attribute, CSS variables, and `dark:` Tailwind classes).

After you implement these ChatVault-specific tools, resources, and widget behavior for Prompt4, go back to **Prompt3** in `openai-AppsSDK-prompt.md` and **update the Jest + e2e tests** so they cover the actual live MCP server (including the new `browseSavedChats` behavior) end-to-end via `/mcp`.

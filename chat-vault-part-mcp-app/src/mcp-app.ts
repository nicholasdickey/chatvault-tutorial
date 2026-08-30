// Global Tailwind + base styles so the single-file bundle includes CSS.
import "./index.css";

import { applyDocumentTheme } from "@modelcontextprotocol/ext-apps";

import { app } from "./app-instance.js";

function applyHostTheme(theme: "light" | "dark" | undefined) {
  if (!theme) return;
  applyDocumentTheme(theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// Wait for MCP connection before loading the chat UI so tool calls (e.g. loadSavedEntries on mount) don't get "Not connected".
app.connect().then(() => {
  applyHostTheme(app.getHostContext()?.theme);
  app.onhostcontextchanged = ({ theme }) => {
    applyHostTheme(theme);
  };
  import("./chat-vault/index.tsx");
});

// Global Tailwind + base styles so the single-file bundle includes CSS.
import "./index.css";

import { app } from "./app-instance.js";

// Wait for MCP connection before loading the chat UI so tool calls (e.g. loadMyChats on mount) don't get "Not connected".
app.connect().then(() => {
  import("./chat-vault/index.tsx");
});

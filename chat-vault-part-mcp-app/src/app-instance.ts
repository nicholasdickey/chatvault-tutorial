/**
 * Shared MCP App instance. Used by mcp-app.ts (connect) and chat-vault (callServerTool, requestDisplayMode, openLink).
 * No window.openai / ChatGPT dependency.
 */
import { App } from "@modelcontextprotocol/ext-apps";

export const app = new App({
  name: "ChatVault Part MCP App UI",
  version: "0.1.0",
});

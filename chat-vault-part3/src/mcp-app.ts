// Global Tailwind + base styles so the single-file bundle includes CSS (otherwise widget is unstyled in ChatGPT iframe).
import "./index.css";

import { App } from "@modelcontextprotocol/ext-apps";

declare global {
  interface Window {
    openai?: {
      callTool?: (name: string, args?: unknown) => Promise<unknown>;
      // Other fields may be present; we don't care about them here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  }
}

// Initialize MCP Apps client for ChatVault
const app = new App({
  name: "ChatVault Part 3 UI",
  version: "0.1.0",
});

// Establish communication with the host (MCP Apps-capable client)
app.connect();

// Shim the ChatGPT Apps-style window.openai.callTool API used by the widget
async function callToolViaMcpApps(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any = {},
): Promise<unknown> {
  // Forward to the MCP server that provided this app
  const result = await app.callServerTool({
    name,
    arguments: args ?? {},
  });
  return result;
}

// Install / extend the global window.openai object
if (typeof window !== "undefined") {
  window.openai = {
    ...(window.openai ?? {}),
    callTool: callToolViaMcpApps,
  };
}

// Finally, bootstrap the existing React ChatVault widget.
// The widget mounts itself into the #chat-vault-root element.
import "./chat-vault/index.jsx";


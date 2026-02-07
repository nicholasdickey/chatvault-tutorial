// Global Tailwind + base styles so the single-file bundle includes CSS (otherwise widget is unstyled in ChatGPT iframe).
import "./index.css";

import { App } from "@modelcontextprotocol/ext-apps";

declare global {
  interface Window {
    openai?: {
      callTool?: (name: string, args?: unknown) => Promise<unknown>;
      [key: string]: unknown;
    };
  }
}

const app = new App({
  name: "ChatVault Part MCP App UI",
  version: "0.1.0",
});

app.connect();

async function callToolViaMcpApps(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await app.callServerTool({
    name,
    arguments: args ?? {},
  });
  return result;
}

if (typeof window !== "undefined") {
  window.openai = {
    ...(window.openai ?? {}),
    callTool: callToolViaMcpApps,
  };
}

import "./chat-vault/index.jsx";

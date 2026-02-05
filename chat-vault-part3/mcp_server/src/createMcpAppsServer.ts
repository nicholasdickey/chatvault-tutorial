import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Create and configure the MCP Apps server for ChatVault Part 3.
 *
 * This server:
 * - Exposes the browseMySavedChats tool
 * - Registers the MCP App UI resource at ui://chat-vault/mcp-app.html
 */
export function createMcpAppsServer(): McpServer {
  const server = new McpServer({
    name: "ChatVault Part 3 MCP App Server",
    version: "0.1.0",
  });

  // UI resource for the ChatVault widget as an MCP App
  const resourceUri = "ui://chat-vault/mcp-app.html";

  // Minimal browseMySavedChats tool that opens the widget UI.
  registerAppTool(
    server,
    "browseMySavedChats",
    {
      title: "Browse Saved Chats",
      description:
        "Open the ChatVault widget to browse, search, and manage saved chats.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      _meta: {
        ui: {
          resourceUri,
        },
      },
    },
    async () => {
      const text =
        "Opened ChatVault! Use the widget to browse, search, and manage your saved chats.";
      return {
        content: [{ type: "text", text }],
      };
    },
  );

  // Register the MCP App UI resource, which will be built to dist/mcp-app.html
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const htmlPath = path.join(process.cwd(), "dist", "mcp-app.html");
      const html = await fs.readFile(htmlPath, "utf-8");
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  return server;
}


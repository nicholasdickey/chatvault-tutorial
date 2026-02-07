import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

/**
 * Create and configure the MCP Apps server for ChatVault Part MCP App.
 *
 * This server:
 * - Exposes the browseMySavedChats tool
 * - Registers the MCP App UI resource at ui://chat-vault/mcp-app.html
 */
export function createMcpAppsServer(): McpServer {
  const server = new McpServer({
    name: "ChatVault Part MCP App Server",
    version: "0.1.0",
  });

  const resourceUri = "ui://chat-vault/mcp-app.html";

  const browseMySavedChatsInputSchema = {
    shortAnonId: z.string().optional(),
    isAnon: z.boolean().optional(),
    portalLink: z.string().url().optional(),
    loginLink: z.string().url().optional(),
  };

  registerAppTool(
    server,
    "browseMySavedChats",
    {
      title: "Browse Saved Chats",
      description:
        "Open the ChatVault widget to browse, search, and manage saved chats.",
      inputSchema: browseMySavedChatsInputSchema,
      _meta: {
        ui: {
          resourceUri,
        },
      },
    },
    async (args) => {
      console.log("[MCP] browseMySavedChats handler called", { argsKeys: args ? Object.keys(args) : [] });
      const text =
        "Opened ChatVault! Use the widget to browse, search, and manage your saved chats.";
      return {
        content: [{ type: "text" as const, text }],
        _meta: {
          ui: { resourceUri },
          "ui/resourceUri": resourceUri,
        },
      };
    },
  );

  registerAppResource(
    server as unknown as Parameters<typeof registerAppResource>[0],
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const possiblePaths = [
        path.join(ASSETS_DIR, "mcp-app.html"),
        path.join(process.cwd(), "assets", "mcp-app.html"),
      ];

      let html: string | null = null;
      let lastError: Error | null = null;

      for (const htmlPath of possiblePaths) {
        try {
          html = await fs.readFile(htmlPath, "utf-8");
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }
      }

      if (!html) {
        throw new Error(
          `Failed to find mcp-app.html. Tried: ${possiblePaths.join(", ")}. Last error: ${lastError?.message}`
        );
      }

      const widgetDomain = "https://chatvault-part-mcp-app.vercel.app";
      const widgetCSP = {
        connect_domains: [widgetDomain, "https://www.agentsyx.com", "https://agentsyx.com"],
        resource_domains: [widgetDomain, "https://*.agentsyx.com"],
      };

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              "openai/outputTemplate": resourceUri,
              "openai/widgetPrefersBorder": true,
              "openai/widgetDomain": widgetDomain,
              "openai/widgetCSP": widgetCSP,
            },
          },
        ],
      };
    },
  );

  return server;
}

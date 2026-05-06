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
 * - Exposes the browseMyChatVault tool
 * - Registers the MCP App UI resource at ui://chat-vault/mcp-app.html
 */
export function createMcpAppsServer(): McpServer {
  const server = new McpServer({
    name: "ChatVault Part MCP App Server",
    version: "0.1.0",
  });

  const resourceUri = "ui://chat-vault/mcp-app.html";

  const browseMyChatVaultInputSchema = z.object({
    isAnon: z.boolean().optional(),
    loginLink: z.string().url().optional(),
    portalLink: z.string().url().optional(),
    shortAnonId: z.string().optional(),
  }).strict();

  registerAppTool(
    server,
    "browseMyChatVault",
    {
      title: "Browse Chat Vault",
      description:
        "Open the Chat Vault widget to browse, search, and manage saved knowledge.",
      inputSchema: browseMyChatVaultInputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          resourceUri,
        },
        "ui/resourceUri": resourceUri,
      },
    },
    async (args) => {
      console.log("[MCP] browseMyChatVault handler called", { argsKeys: args ? Object.keys(args) : [] });
      const text =
        "Opened Chat Vault. Use the widget to browse, search, and manage your saved knowledge.";
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

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

/** Bump with widget HTML deploys so hosts can bust Redis/memory caches. */
const WIDGET_VERSION =
  process.env.WIDGET_VERSION?.trim() ||
  process.env.ACTIVE_WIDGET_VERSION?.trim() ||
  "1.0.2";

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

  const browseMyChatVaultInputSchema = {
    isAnon: z.boolean().optional(),
    loginLink: z.string().url().optional(),
    portalLink: z.string().url().optional(),
    shortAnonId: z.string().optional(),
  };

  const uiMeta = {
    resourceUri,
    widgetVersion: WIDGET_VERSION,
  };

  registerAppTool(
    server,
    "browseMyChatVault",
    {
      title: "Browse Chat Vault",
      description:
        "Open the Chat Vault widget to browse, search, and manage saved knowledge.",
      inputSchema: browseMyChatVaultInputSchema,
      // Intentionally omit outputSchema for this widget-launcher tool.
      // Some MCP runtimes validate that tools with outputSchema must return structured content.
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          ...uiMeta,
          visibility: ["model"],
        },
        "ui/resourceUri": resourceUri,
        "ui/widgetVersion": WIDGET_VERSION,
      },
    },
    async (args) => {
      console.log("[MCP] browseMyChatVault handler called", { argsKeys: args ? Object.keys(args) : [] });
      const text =
        "Opened Chat Vault. Use the widget to browse, search, and manage your saved knowledge.";
      return {
        content: [{ type: "text" as const, text }],
        _meta: {
          ui: uiMeta,
          "ui/resourceUri": resourceUri,
          "ui/widgetVersion": WIDGET_VERSION,
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
      const legacyWidgetCSP = {
        connect_domains: [widgetDomain, "https://www.agentsyx.com", "https://agentsyx.com"],
        resource_domains: [widgetDomain, "https://www.agentsyx.com", "https://agentsyx.com"],
      };
      const widgetCSP = {
        connectDomains: legacyWidgetCSP.connect_domains,
        resourceDomains: legacyWidgetCSP.resource_domains,
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
              "openai/widgetCSP": legacyWidgetCSP,
              ui: {
                resourceUri,
                widgetVersion: WIDGET_VERSION,
                domain: widgetDomain,
                prefersBorder: true,
                csp: widgetCSP,
              },
              "ui/widgetVersion": WIDGET_VERSION,
            },
          },
        ],
      };
    },
  );

  return server;
}

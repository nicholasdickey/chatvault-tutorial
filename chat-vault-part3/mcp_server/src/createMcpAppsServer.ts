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

// Log path resolution for debugging
console.log("[createMcpAppsServer] Path resolution:");
console.log(`  import.meta.url: ${import.meta.url}`);
console.log(`  __dirname: ${__dirname}`);
console.log(`  ROOT_DIR: ${ROOT_DIR}`);
console.log(`  ASSETS_DIR: ${ASSETS_DIR}`);
console.log(`  process.cwd(): ${process.cwd()}`);

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

  // Raw shape for browseMySavedChats tool arguments (ext-apps expects ZodRawShapeCompat or AnySchema).
  // Hosts may send extra fields (serviceUserKey, refUuid, etc.); the handler receives whatever is passed.
  const browseMySavedChatsInputSchema = {
    shortAnonId: z.string().optional(),
    isAnon: z.boolean().optional(),
    portalLink: z.string().url().optional(),
    loginLink: z.string().url().optional(),
  };

  // Minimal browseMySavedChats tool that opens the widget UI.
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
      const result = {
        content: [{ type: "text" as const, text }],
        _meta: {
          ui: {
            resourceUri,
          },
          "ui/resourceUri": resourceUri, // Also include flat format for compatibility
        },
      };
      console.log("[MCP] browseMySavedChats returning", {
        textLength: text.length,
        hasMeta: Boolean(result._meta),
        metaKeys: result._meta ? Object.keys(result._meta) : [],
        resourceUri: result._meta?.ui?.resourceUri,
        fullResult: JSON.stringify(result, null, 2),
      });
      return result;
    },
  );

  // Register the MCP App UI resource, which will be built to assets/mcp-app.html
  // Try __dirname-based path first (matches Part 1), then fallback to process.cwd()
  // because Vercel's includeFiles puts assets at /var/task/assets/, not under project dir
  // Cast server: ext-apps expects registerResource(uri: string); our SDK may use ResourceTemplate.
  registerAppResource(
    server as unknown as Parameters<typeof registerAppResource>[0],
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const possiblePaths = [
        path.join(ASSETS_DIR, "mcp-app.html"), // __dirname-based (matches Part 1)
        path.join(process.cwd(), "assets", "mcp-app.html"), // process.cwd-based (Vercel includeFiles location)
      ];

      console.log("[createMcpAppsServer] Reading mcp-app.html:");
      console.log(`  ASSETS_DIR: ${ASSETS_DIR}`);
      console.log(`  process.cwd(): ${process.cwd()}`);
      console.log(`  Trying paths:`);
      possiblePaths.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));

      let html: string | null = null;
      let lastError: Error | null = null;
      let successfulPath: string | null = null;

      for (const htmlPath of possiblePaths) {
        try {
          console.log(`  Attempting to read: ${htmlPath}`);
          html = await fs.readFile(htmlPath, "utf-8");
          successfulPath = htmlPath;
          console.log(`  ✅ Successfully read from: ${htmlPath} (${html.length} bytes)`);
          break;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.log(`  ❌ Failed to read ${htmlPath}: ${err.message} (code: ${(error as any)?.code || 'N/A'})`);
          lastError = err;
          continue;
        }
      }

      if (!html) {
        const errorMsg = `Failed to find mcp-app.html. Tried: ${possiblePaths.join(", ")}. Last error: ${lastError?.message}`;
        console.error(`[createMcpAppsServer] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log(`[createMcpAppsServer] Successfully loaded mcp-app.html from: ${successfulPath} (${html.length} bytes; expected single-file bundle ~500k+, not ~327 stub)`);

      // Include CSP hints so the host (e.g. ChatGPT) can render the widget iframe with correct permissions.
      // Without these, a restrictive default CSP can block scripts/fetch and loadMyChats never runs.
      const widgetDomain = "https://chatvault-mcp-app.vercel.app";
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


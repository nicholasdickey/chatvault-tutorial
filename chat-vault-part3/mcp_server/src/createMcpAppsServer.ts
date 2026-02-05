import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  // Register the MCP App UI resource, which will be built to assets/mcp-app.html
  // Try __dirname-based path first (matches Part 1), then fallback to process.cwd()
  // because Vercel's includeFiles puts assets at /var/task/assets/, not under project dir
  registerAppResource(
    server,
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

      console.log(`[createMcpAppsServer] Successfully loaded mcp-app.html from: ${successfulPath}`);

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


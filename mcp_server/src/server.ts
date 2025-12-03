import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type ChatVaultWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
  responseText: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");

function readWidgetHtml(componentName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`
    );
  }

  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) => file.startsWith(`${componentName}-`) && file.endsWith(".html")
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "${componentName}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }

  return localizeWidgetAssets(htmlContents, ASSETS_DIR);
}

function localizeWidgetAssets(html: string, assetsDir: string): string {
  let processedHtml = html;

  // Inline JavaScript files
  // Match script tags with src attribute, handling both relative and absolute paths
  // Also capture the type attribute if present
  const scriptRegex = /<script\s+([^>]*?)src=["']([^"']+\.js)["']([^>]*?)><\/script>/gi;
  processedHtml = processedHtml.replace(scriptRegex, (match, beforeSrc, src, afterSrc) => {
    // Check if original script tag had type="module"
    const hasModuleType = /type\s*=\s*["']module["']/i.test(beforeSrc + afterSrc);

    // Extract just the filename (handle both relative paths and URLs)
    const filename = path.basename(src);
    // Try direct path first, then look for hashed versions
    let scriptPath = path.join(assetsDir, filename);

    if (!fs.existsSync(scriptPath)) {
      // Look for hashed version (e.g., chat-vault-abc123.js)
      const baseName = filename.replace(/-\w+\.js$/, "").replace(/\.js$/, "");
      const candidates = fs
        .readdirSync(assetsDir)
        .filter((file) => file.startsWith(baseName) && file.endsWith(".js"))
        .sort();
      if (candidates.length > 0) {
        scriptPath = path.join(assetsDir, candidates[candidates.length - 1]);
      }
    }

    if (fs.existsSync(scriptPath)) {
      let jsContent = fs.readFileSync(scriptPath, "utf8");
      // Escape </script> sequences in JS content
      jsContent = jsContent.replace(/<\/script>/gi, "<\\/script>");
      // Preserve module type if original had it, or check if JS is ESM
      const isESM = hasModuleType ||
        /^\s*(import|export)\s+/.test(jsContent) ||
        /import\s+.*from|export\s+/.test(jsContent);
      return isESM
        ? `<script type="module">${jsContent}</script>`
        : `<script>${jsContent}</script>`;
    }
    return match; // Return original if file not found
  });

  // Inline CSS files
  // Match link tags with rel="stylesheet" and href attribute
  const cssRegex =
    /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+\.css)["'][^>]*>/gi;
  processedHtml = processedHtml.replace(cssRegex, (match, href) => {
    // Extract just the filename (handle both relative paths and URLs)
    const filename = path.basename(href);
    // Try direct path first, then look for hashed versions
    let cssPath = path.join(assetsDir, filename);

    if (!fs.existsSync(cssPath)) {
      // Look for hashed version (e.g., chat-vault-abc123.css)
      const baseName = filename.replace(/-\w+\.css$/, "").replace(/\.css$/, "");
      const candidates = fs
        .readdirSync(assetsDir)
        .filter((file) => file.startsWith(baseName) && file.endsWith(".css"))
        .sort();
      if (candidates.length > 0) {
        cssPath = path.join(assetsDir, candidates[candidates.length - 1]);
      }
    }

    if (fs.existsSync(cssPath)) {
      const cssContent = fs.readFileSync(cssPath, "utf8");
      return `<style>${cssContent}</style>`;
    }
    return match; // Return original if file not found
  });

  return processedHtml;
}

function widgetDescriptorMeta(widget: ChatVaultWidget) {
  return {
    "openai/outputTemplate": widget.templateUri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  } as const;
}

function widgetInvocationMeta(widget: ChatVaultWidget) {
  return {
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
  } as const;
}

// Lazy-load widget HTML to avoid errors during module load
function getWidgetHtml(componentName: string): string {
  try {
    return readWidgetHtml(componentName);
  } catch (error) {
    // If widget HTML can't be read (e.g., assets not built), return empty HTML
    console.warn(`Warning: Could not load widget HTML for ${componentName}:`, error instanceof Error ? error.message : String(error));
    return `<!doctype html><html><head></head><body><div id="${componentName}-root">Widget assets not built. Run "pnpm run build" first.</div></body></html>`;
  }
}

const widgets: ChatVaultWidget[] = [
  {
    id: "chat-vault",
    title: "ChatVault",
    templateUri: "ui://widget/chat-vault.html",
    invoking: "Browsing saved chats",
    invoked: "ChatVault opened",
    html: "", // Will be loaded lazily
    responseText: "Opened ChatVault!",
  },
];

// Initialize widget HTML (lazy)
widgets.forEach((widget) => {
  widget.html = getWidgetHtml("chat-vault");
});

const widgetsById = new Map<string, ChatVaultWidget>();
const widgetsByUri = new Map<string, ChatVaultWidget>();

widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  widgetsByUri.set(widget.templateUri, widget);
});

const toolInputSchema = {
  type: "object",
  properties: {
    pizzaTopping: {
      type: "string",
      description: "Topping to mention when rendering the widget.",
    },
  },
  required: ["pizzaTopping"],
  additionalProperties: false,
} as const;

const toolInputParser = z.object({
  pizzaTopping: z.string(),
});

const tools: Tool[] = widgets.map((widget) => ({
  name: widget.id,
  description: widget.title,
  inputSchema: toolInputSchema,
  title: widget.title,
  _meta: widgetDescriptorMeta(widget),
  // To disable the approval prompt for the widgets
  annotations: {
    destructiveHint: false,
    openWorldHint: false,
    readOnlyHint: true,
  },
}));

const resources: Resource[] = widgets.map((widget) => ({
  uri: widget.templateUri,
  name: widget.title,
  description: `${widget.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetDescriptorMeta(widget),
}));

const resourceTemplates: ResourceTemplate[] = widgets.map((widget) => ({
  uriTemplate: widget.templateUri,
  name: widget.title,
  description: `${widget.title} widget markup`,
  mimeType: "text/html+skybridge",
  _meta: widgetDescriptorMeta(widget),
}));

// Handler functions (extracted from server handlers for manual dispatch)
async function handleListTools(_request: ListToolsRequest) {
  console.log("[MCP Handler] handleListTools - request id:", _request.id);
  const result = { tools };
  console.log("[MCP Handler] handleListTools - returning", tools.length, "tools");
  return result;
}

async function handleCallTool(request: CallToolRequest) {
  console.log("[MCP Handler] handleCallTool - request id:", request.id, "tool name:", request.params.name, "arguments:", JSON.stringify(request.params.arguments));
  const widget = widgetsById.get(request.params.name);

  if (!widget) {
    console.error("[MCP Handler] handleCallTool - Unknown tool:", request.params.name);
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = toolInputParser.parse(request.params.arguments ?? {});
  console.log("[MCP Handler] handleCallTool - parsed arguments:", JSON.stringify(args));

  const result = {
    content: [
      {
        type: "text",
        text: widget.responseText,
      },
    ],
    structuredContent: {
      pizzaTopping: args.pizzaTopping,
    },
    _meta: widgetInvocationMeta(widget),
  };
  console.log("[MCP Handler] handleCallTool - returning result for widget:", widget.id);
  return result;
}

async function handleListResources(_request: ListResourcesRequest) {
  console.log("[MCP Handler] handleListResources - request id:", _request.id);
  const result = { resources };
  console.log("[MCP Handler] handleListResources - returning", resources.length, "resources");
  return result;
}

async function handleReadResource(request: ReadResourceRequest) {
  console.log("[MCP Handler] handleReadResource - request id:", request.id, "uri:", request.params.uri);
  const widget = widgetsByUri.get(request.params.uri);

  if (!widget) {
    console.error("[MCP Handler] handleReadResource - Unknown resource:", request.params.uri);
    throw new Error(`Unknown resource: ${request.params.uri}`);
  }

  console.log("[MCP Handler] handleReadResource - Found widget:", widget.id, "HTML length:", widget.html.length);
  const result = {
    contents: [
      {
        uri: widget.templateUri,
        mimeType: "text/html+skybridge",
        text: widget.html,
        _meta: widgetDescriptorMeta(widget),
      },
    ],
  };
  return result;
}

async function handleListResourceTemplates(
  _request: ListResourceTemplatesRequest
) {
  console.log("[MCP Handler] handleListResourceTemplates - request id:", _request.id);
  const result = { resourceTemplates };
  console.log("[MCP Handler] handleListResourceTemplates - returning", resourceTemplates.length, "templates");
  return result;
}

function createChatVaultServer(): Server {
  const server = new Server(
    {
      name: "chat-vault-part1",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, handleListResources);
  server.setRequestHandler(ReadResourceRequestSchema, handleReadResource);
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    handleListResourceTemplates
  );
  server.setRequestHandler(ListToolsRequestSchema, handleListTools);
  server.setRequestHandler(CallToolRequestSchema, handleCallTool);

  return server;
}

type SessionRecord = {
  server: Server;
  sessionId: string;
};

const sessions = new Map<string, SessionRecord>();

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function writeJsonRpcResponse(
  res: ServerResponse,
  id: string | number | null,
  result?: unknown,
  error?: { code: number; message: string; data?: unknown }
) {
  const response: {
    jsonrpc: string;
    id: string | number | null;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  } = {
    jsonrpc: "2.0",
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  res.write(JSON.stringify(response));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Content-Type", "application/json");

  try {
    const body = await readRequestBody(req);
    console.log("[MCP] Incoming request body:", body);
    const requestData = JSON.parse(body);

    const { jsonrpc, id, method, params } = requestData;
    console.log("[MCP] Request parsed - id:", id, "method:", method, "params:", JSON.stringify(params));

    if (jsonrpc !== "2.0") {
      console.error("[MCP] Invalid JSON-RPC version:", jsonrpc);
      writeJsonRpcResponse(res, id, undefined, {
        code: -32600,
        message: "Invalid Request",
      });
      res.end();
      return;
    }

    // Handle notifications (requests without id)
    if (id === undefined || id === null) {
      console.log("[MCP] Notification received - method:", method);
      // Handle notifications/initialized
      if (method === "notifications/initialized") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        console.log("[MCP] notifications/initialized - sessionId:", sessionId);
        if (sessionId) {
          res.writeHead(204, {
            "mcp-session-id": sessionId,
          });
        } else {
          res.writeHead(204);
        }
        res.end();
        return;
      }
      // For other notifications, just return 204
      console.log("[MCP] Unknown notification, returning 204");
      res.writeHead(204);
      res.end();
      return;
    }

    // Get or create session
    let sessionId = req.headers["mcp-session-id"] as string | undefined;
    let session: SessionRecord | undefined;

    if (sessionId) {
      session = sessions.get(sessionId);
    }

    // Handle initialize request
    if (method === "initialize") {
      console.log("[MCP] initialize - id:", id, "params:", JSON.stringify(params));
      if (!session) {
        sessionId = generateSessionId();
        console.log("[MCP] Creating new session:", sessionId);
        const server = createChatVaultServer();
        session = { server, sessionId };
        sessions.set(sessionId, session);
      } else {
        console.log("[MCP] Using existing session:", sessionId);
      }

      const response = {
        protocolVersion: "2024-11-05",
        capabilities: {
          resources: {},
          tools: {},
        },
        serverInfo: {
          name: "chat-vault-part1",
          version: "0.1.0",
        },
      };

      console.log("[MCP] initialize response:", JSON.stringify(response));
      res.setHeader("mcp-session-id", sessionId);
      writeJsonRpcResponse(res, id, response);
      res.end();
      return;
    }

    // For all other requests, we need a session
    if (!session) {
      console.error("[MCP] Session not found for method:", method, "sessionId:", sessionId);
      writeJsonRpcResponse(res, id, undefined, {
        code: -32000,
        message: "Session not found. Call initialize first.",
      });
      res.end();
      return;
    }

    // Dispatch to handler functions manually
    try {
      let result: unknown;

      if (method === "tools/list") {
        const request: ListToolsRequest = {
          jsonrpc: "2.0",
          id: id as string | number,
          method: "tools/list",
          params: params || {},
        };
        console.log("[MCP] tools/list - id:", id, "params:", JSON.stringify(params));
        result = await handleListTools(request);
        console.log("[MCP] tools/list response:", JSON.stringify(result));
      } else if (method === "tools/call") {
        const request: CallToolRequest = {
          jsonrpc: "2.0",
          id: id as string | number,
          method: "tools/call",
          params: params || {},
        };
        console.log("[MCP] tools/call - id:", id, "params:", JSON.stringify(params));
        result = await handleCallTool(request);
        console.log("[MCP] tools/call response:", JSON.stringify(result));
      } else if (method === "resources/list") {
        const request: ListResourcesRequest = {
          jsonrpc: "2.0",
          id: id as string | number,
          method: "resources/list",
          params: params || {},
        };
        console.log("[MCP] resources/list - id:", id, "params:", JSON.stringify(params));
        result = await handleListResources(request);
        console.log("[MCP] resources/list response:", JSON.stringify(result));
      } else if (method === "resources/read") {
        const request: ReadResourceRequest = {
          jsonrpc: "2.0",
          id: id as string | number,
          method: "resources/read",
          params: params || {},
        };
        console.log("[MCP] resources/read - id:", id, "params:", JSON.stringify(params));
        result = await handleReadResource(request);
        console.log("[MCP] resources/read response (truncated, contains HTML)");
      } else if (method === "resources/listTemplates") {
        const request: ListResourceTemplatesRequest = {
          jsonrpc: "2.0",
          id: id as string | number,
          method: "resources/listTemplates",
          params: params || {},
        };
        console.log("[MCP] resources/listTemplates - id:", id, "params:", JSON.stringify(params));
        result = await handleListResourceTemplates(request);
        console.log("[MCP] resources/listTemplates response:", JSON.stringify(result));
      } else {
        console.error("[MCP] Method not found:", method);
        writeJsonRpcResponse(res, id, undefined, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
        res.end();
        return;
      }

      res.setHeader("mcp-session-id", sessionId);
      writeJsonRpcResponse(res, id, result);
      res.end();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[MCP] Internal error in handler:", errorMessage);
      console.error("[MCP] Error stack:", error instanceof Error ? error.stack : "N/A");
      writeJsonRpcResponse(res, id, undefined, {
        code: -32603,
        message: `Internal error: ${errorMessage}`,
      });
      res.end();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[MCP] Parse error:", errorMessage);
    console.error("[MCP] Error stack:", error instanceof Error ? error.stack : "N/A");
    writeJsonRpcResponse(res, null, undefined, {
      code: -32700,
      message: `Parse error: ${errorMessage}`,
    });
    res.end();
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) {
        res.writeHead(400).end("Missing URL");
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "OPTIONS" && url.pathname === "/mcp") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type, mcp-session-id",
        });
        res.end();
        return;
      }

      if (req.method === "POST" && url.pathname === "/mcp") {
        await handleMcpRequest(req, res);
        return;
      }

      res.writeHead(404).end("Not Found");
    } catch (error) {
      console.error("[HTTP Server] Unhandled error in request handler:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal Server Error");
      }
    }
  }
);

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

// Handle uncaught errors to prevent server crashes
process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught exception:", error);
  // Don't exit - let the server continue running
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled rejection at:", promise, "reason:", reason);
  // Don't exit - let the server continue running
});

httpServer.listen(port, () => {
  console.log(`ChatVault MCP server listening on http://localhost:${port}`);
  console.log(`  MCP endpoint: POST http://localhost:${port}/mcp`);
});

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
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
  description: string;
  title: string;
  templateVersions: string[]; // Array of supported template versions (e.g., ["1.0.0", "1.0.1"])
  activeTemplateVersion: string; // Which version to expose in tools/list
  templateUri: string; // Computed: active version's template URI (for backward compatibility)
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

function widgetDescriptorMeta(widget: ChatVaultWidget, templateUri?: string) {
  const uri = templateUri || widget.templateUri;
  return {
    "openai/outputTemplate": uri,
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
    "openai/widgetDescription": widget.description,
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

// Widget version configuration
// WIDGET_VERSIONS: comma-separated list of supported versions (e.g., "1.0.0,1.0.1")
// ACTIVE_WIDGET_VERSION: which version to expose in tools/list (defaults to latest)
const WIDGET_VERSIONS_STR = process.env.WIDGET_VERSIONS || process.env.WIDGET_VERSION || "1.0.0,1.0.1";
const WIDGET_VERSIONS = WIDGET_VERSIONS_STR.split(",").map(v => v.trim()).filter(Boolean);
const ACTIVE_WIDGET_VERSION = process.env.ACTIVE_WIDGET_VERSION || WIDGET_VERSIONS[WIDGET_VERSIONS.length - 1];

// Helper to generate template URI from version
function templateUriFromVersion(version: string): string {
  return `ui://widget/chat-vault-v${version}.html`;
}

const widgets: ChatVaultWidget[] = [
  {
    id: "browseMySavedChats",
    title: "Chat Vault",
    templateVersions: WIDGET_VERSIONS,
    activeTemplateVersion: ACTIVE_WIDGET_VERSION,
    templateUri: templateUriFromVersion(ACTIVE_WIDGET_VERSION), // Active version's URI (used in tools/list)
    invoking: "Browsing saved chats",
    invoked: "Chat Vault opened",
    html: "", // Will be loaded lazily
    responseText: "Opened ChatVault!",
    description: "Browse, display, search, and and delete my saved chats in the Chat Vault widget. Liited in scope to user's explicitely saved chats only",
  },
];

// Initialize widget HTML (lazy) - same HTML for all versions
widgets.forEach((widget) => {
  widget.html = getWidgetHtml("chat-vault");
});

const widgetsById = new Map<string, ChatVaultWidget>();
const widgetsByUri = new Map<string, ChatVaultWidget>();

// Register widgets by ID and by all template URIs (for backward compatibility)
widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  // Register active template URI
  widgetsByUri.set(widget.templateUri, widget);
  // Register all template version URIs (all versions are available via resources/read)
  widget.templateVersions.forEach((version) => {
    const uri = templateUriFromVersion(version);
    widgetsByUri.set(uri, widget);
  });
});

// Chat data structure
interface Chat {
  title: string;
  timestamp: number;
  type?: "note" | "chat"; // Optional: "note" for unparseable content, "chat" for regular chats (default)
  content?: string; // For notes: the raw text content
  turns?: Array<{
    prompt: string;
    response: string;
  }>;
}

// Hardcoded example chat data
const exampleChats: Chat[] = [
  {
    title: "React Hooks Best Practices",
    timestamp: Date.now() - 86400000, // 1 day ago
    turns: [
      {
        prompt: "What are the best practices for using React hooks?",
        response: "Here are some key best practices for React hooks:\n\n1. **Only call hooks at the top level** - Don't call hooks inside loops, conditions, or nested functions.\n\n2. **Use the dependency array correctly** - Include all values from component scope that change between renders.\n\n3. **Custom hooks for reusable logic** - Extract component logic into custom hooks.\n\n4. **Use useMemo and useCallback wisely** - Only use them when you have performance issues.\n\n5. **Cleanup effects** - Always return cleanup functions from useEffect when needed.",
      },
      {
        prompt: "Can you give me an example of a custom hook?",
        response: "Sure! Here's an example of a custom hook for fetching data:\n\n```javascript\nfunction useFetch(url) {\n  const [data, setData] = useState(null);\n  const [loading, setLoading] = useState(true);\n  const [error, setError] = useState(null);\n\n  useEffect(() => {\n    fetch(url)\n      .then(res => res.json())\n      .then(data => {\n        setData(data);\n        setLoading(false);\n      })\n      .catch(err => {\n        setError(err);\n        setLoading(false);\n      });\n  }, [url]);\n\n  return { data, loading, error };\n}\n```",
      },
    ],
  },
  {
    title: "TypeScript Type Guards",
    timestamp: Date.now() - 172800000, // 2 days ago
    turns: [
      {
        prompt: "What are TypeScript type guards?",
        response: "Type guards are TypeScript expressions that perform runtime checks to narrow down the type of a variable. They help TypeScript understand the type of a value at a specific point in your code.\n\nCommon type guards include:\n- `typeof` checks\n- `instanceof` checks\n- Custom type predicate functions\n\nExample:\n```typescript\nfunction isString(value: unknown): value is string {\n  return typeof value === 'string';\n}\n```",
      },
    ],
  },
  {
    title: "MCP Protocol Overview",
    timestamp: Date.now() - 259200000, // 3 days ago
    turns: [
      {
        prompt: "Explain the Model Context Protocol",
        response: "The Model Context Protocol (MCP) is an open specification for connecting LLM clients to external tools, data, and UIs. It uses JSON-RPC 2.0 for communication and supports:\n\n- **Tools**: Functions the LLM can call\n- **Resources**: Data the LLM can read\n- **Prompts**: Reusable prompt templates\n\nMCP servers can be implemented over various transports including HTTP, SSE, and stdio.",
      },
      {
        prompt: "How does MCP differ from function calling?",
        response: "MCP is more comprehensive than simple function calling:\n\n1. **Resources**: MCP provides a way to expose data sources, not just functions\n2. **Prompts**: MCP includes prompt templates for common tasks\n3. **Transport agnostic**: MCP can work over HTTP, SSE, stdio, etc.\n4. **Standardized**: MCP provides a standard protocol, not just an API\n5. **Widgets**: MCP supports UI widgets that can be rendered inline",
      },
    ],
  },
];

// Tool input schemas
const browseSavedChatsSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

const loadChatsSchema = {
  type: "object",
  properties: {
    userId: {
      type: "string",
      description: "User ID to load chats for",
    },
    page: {
      type: "number",
      description: "Page number (0-indexed)",
    },
    pageSize: {
      type: "number",
      description: "Number of chats per page",
    },
  },
  required: [],
  additionalProperties: false,
};

const saveChatSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Chat title",
    },
    timestamp: {
      type: "number",
      description: "Chat timestamp",
    },
    turns: {
      type: "array",
      description: "Chat turns",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          response: { type: "string" },
        },
      },
    },
  },
  required: ["title", "timestamp", "turns"],
  additionalProperties: false,
};

const searchChatSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search query",
    },
    userId: {
      type: "string",
      description: "User ID to search chats for",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const saveChatManuallySchema = {
  type: "object",
  properties: {
    htmlContent: {
      type: "string",
      description: "HTML or text content to parse and save",
    },
    title: {
      type: "string",
      description: "Optional title for the chat/note",
    },
  },
  required: ["htmlContent"],
  additionalProperties: false,
};

// Define all ChatVault tools
const chatVaultTools: Tool[] = [
  {
    name: "browseMySavedChats",
    description: "Browse and display saved chats in the ChatVault widget",
    // @ts-expect-error - Schema types are compatible at runtime, TypeScript type system is too strict
    inputSchema: browseSavedChatsSchema,
    title: "Browse Saved Chats",
    _meta: widgetDescriptorMeta(widgets[0]),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
    securitySchemes: [
      { type: "noauth" },
      { type: "oauth2" }
    ]
  },
  {
    name: "loadMyChats",
    description: "Load saved chats with pagination support",
    // @ts-expect-error - Schema types are compatible at runtime, TypeScript type system is too strict
    inputSchema: loadChatsSchema,
    title: "Load Chats",
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "saveChat",
    description: "Save a chat conversation (dummy function for this project)",
    // @ts-expect-error - Schema types are compatible at runtime, TypeScript type system is too strict
    inputSchema: saveChatSchema,
    title: "Save Chat",
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "searchChat",
    description: "Search saved chats (dummy function for this project)",
    // @ts-expect-error - Schema types are compatible at runtime, TypeScript type system is too strict
    inputSchema: searchChatSchema,
    title: "Search Chats",
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: true,
    },
  },
  {
    name: "saveChatManually",
    description: "Save a chat conversation by parsing HTML/text content. If parsing fails, saves as a note.",
    // @ts-expect-error - Schema types are compatible at runtime, TypeScript type system is too strict
    inputSchema: saveChatManuallySchema,
    title: "Save Chat Manually",
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
];

const tools: Tool[] = [...chatVaultTools];

// Generate resources for all template versions (all versions are available via resources/read)
const resources: Resource[] = widgets.flatMap((widget) =>
  widget.templateVersions.map((version) => {
    const uri = templateUriFromVersion(version);
    return {
      uri,
      name: `${widget.title} (v${version})`,
      description: `${widget.title} widget markup (version ${version})`,
      mimeType: "text/html+skybridge",
      _meta: widgetDescriptorMeta(widget, uri),
    };
  })
);

// Resource templates: expose all template versions
const resourceTemplates: ResourceTemplate[] = widgets.flatMap((widget) =>
  widget.templateVersions.map((version) => {
    const uri = templateUriFromVersion(version);
    return {
      uriTemplate: uri,
      name: `${widget.title} (v${version})`,
      description: `${widget.title} widget markup (version ${version})`,
      mimeType: "text/html+skybridge",
      _meta: widgetDescriptorMeta(widget, uri),
    };
  })
);

// Handler functions (extracted from server handlers for manual dispatch)
async function handleListTools(_request: ListToolsRequest) {
  const requestId = (_request as { id?: string | number }).id;
  console.log("[MCP Handler] handleListTools - request id:", requestId);
  const result = { tools };
  console.log("[MCP Handler] handleListTools - returning", tools.length, "tools");
  return result;
}

async function handleCallTool(request: CallToolRequest) {
  const requestId = (request as { id?: string | number }).id;
  console.log("[MCP Handler] handleCallTool - request id:", requestId, "tool name:", request.params.name, "arguments:", JSON.stringify(request.params.arguments));

  const toolName = request.params.name;
  const args = request.params.arguments ?? {};

  switch (toolName) {
    case "browseMySavedChats": {
      const widget = widgetsById.get("browseMySavedChats");
      if (!widget) {
        throw new Error("Widget not found");
      }

      // Return widget invocation result
      const result = {
        content: [
          {
            type: "text",
            text: widget.responseText,
          },
        ],
        structuredContent: {},
        _meta: widgetInvocationMeta(widget),
      };
      console.log("[MCP Handler] handleCallTool - returning browseMySavedChats widget");
      return result;
    }

    case "loadMyChats": {
      const page = (args.page as number) ?? 0;
      const pageSize = (args.pageSize as number) ?? 10;
      const start = page * pageSize;
      const end = start + pageSize;
      const paginatedChats = exampleChats.slice(start, end);

      // Default content metadata (can be overridden by backend/env in real implementation)
      const defaultHelpText = `# How to Use ChatVault

ChatVault helps you save, organize, and search your conversations. Think of it as a personal archive for your most valuable chats.
Note: chats are stored for {expirationDays} days in the free version of the app.
## Saving Conversations

You have three flexible ways to save conversations to your vault:

### 1. Ask ChatGPT to Save
Simply ask ChatGPT to save the current conversation to your vault. You can specify:
- **By subject**: "Save this conversation about [topic] to my ChatVault"
- **By number of turns**: "Save the last 5 turns to my ChatVault"
- **The entire conversation**: "Add this entire chat to my ChatVault"

### 2. Manual Save via Widget
Use the '+' button in the ChatVault widget to manually add conversations:
1. Copy a conversation from ChatGPT (or anywhere)
2. Click the '+' button in the ChatVault widget header
3. Paste the conversation into the text area
4. Optionally add a custom title
5. Click "Save"

## Accessing Your Vault

Just ask ChatGPT to 'browse my chats' or to find a chat in the vault by topic, date, or other criteria.`;

      const contentMetadata = {
        helpText: defaultHelpText,
        limits: {
          counterTooltip: "Click to learn about chat limits",
          limitReachedTooltip: "Chat limit reached - delete a chat or upgrade",
          limitReachedMessageWithPortal: "You've reached the limit of {maxChats} free chats. Delete a chat to add more, or upgrade your account to save unlimited chats.",
          limitReachedMessageWithoutPortal: "You've reached the limit of {maxChats} free chats. Please delete a chat to add more.",
        },
        config: {
          freeChatLimit: 10,
          chatExpirationDays: 7,
        },
      };

      const result = {
        content: [
          {
            type: "text",
            text: `Loaded ${paginatedChats.length} chats`,
          },
        ],
        structuredContent: {
          chats: paginatedChats,
          page,
          pageSize,
          total: exampleChats.length,
          hasMore: end < exampleChats.length,
          content: contentMetadata,
        },
      };
      console.log("[MCP Handler] handleCallTool - loadMyChats returning", paginatedChats.length, "chats");
      return result;
    }

    case "saveChat": {
      // Dummy function - just acknowledge
      const result = {
        content: [
          {
            type: "text",
            text: "Chat saved (dummy function)",
          },
        ],
        structuredContent: {
          saved: true,
        },
      };
      console.log("[MCP Handler] handleCallTool - saveChat (dummy)");
      return result;
    }

    case "searchChat": {
      // Dummy function - return all chats
      const query = (args.query as string) ?? "";
      const result = {
        content: [
          {
            type: "text",
            text: `Found ${exampleChats.length} chats matching "${query}" (dummy search)`,
          },
        ],
        structuredContent: {
          chats: exampleChats,
          query,
        },
      };
      console.log("[MCP Handler] handleCallTool - searchChat (dummy)");
      return result;
    }

    case "saveChatManually": {
      const htmlContent = (args.htmlContent as string) ?? "";
      const title = (args.title as string)?.trim() || "Untitled";

      // Try to parse the content as a chat with turns
      // Simple parsing: look for patterns like "You said:", "AI said:", "User:", "Assistant:", etc.
      const parseChat = (content: string): { turns?: Array<{ prompt: string; response: string }>; success: boolean } => {
        // Remove HTML tags for text extraction
        const textOnly = content.replace(/<[^>]*>/g, "\n").replace(/\n+/g, "\n").trim();

        // Try to find patterns indicating prompts and responses
        // Common patterns: "You said:", "AI said:", "User:", "Assistant:", "Prompt:", "Response:"
        const promptPatterns = [
          /(?:^|\n)\s*(?:You said|User|Prompt|Human)[:\-]\s*\n?(.+?)(?=\n\s*(?:AI said|Assistant|Response|Bot)[:\-]|$)/gis,
          /(?:^|\n)\s*(?:AI said|Assistant|Response|Bot)[:\-]\s*\n?(.+?)(?=\n\s*(?:You said|User|Prompt|Human)[:\-]|$)/gis,
        ];

        const turns: Array<{ prompt: string; response: string }> = [];
        let hasPattern = false;

        // Try pattern matching for structured content
        const userMatches = Array.from(textOnly.matchAll(/(?:^|\n)\s*(?:You said|User|Prompt|Human)[:\-]\s*\n?(.+?)(?=\n\s*(?:AI said|Assistant|Response|Bot)[:\-]|$)/gis));
        const aiMatches = Array.from(textOnly.matchAll(/(?:^|\n)\s*(?:AI said|Assistant|Response|Bot)[:\-]\s*\n?(.+?)(?=\n\s*(?:You said|User|Prompt|Human)[:\-]|$)/gis));

        if (userMatches.length > 0 || aiMatches.length > 0) {
          hasPattern = true;
          // Try to pair prompts and responses
          const allMatches = [
            ...userMatches.map((m, i) => ({ type: "prompt" as const, text: m[1].trim(), index: i * 2 })),
            ...aiMatches.map((m, i) => ({ type: "response" as const, text: m[1].trim(), index: i * 2 + 1 })),
          ].sort((a, b) => {
            // Sort by position in original text
            const aPos = textOnly.indexOf(a.text);
            const bPos = textOnly.indexOf(b.text);
            return aPos - bPos;
          });

          // Group into pairs
          for (let i = 0; i < allMatches.length - 1; i += 2) {
            if (allMatches[i].type === "prompt" && allMatches[i + 1]?.type === "response") {
              turns.push({
                prompt: allMatches[i].text,
                response: allMatches[i + 1].text,
              });
            }
          }
        }

        // If we found structured turns, return them
        if (turns.length > 0) {
          return { turns, success: true };
        }

        // If we detected patterns but couldn't extract turns, or if content is too short, treat as unparseable
        return { success: false };
      };

      const parseResult = parseChat(htmlContent);
      const timestamp = Date.now();

      let savedChat: Chat;

      if (parseResult.success && parseResult.turns && parseResult.turns.length > 0) {
        // Save as regular chat
        savedChat = {
          title,
          timestamp,
          type: "chat",
          turns: parseResult.turns,
        };
        console.log("[MCP Handler] handleCallTool - saveChatManually: parsed as chat with", parseResult.turns.length, "turns");
      } else {
        // Save as note
        // Extract plain text from HTML for note content
        const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        savedChat = {
          title,
          timestamp,
          type: "note",
          content: plainText || htmlContent,
        };
        console.log("[MCP Handler] handleCallTool - saveChatManually: saved as note (could not parse as chat)");
      }

      // Add to exampleChats array (prepend to show most recent first)
      exampleChats.unshift(savedChat);

      const result = {
        content: [
          {
            type: "text",
            text: savedChat.type === "note"
              ? "Note saved successfully"
              : `Chat saved successfully with ${savedChat.turns?.length || 0} turns`,
          },
        ],
        structuredContent: {
          saved: true,
          chat: savedChat,
        },
      };
      console.log("[MCP Handler] handleCallTool - saveChatManually: saved", savedChat.type || "chat");
      return result;
    }

    default: {
      console.error("[MCP Handler] handleCallTool - Unknown tool:", toolName);
      throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

async function handleListResources(_request: ListResourcesRequest) {
  const requestId = (_request as { id?: string | number }).id;
  console.log("[MCP Handler] handleListResources - request id:", requestId);
  const result = { resources };
  console.log("[MCP Handler] handleListResources - returning", resources.length, "resources");
  return result;
}

async function handleReadResource(request: ReadResourceRequest) {
  const requestId = (request as { id?: string | number }).id;
  const requestedUri = request.params.uri;
  console.log("[MCP Handler] handleReadResource - request id:", requestId, "uri:", requestedUri);
  const widget = widgetsByUri.get(requestedUri);

  if (!widget) {
    console.error("[MCP Handler] handleReadResource - Unknown resource:", requestedUri);
    throw new Error(`Unknown resource: ${requestedUri}`);
  }

  console.log("[MCP Handler] handleReadResource - Found widget:", widget.id, "HTML length:", widget.html.length);
  const result = {
    contents: [
      {
        uri: requestedUri, // Return the requested URI (which version was requested)
        mimeType: "text/html+skybridge",
        text: widget.html, // Same HTML for all versions
        _meta: {
          ...widgetDescriptorMeta(widget),
          "openai/outputTemplate": requestedUri, // Use requested URI in metadata
          "openai/widgetPrefersBorder": true,
          "openai/widgetDomain": "https://agentsyx.com",
          "openai/widgetCSP": {
            connect_domains: ["https://agentsyx.com"],
            resource_domains: ["https://*.agentsyx.com"],
          },
        },
      },
    ],
  };
  return result;
}

async function handleListResourceTemplates(
  _request: ListResourceTemplatesRequest
) {
  const requestId = (_request as { id?: string | number }).id;
  console.log("[MCP Handler] handleListResourceTemplates - request id:", requestId);
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

function getBearerTokenFromAuthHeader(
  header: string | string[] | undefined
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = raw.match(/^\s*Bearer\s+(.+)\s*$/i);
  return match?.[1] ?? null;
}

function isAuthorized(req: IncomingMessage): { ok: true } | { ok: false; status: number; message: string } {
  const expected = process.env.API_KEY;
  console.log("[AUTH] Checking API_KEY authorization");
  console.log("[AUTH] API_KEY env var present =", Boolean(expected));
  if (!expected) {
    console.log("[AUTH] DENY: missing API_KEY env var (server misconfigured)");
    return {
      ok: false,
      status: 500,
      message: "Server misconfigured: missing API_KEY env var",
    };
  }

  const token = getBearerTokenFromAuthHeader(req.headers.authorization);
  console.log("[AUTH] Authorization header present =", Boolean(req.headers.authorization));
  console.log("[AUTH] Bearer token parsed =", Boolean(token));
  if (!token) {
    console.log("[AUTH] DENY: missing/invalid Authorization header (expected Bearer)");
    return { ok: false, status: 401, message: "Missing Authorization: Bearer <API_KEY>" };
  }

  // Avoid leaking timing differences
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  console.log("[AUTH] token length =", a.length, "expected length =", b.length);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.log("[AUTH] DENY: token mismatch");
    return { ok: false, status: 401, message: "Invalid API key" };
  }

  console.log("[AUTH] ALLOW: token matched");
  return { ok: true };
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, mcp-session-id, authorization"
  );
  res.setHeader("Content-Type", "application/json");

  try {
    console.log("[MCP] Incoming request:", {
      method: req.method,
      url: req.url,
      hasAuthHeader: Boolean(req.headers.authorization),
      hasSessionHeader: Boolean(req.headers["mcp-session-id"]),
    });
    const auth = isAuthorized(req);
    if (!auth.ok) {
      console.log("[MCP] Auth failed:", { status: auth.status, message: auth.message });
      res.setHeader("WWW-Authenticate", "Bearer");
      res.writeHead(auth.status);
      res.end(JSON.stringify({ error: auth.message }));
      return;
    }

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
      if (sessionId) {
        res.setHeader("mcp-session-id", sessionId);
      }
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
          method: "tools/list" as const,
          params: params || {},
        };
        console.log("[MCP] tools/list - id:", id, "params:", JSON.stringify(params));
        result = await handleListTools(request);
        console.log("[MCP] tools/list response:", JSON.stringify(result));
      } else if (method === "tools/call") {
        const request: CallToolRequest = {
          method: "tools/call" as const,
          params: params || {},
        };
        console.log("[MCP] tools/call - id:", id, "params:", JSON.stringify(params));
        result = await handleCallTool(request);
        console.log("[MCP] tools/call response:", JSON.stringify(result));
      } else if (method === "resources/list") {
        const request: ListResourcesRequest = {
          method: "resources/list" as const,
          params: params || {},
        };
        console.log("[MCP] resources/list - id:", id, "params:", JSON.stringify(params));
        result = await handleListResources(request);
        console.log("[MCP] resources/list response:", JSON.stringify(result));
      } else if (method === "resources/read") {
        const request: ReadResourceRequest = {
          method: "resources/read" as const,
          params: params || {},
        };
        console.log("[MCP] resources/read - id:", id, "params:", JSON.stringify(params));
        result = await handleReadResource(request);
        console.log("[MCP] resources/read response (truncated, contains HTML)");
      } else {
        console.error("[MCP] Method not found:", method);
        writeJsonRpcResponse(res, id, undefined, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
        res.end();
        return;
      }

      if (sessionId) {
        res.setHeader("mcp-session-id", sessionId);
      }
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

function startLocalHttpServer(): void {
  const portEnv = Number(process.env.PORT ?? 8000);
  const port = Number.isFinite(portEnv) ? portEnv : 8000;

  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          res.writeHead(400).end("Missing URL");
          return;
        }

        const url = new URL(
          req.url,
          `http://${req.headers.host ?? "localhost"}`
        );

        if (req.method === "OPTIONS" && url.pathname === "/mcp") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "content-type, mcp-session-id, authorization",
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
        console.error(
          "[HTTP Server] Unhandled error in request handler:",
          error
        );
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
    console.error(
      "[Server] Unhandled rejection at:",
      promise,
      "reason:",
      reason
    );
    // Don't exit - let the server continue running
  });

  httpServer.listen(port, () => {
    console.log(`ChatVault MCP server listening on http://localhost:${port}`);
    console.log(`  MCP endpoint: POST http://localhost:${port}/mcp`);
  });
}

function isDirectRun(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  startLocalHttpServer();
}

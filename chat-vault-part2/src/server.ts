import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    type ListToolsRequest,
    type CallToolRequest,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { testConnection, db } from "./db/index.js";
import { sql } from "drizzle-orm";
import { saveChat } from "./tools/saveChat.js";
import { widgetAdd } from "./tools/widgetAdd.js";
import { loadMyChats } from "./tools/loadMyChats.js";
import { searchMyChats } from "./tools/searchMyChats.js";
import { explainHowToUse } from "./tools/explainHowToUse.js";
import { deleteChat } from "./tools/deleteChat.js";
import { updateChat } from "./tools/updateChat.js";

dotenv.config();

// Anonymous user limits (for tutorial purposes)
export const ANON_CHAT_EXPIRY_DAYS = 30; // Chats older than 30 days are considered expired
export const ANON_MAX_CHATS = 10; // Maximum number of chats for anonymous users

// User context type (from Findexar headers)
export interface UserContext {
    isAnon?: boolean;
    isAnonymousPlan?: boolean; // True if user is on an anonymous (free/limited) subscription plan
    portalLink?: string | null;
    loginLink?: string | null;
}

// Session management
type SessionRecord = {
    server: Server;
    sessionId: string;
};

const sessions = new Map<string, SessionRecord>();

function generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// Create MCP server instance
function createMcpServer(): Server {
    const server = new Server(
        {
            name: "chat-vault-part2",
            version: "0.1.0",
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Register handlers
    server.setRequestHandler(ListToolsRequestSchema, handleListTools);
    // Note: handleCallTool is called directly from handleMcpRequest with userContext
    // This registration is for SDK compatibility but may not be used
    server.setRequestHandler(CallToolRequestSchema, (request) => handleCallTool(request));

    return server;
}

// Define available tools
const chatVaultTools: Tool[] = [
    {
        name: "deleteChat",
        description: "USED INSIDE THE WIDGET. Delete selected chat by the widget using chatId",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                chatId: {
                    type: "string",
                    description: "Chat ID to delete (required)",
                },
            },
            required: ["userId", "chatId"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: true,
        },

    },
    {
        name: "updateChat",
        description: "USED INSIDE THE WIDGET. Update a chat's properties (title and/or turns). When turns are updated, embeddings are regenerated.",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                chatId: {
                    type: "string",
                    description: "Chat ID to update (required)",
                },
                chat: {
                    type: "object",
                    description: "Chat properties to update (at least one of title or turns must be provided)",
                    properties: {
                        title: {
                            type: "string",
                            description: "New title for the chat (optional, max 2048 characters)",
                        },
                        turns: {
                            type: "array",
                            description: "Updated turns array (optional, must be non-empty if provided)",
                            items: {
                                type: "object",
                                properties: {
                                    prompt: { type: "string" },
                                    response: { type: "string" },
                                },
                                required: ["prompt", "response"],
                            },
                        },
                    },
                },
            },
            required: ["userId", "chatId", "chat"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        },
    },
    {
        name: "saveChat",
        description: "Save a chat conversation with embeddings for semantic search. To be used by LLM to save chats turn-by-turn verbatiminto the vault.",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                title: {
                    type: "string",
                    description: "Chat title",
                },
                turns: {
                    type: "array",
                    description: "Array of chat turns (prompt and response pairs)",
                    items: {
                        type: "object",
                        properties: {
                            prompt: { type: "string" },
                            response: { type: "string" },
                        },
                        required: ["prompt", "response"],
                    },
                },
            },
            required: ["userId", "title", "turns"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        }
    },
    {
        name: "loadMyChats",
        description: "USED INSIDE THE WIDGET. Load paginated chat data for a user with optional text search filter",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                page: {
                    type: "number",
                    description: "Page number (0-indexed, default 0)",
                },
                size: {
                    type: "number",
                    description: "Number of chats per page (default 10)",
                },
                query: {
                    type: "string",
                    description: "Optional search query to filter chats by title or content",
                },
                widgetVersion: {
                    type: "string",
                    description: "Widget version (optional, for tracking which widget version is calling)",
                },
            },
            required: ["userId"],
        },

        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        }
    },
    {
        name: "searchMyChats",
        description: "LLM: Search chats using vector similarity search. Access user's knowledge base and long-term memory and include with your context.",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                query: {
                    type: "string",
                    description: "Search query text (required)",
                },
                page: {
                    type: "number",
                    description: "Page number (0-indexed, default 0)",
                },
                size: {
                    type: "number",
                    description: "Number of results per page (default 10)",
                },
            },
            required: ["userId", "query"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        }
    },
    {
        name: "widgetAdd",
        description: "NOT TO BE USED OUTSIDE OF THE WIDGET!!! In-widget save a manually pasted Claude, Gemini, ChatGPT, etc. conversation by parsing HTML/text content",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                htmlContent: {
                    type: "string",
                    description: "The pasted HTML/text content from ChatGPT conversation",
                },
                title: {
                    type: "string",
                    description: "Optional title for the chat (defaults to 'manual save [timestamp]')",
                },
                widgetVersion: {
                    type: "string",
                    description: "Widget version (optional, for tracking which widget version is calling)",
                },
            },
            required: ["userId", "htmlContent"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        }
    },
    {
        name: "explainHowToUse",
        description: "Get help text explaining how to use ChatVault",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
            },
            required: ["userId"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        }
    },
];

// Handler for tools/list
async function handleListTools(request: ListToolsRequest) {
    const requestId = (request as unknown as { id?: string | number }).id;
    console.log("[MCP Handler] handleListTools - request id:", requestId);
    const result = { tools: chatVaultTools };
    console.log("[MCP Handler] handleListTools - returning", result.tools.length, "tools");
    return result;
}

// Handler for tools/call
async function handleCallTool(request: CallToolRequest, userContext?: UserContext, headers?: Record<string, string | string[] | undefined>) {
    const requestId = (request as unknown as { id?: string | number }).id;
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    console.log(
        "[MCP Handler] handleCallTool - request id:",
        requestId,
        "tool:",
        toolName,
        "arguments:",
        JSON.stringify(args),
        "userContext:",
        JSON.stringify(userContext)
    );
    // Debug: Check if portalLink is in arguments (maybe nested or with different casing)
    if (toolName === "loadMyChats") {
        console.log("[MCP Handler] Debug - checking for portalLink in args:", {
            hasPortalLink: !!(args as any).portalLink,
            hasPortal_link: !!(args as any).portal_link,
            hasPortalLinkLower: !!(args as any).portallink,
            allArgKeys: Object.keys(args),
            argsFull: JSON.stringify(args),
        });
    }

    try {
        if (toolName === "saveChat") {
            const result = await saveChat(args as { userId: string; title: string; turns: Array<{ prompt: string; response: string }> });
            console.log("[MCP Handler] handleCallTool - saveChat result:", JSON.stringify(result));
            return {
                content: [
                    {
                        type: "text",
                        text: `Chat saved successfully with ID: ${result.chatId}`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "loadMyChats") {
            // Findexar may inject portalLink and isAnon into arguments as well
            // Use arguments as fallback if not in headers
            const finalUserContext: UserContext = {
                isAnon: userContext?.isAnon ?? (args as any).isAnon ?? false,
                isAnonymousPlan: userContext?.isAnonymousPlan ?? (args as any).isAnonymousPlan,
                portalLink: userContext?.portalLink ?? (args as any).portalLink ?? null,
                loginLink: userContext?.loginLink ?? (args as any).loginLink ?? null,
            };
            console.log("[MCP Handler] Final userContext (headers + args fallback):", finalUserContext);
            const result = await loadMyChats({
                ...(args as { userId: string; page?: number; size?: number; query?: string }),
                userContext: finalUserContext,
                headers: headers, // Pass all headers for logging
            });
            console.log("[MCP Handler] handleCallTool - loadMyChats result:", result.chats.length, "chats", "userInfo:", result.userInfo);
            // Return in Part 1 compatible format: structuredContent with chats, pagination, and userInfo
            return {
                content: [
                    {
                        type: "text",
                        text: `Loaded ${result.chats.length} chats`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "searchMyChats") {
            const result = await searchMyChats(args as { userId: string; query: string; page?: number; size?: number });
            console.log("[MCP Handler] handleCallTool - searchMyChats result:", result.chats.length, "chats");
            // Return in Part 1 compatible format: structuredContent with chats, search, and pagination
            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${result.chats.length} chats matching "${result.search.query}"`,
                    },
                ],
                structuredContent: {
                    chats: result.chats,
                    search: result.search,
                    pagination: result.pagination,
                },
                _meta: {
                    chats: result.chats,
                    search: result.search,
                    pagination: result.pagination,
                },
            };
        } else if (toolName === "widgetAdd") {
            console.log("[MCP Handler] 📥 widgetAdd request received:", {
                requestId: requestId,
                userId: (args as any)?.userId?.substring(0, 20) + "...",
                htmlContentLength: (args as any)?.htmlContent?.length || 0,
                htmlContentPreview: (args as any)?.htmlContent?.substring(0, 200) || "(empty)",
                hasTitle: !!(args as any)?.title,
                title: (args as any)?.title || "(none)",
                userContext: userContext ? {
                    isAnon: userContext.isAnon,
                    hasPortalLink: !!userContext.portalLink,
                    hasLoginLink: !!userContext.loginLink,
                } : "none",
            });
            const result = await widgetAdd({
                ...(args as { userId: string; htmlContent: string; title?: string }),
                userContext,
            });
            console.log("[MCP Handler] 📤 widgetAdd result:", {
                chatId: result.chatId || "(empty)",
                saved: result.saved,
                turnsCount: result.turnsCount,
                error: result.error || "(none)",
                message: result.message || "(none)",
            });
            return {
                content: [
                    {
                        type: "text",
                        text: result.error
                            ? `Error: ${result.message}`
                            : `Chat saved successfully with ID: ${result.chatId} (${result.turnsCount} turns)`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "explainHowToUse") {
            const result = explainHowToUse(args as { userId: string });
            console.log("[MCP Handler] handleCallTool - explainHowToUse result");
            return {
                content: [
                    {
                        type: "text",
                        text: result.helpText,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "deleteChat") {
            const result = await deleteChat(args as { userId: string; chatId: string });
            console.log("[MCP Handler] handleCallTool - deleteChat result:", JSON.stringify(result));
            return {
                content: [
                    {
                        type: "text",
                        text: `Chat deleted successfully with ID: ${result.chatId}`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "updateChat") {
            const result = await updateChat(args as { userId: string; chatId: string; chat: { title?: string; turns?: Array<{ prompt: string; response: string }> } });
            console.log("[MCP Handler] handleCallTool - updateChat result:", JSON.stringify(result));
            return {
                content: [
                    {
                        type: "text",
                        text: `Chat updated successfully with ID: ${result.chatId}`,
                    },
                ],
                structuredContent: result,
            };
        } else {
            throw new Error(`Unknown tool: ${toolName}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[MCP Handler] handleCallTool - error:", errorMessage);
        // Re-throw to be caught by the outer error handler and returned as JSON-RPC error
        throw error;
    }
}

// JSON-RPC response helper
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

    res.setHeader("Content-Type", "application/json");
    res.write(JSON.stringify(response));
}

// Read request body
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

function isAuthorized(
    req: IncomingMessage
): { ok: true } | { ok: false; status: number; message: string } {
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
        return {
            ok: false,
            status: 401,
            message: "Missing Authorization: Bearer <API_KEY>",
        };
    }

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

// Main MCP request handler
export async function handleMcpRequest(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "content-type, mcp-session-id, authorization"
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

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
            res.writeHead(auth.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: auth.message }));
            return;
        }

        // Extract user context from A6 headers
        const isAnonHeader = req.headers["x-a6-is-anon-user"];
        const isAnonymousPlanHeader = req.headers["x-a6-anonymous-subscription"];
        const portalLinkHeader = req.headers["x-a6-portal-link"];
        const loginLinkHeader = req.headers["x-a6-login-link"];
        // Log all A6 headers for debugging
        const a6Headers = Object.keys(req.headers)
            .filter(key => key.toLowerCase().startsWith("x-a6"))
            .reduce((acc, key) => {
                acc[key] = req.headers[key];
                return acc;
            }, {} as Record<string, string | string[] | undefined>);
        console.log("[MCP] All A6 headers:", JSON.stringify(a6Headers));
        const userContext: UserContext = {
            isAnon: isAnonHeader === "true" || isAnonHeader === "True",
            isAnonymousPlan: isAnonymousPlanHeader === "true" || isAnonymousPlanHeader === "True",
            portalLink: portalLinkHeader ? String(portalLinkHeader) : null,
            loginLink: loginLinkHeader ? String(loginLinkHeader) : null,
        };
        console.log("[MCP] User context extracted from headers:", userContext);

        const body = await readRequestBody(req);
        console.log("[MCP] Incoming request body:", body);
        const requestData = JSON.parse(body);

        const { jsonrpc, id, method, params } = requestData;
        console.log(
            "[MCP] Request parsed - id:",
            id,
            "method:",
            method,
            "params:",
            JSON.stringify(params)
        );

        // Validate JSON-RPC version
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
            console.log(
                "[MCP] initialize - id:",
                id,
                "params:",
                JSON.stringify(params)
            );
            if (!session) {
                sessionId = generateSessionId();
                console.log("[MCP] Creating new session:", sessionId);
                const server = createMcpServer();
                session = { server, sessionId };
                sessions.set(sessionId, session);
            } else {
                console.log("[MCP] Using existing session:", sessionId);
            }

            const response = {
                protocolVersion: "2024-11-05",
                capabilities: {
                    tools: {},
                },
                serverInfo: {
                    name: "chat-vault-part2",
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
            sessionId = generateSessionId();
            console.log("[MCP] Creating new session:", sessionId);
            const server = createMcpServer();
            session = { server, sessionId };
            sessions.set(sessionId, session);
        }

        // Dispatch to handler functions
        try {
            let result: unknown;

            if (method === "tools/list") {
                const request = {
                    method: "tools/list" as const,
                    params: params || {},
                } as ListToolsRequest;
                console.log(
                    "[MCP] tools/list - id:",
                    id,
                    "params:",
                    JSON.stringify(params)
                );
                result = await handleListTools(request);
                console.log("[MCP] tools/list response:", JSON.stringify(result));
            } else if (method === "tools/call") {
                const request: CallToolRequest = {
                    jsonrpc: "2.0",
                    id: id as string | number,
                    method: "tools/call",
                    params: params || {},
                } as CallToolRequest;
                console.log(
                    "[MCP] tools/call - id:",
                    id,
                    "params:",
                    JSON.stringify(params)
                );
                result = await handleCallTool(request, userContext, req.headers);
                console.log("[MCP] tools/call response:", JSON.stringify(result));
            } else if (method === "resources/list") {
                // MCP protocol: resources/list - return empty list since we don't provide resources
                console.log("[MCP] resources/list - id:", id);
                result = { resources: [] };
                console.log("[MCP] resources/list response: empty list");
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
            console.error(
                "[MCP] Error stack:",
                error instanceof Error ? error.stack : "N/A"
            );
            // Preserve error messages for user-facing errors (validation, not found, etc.)
            // Use the actual error message if it's meaningful, otherwise use "Internal error"
            const isUserFacingError =
                errorMessage.includes("not found") ||
                errorMessage.includes("required") ||
                errorMessage.includes("invalid") ||
                errorMessage.includes("does not belong");

            writeJsonRpcResponse(res, id, undefined, {
                code: -32603,
                message: isUserFacingError ? errorMessage : "Internal error",
                data: isUserFacingError ? undefined : errorMessage,
            });
            res.end();
        }
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        console.error("[MCP] Error parsing request:", errorMessage);
        console.error(
            "[MCP] Error stack:",
            error instanceof Error ? error.stack : "N/A"
        );
        writeJsonRpcResponse(res, null, undefined, {
            code: -32700,
            message: "Parse error",
            data: errorMessage,
        });
        res.end();
    }
}

// HTTP server setup
const PORT = process.env.PORT_BACKEND ? parseInt(process.env.PORT_BACKEND, 10) : 8001;

const server = createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS" && req.url === "/mcp") {
        console.log("[MCP] CORS preflight request");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
            "Access-Control-Allow-Headers",
            "content-type, mcp-session-id, authorization"
        );
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.writeHead(204);
        res.end();
        return;
    }

    // Handle MCP requests
    if (req.method === "POST" && req.url === "/mcp") {
        handleMcpRequest(req, res).catch((error) => {
            console.error("[MCP] Unhandled error in request handler:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal server error" }));
            }
        });
        return;
    }

    // 404 for other routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

// Test database connection and verify pgvector on startup
export async function initializeDatabase() {
    try {
        console.log("[DB] Testing database connection...");
        const isConnected = await testConnection();
        if (!isConnected) {
            throw new Error("Database connection test failed");
        }
        console.log("[DB] Database connection successful");

        // Verify pgvector extension is available
        const result = await db.execute(
            sql`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as vector_available`
        );
        const vectorAvailable = (result[0] as { vector_available: boolean })?.vector_available;
        if (!vectorAvailable) {
            console.warn("[DB] Warning: pgvector extension not found. Run migrations to enable it.");
        } else {
            console.log("[DB] pgvector extension is available");
        }
    } catch (error) {
        console.error("[DB] Database initialization failed:", error);
        throw error;
    }
}

// Start server after database initialization
async function startServer() {
    try {
        await initializeDatabase();

        server.listen(PORT, () => {
            console.log(`ChatVault Part 2 MCP server listening on http://localhost:${PORT}`);
            console.log(`  MCP endpoint: POST http://localhost:${PORT}/mcp`);
            console.log(`  CORS preflight: OPTIONS http://localhost:${PORT}/mcp`);
        });
    } catch (error) {
        console.error("[Server] Failed to start server:", error);
        process.exit(1);
    }
}

function isDirectRun(): boolean {
    try {
        // With tsx, argv[1] should be the entry file path
        const entry = process.argv[1];
        if (!entry) return false;
        return fileURLToPath(import.meta.url) === resolve(entry);
    } catch {
        return false;
    }
}

if (isDirectRun()) {
    startServer();
}

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n[MCP] Shutting down server...");
    server.close(() => {
        console.log("[MCP] Server closed");
        process.exit(0);
    });
});

process.on("SIGTERM", () => {
    console.log("\n[MCP] Shutting down server...");
    server.close(() => {
        console.log("[MCP] Server closed");
        process.exit(0);
    });
});

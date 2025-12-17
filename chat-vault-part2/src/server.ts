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
import { loadChats } from "./tools/loadChats.js";
import { searchChats } from "./tools/searchChats.js";

dotenv.config();

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
    server.setRequestHandler(CallToolRequestSchema, handleCallTool);

    return server;
}

// Define available tools
const chatVaultTools: Tool[] = [
    {
        name: "saveChat",
        description: "Save a chat conversation with embeddings for semantic search",
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
    },
    {
        name: "loadChats",
        description: "Load paginated chat data for a user",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required)",
                },
                page: {
                    type: "number",
                    description: "Page number (1-indexed, default 1)",
                },
                limit: {
                    type: "number",
                    description: "Number of chats per page (default 10)",
                },
            },
            required: ["userId"],
        },
    },
    {
        name: "searchChats",
        description: "Search chats using vector similarity search",
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
                limit: {
                    type: "number",
                    description: "Maximum number of results (default 10)",
                },
            },
            required: ["userId", "query"],
        },
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
async function handleCallTool(request: CallToolRequest) {
    const requestId = (request as unknown as { id?: string | number }).id;
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    console.log(
        "[MCP Handler] handleCallTool - request id:",
        requestId,
        "tool:",
        toolName,
        "arguments:",
        JSON.stringify(args)
    );

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
        } else if (toolName === "loadChats") {
            const result = await loadChats(args as { userId: string; page?: number; limit?: number });
            console.log("[MCP Handler] handleCallTool - loadChats result:", result.chats.length, "chats");
            // Return in Part 1 compatible format: structuredContent with chats and pagination
            return {
                content: [
                    {
                        type: "text",
                        text: `Loaded ${result.chats.length} chats`,
                    },
                ],
                structuredContent: {
                    chats: result.chats,
                    pagination: result.pagination,
                },
                _meta: {
                    chats: result.chats,
                    pagination: result.pagination,
                },
            };
        } else if (toolName === "searchChats") {
            const result = await searchChats(args as { userId: string; query: string; limit?: number });
            console.log("[MCP Handler] handleCallTool - searchChats result:", result.chats.length, "chats");
            // Return in Part 1 compatible format: structuredContent with chats and search metadata
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
                },
                _meta: {
                    chats: result.chats,
                    search: result.search,
                },
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
    if (!expected) {
        return {
            ok: false,
            status: 500,
            message: "Server misconfigured: missing API_KEY env var",
        };
    }

    const token = getBearerTokenFromAuthHeader(req.headers.authorization);
    if (!token) {
        return {
            ok: false,
            status: 401,
            message: "Missing Authorization: Bearer <API_KEY>",
        };
    }

    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return { ok: false, status: 401, message: "Invalid API key" };
    }

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
        const auth = isAuthorized(req);
        if (!auth.ok) {
            res.setHeader("WWW-Authenticate", "Bearer");
            res.writeHead(auth.status, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: auth.message }));
            return;
        }

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
            console.error(
                "[MCP] Session not found for method:",
                method,
                "sessionId:",
                sessionId
            );
            writeJsonRpcResponse(res, id, undefined, {
                code: -32000,
                message: "Session not found. Call initialize first.",
            });
            res.end();
            return;
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
                result = await handleCallTool(request);
                console.log("[MCP] tools/call response:", JSON.stringify(result));
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
            writeJsonRpcResponse(res, id, undefined, {
                code: -32603,
                message: "Internal error",
                data: errorMessage,
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

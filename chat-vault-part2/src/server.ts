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
import { testConnection, db, observeDatabaseOperation } from "./db/index.js";
import { sql } from "drizzle-orm";
import { saveChat } from "./tools/saveChat.js";
import { saveChatTurnsBegin } from "./tools/saveChatTurnsBegin.js";
import { saveChatTurn } from "./tools/saveChatTurn.js";
import { saveChatTurnsFinalize } from "./tools/saveChatTurnsFinalize.js";
import { widgetAdd } from "./tools/widgetAdd.js";
import { loadMyChats } from "./tools/loadMyChats.js";
import { loadFullTurn } from "./tools/loadFullTurn.js";
import { searchMyChats } from "./tools/searchMyChats.js";
import { explainHowToUse } from "./tools/explainHowToUse.js";
import { deleteChat } from "./tools/deleteChat.js";
import { updateChat } from "./tools/updateChat.js";
import { listTopics } from "./tools/listTopics.js";
import { getJobStatus } from "./utils/redis.js";
import { resolveDeclaredUserIdWithMerge } from "./user/userMerge.js";

dotenv.config();

const serverInstanceStartedAt = Date.now();
let requestCountInInstance = 0;

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
const GENERIC_OUTPUT_SCHEMA = {
    type: "object" as const,
    description: "Tool result payload (structuredContent).",
    additionalProperties: true,
};

// More specific output schemas for LLM-facing tools (match structuredContent shapes).
const SAVE_CONVERSATION_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: true,
    properties: {
        jobId: { type: "string" },
        chatId: { type: "string" },
        saved: { type: "boolean" },
    },
    anyOf: [
        { required: ["jobId"] },
        { required: ["chatId", "saved"] },
    ],
};

const SAVE_CONVERSATION_BEGIN_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: false,
    required: ["jobId"],
    properties: {
        jobId: { type: "string" },
    },
};

const SAVE_CONVERSATION_TURN_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: false,
    required: ["ok", "turnIndex"],
    properties: {
        ok: { type: "boolean" },
        turnIndex: { type: "number" },
    },
};

const SAVE_CONVERSATION_FINALIZE_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: true,
    properties: {
        jobId: { type: "string" },
        chatId: { type: "string" },
    },
    anyOf: [
        { required: ["jobId"] },
        { required: ["chatId"] },
    ],
};

const SEARCH_KNOWLEDGE_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: false,
    required: ["chats", "search", "pagination"],
    properties: {
        chats: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: true,
                required: ["id", "userId", "title", "timestamp", "turns"],
                properties: {
                    id: { type: "string" },
                    userId: { type: "string" },
                    title: { type: "string" },
                    timestamp: { type: "string", description: "ISO date-time string" },
                    turns: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["prompt", "response"],
                            properties: {
                                prompt: { type: "string" },
                                response: { type: "string" },
                            },
                        },
                    },
                    similarity: { type: "number" },
                },
            },
        },
        search: {
            type: "object" as const,
            additionalProperties: false,
            required: ["query"],
            properties: {
                query: { type: "string" },
            },
        },
        pagination: {
            type: "object" as const,
            additionalProperties: false,
            required: ["page", "limit", "total", "totalPages", "hasMore"],
            properties: {
                page: { type: "number" },
                limit: { type: "number" },
                total: { type: "number" },
                totalPages: { type: "number" },
                hasMore: { type: "boolean" },
            },
        },
    },
};

const GET_SAVE_JOB_STATUS_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: false,
    required: ["status"],
    properties: {
        status: {
            type: "string",
            enum: ["pending", "completed", "failed", "expired"],
        },
        chatId: { type: "string" },
        chatIds: { type: "array", items: { type: "string" } },
        error: { type: "string" },
    },
};

const EXPLAIN_HOW_TO_USE_OUTPUT_SCHEMA = {
    type: "object" as const,
    additionalProperties: false,
    required: ["helpText"],
    properties: {
        helpText: { type: "string" },
    },
};

type ToolMetadataProfile = "full" | "gpt";

function getToolMetadataProfile(): ToolMetadataProfile {
    const raw = (process.env.CHATVAULT_TOOL_METADATA_PROFILE ?? "full").toLowerCase();
    if (raw === "gpt" || raw === "limited") return "gpt";
    return "full";
}

/** Maps public MCP tool names to the existing implementation handler keys. */
const TOOL_NAME_ALIASES: Record<string, string> = {
    savePastedContent: "widgetAdd",
};

function normalizeToolName(toolName: string): string {
    return TOOL_NAME_ALIASES[toolName] ?? toolName;
}

const deleteSavedEntryTool: Tool = {
        name: "deleteSavedEntry",
        title: "Delete saved entry",
        description:
            "Delete the selected saved entry from the user's private Chat Vault.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
                entryId: { type: "string", description: "Saved entry ID to delete (required)" },
            },
            required: ["userId", "entryId"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: true,
        },
        _meta: { ui: { visibility: ["app"] } },
        outputSchema: GENERIC_OUTPUT_SCHEMA,
};

const updateSavedEntryTool: Tool = {
        name: "updateSavedEntry",
        title: "Update saved entry",
        description:
            "Update the title and/or conversation turns of an entry already stored in the user's private Chat Vault.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
                entryId: { type: "string", description: "Saved entry ID to update (required)" },
                entry: {
                    type: "object",
                    description: "Saved entry properties to update; provide title and/or turns.",
                    properties: {
                        title: {
                            type: "string",
                            description: "New title for the saved entry (optional, max 2048 characters)",
                        },
                        turns: {
                            type: "array",
                            description: "Updated conversation turns; must be non-empty if provided.",
                            items: {
                                type: "object",
                                properties: {
                                    prompt: { type: "string" },
                                    response: { type: "string" },
                                },
                                required: ["prompt", "response"],
                            },
                        },
                        topics: {
                            type: "array",
                            description:
                                "Full replacement topic list (max 5). Each item is a topic UUID or a display name to resolve/create.",
                            items: { type: "string" },
                        },
                    },
                },
            },
            required: ["userId", "entryId", "entry"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: true,
        },
        _meta: { ui: { visibility: ["app"] } },
        outputSchema: GENERIC_OUTPUT_SCHEMA,
};

const llmSaveConversationTool: Tool = {
        name: "saveConversation",
        title: "Save conversation",
        description:
            "Save a short conversation selected in the Chat Vault app, or explicitly requested by the user through a supported model (up to about 3 turns). The conversation content is sent to Chat Vault and stored in the user's personal vault. Prefer this for short saves. For longer conversations, use saveConversationBegin, then saveConversationTurn for each turn in order, then saveConversationFinalize.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
                title: { type: "string", description: "Title for the saved conversation" },
                turns: {
                    type: "array",
                    description: "Array of conversation turns, with prompt and response pairs.",
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
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: SAVE_CONVERSATION_OUTPUT_SCHEMA,
};

const llmSaveConversationBeginTool: Tool = {
        name: "saveConversationBegin",
        title: "Start multi-turn save",
        description:
            "Begin a multi-turn save session for a longer conversation. Used by the Chat Vault app, and by supported models when the user explicitly asks to save a conversation longer than about 3 turns. Call this first, then call saveConversationTurn for each turn in order, then call saveConversationFinalize. After finalize, the conversation content is sent to Chat Vault and stored in the user's personal vault. Pass the returned jobId into each subsequent call. Do not poll job status yourself.",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required, injected by connector)",
                },
                title: { type: "string", description: "Title for the saved conversation" },
            },
            required: ["userId", "title"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: SAVE_CONVERSATION_BEGIN_OUTPUT_SCHEMA,
};

const llmSaveConversationTurnTool: Tool = {
        name: "saveConversationTurn",
        title: "Add save turn",
        description:
            "Add one turn (prompt and response) to an open multi-turn save session started by the Chat Vault app or saveConversationBegin. Call once per turn in order, with turnIndex 0, 1, 2, and so on without skipping. Content is accumulated and will be sent to Chat Vault and stored when saveConversationFinalize is called.",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required, injected by connector)",
                },
                jobId: {
                    type: "string",
                    description: "Job ID from saveConversationBegin (required)",
                },
                turnIndex: {
                    type: "number",
                    description: "0-based turn index",
                },
                turn: {
                    type: "object",
                    description: "Conversation turn with prompt and response",
                    properties: {
                        prompt: { type: "string" },
                        response: { type: "string" },
                    },
                    required: ["prompt", "response"],
                },
            },
            required: ["userId", "jobId", "turnIndex", "turn"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: SAVE_CONVERSATION_TURN_OUTPUT_SCHEMA,
};

const llmSaveConversationFinalizeTool: Tool = {
        name: "saveConversationFinalize",
        title: "Finalize multi-turn save",
        description:
            "Finalize a multi-turn save session started by the Chat Vault app or saveConversationBegin after all turns have been added. Pass the session jobId. The full conversation content is sent to Chat Vault and stored in the user's personal vault. On success, tell the user their conversation was saved (or is being saved). Do not poll job status yourself.",
        inputSchema: {
            type: "object",
            properties: {
                userId: {
                    type: "string",
                    description: "User ID (required, injected by connector)",
                },
                jobId: {
                    type: "string",
                    description: "Job ID from saveConversationBegin (required)",
                },
            },
            required: ["userId", "jobId"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: SAVE_CONVERSATION_FINALIZE_OUTPUT_SCHEMA,
};

const loadSavedEntriesTool: Tool = {
        name: "loadSavedEntries",
        title: "Load saved entries",
        description:
            "Load a paginated list of the user's saved Chat Vault entries, with optional text filtering. Used to browse or inspect what is already stored.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
                page: {
                    type: "number",
                    description: "Page number, 0-indexed. Default is 0.",
                },
                size: {
                    type: "number",
                    description: "Number of saved entries per page. Default is 10.",
                },
                query: {
                    type: "string",
                    description: "Optional text query to filter saved entries by title or content.",
                },
                topicIds: {
                    type: "array",
                    description: "Optional topic ids — return entries matching ANY selected topic.",
                    items: { type: "string" },
                },
                aboveTheFoldOnly: {
                    type: "boolean",
                    description:
                        "When true, return saved entries with truncated content. Use loadFullTurn when the user expands a turn.",
                },
                widgetVersion: {
                    type: "string",
                    description: "Widget version, optional.",
                },
            },
            required: ["userId"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: GENERIC_OUTPUT_SCHEMA,
};

const listTopicsTool: Tool = {
        name: "listTopics",
        title: "List topics",
        description:
            "List the user's topics for filtering and organizing saved Chat Vault entries in the widget.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
            },
            required: ["userId"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["app"] } },
        outputSchema: GENERIC_OUTPUT_SCHEMA,
};

const loadFullTurnTool: Tool = {
        name: "loadFullTurn",
        title: "Load full turn",
        description:
            "Load the full content of one saved turn when a listed entry was returned truncated. Requires entryId and turnIndex.",
        inputSchema: {
            type: "object",
            properties: {
                entryId: { type: "string", description: "Saved entry ID (required)" },
                userId: { type: "string", description: "User ID (required)" },
                turnIndex: {
                    type: "number",
                    description: "0-based turn index (required)",
                },
            },
            required: ["entryId", "userId", "turnIndex"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: GENERIC_OUTPUT_SCHEMA,
};

const searchKnowledgeTool: Tool = {
        name: "searchKnowledge",
        title: "Search saved knowledge",
        description:
            "Search the user's Chat Vault with semantic search. Use matching saved conversations as context when answering. Only searches content the user has previously stored in Chat Vault.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
                query: {
                    type: "string",
                    description: "Natural-language search query (required)",
                },
                page: {
                    type: "number",
                    description: "Page number, 0-indexed. Default is 0.",
                },
                size: {
                    type: "number",
                    description: "Number of results per page. Default is 10.",
                },
            },
            required: ["userId", "query"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: SEARCH_KNOWLEDGE_OUTPUT_SCHEMA,
};

const getSaveJobStatusTool: Tool = {
        name: "getSaveJobStatus",
        title: "Get save job status",
        description:
            "Get the current status of an app-initiated asynchronous save job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: {
                    type: "string",
                    description: "Job ID returned by savePastedContent (required)",
                },
            },
            required: ["jobId"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["app"] } },
        outputSchema: GET_SAVE_JOB_STATUS_OUTPUT_SCHEMA,
};

const savePastedContentTool: Tool = {
        name: "savePastedContent",
        title: "Save pasted content",
        description:
            "Parse and save HTML or text that the user explicitly pasted into the Chat Vault app.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
                htmlContent: {
                    type: "string",
                    description: "User-provided HTML or text content to save",
                },
                title: {
                    type: "string",
                    description: "Optional title for the saved entry",
                },
                widgetVersion: {
                    type: "string",
                    description: "Widget version, optional.",
                },
            },
            required: ["userId", "htmlContent"],
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["app"] } },
        outputSchema: GENERIC_OUTPUT_SCHEMA,
};

const explainHowToUseTool: Tool = {
        name: "explainHowToUse",
        title: "How to use Chat Vault",
        description:
            "Return help text explaining how to save conversations to Chat Vault, search stored knowledge, and open the Chat Vault browser.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string", description: "User ID (required)" },
            },
            required: ["userId"],
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
            destructiveHint: false,
        },
        _meta: { ui: { visibility: ["model", "app"] } },
        outputSchema: EXPLAIN_HOW_TO_USE_OUTPUT_SCHEMA,
};

const internalWidgetTools: Tool[] = [
    savePastedContentTool,
    updateSavedEntryTool,
    deleteSavedEntryTool,
    getSaveJobStatusTool,
    listTopicsTool,
];

const conversationSaveTools: Tool[] = [
    llmSaveConversationTool,
    llmSaveConversationBeginTool,
    llmSaveConversationTurnTool,
    llmSaveConversationFinalizeTool,
];

const readSearchTools: Tool[] = [
    loadSavedEntriesTool,
    loadFullTurnTool,
    searchKnowledgeTool,
    explainHowToUseTool,
];

function getListedTools(): Tool[] {
    const profile = getToolMetadataProfile();
    const profileConversationSaveTools = conversationSaveTools.map((tool) => ({
        ...tool,
        _meta: {
            ...tool._meta,
            ui: {
                ...(tool._meta?.ui ?? {}),
                visibility: profile === "gpt" ? ["app"] : ["model", "app"],
            },
        },
    }));
    return [...internalWidgetTools, ...profileConversationSaveTools, ...readSearchTools];
}

export { getListedTools, getToolMetadataProfile, normalizeToolName, TOOL_NAME_ALIASES };

// Handler for tools/list
async function handleListTools(request: ListToolsRequest) {
    const requestId = (request as unknown as { id?: string | number }).id;
    const profile = getToolMetadataProfile();
    const tools = getListedTools();
    console.log("[MCP Handler] handleListTools - request id:", requestId, "profile:", profile);
    const result = { tools };
    console.log("[MCP Handler] handleListTools - returning", result.tools.length, "tools");
    return result;
}

// Handler for tools/call
async function handleCallTool(request: CallToolRequest, userContext?: UserContext, headers?: Record<string, string | string[] | undefined>) {
    const requestId = (request as unknown as { id?: string | number }).id;
    const requestedToolName = request.params.name;
    const toolName = normalizeToolName(requestedToolName);
    let args: Record<string, unknown> = {
        ...((request.params.arguments ?? {}) as Record<string, unknown>),
    };
    args = await resolveDeclaredUserIdWithMerge(args, headers);

    console.log(
        "[MCP Handler] handleCallTool - request id:",
        requestId,
        "tool:",
        requestedToolName,
        toolName !== requestedToolName ? `(normalized: ${toolName})` : "",
        "arguments:",
        JSON.stringify(args),
        "userContext:",
        JSON.stringify(userContext)
    );
    // Debug: Check if portalLink is in arguments (maybe nested or with different casing)
    if (toolName === "loadSavedEntries") {
        console.log("[MCP Handler] Debug - checking for portalLink in args:", {
            hasPortalLink: !!(args as any).portalLink,
            hasPortal_link: !!(args as any).portal_link,
            hasPortalLinkLower: !!(args as any).portallink,
            allArgKeys: Object.keys(args),
            argsFull: JSON.stringify(args),
        });
    }

    try {
        if (toolName === "saveConversation") {
            const result = await saveChat(args as { userId: string; title: string; turns: Array<{ prompt: string; response: string }> });
            console.log("[MCP Handler] handleCallTool - saveConversation result:", JSON.stringify(result));
            const text = "jobId" in result
                ? `Conversation save queued. Job ID: ${(result as { jobId: string }).jobId}.`
                : `Chat saved. ID: ${(result as { chatId: string }).chatId}`;
            return {
                content: [{ type: "text", text }],
                structuredContent: result,
            };
        } else if (toolName === "saveConversationBegin") {
            const result = await saveChatTurnsBegin(args as { userId: string; title: string });
            console.log("[MCP Handler] handleCallTool - saveConversationBegin result:", result.jobId);
            return {
                content: [
                    {
                        type: "text",
                        text: `Save session started. Job ID: ${result.jobId}. Call saveConversationTurn for each turn, then saveConversationFinalize when done.`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "saveConversationTurn") {
            const result = await saveChatTurn(args as { userId: string; jobId: string; turnIndex: number; turn: { prompt: string; response: string } });
            console.log("[MCP Handler] handleCallTool - saveConversationTurn result:", result.turnIndex);
            return {
                content: [
                    {
                        type: "text",
                        text: `Turn ${result.turnIndex} saved.`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "saveConversationFinalize") {
            const result = await saveChatTurnsFinalize(args as { userId: string; jobId: string });
            console.log("[MCP Handler] handleCallTool - saveConversationFinalize result:", JSON.stringify(result));
            const text = "jobId" in result
                ? `Conversation save queued. Job ID: ${(result as { jobId: string }).jobId}.`
                : `Chat saved. ID: ${(result as { chatId: string }).chatId}`;
            return {
                content: [{ type: "text", text }],
                structuredContent: result,
            };
        } else if (toolName === "loadSavedEntries") {
            // Findexar may inject portalLink and isAnon into arguments as well
            // Use arguments as fallback if not in headers
            const finalUserContext: UserContext = {
                isAnon: userContext?.isAnon ?? (args as any).isAnon ?? false,
                isAnonymousPlan: userContext?.isAnonymousPlan ?? (args as any).isAnonymousPlan,
                portalLink: userContext?.portalLink ?? (args as any).portalLink ?? null,
                loginLink: userContext?.loginLink ?? (args as any).loginLink ?? null,
            };
            console.log("[MCP Handler] Final user context:", {
                isAnon: finalUserContext.isAnon,
                isAnonymousPlan: finalUserContext.isAnonymousPlan,
                hasPortalLink: Boolean(finalUserContext.portalLink),
                hasLoginLink: Boolean(finalUserContext.loginLink),
            });
            const result = await loadMyChats({
                ...(args as { userId: string; page?: number; size?: number; query?: string; topicIds?: string[]; aboveTheFoldOnly?: boolean }),
                userContext: finalUserContext,
                headers: headers, // Pass all headers for logging
            });
            console.log("[MCP Handler] handleCallTool - loadSavedEntries result:", {
                entries: result.chats.length,
                hasUserInfo: Boolean(result.userInfo),
            });
            // Return in Part 1 compatible format: structuredContent with chats, pagination, and userInfo
            return {
                content: [
                    {
                        type: "text",
                        text: `Loaded ${result.chats.length} saved entries`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "loadFullTurn") {
            const result = await loadFullTurn({
                ...(args as { userId: string; turnIndex: number }),
                chatId: String((args as { entryId?: unknown; chatId?: unknown }).entryId ?? (args as { chatId?: unknown }).chatId ?? ""),
            });
            if (!result) {
                throw new Error("Turn not found or does not belong to user");
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Loaded turn`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "searchKnowledge") {
            const result = await searchMyChats(args as { userId: string; query: string; page?: number; size?: number });
            console.log("[MCP Handler] handleCallTool - searchKnowledge result:", result.chats.length, "entries");
            // Return in Part 1 compatible format: structuredContent with chats, search, and pagination
            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${result.chats.length} saved entries matching "${result.search.query}"`,
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
                jobId: result.jobId || "(empty)",
                turnsCount: result.turnsCount,
                error: result.error || "(none)",
                message: result.message || "(none)",
            });
            const text = result.error
                ? `Error: ${result.message}`
                : result.jobId
                    ? `Content save queued. Job ID: ${result.jobId} (${result.turnsCount} turns). Poll getSaveJobStatus for completion.`
                    : `Chat saved. ID: ${result.chatId} (${result.turnsCount} turns).`;
            return {
                content: [{ type: "text", text }],
                structuredContent: result,
            };
        } else if (toolName === "getSaveJobStatus") {
            const receivedJobId = (args as { jobId?: string }).jobId;
            const statusKey = receivedJobId ? `chatvault:job:${receivedJobId}` : "(no jobId)";
            console.log("[MCP Handler] getSaveJobStatus ENTRY:", {
                requestId,
                receivedJobId: receivedJobId ?? "(missing)",
                receivedJobIdLength: receivedJobId?.length ?? 0,
                statusKeyToLookup: statusKey,
                allArgKeys: Object.keys(args),
            });
            if (!receivedJobId || typeof receivedJobId !== "string") {
                console.log("[MCP Handler] getSaveJobStatus ERROR: jobId missing or invalid");
            }
            const result = await getJobStatus(receivedJobId ?? "");
            console.log("[MCP Handler] getSaveJobStatus EXIT:", {
                requestId,
                receivedJobId: receivedJobId ?? "(missing)",
                lookupResult: result ? { status: result.status, chatId: result.chatId } : "null (not found or expired)",
            });
            return {
                content: [
                    {
                        type: "text",
                        text: result
                            ? `Status: ${result.status}${result.chatId ? `, chatId: ${result.chatId}` : ""}${result.error ? `, error: ${result.error}` : ""}`
                            : "Job not found or expired",
                    },
                ],
                structuredContent: result ?? { status: "expired" as const },
            };
        } else if (toolName === "listTopics") {
            const result = await listTopics(args as { userId: string });
            console.log("[MCP Handler] handleCallTool - listTopics result:", result.topics.length, "topics");
            return {
                content: [
                    {
                        type: "text",
                        text: `Listed ${result.topics.length} topics`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "explainHowToUse") {
            const result = explainHowToUse(
                args as { userId: string },
                getToolMetadataProfile(),
            );
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
        } else if (toolName === "deleteSavedEntry") {
            const result = await deleteChat({
                userId: String((args as { userId?: unknown }).userId ?? ""),
                chatId: String((args as { entryId?: unknown; chatId?: unknown }).entryId ?? (args as { chatId?: unknown }).chatId ?? ""),
            });
            console.log("[MCP Handler] handleCallTool - deleteSavedEntry result:", JSON.stringify(result));
            return {
                content: [
                    {
                        type: "text",
                        text: `Saved entry deleted successfully with ID: ${result.chatId}`,
                    },
                ],
                structuredContent: result,
            };
        } else if (toolName === "updateSavedEntry") {
            const result = await updateChat({
                userId: String((args as { userId?: unknown }).userId ?? ""),
                chatId: String((args as { entryId?: unknown; chatId?: unknown }).entryId ?? (args as { chatId?: unknown }).chatId ?? ""),
                chat: (args as { entry?: { title?: string; turns?: Array<{ prompt: string; response: string }>; topics?: string[] }; chat?: { title?: string; turns?: Array<{ prompt: string; response: string }>; topics?: string[] } }).entry ?? (args as { chat?: { title?: string; turns?: Array<{ prompt: string; response: string }>; topics?: string[] } }).chat ?? {},
            });
            console.log("[MCP Handler] handleCallTool - updateSavedEntry result:", JSON.stringify(result));
            return {
                content: [
                    {
                        type: "text",
                        text: `Saved entry updated successfully with ID: ${result.chatId}`,
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
    const requestStartedAt = Date.now();
    requestCountInInstance += 1;
    const requestNumberInInstance = requestCountInInstance;
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "content-type, mcp-session-id, authorization, x-a6-canonical-user-id"
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

    try {
        console.log("[MCP] Incoming request:", {
            method: req.method,
            url: req.url,
            hasAuthHeader: Boolean(req.headers.authorization),
            hasSessionHeader: Boolean(req.headers["mcp-session-id"]),
        });
        const authStartedAt = Date.now();
        const auth = isAuthorized(req);
        const authMs = Date.now() - authStartedAt;
        if (auth.ok === false) {
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
        const a6HeaderKeys = Object.keys(req.headers)
            .filter(key => key.toLowerCase().startsWith("x-a6"));
        console.log("[MCP] A6 header summary:", { keys: a6HeaderKeys });
        const userContext: UserContext = {
            isAnon: isAnonHeader === "true" || isAnonHeader === "True",
            isAnonymousPlan: isAnonymousPlanHeader === "true" || isAnonymousPlanHeader === "True",
            portalLink: portalLinkHeader ? String(portalLinkHeader) : null,
            loginLink: loginLinkHeader ? String(loginLinkHeader) : null,
        };
        console.log("[MCP] User context extracted from headers:", {
            isAnon: userContext.isAnon,
            isAnonymousPlan: userContext.isAnonymousPlan,
            hasPortalLink: Boolean(userContext.portalLink),
            hasLoginLink: Boolean(userContext.loginLink),
        });

        const bodyStartedAt = Date.now();
        const body = await readRequestBody(req);
        const bodyReadMs = Date.now() - bodyStartedAt;
        const parseStartedAt = Date.now();
        const requestData = JSON.parse(body);
        const parseMs = Date.now() - parseStartedAt;

        const { jsonrpc, id, method, params } = requestData;
        console.log(
            "[MCP] Request parsed - id:",
            id,
            "method:",
            method,
            "paramKeys:",
            Object.keys(params ?? {})
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
            const initializeStartedAt = Date.now();
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
            console.log(JSON.stringify({
                level: "info",
                event: "chatvault.performance.mcp_request",
                method,
                totalMs: Date.now() - requestStartedAt,
                phasesMs: { auth: authMs, bodyRead: bodyReadMs, jsonParse: parseMs, initialize: Date.now() - initializeStartedAt },
                instance: {
                    requestNumber: requestNumberInInstance,
                    ageMs: Date.now() - serverInstanceStartedAt,
                    firstRequest: requestNumberInInstance === 1,
                },
                requestBytes: Buffer.byteLength(body),
            }));
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
            let toolCallMs: number | undefined;

            if (method === "tools/list") {
                const request = {
                    method: "tools/list" as const,
                    params: params || {},
                } as ListToolsRequest;
                console.log(
                    "[MCP] tools/list - id:",
                    id,
                    "paramKeys:",
                    Object.keys(params ?? {})
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
                    "paramKeys:",
                    Object.keys(params ?? {})
                );
                const toolCallStartedAt = Date.now();
                result = await handleCallTool(request, userContext, req.headers);
                toolCallMs = Date.now() - toolCallStartedAt;
                console.log("[MCP] tools/call response summary:", {
                    hasResult: result != null,
                    contentItems: Array.isArray((result as any)?.content) ? (result as any).content.length : 0,
                    hasStructuredContent: Boolean((result as any)?.structuredContent),
                });
            } else if (method === "resources/list") {
                // MCP protocol: resources/list - return empty list since we don't provide resources
                console.log("[MCP] resources/list - id:", id);
                result = { resources: [] };
                console.log("[MCP] resources/list response: empty list");
            } else if (method === "prompts/list") {
                // MCP protocol: prompts/list - return empty list since we don't provide prompts
                console.log("[MCP] prompts/list - id:", id);
                result = { prompts: [] };
                console.log("[MCP] prompts/list response: empty list");
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
            console.log(JSON.stringify({
                level: "info",
                event: "chatvault.performance.mcp_request",
                method,
                tool: method === "tools/call" ? String(params?.name ?? "unknown") : undefined,
                totalMs: Date.now() - requestStartedAt,
                phasesMs: {
                    auth: authMs,
                    bodyRead: bodyReadMs,
                    jsonParse: parseMs,
                    ...(toolCallMs !== undefined ? { toolCall: toolCallMs } : {}),
                },
                instance: {
                    requestNumber: requestNumberInInstance,
                    ageMs: Date.now() - serverInstanceStartedAt,
                    firstRequest: requestNumberInInstance === 1,
                },
                requestBytes: Buffer.byteLength(body),
            }));
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
            "content-type, mcp-session-id, authorization, x-a6-canonical-user-id"
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
    const initializeStartedAt = Date.now();
    const databaseContext = observeDatabaseOperation();
    try {
        console.log("[DB] Testing database connection...");
        const connectionTestStartedAt = Date.now();
        const isConnected = await testConnection();
        const connectionTestMs = Date.now() - connectionTestStartedAt;
        if (!isConnected) {
            throw new Error("Database connection test failed");
        }
        console.log("[DB] Database connection successful");

        // Verify pgvector extension is available
        const extensionCheckStartedAt = Date.now();
        const result = await db.execute(
            sql`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as vector_available`
        );
        const extensionCheckMs = Date.now() - extensionCheckStartedAt;
        const vectorAvailable = (result[0] as { vector_available: boolean })?.vector_available;
        if (!vectorAvailable) {
            console.warn("[DB] Warning: pgvector extension not found. Run migrations to enable it.");
        } else {
            console.log("[DB] pgvector extension is available");
        }
        console.log(JSON.stringify({
            level: "info",
            event: "chatvault.performance.database_initialize",
            totalMs: Date.now() - initializeStartedAt,
            phasesMs: {
                connectionTest: connectionTestMs,
                extensionCheck: extensionCheckMs,
            },
            database: databaseContext,
        }));
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
            console.log(`  Tool metadata profile: ${getToolMetadataProfile()} (${getListedTools().length} tools listed)`);
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

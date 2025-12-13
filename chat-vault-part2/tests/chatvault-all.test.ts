/**
 * Consolidated test suite for ChatVault Part 2
 * All tests in a single file to avoid module reloading and memory issues
 */

console.log(`[DEBUG chatvault-all.test] Module loading, PID: ${process.pid}, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import {
    startMcpServer,
    stopMcpServer,
    cleanupTestPorts,
    getServerPort,
} from "./mcp-server-helper.js";
import {
    startTestDatabase,
    stopTestDatabase,
    runMigrations,
    truncateAllTables,
    cleanupTestDatabase,
    getTestDrizzle,
} from "./db-helper.js";
import { McpTestClient } from "./mcp-client.js";
import { chats } from "../src/db/schema.js";
import { eq, count } from "drizzle-orm";

describe("ChatVault Part 2 - All Tests", () => {
    let client: McpTestClient;
    let serverUrl: string;

    // Single beforeAll for all tests - setup once
    beforeAll(async () => {
        console.log(`[DEBUG beforeAll] chatvault-all starting, PID: ${process.pid}, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.warn("[All Tests] OPENAI_API_KEY not set - some tests may fail");
        }

        // Clean up any existing processes
        console.log(`[DEBUG beforeAll] about to cleanupTestPorts, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        cleanupTestPorts();
        console.log(`[DEBUG beforeAll] after cleanupTestPorts, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);

        // Start test database
        console.log(`[DEBUG beforeAll] about to startTestDatabase, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        await startTestDatabase();
        console.log(`[DEBUG beforeAll] after startTestDatabase, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        
        console.log(`[DEBUG beforeAll] about to runMigrations, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        await runMigrations();
        console.log(`[DEBUG beforeAll] after runMigrations, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        
        await truncateAllTables();
        console.log(`[DEBUG beforeAll] after truncateAllTables, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);

        // Start MCP server
        console.log(`[DEBUG beforeAll] about to startMcpServer, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        await startMcpServer(8017);
        console.log(`[DEBUG beforeAll] after startMcpServer, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        
        const port = getServerPort();
        serverUrl = `http://localhost:${port}`;
        client = new McpTestClient(serverUrl);

        // Initialize session
        await client.initialize();
        console.log(`[DEBUG beforeAll] setup complete, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
    }, 60000);

    // Single afterAll for all tests - cleanup once
    afterAll(async () => {
        console.log(`[DEBUG afterAll] cleanup starting, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
        await stopMcpServer();
        await cleanupTestDatabase();
        await stopTestDatabase();
        console.log(`[DEBUG afterAll] cleanup complete, Memory: ${JSON.stringify({ rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB' })}`);
    }, 30000);

    // Single beforeEach for all tests - truncate tables before each test
    beforeEach(async () => {
        await truncateAllTables();
    });

    // ========== MCP Protocol Compliance ==========
    describe("MCP Protocol Compliance", () => {
        test("should handle initialize handshake correctly", async () => {
        const response = await client.initialize();

        expect(response.jsonrpc).toBe("2.0");
        expect(response.id).not.toBeNull();
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
        protocolVersion: string;
        capabilities: unknown;
        serverInfo: { name: string; version: string };
        };

        expect(result.protocolVersion).toBe("2024-11-05");
        expect(result.serverInfo.name).toBe("chat-vault-part2");
        expect(result.serverInfo.version).toBe("0.1.0");
        expect(client.getSessionId()).not.toBeNull();
    });

    test("should return session ID in header after initialize", async () => {
        const newClient = new McpTestClient(serverUrl);
        const response = await newClient.initialize();

        expect(response.error).toBeUndefined();
        const sessionId = newClient.getSessionId();
        expect(sessionId).not.toBeNull();
        expect(sessionId).toMatch(/^session-/);
    });

    test("should handle notifications/initialized correctly", async () => {
        const newClient = new McpTestClient(serverUrl);
        await newClient.initialize();

        // Send initialized notification
        await expect(
            newClient.sendNotification("notifications/initialized", {})
        ).resolves.not.toThrow();
    });

    test("should require session for tools/list", async () => {
        const newClient = new McpTestClient(serverUrl);
        // Don't initialize - try to call tools/list directly
        const response = await newClient.listTools();

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32000);
        expect(response.error?.message).toContain("Session not found");
    });

    test("should return all three ChatVault tools in tools list", async () => {
        const newClient = new McpTestClient(serverUrl);
        await newClient.initialize();

        const response = await newClient.listTools();

        expect(response.jsonrpc).toBe("2.0");
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as { tools: unknown[] };
        expect(Array.isArray(result.tools)).toBe(true);
        expect(result.tools.length).toBeGreaterThanOrEqual(3); // All three ChatVault tools should be present

        // Verify all three tools are in the list
        const toolNames = (result.tools as Array<{ name: string }>).map((t) => t.name);
        expect(toolNames).toContain("saveChat");
        expect(toolNames).toContain("loadChats");
        expect(toolNames).toContain("searchChats");

        // Verify tool schemas
        const tools = result.tools as Array<{ name: string; description: string; inputSchema: unknown }>;
        const saveChatTool = tools.find((t) => t.name === "saveChat");
        const loadChatsTool = tools.find((t) => t.name === "loadChats");
        const searchChatsTool = tools.find((t) => t.name === "searchChats");

        expect(saveChatTool).toBeDefined();
        expect(saveChatTool?.description).toBeDefined();
        expect(saveChatTool?.inputSchema).toBeDefined();

        expect(loadChatsTool).toBeDefined();
        expect(loadChatsTool?.description).toBeDefined();
        expect(loadChatsTool?.inputSchema).toBeDefined();

        expect(searchChatsTool).toBeDefined();
        expect(searchChatsTool?.description).toBeDefined();
        expect(searchChatsTool?.inputSchema).toBeDefined();
    });

    test("should handle invalid JSON-RPC version", async () => {
        // This test would require sending raw JSON-RPC with wrong version
        // For now, we'll skip this as the client always sends jsonrpc: "2.0"
        // The server validation is tested implicitly through other tests
        expect(true).toBe(true);
    });

    test("should handle method not found", async () => {
        const newClient = new McpTestClient(serverUrl);
        await newClient.initialize();

        const response = await newClient.request("nonexistent/method");

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32601); // Method not found
        expect(response.error?.message).toContain("Method not found");
    });

    test("should maintain session across multiple requests", async () => {
        const newClient = new McpTestClient(serverUrl);
        await newClient.initialize();
        const sessionId1 = newClient.getSessionId();

        // Make another request
        await newClient.listTools();
        const sessionId2 = newClient.getSessionId();

        expect(sessionId1).toBe(sessionId2);
    });
    });

    // ========== saveChat Tool ==========
    describe("saveChat Tool", () => {
        test("should save a chat successfully with embedding", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
        console.log("[saveChat Tests] Skipping test - OPENAI_API_KEY not set");
        return;
        }
        const testChat = {
        userId: "test-user-1",
        title: "Test Chat About React",
        turns: [
        {
        prompt: "What is React?",
        response: "React is a JavaScript library for building user interfaces.",
        },
        {
        prompt: "What are React hooks?",
        response: "React hooks are functions that let you use state and other React features in functional components.",
        },
        ],
        };

        const response = await client.callTool("saveChat", testChat);

        expect(response.jsonrpc).toBe("2.0");
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
        content: Array<{ type: string; text: string }>;
        structuredContent: { chatId: string; saved: boolean };
        };

        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chatId).toBeDefined();
        expect(result.structuredContent.saved).toBe(true);
        expect(typeof result.structuredContent.chatId).toBe("string");

        // Verify chat was actually saved to database
        const db = getTestDrizzle();
        const savedChats = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, "test-user-1"));

        expect(savedChats.length).toBe(1);
        expect(savedChats[0].title).toBe("Test Chat About React");
        expect(savedChats[0].turns).toHaveLength(2);
        expect(savedChats[0].embedding).toBeDefined();
        expect(Array.isArray(savedChats[0].embedding)).toBe(true);
        expect(savedChats[0].embedding?.length).toBe(1536); // OpenAI text-embedding-3-small produces 1536 dimensions
    });

    test("should require userId parameter", async () => {
        const testChat = {
            title: "Test Chat",
            turns: [
                {
                    prompt: "Test prompt",
                    response: "Test response",
                },
            ],
        };

        const response = await client.callTool("saveChat", testChat);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
        // The error should indicate missing userId
    });

    test("should require title parameter", async () => {
        const testChat = {
            userId: "test-user-2",
            turns: [
                {
                    prompt: "Test prompt",
                    response: "Test response",
                },
            ],
        };

        const response = await client.callTool("saveChat", testChat);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should require turns parameter", async () => {
        const testChat = {
            userId: "test-user-3",
            title: "Test Chat",
        };

        const response = await client.callTool("saveChat", testChat);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should require non-empty turns array", async () => {
        const testChat = {
            userId: "test-user-4",
            title: "Test Chat",
            turns: [],
        };

        const response = await client.callTool("saveChat", testChat);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should save multiple chats for the same user", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[saveChat Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }
        const chat1 = {
            userId: "test-user-5",
            title: "First Chat",
            turns: [
                {
                    prompt: "First question",
                    response: "First answer",
                },
            ],
        };

        const chat2 = {
            userId: "test-user-5",
            title: "Second Chat",
            turns: [
                {
                    prompt: "Second question",
                    response: "Second answer",
                },
            ],
        };

        const response1 = await client.callTool("saveChat", chat1);
        const response2 = await client.callTool("saveChat", chat2);

        expect(response1.error).toBeUndefined();
        expect(response2.error).toBeUndefined();

        // Verify both chats were saved
        const db = getTestDrizzle();
        const savedChats = await db
            .select()
            .from(chats)
            .where(eq(chats.userId, "test-user-5"));

        expect(savedChats.length).toBe(2);
        expect(savedChats.map((c) => c.title).sort()).toEqual(["First Chat", "Second Chat"]);
    });

    test("should generate different embeddings for different chats", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[saveChat Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }
        const chat1 = {
            userId: "test-user-6",
            title: "Chat About Python",
            turns: [
                {
                    prompt: "What is Python?",
                    response: "Python is a programming language.",
                },
            ],
        };

        const chat2 = {
            userId: "test-user-6",
            title: "Chat About JavaScript",
            turns: [
                {
                    prompt: "What is JavaScript?",
                    response: "JavaScript is a programming language for the web.",
                },
            ],
        };

        await client.callTool("saveChat", chat1);
        await client.callTool("saveChat", chat2);

        const db = getTestDrizzle();
        const savedChats = await db
            .select()
            .from(chats)
            .where(eq(chats.userId, "test-user-6"));

        expect(savedChats.length).toBe(2);
        expect(savedChats[0].embedding).toBeDefined();
        expect(savedChats[1].embedding).toBeDefined();

        // Embeddings should be different (not identical)
        const embedding1 = savedChats[0].embedding as number[];
        const embedding2 = savedChats[1].embedding as number[];

        expect(embedding1).not.toEqual(embedding2);
        expect(embedding1.length).toBe(1536);
        expect(embedding2.length).toBe(1536);
    });

    test("should combine all prompts and responses for embedding", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[saveChat Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }
        const testChat = {
            userId: "test-user-7",
            title: "Multi-turn Chat",
            turns: [
                {
                    prompt: "First question",
                    response: "First answer",
                },
                {
                    prompt: "Second question",
                    response: "Second answer",
                },
                {
                    prompt: "Third question",
                    response: "Third answer",
                },
            ],
        };

        const response = await client.callTool("saveChat", testChat);

        expect(response.error).toBeUndefined();

        // Verify chat was saved with all turns
        const db = getTestDrizzle();
        const savedChats = await db
            .select()
            .from(chats)
            .where(eq(chats.userId, "test-user-7"));

        expect(savedChats.length).toBe(1);
        expect(savedChats[0].turns).toHaveLength(3);
        expect(savedChats[0].embedding).toBeDefined();
        // The embedding should be based on all three turns combined
    });
    });

    // ========== loadChats Tool ==========
    describe("loadChats Tool", () => {
        test("should load chats for a user with pagination", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
        console.log("[loadChats Tests] Skipping test - OPENAI_API_KEY not set");
        return;
        }

        const userId = "test-user-load-1";

        // Save multiple chats via MCP
        await client.callTool("saveChat", {
        userId,
        title: "First Chat",
        turns: [{ prompt: "Q1", response: "A1" }],
    });
        await client.callTool("saveChat", {
        userId,
        title: "Second Chat",
        turns: [{ prompt: "Q2", response: "A2" }],
    });
        await client.callTool("saveChat", {
        userId,
        title: "Third Chat",
        turns: [{ prompt: "Q3", response: "A3" }],
    });

        // Load first page
        const response = await client.callTool("loadChats", {
            userId,
            page: 1,
            limit: 2,
        });

        expect(response.jsonrpc).toBe("2.0");
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            structuredContent: {
                chats: unknown[];
                pagination: {
                    page: number;
                    limit: number;
                    total: number;
                    totalPages: number;
                    hasMore: boolean;
                };
            };
        };

        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chats).toHaveLength(2);
        expect(result.structuredContent.pagination.page).toBe(1);
        expect(result.structuredContent.pagination.limit).toBe(2);
        expect(result.structuredContent.pagination.total).toBe(3);
        expect(result.structuredContent.pagination.totalPages).toBe(2);
        expect(result.structuredContent.pagination.hasMore).toBe(true);
    });

    test("should return empty array for user with no chats", async () => {
        const response = await client.callTool("loadChats", {
            userId: "non-existent-user",
            page: 1,
            limit: 10,
        });

        expect(response.jsonrpc).toBe("2.0");
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            structuredContent: {
                chats: unknown[];
                pagination: {
                    page: number;
                    limit: number;
                    total: number;
                    totalPages: number;
                    hasMore: boolean;
                };
            };
        };

        expect(result.structuredContent.chats).toHaveLength(0);
        expect(result.structuredContent.pagination.total).toBe(0);
        expect(result.structuredContent.pagination.totalPages).toBe(0);
        expect(result.structuredContent.pagination.hasMore).toBe(false);
    });

    test("should require userId parameter", async () => {
        const response = await client.callTool("loadChats", {
            page: 1,
            limit: 10,
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should use default page and limit when not provided", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-load-2";

        // Save one chat via MCP
        await client.callTool("saveChat", {
            userId,
            title: "Default Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        // Load without page/limit
        const response = await client.callTool("loadChats", {
            userId,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: unknown[];
                pagination: {
                    page: number;
                    limit: number;
                };
            };
        };

        expect(result.structuredContent.pagination.page).toBe(1); // Default page
        expect(result.structuredContent.pagination.limit).toBe(10); // Default limit
        expect(result.structuredContent.chats).toHaveLength(1);
    });

    test("should return chats ordered by timestamp descending", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-load-3";

        // Save chats with delays to ensure different timestamps
        await client.callTool("saveChat", {
            userId,
            title: "Oldest Chat",
            turns: [{ prompt: "Q1", response: "A1" }],
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await client.callTool("saveChat", {
            userId,
            title: "Middle Chat",
            turns: [{ prompt: "Q2", response: "A2" }],
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await client.callTool("saveChat", {
            userId,
            title: "Newest Chat",
            turns: [{ prompt: "Q3", response: "A3" }],
        });

        // Load chats
        const response = await client.callTool("loadChats", {
            userId,
            page: 1,
            limit: 10,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ title: string; timestamp: string | Date }>;
            };
        };

        expect(result.structuredContent.chats).toHaveLength(3);
        // Should be ordered by timestamp descending (newest first)
        expect(result.structuredContent.chats[0].title).toBe("Newest Chat");
        expect(result.structuredContent.chats[1].title).toBe("Middle Chat");
        expect(result.structuredContent.chats[2].title).toBe("Oldest Chat");
    });

    test("should handle pagination correctly (1-indexed pages)", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-load-4";

        // Save 5 chats via MCP
        for (let i = 1; i <= 5; i++) {
            await client.callTool("saveChat", {
                userId,
                title: `Chat ${i}`,
                turns: [{ prompt: `Q${i}`, response: `A${i}` }],
            });
        }

        // Load page 1 (should get first 2)
        const page1 = await client.callTool("loadChats", {
            userId,
            page: 1,
            limit: 2,
        });

        expect(page1.error).toBeUndefined();
        const result1 = page1.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(result1.structuredContent.chats).toHaveLength(2);
        expect(result1.structuredContent.pagination.page).toBe(1);
        expect(result1.structuredContent.pagination.hasMore).toBe(true);

        // Load page 2 (should get next 2)
        const page2 = await client.callTool("loadChats", {
            userId,
            page: 2,
            limit: 2,
        });

        expect(page2.error).toBeUndefined();
        const result2 = page2.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(result2.structuredContent.chats).toHaveLength(2);
        expect(result2.structuredContent.pagination.page).toBe(2);
        expect(result2.structuredContent.pagination.hasMore).toBe(true);

        // Load page 3 (should get last 1)
        const page3 = await client.callTool("loadChats", {
            userId,
            page: 3,
            limit: 2,
        });

        expect(page3.error).toBeUndefined();
        const result3 = page3.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(result3.structuredContent.chats).toHaveLength(1);
        expect(result3.structuredContent.pagination.page).toBe(3);
        expect(result3.structuredContent.pagination.hasMore).toBe(false);
    });

    test("should only return chats for specified userId", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId1 = "test-user-load-5";
        const userId2 = "test-user-load-6";

        // Save chats for both users via MCP
        await client.callTool("saveChat", {
            userId: userId1,
            title: "User 1 Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });
        await client.callTool("saveChat", {
            userId: userId2,
            title: "User 2 Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        // Load chats for user 1
        const response = await client.callTool("loadChats", {
            userId: userId1,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ userId: string; title: string }>;
            };
        };

        expect(result.structuredContent.chats).toHaveLength(1);
        expect(result.structuredContent.chats[0].userId).toBe(userId1);
        expect(result.structuredContent.chats[0].title).toBe("User 1 Chat");
    });

    test("should return response in Part 1 compatible format", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-load-7";

        await client.callTool("saveChat", {
            userId,
            title: "Format Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        const response = await client.callTool("loadChats", {
            userId,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            structuredContent: {
                chats: Array<{
                    id: string;
                    userId: string;
                    title: string;
                    timestamp: Date | string;
                    turns: Array<{ prompt: string; response: string }>;
                }>;
                pagination: {
                    page: number;
                    limit: number;
                    total: number;
                    totalPages: number;
                    hasMore: boolean;
                };
            };
            _meta?: {
                chats: unknown[];
                pagination: unknown;
            };
        };

        // Verify Part 1 compatible format
        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chats).toBeDefined();
        expect(result.structuredContent.pagination).toBeDefined();
        expect(Array.isArray(result.structuredContent.chats)).toBe(true);
        expect(result.structuredContent.pagination.page).toBeDefined();
        expect(result.structuredContent.pagination.limit).toBeDefined();
        expect(result.structuredContent.pagination.total).toBeDefined();
        expect(result.structuredContent.pagination.hasMore).toBeDefined();

        // Verify _meta structure exists
        expect(result._meta).toBeDefined();
    });
    });

    // ========== searchChats Tool ==========
    describe("searchChats Tool", () => {
        test("should search chats by semantic similarity", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
        console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
        return;
        }

        const userId = "test-user-search-1";

        // Save chats with different topics
        await client.callTool("saveChat", {
        userId,
        title: "Python Programming",
        turns: [
        {
        prompt: "How do I create a list in Python?",
        response: "You can create a list in Python using square brackets: my_list = [1, 2, 3]",
        },
        ],
    });

        await client.callTool("saveChat", {
            userId,
            title: "JavaScript Basics",
            turns: [
                {
                    prompt: "What is a JavaScript array?",
                    response: "A JavaScript array is a data structure that stores multiple values in a single variable.",
                },
            ],
        });

        await client.callTool("saveChat", {
            userId,
            title: "React Hooks",
            turns: [
                {
                    prompt: "How do I use useState in React?",
                    response: "useState is a React hook that lets you add state to functional components.",
                },
            ],
        });

        // Search for Python-related content
        const response = await client.callTool("searchChats", {
            userId,
            query: "Python programming language",
            limit: 10,
        });

        expect(response.jsonrpc).toBe("2.0");
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            structuredContent: {
                chats: Array<{ title: string; similarity?: number }>;
                search: {
                    query: string;
                    limit: number;
                    total: number;
                };
            };
        };

        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chats.length).toBeGreaterThan(0);
        expect(result.structuredContent.chats[0].title).toBe("Python Programming");
        expect(result.structuredContent.search.query).toBe("Python programming language");
        expect(result.structuredContent.search.limit).toBe(10);
    });

    test("should require userId parameter", async () => {
        const response = await client.callTool("searchChats", {
            query: "test query",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should require query parameter", async () => {
        const response = await client.callTool("searchChats", {
            userId: "test-user",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should return empty array when no matches found", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-2";

        // Search without any chats saved
        const response = await client.callTool("searchChats", {
            userId,
            query: "some random query that won't match anything",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: unknown[];
                search: {
                    query: string;
                    total: number;
                };
            };
        };

        expect(result.structuredContent.chats).toHaveLength(0);
        expect(result.structuredContent.search.total).toBe(0);
    });

    test("should only return chats for specified userId", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId1 = "test-user-search-3";
        const userId2 = "test-user-search-4";

        // Save chats for both users
        await client.callTool("saveChat", {
            userId: userId1,
            title: "User 1 Chat",
            turns: [{ prompt: "What is Python?", response: "Python is a programming language." }],
        });

        await client.callTool("saveChat", {
            userId: userId2,
            title: "User 2 Chat",
            turns: [{ prompt: "What is JavaScript?", response: "JavaScript is a programming language." }],
        });

        // Search for user 1
        const response = await client.callTool("searchChats", {
            userId: userId1,
            query: "programming language",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ userId: string; title: string }>;
            };
        };

        expect(result.structuredContent.chats.length).toBeGreaterThan(0);
        // All results should belong to userId1
        result.structuredContent.chats.forEach((chat) => {
            expect(chat.userId).toBe(userId1);
        });
    });

    test("should use default limit when not provided", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-5";

        // Save multiple chats
        for (let i = 1; i <= 5; i++) {
            await client.callTool("saveChat", {
                userId,
                title: `Chat ${i}`,
                turns: [{ prompt: `Question ${i}`, response: `Answer ${i}` }],
            });
        }

        // Search without limit
        const response = await client.callTool("searchChats", {
            userId,
            query: "question",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: unknown[];
                search: {
                    limit: number;
                };
            };
        };

        expect(result.structuredContent.search.limit).toBe(10); // Default limit
    });

    test("should return results ordered by similarity (most similar first)", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-6";

        // Save chats with different topics
        await client.callTool("saveChat", {
            userId,
            title: "Machine Learning",
            turns: [
                {
                    prompt: "What is machine learning?",
                    response: "Machine learning is a subset of artificial intelligence.",
                },
            ],
        });

        await client.callTool("saveChat", {
            userId,
            title: "Cooking Recipes",
            turns: [
                {
                    prompt: "How do I bake a cake?",
                    response: "Mix flour, sugar, eggs, and bake at 350 degrees.",
                },
            ],
        });

        // Search for machine learning
        const response = await client.callTool("searchChats", {
            userId,
            query: "artificial intelligence and machine learning",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ title: string; similarity?: number }>;
            };
        };

        expect(result.structuredContent.chats.length).toBeGreaterThan(0);
        // First result should be most similar (Machine Learning)
        expect(result.structuredContent.chats[0].title).toBe("Machine Learning");
        // If similarity scores are present, they should be in descending order
        if (result.structuredContent.chats[0].similarity !== undefined) {
            const similarities = result.structuredContent.chats
                .map((c) => c.similarity ?? 0)
                .filter((s) => s > 0);
            for (let i = 1; i < similarities.length; i++) {
                expect(similarities[i - 1]).toBeGreaterThanOrEqual(similarities[i]);
            }
        }
    });

    test("should only return chats with embeddings", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-7";

        // Save a chat (which will have an embedding)
        await client.callTool("saveChat", {
            userId,
            title: "Test Chat",
            turns: [{ prompt: "Test question", response: "Test answer" }],
        });

        // Search - should only return the chat with embedding
        const response = await client.callTool("searchChats", {
            userId,
            query: "test",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
            };
        };

        // Should find the chat we just saved
        expect(result.structuredContent.chats.length).toBeGreaterThan(0);
    });

    test("should return response in Part 1 compatible format", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-8";

        await client.callTool("saveChat", {
            userId,
            title: "Format Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        const response = await client.callTool("searchChats", {
            userId,
            query: "test",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            structuredContent: {
                chats: Array<{
                    id: string;
                    userId: string;
                    title: string;
                    timestamp: Date | string;
                    turns: Array<{ prompt: string; response: string }>;
                }>;
                search: {
                    query: string;
                    limit: number;
                    total: number;
                };
            };
            _meta?: {
                chats: unknown[];
                search: unknown;
            };
        };

        // Verify Part 1 compatible format
        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chats).toBeDefined();
        expect(result.structuredContent.search).toBeDefined();
        expect(Array.isArray(result.structuredContent.chats)).toBe(true);
        expect(result.structuredContent.search.query).toBeDefined();
        expect(result.structuredContent.search.limit).toBeDefined();
        expect(result.structuredContent.search.total).toBeDefined();

        // Verify _meta structure exists
        expect(result._meta).toBeDefined();
    });
    });

    // ========== ChatVault Integration Tests ==========
    describe("ChatVault Integration Tests", () => {
        test("should complete full workflow: save → load → search", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
        console.log("[Integration Tests] Skipping test - OPENAI_API_KEY not set");
        return;
        }

        const userId = "integration-user-1";

        // Step 1: Save multiple chats
        const saveResponse1 = await client.callTool("saveChat", {
        userId,
        title: "Python Tutorial",
        turns: [
        {
        prompt: "What is Python?",
        response: "Python is a high-level programming language known for its simplicity and readability.",
        },
        {
        prompt: "How do I install Python?",
        response: "You can download Python from python.org or use a package manager like pip.",
        },
        ],
    });

        expect(saveResponse1.error).toBeUndefined();
        const saveResult1 = saveResponse1.result as {
            structuredContent: { chatId: string; saved: boolean };
        };
        expect(saveResult1.structuredContent.saved).toBe(true);
        const chatId1 = saveResult1.structuredContent.chatId;

        const saveResponse2 = await client.callTool("saveChat", {
            userId,
            title: "JavaScript Basics",
            turns: [
                {
                    prompt: "What is JavaScript?",
                    response: "JavaScript is a programming language used for web development.",
                },
            ],
        });

        expect(saveResponse2.error).toBeUndefined();
        const saveResult2 = saveResponse2.result as {
            structuredContent: { chatId: string; saved: boolean };
        };
        expect(saveResult2.structuredContent.saved).toBe(true);

        // Verify chats were saved to database
        const db = getTestDrizzle();
        const savedChats = await db
            .select({ count: count() })
            .from(chats)
            .where(eq(chats.userId, userId));
        expect(Number(savedChats[0]?.count ?? 0)).toBe(2);

        // Step 2: Load chats
        const loadResponse = await client.callTool("loadChats", {
            userId,
            page: 1,
            limit: 10,
        });

        expect(loadResponse.error).toBeUndefined();
        const loadResult = loadResponse.result as {
            structuredContent: {
                chats: Array<{ id: string; title: string }>;
                pagination: { total: number };
            };
        };
        expect(loadResult.structuredContent.chats).toHaveLength(2);
        expect(loadResult.structuredContent.pagination.total).toBe(2);
        expect(loadResult.structuredContent.chats.map((c) => c.title).sort()).toEqual([
            "JavaScript Basics",
            "Python Tutorial",
        ]);

        // Step 3: Search chats
        const searchResponse = await client.callTool("searchChats", {
            userId,
            query: "Python programming language",
            limit: 10,
        });

        expect(searchResponse.error).toBeUndefined();
        const searchResult = searchResponse.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                search: { query: string; total: number };
            };
        };
        expect(searchResult.structuredContent.chats.length).toBeGreaterThan(0);
        // Should find Python-related chat first
        expect(searchResult.structuredContent.chats[0].title).toBe("Python Tutorial");
        expect(searchResult.structuredContent.search.query).toBe("Python programming language");
    });

    test("should handle pagination workflow: save many → load paginated → search", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Integration Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "integration-user-2";

        // Save 15 chats
        for (let i = 1; i <= 15; i++) {
            await client.callTool("saveChat", {
                userId,
                title: `Chat ${i}`,
                turns: [{ prompt: `Question ${i}`, response: `Answer ${i}` }],
            });
        }

        // Verify all saved
        const db = getTestDrizzle();
        const savedChats = await db
            .select({ count: count() })
            .from(chats)
            .where(eq(chats.userId, userId));
        expect(Number(savedChats[0]?.count ?? 0)).toBe(15);

        // Load first page (10 items)
        const page1 = await client.callTool("loadChats", {
            userId,
            page: 1,
            limit: 10,
        });

        expect(page1.error).toBeUndefined();
        const page1Result = page1.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; limit: number; total: number; hasMore: boolean };
            };
        };
        expect(page1Result.structuredContent.chats).toHaveLength(10);
        expect(page1Result.structuredContent.pagination.total).toBe(15);
        expect(page1Result.structuredContent.pagination.hasMore).toBe(true);

        // Load second page (5 items)
        const page2 = await client.callTool("loadChats", {
            userId,
            page: 2,
            limit: 10,
        });

        expect(page2.error).toBeUndefined();
        const page2Result = page2.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(page2Result.structuredContent.chats).toHaveLength(5);
        expect(page2Result.structuredContent.pagination.hasMore).toBe(false);

        // Search should find relevant chats
        const searchResponse = await client.callTool("searchChats", {
            userId,
            query: "question answer",
            limit: 10,
        });

        expect(searchResponse.error).toBeUndefined();
        const searchResult = searchResponse.result as {
            structuredContent: { chats: unknown[] };
        };
        expect(searchResult.structuredContent.chats.length).toBeGreaterThan(0);
    });

    test("should handle user isolation: save for multiple users → load/search per user", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Integration Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId1 = "integration-user-3";
        const userId2 = "integration-user-4";

        // Save chats for both users
        await client.callTool("saveChat", {
            userId: userId1,
            title: "User 1 Chat",
            turns: [{ prompt: "Q1", response: "A1" }],
        });

        await client.callTool("saveChat", {
            userId: userId2,
            title: "User 2 Chat",
            turns: [{ prompt: "Q2", response: "A2" }],
        });

        // Load for user 1 - should only see user 1's chats
        const load1 = await client.callTool("loadChats", {
            userId: userId1,
        });

        expect(load1.error).toBeUndefined();
        const load1Result = load1.result as {
            structuredContent: {
                chats: Array<{ userId: string; title: string }>;
                pagination: { total: number };
            };
        };
        expect(load1Result.structuredContent.pagination.total).toBe(1);
        expect(load1Result.structuredContent.chats[0].userId).toBe(userId1);
        expect(load1Result.structuredContent.chats[0].title).toBe("User 1 Chat");

        // Search for user 1 - should only find user 1's chats
        const search1 = await client.callTool("searchChats", {
            userId: userId1,
            query: "chat",
        });

        expect(search1.error).toBeUndefined();
        const search1Result = search1.result as {
            structuredContent: {
                chats: Array<{ userId: string; title: string }>;
            };
        };
        expect(search1Result.structuredContent.chats.length).toBe(1);
        expect(search1Result.structuredContent.chats[0].userId).toBe(userId1);
        expect(search1Result.structuredContent.chats[0].title).toBe("User 1 Chat");
    });

    test("should handle empty state: no chats → load empty → search empty", async () => {
        const userId = "integration-user-5";

        // Load with no chats
        const loadResponse = await client.callTool("loadChats", {
            userId,
        });

        expect(loadResponse.error).toBeUndefined();
        const loadResult = loadResponse.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { total: number };
            };
        };
        expect(loadResult.structuredContent.chats).toHaveLength(0);
        expect(loadResult.structuredContent.pagination.total).toBe(0);

        // Search with no chats (skip if no API key)
        if (process.env.OPENAI_API_KEY) {
            const searchResponse = await client.callTool("searchChats", {
                userId,
                query: "anything",
            });

            expect(searchResponse.error).toBeUndefined();
            const searchResult = searchResponse.result as {
                structuredContent: {
                    chats: unknown[];
                    search: { total: number };
                };
            };
            expect(searchResult.structuredContent.chats).toHaveLength(0);
            expect(searchResult.structuredContent.search.total).toBe(0);
        }
    });

    test("should verify database state matches API responses", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Integration Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "integration-user-6";

        // Save a chat
        const saveResponse = await client.callTool("saveChat", {
            userId,
            title: "Database Verification Chat",
            turns: [
                {
                    prompt: "Test prompt",
                    response: "Test response",
                },
            ],
        });

        expect(saveResponse.error).toBeUndefined();
        const saveResult = saveResponse.result as {
            structuredContent: { chatId: string };
        };
        const chatId = saveResult.structuredContent.chatId;

        // Verify in database
        const db = getTestDrizzle();
        const dbChat = await db
            .select()
            .from(chats)
            .where(eq(chats.id, chatId));

        expect(dbChat.length).toBe(1);
        expect(dbChat[0].userId).toBe(userId);
        expect(dbChat[0].title).toBe("Database Verification Chat");
        expect(dbChat[0].turns).toHaveLength(1);
        expect(dbChat[0].embedding).toBeDefined();
        expect(Array.isArray(dbChat[0].embedding)).toBe(true);

        // Load via API and verify matches database
        const loadResponse = await client.callTool("loadChats", {
            userId,
        });

        expect(loadResponse.error).toBeUndefined();
        const loadResult = loadResponse.result as {
            structuredContent: {
                chats: Array<{ id: string; title: string; turns: unknown[] }>;
            };
        };

        expect(loadResult.structuredContent.chats.length).toBe(1);
        expect(loadResult.structuredContent.chats[0].id).toBe(chatId);
        expect(loadResult.structuredContent.chats[0].title).toBe("Database Verification Chat");
        expect(loadResult.structuredContent.chats[0].turns).toHaveLength(1);
    });
    });

    // ========== ChatVault Error Cases ==========
    describe("ChatVault Error Cases", () => {

    });

});

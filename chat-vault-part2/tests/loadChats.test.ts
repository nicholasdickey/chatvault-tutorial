/**
 * Tests for loadChats tool
 */

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
import { eq } from "drizzle-orm";

describe("loadChats Tool", () => {
    let client: McpTestClient;
    let serverUrl: string;

    beforeAll(async () => {
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.warn("[loadChats Tests] OPENAI_API_KEY not set - some tests may fail");
        }

        // Clean up any existing processes
        cleanupTestPorts();

        // Start test database
        await startTestDatabase();
        await runMigrations();
        await truncateAllTables();

        // Start MCP server
        await startMcpServer(8000);
        const port = getServerPort();
        serverUrl = `http://localhost:${port}`;
        client = new McpTestClient(serverUrl);

        // Initialize session
        await client.initialize();
    }, 60000);

    afterAll(async () => {
        // Clean up
        await stopMcpServer();
        await cleanupTestDatabase();
        await stopTestDatabase();
        cleanupTestPorts();
    }, 30000);

    beforeEach(async () => {
        // Ensure clean state before each test
        await truncateAllTables();
    });

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


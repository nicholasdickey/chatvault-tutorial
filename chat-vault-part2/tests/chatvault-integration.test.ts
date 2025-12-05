/**
 * Integration tests for ChatVault tools - Full workflow testing
 * Tests the complete workflow: save → load → search
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
import { eq, count } from "drizzle-orm";

describe("ChatVault Integration Tests", () => {
    let client: McpTestClient;
    let serverUrl: string;

    beforeAll(async () => {
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.warn("[Integration Tests] OPENAI_API_KEY not set - some tests may fail");
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


/**
 * Part 2 - Consolidated test suite (Prompt0)
 *
 * Requirements satisfied:
 * - single test file: tests/all.test.ts
 * - single fixed port: 8007 (no fallback)
 * - all cleanup only in beforeAll (port cleanup + DB truncate)
 * - start MCP server only once in beforeAll
 * - only server + DB teardown in afterAll (no port cleanup, no truncate)
 * - do not modify test() clauses; only consolidate + adjust setup/teardown
 * - saturated with console.log for debugging
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import { McpTestClient } from "./mcp-client.js";
import { startMcpServer, stopMcpServer, killProcessOnPort } from "./mcp-server-helper.js";
import {
    startTestDatabase,
    stopTestDatabase,
    runMigrations,
    truncateAllTables,
    cleanupTestDatabase,
    getTestDrizzle,
} from "./db-helper.js";
import { chats } from "../src/db/schema.js";
import { eq, count } from "drizzle-orm";

describe("chat-vault-part2 (all)", () => {
    const TEST_PORT = 8007;
    let client: McpTestClient;
    let serverUrl: string;

    beforeAll(async () => {
        process.env.API_KEY = process.env.API_KEY || "test-api-key";
        console.log(`[Part2 all] beforeAll: API_KEY present=${Boolean(process.env.API_KEY)}`);
        console.log(`[Part2 all] beforeAll: OPENAI_API_KEY present=${Boolean(process.env.OPENAI_API_KEY)}`);
        console.log(`[Part2 all] beforeAll: cleaning port ${TEST_PORT}`);
        killProcessOnPort(TEST_PORT);
        await new Promise((resolve) => setTimeout(resolve, 250));

        console.log(`[Part2 all] beforeAll: starting test database`);
        await startTestDatabase();

        console.log(`[Part2 all] beforeAll: running migrations`);
        await runMigrations();

        console.log(`[Part2 all] beforeAll: truncating all tables (single truncate per Prompt0)`);
        await truncateAllTables();

        console.log(`[Part2 all] beforeAll: starting MCP server on port ${TEST_PORT}`);
        await startMcpServer(TEST_PORT);

        serverUrl = `http://localhost:${TEST_PORT}`;
        client = new McpTestClient(serverUrl);

        console.log(`[Part2 all] beforeAll: initializing session`);
        await client.initialize();
        console.log(`[Part2 all] beforeAll: sessionId=${client.getSessionId()}`);
    }, 180000);

    beforeEach(() => {
        const name = expect.getState().currentTestName ?? "(unknown test)";
        console.log(`\n[Part2 all] >>> START ${name}`);
    });

    afterEach(() => {
        const name = expect.getState().currentTestName ?? "(unknown test)";
        console.log(`[Part2 all] <<< END ${name}\n`);
    });

    afterAll(async () => {
        console.log(`[Part2 all] afterAll: stopping MCP server`);
        await stopMcpServer();

        console.log(`[Part2 all] afterAll: closing DB connection`);
        await cleanupTestDatabase();

        console.log(`[Part2 all] afterAll: stopping test database`);
        await stopTestDatabase();
    }, 180000);

    // -------------------------------------------------------------------------
    // The test() clauses below are copied verbatim from the original Part 2 tests
    // (only describe/beforeAll/afterAll scaffolding was consolidated).
    // -------------------------------------------------------------------------

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

        // Verify all tools are in the list
        const toolNames = (result.tools as Array<{ name: string }>).map((t) => t.name);
        expect(toolNames).toContain("saveChat");
        expect(toolNames).toContain("loadMyChats");
        expect(toolNames).toContain("searchMyChats");
        expect(toolNames).toContain("saveChatManually");
        expect(toolNames).toContain("explainHowToUse");

        // Verify tool schemas
        const tools = result.tools as Array<{ name: string; description: string; inputSchema: unknown }>;
        const saveChatTool = tools.find((t) => t.name === "saveChat");
        const loadChatsTool = tools.find((t) => t.name === "loadMyChats");
        const searchChatsTool = tools.find((t) => t.name === "searchMyChats");
        const saveChatManuallyTool = tools.find((t) => t.name === "saveChatManually");
        const explainHowToUseTool = tools.find((t) => t.name === "explainHowToUse");

        expect(saveChatTool).toBeDefined();
        expect(saveChatTool?.description).toBeDefined();
        expect(saveChatTool?.inputSchema).toBeDefined();

        expect(loadChatsTool).toBeDefined();
        expect(loadChatsTool?.description).toBeDefined();
        expect(loadChatsTool?.inputSchema).toBeDefined();

        expect(searchChatsTool).toBeDefined();
        expect(searchChatsTool?.description).toBeDefined();
        expect(searchChatsTool?.inputSchema).toBeDefined();

        expect(saveChatManuallyTool).toBeDefined();
        expect(saveChatManuallyTool?.description).toBeDefined();
        expect(saveChatManuallyTool?.inputSchema).toBeDefined();

        expect(explainHowToUseTool).toBeDefined();
        expect(explainHowToUseTool?.description).toBeDefined();
        expect(explainHowToUseTool?.inputSchema).toBeDefined();
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

    test("should error on missing userId", async () => {
        const response = await client.callTool("saveChat", {
            title: "Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on missing title", async () => {
        const response = await client.callTool("saveChat", {
            userId: "test-user",
            turns: [{ prompt: "Q", response: "A" }],
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on missing turns", async () => {
        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: "Test Chat",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on empty turns array", async () => {
        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: "Test Chat",
            turns: [],
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should handle invalid turns structure", async () => {
        // Skip if no OpenAI API key (validation might happen at embedding generation)
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: "Test Chat",
            turns: [{ invalid: "data" }],
        });

        // May error during embedding generation or succeed with empty content
        // Either behavior is acceptable
        if (response.error) {
            expect(response.error.code).toBeDefined();
        }
    });

    test("should handle missing prompt in turn", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: "Test Chat",
            turns: [{ response: "A" }],
        });

        // May error during embedding generation or succeed with partial content
        if (response.error) {
            expect(response.error.code).toBeDefined();
        }
    });

    test("should handle missing response in turn", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: "Test Chat",
            turns: [{ prompt: "Q" }],
        });

        // May error during embedding generation or succeed with partial content
        if (response.error) {
            expect(response.error.code).toBeDefined();
        }
    });

    test("should error on missing userId", async () => {
        const response = await client.callTool("loadMyChats", {
            page: 0,
            size: 10,
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should handle invalid page number (negative)", async () => {
        const response = await client.callTool("loadMyChats", {
            userId: "test-user",
            page: -1,
        });

        // Should either error or default to page 0
        if (response.error) {
            expect(response.error.code).toBeDefined();
        } else {
            // If it doesn't error, it should default to page 0
            const result = response.result as {
                structuredContent: { pagination: { page: number } };
            };
            expect(result.structuredContent.pagination.page).toBeGreaterThanOrEqual(0);
        }
    });

    test("should handle invalid size (negative)", async () => {
        const response = await client.callTool("loadMyChats", {
            userId: "test-user",
            size: -5,
        });

        // Should either error or clamp to valid range
        if (response.error) {
            expect(response.error.code).toBeDefined();
        } else {
            const result = response.result as {
                structuredContent: { pagination: { limit: number } };
            };
            expect(result.structuredContent.pagination.limit).toBeGreaterThan(0);
        }
    });

    test("should handle very large size", async () => {
        const response = await client.callTool("loadMyChats", {
            userId: "test-user",
            size: 10000,
        });

        // Should clamp to max size (100)
        if (!response.error) {
            const result = response.result as {
                structuredContent: { pagination: { limit: number } };
            };
            expect(result.structuredContent.pagination.limit).toBeLessThanOrEqual(100);
        }
    });

    test("should handle page beyond available data", async () => {
        const response = await client.callTool("loadMyChats", {
            userId: "non-existent-user",
            page: 999,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; total: number };
            };
        };
        expect(result.structuredContent.chats).toHaveLength(0);
        expect(result.structuredContent.pagination.total).toBe(0);
    });

    test("should error on missing userId", async () => {
        const response = await client.callTool("searchMyChats", {
            query: "test query",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on missing query", async () => {
        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on empty query", async () => {
        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
            query: "",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on whitespace-only query", async () => {
        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
            query: "   ",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should handle invalid size (negative)", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
            query: "test",
            size: -5,
        });

        // Should either error or clamp to valid range
        if (response.error) {
            expect(response.error.code).toBeDefined();
        } else {
            const result = response.result as {
                structuredContent: { pagination: { limit: number } };
            };
            expect(result.structuredContent.pagination.limit).toBeGreaterThan(0);
        }
    });

    test("should handle very large size", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
            query: "test",
            size: 10000,
        });

        // Should clamp to max size (100)
        if (!response.error) {
            const result = response.result as {
                structuredContent: { pagination: { limit: number } };
            };
            expect(result.structuredContent.pagination.limit).toBeLessThanOrEqual(100);
        }
    });

    test("should handle very long chat title", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const longTitle = "A".repeat(1000);
        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: longTitle,
            turns: [{ prompt: "Q", response: "A" }],
        });

        // Should either succeed or error gracefully
        if (response.error) {
            expect(response.error.code).toBeDefined();
        } else {
            expect(response.error).toBeUndefined();
        }
    });

    test("should handle very long query in search", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const longQuery = "A".repeat(10000);
        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
            query: longQuery,
        });

        // Should either succeed or error gracefully
        if (response.error) {
            expect(response.error.code).toBeDefined();
        } else {
            expect(response.error).toBeUndefined();
        }
    });

    test("should handle special characters in userId", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const specialUserId = "user-with-special-chars-!@#$%^&*()";
        const response = await client.callTool("saveChat", {
            userId: specialUserId,
            title: "Test",
            turns: [{ prompt: "Q", response: "A" }],
        });

        // Should handle special characters (may succeed or error based on validation)
        if (!response.error) {
            // If it succeeds, verify we can load it
            const loadResponse = await client.callTool("loadMyChats", {
                userId: specialUserId,
            });
            expect(loadResponse.error).toBeUndefined();
        }
    });

    test("should handle unicode characters in chat content", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("saveChat", {
            userId: "test-user",
            title: "Unicode Test: 你好世界 🌍",
            turns: [
                {
                    prompt: "Question with emoji: 🚀",
                    response: "Answer with unicode: こんにちは",
                },
            ],
        });

        if (!response.error) {
            expect(response.error).toBeUndefined();
            // Verify we can load it back
            const loadResponse = await client.callTool("loadMyChats", {
                userId: "test-user",
            });
            expect(loadResponse.error).toBeUndefined();
        }
    });

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

    test("should load chats for a user with pagination", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("loadMyChats", {
            userId,
            page: 0,
            size: 2,
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
        expect(result.structuredContent.pagination.page).toBe(0);
        expect(result.structuredContent.pagination.limit).toBe(2);
        expect(result.structuredContent.pagination.total).toBe(3);
        expect(result.structuredContent.pagination.totalPages).toBe(2);
        expect(result.structuredContent.pagination.hasMore).toBe(true);
    });

    test("should return empty array for user with no chats", async () => {
        const response = await client.callTool("loadMyChats", {
            userId: "non-existent-user",
            page: 0,
            size: 10,
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
        const response = await client.callTool("loadMyChats", {
            page: 0,
            size: 10,
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should use default page and size when not provided", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-load-2";

        // Save one chat via MCP
        await client.callTool("saveChat", {
            userId,
            title: "Default Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        // Load without page/size
        const response = await client.callTool("loadMyChats", {
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

        expect(result.structuredContent.pagination.page).toBe(0); // Default page (0-based)
        expect(result.structuredContent.pagination.limit).toBe(10); // Default size
        expect(result.structuredContent.chats).toHaveLength(1);
    });

    test("should return chats ordered by timestamp descending", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("loadMyChats", {
            userId,
            page: 0,
            size: 10,
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

    test("should handle pagination correctly (0-indexed pages)", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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

        // Load page 0 (should get first 2)
        const page0 = await client.callTool("loadMyChats", {
            userId,
            page: 0,
            size: 2,
        });

        expect(page0.error).toBeUndefined();
        const result0 = page0.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(result0.structuredContent.chats).toHaveLength(2);
        expect(result0.structuredContent.pagination.page).toBe(0);
        expect(result0.structuredContent.pagination.hasMore).toBe(true);

        // Load page 1 (should get next 2)
        const page1 = await client.callTool("loadMyChats", {
            userId,
            page: 1,
            size: 2,
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

        // Load page 2 (should get last 1)
        const page2 = await client.callTool("loadMyChats", {
            userId,
            page: 2,
            size: 2,
        });

        expect(page2.error).toBeUndefined();
        const result2 = page2.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(result2.structuredContent.chats).toHaveLength(1);
        expect(result2.structuredContent.pagination.page).toBe(2);
        expect(result2.structuredContent.pagination.hasMore).toBe(false);
    });

    test("should only return chats for specified userId", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("loadMyChats", {
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
            console.log("[loadMyChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-load-7";

        await client.callTool("saveChat", {
            userId,
            title: "Format Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        const response = await client.callTool("loadMyChats", {
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

    test("should search chats by semantic similarity", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("searchMyChats", {
            userId,
            query: "Python programming language",
            page: 0,
            size: 10,
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
                };
                pagination: {
                    page: number;
                    limit: number;
                    total: number;
                };
            };
        };

        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chats.length).toBeGreaterThan(0);
        expect(result.structuredContent.chats[0].title).toBe("Python Programming");
        expect(result.structuredContent.search.query).toBe("Python programming language");
        expect(result.structuredContent.pagination.page).toBe(0);
        expect(result.structuredContent.pagination.limit).toBe(10);
    });

    test("should require userId parameter", async () => {
        const response = await client.callTool("searchMyChats", {
            query: "test query",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should require query parameter", async () => {
        const response = await client.callTool("searchMyChats", {
            userId: "test-user",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should return empty array when no matches found", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-2";

        // Search without any chats saved
        const response = await client.callTool("searchMyChats", {
            userId,
            query: "some random query that won't match anything",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: unknown[];
                search: {
                    query: string;
                };
                pagination: {
                    total: number;
                };
            };
        };

        expect(result.structuredContent.chats).toHaveLength(0);
        expect(result.structuredContent.pagination.total).toBe(0);
    });

    test("should only return chats for specified userId", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("searchMyChats", {
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
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("searchMyChats", {
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

        expect(result.structuredContent.pagination.limit).toBe(10); // Default size
    });

    test("should return results ordered by similarity (most similar first)", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("searchMyChats", {
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
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
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
        const response = await client.callTool("searchMyChats", {
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
            console.log("[searchMyChats Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-8";

        await client.callTool("saveChat", {
            userId,
            title: "Format Test Chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        const response = await client.callTool("searchMyChats", {
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
                };
                pagination: {
                    page: number;
                    limit: number;
                    total: number;
                };
            };
            _meta?: {
                chats: unknown[];
                search: unknown;
                pagination: unknown;
            };
        };

        // Verify Part 1 compatible format
        expect(result.content).toBeDefined();
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.chats).toBeDefined();
        expect(result.structuredContent.search).toBeDefined();
        expect(Array.isArray(result.structuredContent.chats)).toBe(true);
        expect(result.structuredContent.search.query).toBeDefined();
        expect(result.structuredContent.pagination).toBeDefined();
        expect(result.structuredContent.pagination.page).toBeDefined();
        expect(result.structuredContent.pagination.limit).toBeDefined();
        expect(result.structuredContent.pagination.total).toBeDefined();

        // Verify _meta structure exists
        expect(result._meta).toBeDefined();
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
        const loadResponse = await client.callTool("loadMyChats", {
            userId,
            page: 0,
            size: 10,
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
        const searchResponse = await client.callTool("searchMyChats", {
            userId,
            query: "Python programming language",
            page: 0,
            size: 10,
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
        const page0 = await client.callTool("loadMyChats", {
            userId,
            page: 0,
            size: 10,
        });

        expect(page0.error).toBeUndefined();
        const page0Result = page0.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; limit: number; total: number; hasMore: boolean };
            };
        };
        expect(page0Result.structuredContent.chats).toHaveLength(10);
        expect(page0Result.structuredContent.pagination.total).toBe(15);
        expect(page0Result.structuredContent.pagination.hasMore).toBe(true);

        // Load second page (5 items)
        const page1 = await client.callTool("loadMyChats", {
            userId,
            page: 1,
            size: 10,
        });

        expect(page1.error).toBeUndefined();
        const page1Result = page1.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(page1Result.structuredContent.chats).toHaveLength(5);
        expect(page1Result.structuredContent.pagination.hasMore).toBe(false);

        // Search should find relevant chats
        const searchResponse = await client.callTool("searchMyChats", {
            userId,
            query: "question answer",
            page: 0,
            size: 10,
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
        const load1 = await client.callTool("loadMyChats", {
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
        // Use a more specific query that will match the chat content
        const search1 = await client.callTool("searchMyChats", {
            userId: userId1,
            query: "Q1 A1",
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
        const loadResponse = await client.callTool("loadMyChats", {
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
            const searchResponse = await client.callTool("searchMyChats", {
                userId,
                query: "anything",
            });

            expect(searchResponse.error).toBeUndefined();
            const searchResult = searchResponse.result as {
                structuredContent: {
                    chats: unknown[];
                    search: { query: string };
                    pagination: { total: number };
                };
            };
            expect(searchResult.structuredContent.chats).toHaveLength(0);
            expect(searchResult.structuredContent.pagination.total).toBe(0);
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
        const loadResponse = await client.callTool("loadMyChats", {
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

    // -------------------------------------------------------------------------
    // New tests for saveChatManually tool
    // -------------------------------------------------------------------------

    test("should save chat manually with You said/ChatGPT said format", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[saveChatManually Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const htmlContent = `You said: What is React?
ChatGPT said: React is a JavaScript library for building user interfaces.

You said: How do I use hooks?
ChatGPT said: React hooks let you use state in functional components.`;

        const response = await client.callTool("saveChatManually", {
            userId: "test-user-manual-1",
            htmlContent,
            title: "Manual React Chat",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: { chatId: string; turnsCount: number };
        };

        expect(result.structuredContent.chatId).toBeDefined();
        expect(result.structuredContent.turnsCount).toBe(2);

        // Verify chat was saved
        const db = getTestDrizzle();
        const savedChats = await db
            .select()
            .from(chats)
            .where(eq(chats.userId, "test-user-manual-1"));

        expect(savedChats.length).toBe(1);
        expect(savedChats[0].title).toBe("Manual React Chat");
        expect(savedChats[0].turns).toHaveLength(2);
        expect(savedChats[0].turns[0].prompt).toBe("What is React?");
        expect(savedChats[0].turns[0].response).toContain("React is a JavaScript library");
    });

    test("should save chat manually with alternating messages format", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[saveChatManually Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const htmlContent = `What is Python?

Python is a programming language known for its simplicity.

How do I install it?

You can download Python from python.org.`;

        const response = await client.callTool("saveChatManually", {
            userId: "test-user-manual-2",
            htmlContent,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: { chatId: string; turnsCount: number };
        };

        expect(result.structuredContent.chatId).toBeDefined();
        expect(result.structuredContent.turnsCount).toBe(2);

        // Verify auto-generated title
        const db = getTestDrizzle();
        const savedChats = await db
            .select()
            .from(chats)
            .where(eq(chats.userId, "test-user-manual-2"));

        expect(savedChats.length).toBe(1);
        expect(savedChats[0].title).toMatch(/^manual save /);
        expect(savedChats[0].turns).toHaveLength(2);
    });

    test("should error on missing userId for saveChatManually", async () => {
        const response = await client.callTool("saveChatManually", {
            htmlContent: "Some content",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on missing htmlContent for saveChatManually", async () => {
        const response = await client.callTool("saveChatManually", {
            userId: "test-user",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on empty htmlContent for saveChatManually", async () => {
        const response = await client.callTool("saveChatManually", {
            userId: "test-user",
            htmlContent: "",
        });

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    test("should error on unparseable htmlContent for saveChatManually", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[saveChatManually Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const response = await client.callTool("saveChatManually", {
            userId: "test-user",
            htmlContent: "This is just random text with no structure",
        });

        // Should error because no turns can be parsed
        // Check structuredContent error (not JSON-RPC error, as we return structured error response)
        expect(response.error).toBeUndefined(); // No JSON-RPC error
        expect(response.result).toBeDefined();
        const result = response.result as {
            structuredContent: { error?: string; message?: string };
        };
        expect(result.structuredContent.error).toBe("parse_error");
        expect(result.structuredContent.message).toBeDefined();
    });

    // -------------------------------------------------------------------------
    // New tests for explainHowToUse tool
    // -------------------------------------------------------------------------

    test("should return help text from explainHowToUse", async () => {
        const response = await client.callTool("explainHowToUse", {
            userId: "test-user",
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            content: Array<{ type: string; text: string }>;
            structuredContent: { helpText: string };
        };

        expect(result.content).toBeDefined();
        expect(result.content[0].text).toBeDefined();
        expect(result.structuredContent.helpText).toBeDefined();
        expect(typeof result.structuredContent.helpText).toBe("string");
        expect(result.structuredContent.helpText.length).toBeGreaterThan(0);
    });

    test("should error on missing userId for explainHowToUse", async () => {
        const response = await client.callTool("explainHowToUse", {});

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
    });

    // -------------------------------------------------------------------------
    // New tests for loadMyChats with query parameter
    // -------------------------------------------------------------------------

    test("should use vector search when query provided to loadMyChats", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Query Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-query-1";

        // Save chats with different topics
        await client.callTool("saveChat", {
            userId,
            title: "Python Tutorial",
            turns: [{ prompt: "What is Python?", response: "Python is a programming language." }],
        });

        await client.callTool("saveChat", {
            userId,
            title: "JavaScript Basics",
            turns: [{ prompt: "What is JavaScript?", response: "JavaScript is for web development." }],
        });

        // Load with query - should use vector search
        const response = await client.callTool("loadMyChats", {
            userId,
            query: "Python programming",
            page: 0,
            size: 10,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
                pagination: { page: number; total: number };
            };
        };

        expect(result.structuredContent.chats.length).toBeGreaterThan(0);
        // Should find Python-related chat first (vector similarity)
        expect(result.structuredContent.chats[0].title).toBe("Python Tutorial");
        expect(result.structuredContent.pagination.page).toBe(0);
    });

    test("should use timestamp ordering when no query provided to loadMyChats", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Query Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-query-2";

        // Save chats with delays
        await client.callTool("saveChat", {
            userId,
            title: "First Chat",
            turns: [{ prompt: "Q1", response: "A1" }],
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await client.callTool("saveChat", {
            userId,
            title: "Second Chat",
            turns: [{ prompt: "Q2", response: "A2" }],
        });

        // Load without query - should use timestamp ordering
        const response = await client.callTool("loadMyChats", {
            userId,
            page: 0,
            size: 10,
        });

        expect(response.error).toBeUndefined();
        const result = response.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
            };
        };

        // Should be ordered by timestamp descending (newest first)
        expect(result.structuredContent.chats[0].title).toBe("Second Chat");
        expect(result.structuredContent.chats[1].title).toBe("First Chat");
    });

    test("should return same results for loadMyChats with query and searchMyChats", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[loadMyChats Query Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-query-3";

        // Save a chat
        await client.callTool("saveChat", {
            userId,
            title: "React Hooks",
            turns: [{ prompt: "How do I use useState?", response: "useState is a React hook." }],
        });

        // Search with loadMyChats query
        const loadResponse = await client.callTool("loadMyChats", {
            userId,
            query: "React hooks",
            page: 0,
            size: 10,
        });

        // Search with searchMyChats
        const searchResponse = await client.callTool("searchMyChats", {
            userId,
            query: "React hooks",
            page: 0,
            size: 10,
        });

        expect(loadResponse.error).toBeUndefined();
        expect(searchResponse.error).toBeUndefined();

        const loadResult = loadResponse.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
            };
        };

        const searchResult = searchResponse.result as {
            structuredContent: {
                chats: Array<{ title: string }>;
            };
        };

        // Should return same chats (both use vector search)
        expect(loadResult.structuredContent.chats.length).toBeGreaterThan(0);
        expect(searchResult.structuredContent.chats.length).toBeGreaterThan(0);
        expect(loadResult.structuredContent.chats[0].title).toBe(searchResult.structuredContent.chats[0].title);
    });

    // -------------------------------------------------------------------------
    // New tests for searchMyChats with 0-based pagination
    // -------------------------------------------------------------------------

    test("should handle pagination correctly for searchMyChats (0-indexed)", async () => {
        // Skip if no OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            console.log("[searchMyChats Pagination Tests] Skipping test - OPENAI_API_KEY not set");
            return;
        }

        const userId = "test-user-search-pag-1";

        // Save multiple chats
        for (let i = 1; i <= 5; i++) {
            await client.callTool("saveChat", {
                userId,
                title: `Chat ${i}`,
                turns: [{ prompt: `Question ${i}`, response: `Answer ${i}` }],
            });
        }

        // Search page 0
        const page0 = await client.callTool("searchMyChats", {
            userId,
            query: "question",
            page: 0,
            size: 2,
        });

        expect(page0.error).toBeUndefined();
        const result0 = page0.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; limit: number; hasMore: boolean };
            };
        };
        expect(result0.structuredContent.chats).toHaveLength(2);
        expect(result0.structuredContent.pagination.page).toBe(0);
        expect(result0.structuredContent.pagination.hasMore).toBe(true);

        // Search page 1
        const page1 = await client.callTool("searchMyChats", {
            userId,
            query: "question",
            page: 1,
            size: 2,
        });

        expect(page1.error).toBeUndefined();
        const result1 = page1.result as {
            structuredContent: {
                chats: unknown[];
                pagination: { page: number; hasMore: boolean };
            };
        };
        expect(result1.structuredContent.chats.length).toBeGreaterThan(0);
        expect(result1.structuredContent.pagination.page).toBe(1);
    });
});



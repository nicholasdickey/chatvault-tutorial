/**
 * Tests for searchChats tool
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
} from "./db-helper.js";
import { McpTestClient } from "./mcp-client.js";

describe("searchChats Tool", () => {
    let client: McpTestClient;
    let serverUrl: string;

    beforeAll(async () => {
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.warn("[searchChats Tests] OPENAI_API_KEY not set - tests will be skipped");
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


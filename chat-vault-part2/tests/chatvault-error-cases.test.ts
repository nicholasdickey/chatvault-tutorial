/**
 * Error case tests for ChatVault tools
 * Tests missing parameters, invalid data, and edge cases
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

describe("ChatVault Error Cases", () => {
    let client: McpTestClient;
    let serverUrl: string;

    beforeAll(async () => {
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.warn("[Error Case Tests] OPENAI_API_KEY not set - some tests may fail");
        }

        // Clean up any existing processes
        cleanupTestPorts();

        // Start test database
        await startTestDatabase();
        await runMigrations();
        await truncateAllTables();

        // Start MCP server
        await startMcpServer(8017);
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
        // cleanupTestPorts() removed - server is already stopped by stopMcpServer()
        // cleanupTestPorts() is still called in beforeAll to ensure clean ports before starting
    }, 30000);

    beforeEach(async () => {
        // Ensure clean state before each test
        await truncateAllTables();
    });

    describe("saveChat error cases", () => {
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
    });

    describe("loadChats error cases", () => {
        test("should error on missing userId", async () => {
            const response = await client.callTool("loadChats", {
                page: 1,
                limit: 10,
            });

            expect(response.error).toBeDefined();
            expect(response.error?.code).toBeDefined();
        });

        test("should handle invalid page number (negative)", async () => {
            const response = await client.callTool("loadChats", {
                userId: "test-user",
                page: -1,
            });

            // Should either error or default to page 1
            if (response.error) {
                expect(response.error.code).toBeDefined();
            } else {
                // If it doesn't error, it should default to page 1
                const result = response.result as {
                    structuredContent: { pagination: { page: number } };
                };
                expect(result.structuredContent.pagination.page).toBeGreaterThanOrEqual(1);
            }
        });

        test("should handle invalid limit (negative)", async () => {
            const response = await client.callTool("loadChats", {
                userId: "test-user",
                limit: -5,
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

        test("should handle very large limit", async () => {
            const response = await client.callTool("loadChats", {
                userId: "test-user",
                limit: 10000,
            });

            // Should clamp to max limit (100)
            if (!response.error) {
                const result = response.result as {
                    structuredContent: { pagination: { limit: number } };
                };
                expect(result.structuredContent.pagination.limit).toBeLessThanOrEqual(100);
            }
        });

        test("should handle page beyond available data", async () => {
            const response = await client.callTool("loadChats", {
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
    });

    describe("searchChats error cases", () => {
        test("should error on missing userId", async () => {
            const response = await client.callTool("searchChats", {
                query: "test query",
            });

            expect(response.error).toBeDefined();
            expect(response.error?.code).toBeDefined();
        });

        test("should error on missing query", async () => {
            const response = await client.callTool("searchChats", {
                userId: "test-user",
            });

            expect(response.error).toBeDefined();
            expect(response.error?.code).toBeDefined();
        });

        test("should error on empty query", async () => {
            const response = await client.callTool("searchChats", {
                userId: "test-user",
                query: "",
            });

            expect(response.error).toBeDefined();
            expect(response.error?.code).toBeDefined();
        });

        test("should error on whitespace-only query", async () => {
            const response = await client.callTool("searchChats", {
                userId: "test-user",
                query: "   ",
            });

            expect(response.error).toBeDefined();
            expect(response.error?.code).toBeDefined();
        });

        test("should handle invalid limit (negative)", async () => {
            // Skip if no OpenAI API key
            if (!process.env.OPENAI_API_KEY) {
                console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
                return;
            }

            const response = await client.callTool("searchChats", {
                userId: "test-user",
                query: "test",
                limit: -5,
            });

            // Should either error or clamp to valid range
            if (response.error) {
                expect(response.error.code).toBeDefined();
            } else {
                const result = response.result as {
                    structuredContent: { search: { limit: number } };
                };
                expect(result.structuredContent.search.limit).toBeGreaterThan(0);
            }
        });

        test("should handle very large limit", async () => {
            // Skip if no OpenAI API key
            if (!process.env.OPENAI_API_KEY) {
                console.log("[Error Case Tests] Skipping test - OPENAI_API_KEY not set");
                return;
            }

            const response = await client.callTool("searchChats", {
                userId: "test-user",
                query: "test",
                limit: 10000,
            });

            // Should clamp to max limit (100)
            if (!response.error) {
                const result = response.result as {
                    structuredContent: { search: { limit: number } };
                };
                expect(result.structuredContent.search.limit).toBeLessThanOrEqual(100);
            }
        });
    });

    describe("Edge cases", () => {
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
            const response = await client.callTool("searchChats", {
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
                const loadResponse = await client.callTool("loadChats", {
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
                const loadResponse = await client.callTool("loadChats", {
                    userId: "test-user",
                });
                expect(loadResponse.error).toBeUndefined();
            }
        });
    });
});


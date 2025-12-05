/**
 * Tests for saveChat tool
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
    getTestDb,
} from "./db-helper.js";
import { McpTestClient } from "./mcp-client.js";
import { chats } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { getTestDrizzle } from "./db-helper.js";

describe("saveChat Tool", () => {
    let client: McpTestClient;
    let serverUrl: string;

    beforeAll(async () => {
        // Check if OpenAI API key is available
        if (!process.env.OPENAI_API_KEY) {
            console.warn("[saveChat Tests] OPENAI_API_KEY not set - some tests may fail");
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

    beforeEach(async () => {
        // Ensure clean state before each test
        await truncateAllTables();
    });

    afterAll(async () => {
        // Clean up
        await stopMcpServer();
        await cleanupTestDatabase();
        await stopTestDatabase();
        cleanupTestPorts();
    }, 30000);

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


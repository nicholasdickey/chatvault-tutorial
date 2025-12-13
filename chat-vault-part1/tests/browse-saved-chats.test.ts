/**
 * End-to-end test for browseSavedChats action
 * 
 * This test exercises the MCP action end-to-end via the real MCP server,
 * calling /mcp exactly as the Apps SDK would.
 * 
 * Tests the browseSavedChats tool and widget (Prompt4 implementation)
 */

console.log(`[DEBUG] browse-saved-chats.test.ts module loading, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { McpTestClient } from "./mcp-client.js";
import { startMcpServer, stopMcpServer, getServerPort, cleanupTestPorts } from "./mcp-server-helper.js";

describe("browseSavedChats e2e test", () => {
    let client: McpTestClient;
    const TEST_PORT = 8017;

    beforeAll(async () => {
        console.log(`[DEBUG] browse-saved-chats beforeAll started, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
        cleanupTestPorts();
        // Start the MCP server
        await startMcpServer(TEST_PORT);
        client = new McpTestClient(`http://localhost:${TEST_PORT}`);

        // Initialize the session
        const initResponse = await client.initialize();
        expect(initResponse.error).toBeUndefined();
        expect(initResponse.result).toBeDefined();
    }, 30000);

    afterAll(async () => {
        await stopMcpServer();
        // cleanupTestPorts() removed - server is already stopped by stopMcpServer()
        // cleanupTestPorts() is still called in beforeAll to ensure clean ports before starting
    });

    test("should initialize MCP session successfully", async () => {
        const sessionId = client.getSessionId();
        expect(sessionId).toBeDefined();
        expect(typeof sessionId).toBe("string");
    });

    test("should list tools and include browseSavedChats", async () => {
        const response = await client.listTools();

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as { tools?: unknown[] };
        expect(result.tools).toBeDefined();
        expect(Array.isArray(result.tools)).toBe(true);
        expect(result.tools!.length).toBeGreaterThan(0);

        // Find the browseSavedChats tool
        const chatVaultTool = result.tools!.find(
            (tool: any) => tool.name === "browseSavedChats"
        ) as any;
        expect(chatVaultTool).toBeDefined();
        expect(chatVaultTool?.name).toBe("browseSavedChats");
        expect(chatVaultTool?.description).toBeDefined();
        expect(chatVaultTool?.inputSchema).toBeDefined();

        // Verify tool metadata matches Apps SDK spec
        expect(chatVaultTool?._meta).toBeDefined();
        expect(chatVaultTool?._meta?.["openai/outputTemplate"]).toBeDefined();
        expect(chatVaultTool?._meta?.["openai/widgetAccessible"]).toBe(true);
    });

    test("should call browseSavedChats tool and return widget metadata", async () => {
        const response = await client.callTool("browseSavedChats", {});

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            content?: Array<{ type: string; text: string }>;
            structuredContent?: unknown;
            _meta?: Record<string, unknown>;
        };

        // Verify response structure matches Apps SDK spec
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content!.length).toBeGreaterThan(0);

        // Verify metadata includes widget information
        expect(result._meta).toBeDefined();
        expect(result._meta?.["openai/toolInvocation/invoking"]).toBeDefined();
        expect(result._meta?.["openai/toolInvocation/invoked"]).toBeDefined();
    });

    test("should list resources and include chat-vault widget", async () => {
        const response = await client.listResources();

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as { resources?: unknown[] };
        expect(result.resources).toBeDefined();
        expect(Array.isArray(result.resources)).toBe(true);
        expect(result.resources!.length).toBeGreaterThan(0);

        // Find the chat-vault resource
        const chatVaultResource = result.resources!.find(
            (resource: any) => resource.uri === "ui://widget/chat-vault.html"
        ) as any;
        expect(chatVaultResource).toBeDefined();
        expect(chatVaultResource?.uri).toBe("ui://widget/chat-vault.html");
        expect(chatVaultResource?.mimeType).toBe("text/html+skybridge");

        // Verify resource metadata matches Apps SDK spec
        expect(chatVaultResource?._meta).toBeDefined();
        expect(chatVaultResource?._meta?.["openai/outputTemplate"]).toBe("ui://widget/chat-vault.html");
    });

    test("should read chat-vault widget resource and return inlined HTML", async () => {
        const response = await client.readResource("ui://widget/chat-vault.html");

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            contents?: Array<{
                uri: string;
                mimeType: string;
                text: string;
                _meta?: Record<string, unknown>;
            }>;
        };

        expect(result.contents).toBeDefined();
        expect(Array.isArray(result.contents)).toBe(true);
        expect(result.contents!.length).toBe(1);

        const content = result.contents![0];
        expect(content.uri).toBe("ui://widget/chat-vault.html");
        expect(content.mimeType).toBe("text/html+skybridge");
        expect(content.text).toBeDefined();
        expect(typeof content.text).toBe("string");
        expect(content.text.length).toBeGreaterThan(0);

        // Verify HTML contains the widget root element
        expect(content.text).toContain('id="chat-vault-root"');

        // Verify metadata
        expect(content._meta).toBeDefined();
        expect(content._meta?.["openai/outputTemplate"]).toBe("ui://widget/chat-vault.html");
    });

    test("should complete full browseSavedChats flow end-to-end", async () => {
        // 1. List tools
        const toolsResponse = await client.listTools();
        expect(toolsResponse.error).toBeUndefined();

        // 2. Call the browse tool
        const callResponse = await client.callTool("browseSavedChats", {});
        expect(callResponse.error).toBeUndefined();
        const callResult = callResponse.result as any;
        expect(callResult?._meta).toBeDefined();

        // 3. Read the widget resource
        const resourceResponse = await client.readResource("ui://widget/chat-vault.html");
        expect(resourceResponse.error).toBeUndefined();
        const resourceResult = resourceResponse.result as any;
        expect(resourceResult?.contents?.[0]?.text).toBeDefined();

        // Verify the widget HTML is self-contained (assets inlined)
        const widgetHtml = resourceResult?.contents?.[0]?.text as string;
        expect(widgetHtml).toContain("<script");
        expect(widgetHtml).toContain("<style");
    });
});


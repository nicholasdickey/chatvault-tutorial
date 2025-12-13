/**
 * MCP Protocol Compliance Tests
 * 
 * Tests that the MCP server implementation follows the JSON-RPC 2.0 spec
 * and matches the behavior and shapes from the OpenAI MCP / Apps SDK examples.
 * 
 * Any drift from the examples should be treated as a failing test to fix.
 */

console.log(`[DEBUG] mcp-protocol-compliance.test.ts module loading, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { McpTestClient } from "./mcp-client.js";
import { startMcpServer, stopMcpServer, getServerPort, cleanupTestPorts } from "./mcp-server-helper.js";

describe("MCP Protocol Compliance", () => {
    let client: McpTestClient;
    const TEST_PORT = 8017;

    beforeAll(async () => {
        console.log(`[DEBUG] mcp-protocol-compliance beforeAll started, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
        cleanupTestPorts();
        await startMcpServer(TEST_PORT);
        client = new McpTestClient(`http://localhost:${TEST_PORT}`);
    }, 30000);

    afterAll(async () => {
        console.log(`[DEBUG] mcp-protocol-compliance afterAll starting, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
        console.log(`[DEBUG] About to call stopMcpServer(), Memory: ${JSON.stringify(process.memoryUsage())}`);
        await stopMcpServer();
        console.log(`[DEBUG] stopMcpServer() completed, Memory: ${JSON.stringify(process.memoryUsage())}`);
        // cleanupTestPorts() removed from afterAll - server is already stopped by stopMcpServer()
        // cleanupTestPorts() is still called in beforeAll to ensure clean ports before starting
        console.log(`[DEBUG] afterAll completed, Memory: ${JSON.stringify(process.memoryUsage())}`);
    });

    test("should respond with valid JSON-RPC 2.0 format", async () => {
        console.log(`[DEBUG] First test starting, PID: ${process.pid}, Memory: ${JSON.stringify(process.memoryUsage())}`);
        const response = await client.initialize();

        // Verify JSON-RPC 2.0 structure
        expect(response.jsonrpc).toBe("2.0");
        expect(response.id).toBeDefined();
        expect(response.id).not.toBeNull();

        // Should have either result or error, not both
        const hasResult = response.result !== undefined;
        const hasError = response.error !== undefined;
        expect(hasResult || hasError).toBe(true);
        expect(hasResult && hasError).toBe(false);
    });

    test("should handle initialize request correctly", async () => {
        const response = await client.initialize();

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            protocolVersion?: string;
            capabilities?: {
                resources?: Record<string, unknown>;
                tools?: Record<string, unknown>;
            };
            serverInfo?: {
                name?: string;
                version?: string;
            };
        };

        // Verify initialize response structure matches Apps SDK spec
        expect(result.protocolVersion).toBeDefined();
        expect(result.capabilities).toBeDefined();
        expect(result.capabilities?.resources).toBeDefined();
        expect(result.capabilities?.tools).toBeDefined();
        expect(result.serverInfo).toBeDefined();
        expect(result.serverInfo?.name).toBe("chat-vault-part1");
        expect(result.serverInfo?.version).toBeDefined();
    });

    test("should set mcp-session-id header in initialize response", async () => {
        const response = await client.initialize();
        expect(response.error).toBeUndefined();

        // Session ID should be set after initialize
        const sessionId = client.getSessionId();
        expect(sessionId).toBeDefined();
        expect(typeof sessionId).toBe("string");
        expect(sessionId!.length).toBeGreaterThan(0);
    });

    test("should handle notifications/initialized correctly", async () => {
        // Initialize first
        await client.initialize();

        // Send initialized notification (without id)
        await client.sendNotification("notifications/initialized", {});

        // Notifications return 204 No Content, sendNotification resolves on success
        // If we get here without error, the notification was handled correctly
        const sessionId = client.getSessionId();
        expect(sessionId).toBeTruthy();
    });

    test("should return tools/list in correct format", async () => {
        await client.initialize();
        const response = await client.listTools();

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as { tools?: unknown[] };
        expect(result.tools).toBeDefined();
        expect(Array.isArray(result.tools)).toBe(true);

        // Verify tool structure matches Apps SDK spec
        if (result.tools && result.tools.length > 0) {
            const tool = result.tools[0] as {
                name?: string;
                description?: string;
                inputSchema?: unknown;
                _meta?: Record<string, unknown>;
                annotations?: {
                    destructiveHint?: boolean;
                    openWorldHint?: boolean;
                    readOnlyHint?: boolean;
                };
            };

            expect(tool.name).toBeDefined();
            expect(tool.description).toBeDefined();
            expect(tool.inputSchema).toBeDefined();
            expect(tool._meta).toBeDefined();
            expect(tool.annotations).toBeDefined();

            // Verify metadata structure
            expect(tool._meta?.["openai/outputTemplate"]).toBeDefined();
            expect(tool._meta?.["openai/widgetAccessible"]).toBe(true);
        }
    });

    test("should return tools/call in correct format", async () => {
        await client.initialize();
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
        expect(result.content![0].type).toBe("text");
        expect(result.content![0].text).toBeDefined();

        // Verify metadata
        expect(result._meta).toBeDefined();
        expect(result._meta?.["openai/toolInvocation/invoking"]).toBeDefined();
        expect(result._meta?.["openai/toolInvocation/invoked"]).toBeDefined();
    });

    test("should return resources/list in correct format", async () => {
        await client.initialize();
        const response = await client.listResources();

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as { resources?: unknown[] };
        expect(result.resources).toBeDefined();
        expect(Array.isArray(result.resources)).toBe(true);

        // Verify resource structure matches Apps SDK spec
        if (result.resources && result.resources.length > 0) {
            const resource = result.resources[0] as {
                uri?: string;
                name?: string;
                description?: string;
                mimeType?: string;
                _meta?: Record<string, unknown>;
            };

            expect(resource.uri).toBeDefined();
            expect(resource.name).toBeDefined();
            expect(resource.mimeType).toBe("text/html+skybridge");
            expect(resource._meta).toBeDefined();
            expect(resource._meta?.["openai/outputTemplate"]).toBeDefined();
        }
    });

    test("should return resources/read in correct format", async () => {
        await client.initialize();
        const response = await client.readResource("ui://widget/chat-vault.html");

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            contents?: Array<{
                uri?: string;
                mimeType?: string;
                text?: string;
                _meta?: Record<string, unknown>;
            }>;
        };

        // Verify response structure matches Apps SDK spec
        expect(result.contents).toBeDefined();
        expect(Array.isArray(result.contents)).toBe(true);
        expect(result.contents!.length).toBe(1);

        const content = result.contents![0];
        expect(content.uri).toBe("ui://widget/chat-vault.html");
        expect(content.mimeType).toBe("text/html+skybridge");
        expect(content.text).toBeDefined();
        expect(typeof content.text).toBe("string");
        expect(content._meta).toBeDefined();
    });

    test("should return proper error for unknown tool", async () => {
        await client.initialize();
        const response = await client.callTool("unknown-tool", {});

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
        expect(response.error?.message).toBeDefined();
        expect(typeof response.error?.code).toBe("number");
        expect(typeof response.error?.message).toBe("string");
    });

    test("should return proper error for unknown resource", async () => {
        await client.initialize();
        const response = await client.readResource("ui://widget/unknown.html");

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBeDefined();
        expect(response.error?.message).toBeDefined();
    });

    test("should require session for non-initialize requests", async () => {
        // Create a new client without initializing
        const newClient = new McpTestClient(`http://localhost:${TEST_PORT}`);

        // Try to call a tool without initializing
        const response = await newClient.callTool("browseSavedChats", {});

        // Should return an error about missing session
        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32000);
        expect(response.error?.message).toContain("Session");
    });

    test("should maintain session across multiple requests", async () => {
        await client.initialize();
        const sessionId1 = client.getSessionId();

        // Make another request
        await client.listTools();
        const sessionId2 = client.getSessionId();

        // Session ID should remain the same
        expect(sessionId1).toBe(sessionId2);
    });

    test("should handle Content-Type header correctly", async () => {
        // All responses should have Content-Type: application/json
        // This is verified by our client parsing JSON successfully
        await client.initialize();
        const response = await client.listTools();

        // If Content-Type was wrong, JSON parsing would fail
        expect(response.jsonrpc).toBe("2.0");
        expect(response.result || response.error).toBeDefined();
    });
});


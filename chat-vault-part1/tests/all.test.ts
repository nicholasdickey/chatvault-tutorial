/**
 * Part 1 - Consolidated test suite (Prompt0)
 *
 * Requirements satisfied:
 * - single test file: tests/all.test.ts
 * - single fixed port: 8007 (no fallback)
 * - all cleanup only in beforeAll (port cleanup)
 * - start MCP server only once in beforeAll
 * - only server teardown in afterAll (no port cleanup, no other cleanup)
 * - do not modify test() clauses; only consolidate + adjust setup/teardown
 * - saturated with console.log for debugging
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import { McpTestClient } from "./mcp-client.js";
import {
    startMcpServer,
    stopMcpServer,
    killProcessOnPort,
} from "./mcp-server-helper.js";

describe("chat-vault-part1 (all)", () => {
    const TEST_PORT = 8007;
    let client: McpTestClient;

    beforeAll(async () => {
        process.env.API_KEY = process.env.API_KEY || "test-api-key";
        console.log(`[Part1 all] beforeAll: API_KEY present=${Boolean(process.env.API_KEY)}`);

        console.log(`[Part1 all] beforeAll: cleaning port ${TEST_PORT}`);
        killProcessOnPort(TEST_PORT);
        await new Promise((resolve) => setTimeout(resolve, 250));

        console.log(`[Part1 all] beforeAll: starting MCP server on ${TEST_PORT}`);
        await startMcpServer(TEST_PORT);
        client = new McpTestClient(`http://localhost:${TEST_PORT}`);

        console.log(`[Part1 all] beforeAll: starting baseline MCP session`);
        await client.initialize();
        console.log(`[Part1 all] beforeAll: baseline sessionId=${client.getSessionId()}`);
    }, 120000);

    beforeEach(() => {
        const name = expect.getState().currentTestName ?? "(unknown test)";
        console.log(`\n[Part1 all] >>> START ${name}`);
    });

    afterEach(() => {
        const name = expect.getState().currentTestName ?? "(unknown test)";
        console.log(`[Part1 all] <<< END ${name}\n`);
    });

    afterAll(async () => {
        console.log(`[Part1 all] afterAll: stopping MCP server`);
        await stopMcpServer();
    }, 60000);

    // -------------------------------------------------------------------------
    // The test() clauses below are copied verbatim from the original Part 1 tests
    // (only describe/beforeAll/afterAll scaffolding was consolidated).
    // -------------------------------------------------------------------------

    test("should respond with valid JSON-RPC 2.0 format", async () => {
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

    test("should return widget HTML with inlined assets", async () => {
        const response = await client.readResource("ui://widget/chat-vault.html");

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const result = response.result as {
            contents?: Array<{ text: string }>;
        };
        const widgetHtml = result.contents?.[0]?.text;
        expect(widgetHtml).toBeDefined();
        expect(typeof widgetHtml).toBe("string");
    });

    test("should contain script tag with type='module' for ESM bundle", async () => {
        const response = await client.readResource("ui://widget/chat-vault.html");
        const result = response.result as {
            contents?: Array<{ text: string }>;
        };
        const widgetHtml = result.contents?.[0]?.text as string;

        // Check for script tag with type="module"
        // This ensures the inlined JS bundle preserves ES module semantics
        const moduleScriptRegex = /<script\s+type=["']module["'][^>]*>/i;
        expect(widgetHtml).toMatch(moduleScriptRegex);

        // Verify the script content is inlined (not an external src)
        const scriptMatches = widgetHtml.match(/<script[^>]*>/gi);
        expect(scriptMatches).toBeDefined();
        expect(scriptMatches!.length).toBeGreaterThan(0);

        // All script tags should be inline (no src attribute pointing to external files)
        scriptMatches!.forEach((scriptTag) => {
            // If it has src, it should be a data URL or inline
            if (scriptTag.includes('src=')) {
                const srcMatch = scriptTag.match(/src=["']([^"']+)["']/i);
                if (srcMatch) {
                    const src = srcMatch[1];
                    // Should not be an external HTTP/HTTPS URL (assets should be inlined)
                    expect(src).not.toMatch(/^https?:\/\//);
                }
            }
        });
    });

    test("should contain inlined CSS in style tags", async () => {
        const response = await client.readResource("ui://widget/chat-vault.html");
        const result = response.result as {
            contents?: Array<{ text: string }>;
        };
        const widgetHtml = result.contents?.[0]?.text as string;

        // Check for style tags (CSS should be inlined)
        const styleTagRegex = /<style[^>]*>/i;
        expect(widgetHtml).toMatch(styleTagRegex);

        // Verify no external stylesheet links (all CSS should be inlined)
        const linkMatches = widgetHtml.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi);
        if (linkMatches) {
            // If there are link tags, they should not point to external HTTP/HTTPS URLs
            linkMatches.forEach((linkTag) => {
                const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
                if (hrefMatch) {
                    const href = hrefMatch[1];
                    // Should not be an external HTTP/HTTPS URL
                    expect(href).not.toMatch(/^https?:\/\//);
                }
            });
        }
    });

    test("should be self-contained (no external asset requests)", async () => {
        const response = await client.readResource("ui://widget/chat-vault.html");
        const result = response.result as {
            contents?: Array<{ text: string }>;
        };
        const widgetHtml = result.contents?.[0]?.text as string;

        // Extract all URLs from the HTML
        const urlRegex = /(?:src|href)=["']([^"']+)["']/gi;
        const urls: string[] = [];
        let match;

        while ((match = urlRegex.exec(widgetHtml)) !== null) {
            urls.push(match[1]);
        }

        // All URLs should be either:
        // 1. Data URLs
        // 2. Relative paths (which won't work in iframe, so assets should be inlined)
        // 3. Not external HTTP/HTTPS URLs

        urls.forEach((url) => {
            if (url.startsWith("http://") || url.startsWith("https://")) {
                // External URLs are allowed for things like images from CDN, but JS/CSS should be inlined
                // This is just a warning, not a failure
                console.warn(`Found external URL in widget HTML: ${url}`);
            }
        });

        // The widget should contain the root element
        expect(widgetHtml).toContain('id="chat-vault-root"');
    });

    test("should escape script tags in inlined JavaScript", async () => {
        const response = await client.readResource("ui://widget/chat-vault.html");
        const result = response.result as {
            contents?: Array<{ text: string }>;
        };
        const widgetHtml = result.contents?.[0]?.text as string;

        // Find script tags with inline content
        const inlineScriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let match;

        while ((match = inlineScriptRegex.exec(widgetHtml)) !== null) {
            const scriptContent = match[1];
            // If the script contains </script> (unescaped), it would break HTML parsing
            // It should be escaped as <\/script>
            if (scriptContent.includes("</script>") && !scriptContent.includes("<\\/script>")) {
                // This is a potential issue, but might be okay if it's in a string literal
                // We'll just log it
                console.warn("Found unescaped </script> in script content");
            }
        }
    });
});



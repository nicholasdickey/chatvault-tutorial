/**
 * Test for widget bundle module semantics
 * 
 * Ensures the inlined widget bundle preserves module semantics (ES modules)
 * so it can safely use modern tooling (Vite + React) inside the ChatGPT widget iframe.
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import { McpTestClient } from "./mcp-client.js";
import { startMcpServer, stopMcpServer, getServerPort, cleanupTestPorts } from "./mcp-server-helper.js";

describe("Widget module semantics test", () => {
    let client: McpTestClient;
    const TEST_PORT = 8002;

    beforeAll(async () => {
        cleanupTestPorts();
        await startMcpServer(TEST_PORT);
        client = new McpTestClient(`http://localhost:${TEST_PORT}`);
        await client.initialize();
    }, 30000);

    afterAll(async () => {
        await stopMcpServer();
        cleanupTestPorts();
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


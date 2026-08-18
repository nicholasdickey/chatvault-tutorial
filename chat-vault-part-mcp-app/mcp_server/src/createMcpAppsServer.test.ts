import assert from "node:assert/strict";
import test from "node:test";

import { createMcpAppsServer } from "./createMcpAppsServer.js";

const resourceUri = "ui://chat-vault/mcp-app.html";

test("exposes the widget launcher to the model only", () => {
  const server = createMcpAppsServer() as any;
  const tool = server._registeredTools.browseMyChatVault;

  assert.deepEqual(tool._meta.ui.visibility, ["model"]);
  assert.equal(tool._meta.ui.resourceUri, resourceUri);
  assert.ok(tool.outputSchema);
});

test("widget launcher returns structured content matching its output schema", async () => {
  const server = createMcpAppsServer() as any;
  const tool = server._registeredTools.browseMyChatVault;
  const result = await tool.handler({});

  assert.deepEqual(result.structuredContent, {
    opened: true,
    message: "Opened Chat Vault. Use the widget to browse, search, and manage your saved knowledge.",
  });
});

test("publishes the Claude-compatible legacy widget resource metadata", async () => {
  const server = createMcpAppsServer() as any;
  const resource = server._registeredResources[resourceUri];
  const result = await resource.readCallback(resourceUri);
  const metadata = result.contents[0]._meta;

  assert.equal(metadata.ui, undefined);
  assert.deepEqual(metadata["openai/widgetCSP"], {
    connect_domains: [
      "https://chatvault-part-mcp-app.vercel.app",
      "https://www.agentsyx.com",
      "https://agentsyx.com",
    ],
    resource_domains: [
      "https://chatvault-part-mcp-app.vercel.app",
      "https://www.agentsyx.com",
      "https://agentsyx.com",
    ],
  });
  assert.equal(metadata["ui/widgetVersion"], "1.0.5");
});

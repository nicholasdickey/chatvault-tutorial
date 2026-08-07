import assert from "node:assert/strict";
import test from "node:test";

import { createMcpAppsServer } from "./createMcpAppsServer.js";

const resourceUri = "ui://chat-vault/mcp-app.html";

test("exposes the widget launcher to the model only", () => {
  const server = createMcpAppsServer() as any;
  const tool = server._registeredTools.browseMyChatVault;

  assert.deepEqual(tool._meta.ui.visibility, ["model"]);
  assert.equal(tool._meta.ui.resourceUri, resourceUri);
});

test("publishes standard and legacy widget resource metadata", async () => {
  const server = createMcpAppsServer() as any;
  const resource = server._registeredResources[resourceUri];
  const result = await resource.readCallback(resourceUri);
  const metadata = result.contents[0]._meta;

  assert.equal(metadata.ui.domain, "https://chatvault-part-mcp-app.vercel.app");
  assert.equal(metadata.ui.prefersBorder, true);
  assert.deepEqual(metadata.ui.csp, {
    connectDomains: [
      "https://chatvault-part-mcp-app.vercel.app",
      "https://www.agentsyx.com",
      "https://agentsyx.com",
    ],
    resourceDomains: [
      "https://chatvault-part-mcp-app.vercel.app",
      "https://*.agentsyx.com",
    ],
  });
  assert.deepEqual(metadata["openai/widgetCSP"], {
    connect_domains: metadata.ui.csp.connectDomains,
    resource_domains: metadata.ui.csp.resourceDomains,
  });
});

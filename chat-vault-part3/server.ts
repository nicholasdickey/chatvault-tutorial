import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const server = new McpServer({
  name: "ChatVault Part 3 MCP App Server",
  version: "0.1.0",
});

// UI resource for the ChatVault widget as an MCP App
const resourceUri = "ui://chat-vault/mcp-app.html";

// Minimal browseMySavedChats tool that opens the widget UI.
registerAppTool(
  server,
  "browseMySavedChats",
  {
    title: "Browse Saved Chats",
    description:
      "Open the ChatVault widget to browse, search, and manage saved chats.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    _meta: {
      ui: {
        resourceUri,
      },
    },
  },
  async () => {
    const text =
      "Opened ChatVault! Use the widget to browse, search, and manage your saved chats.";
    return {
      content: [{ type: "text", text }],
    };
  },
);

// Register the MCP App UI resource, which will be built to dist/mcp-app.html
registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const htmlPath = path.join(process.cwd(), "dist", "mcp-app.html");
    const html = await fs.readFile(htmlPath, "utf-8");
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
        },
      ],
    };
  },
);

// Expose the MCP server over HTTP using the streamable HTTP transport
const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(PORT, (err?: Error) => {
  if (err) {
    console.error("Error starting ChatVault Part 3 MCP App server:", err);
    process.exit(1);
  }
  console.log(
    `ChatVault Part 3 MCP App server listening on http://localhost:${PORT}/mcp`,
  );
});


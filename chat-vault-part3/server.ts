import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import { createMcpAppsServer } from "./mcp_server/src/createMcpAppsServer.js";

// Expose the MCP server over HTTP using the streamable HTTP transport
const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const server = createMcpAppsServer();
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


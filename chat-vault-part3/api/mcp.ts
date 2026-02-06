import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpRequest } from "../mcp_server/src/server.js";

/**
 * Vercel Serverless Function: /api/mcp
 * - Also supports /mcp via vercel.json rewrite
 * - Delegates to the plain MCP HTTP handler in mcp_server/src/server.ts
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // CORS for external callers (ChatGPT, A6, etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, mcp-session-id, authorization",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  // Delegate all JSON-RPC handling (including auth and logging) to the core MCP server
  await handleMcpRequest(req, res);
}


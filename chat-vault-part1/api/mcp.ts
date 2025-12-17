import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vercel Serverless Function: /api/mcp
 * - Also supports /mcp via vercel.json rewrite
 * - Uses dynamic import to avoid ESM import edge-cases in serverless bundling
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // CORS for external callers (ChatGPT, Findexar, etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, mcp-session-id, authorization"
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

  const mod = await import("../mcp_server/src/server.js");
  await mod.handleMcpRequest(req, res);
}

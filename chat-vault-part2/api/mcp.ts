import type { IncomingMessage, ServerResponse } from "node:http";

let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import("../src/server.js");
      await mod.initializeDatabase();
    })();
  }
  await initPromise;
}

/**
 * Vercel Serverless Function: /api/mcp
 * - Also supports /mcp via vercel.json rewrite
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
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  await ensureInitialized();
  const mod = await import("../src/server.js");
  await mod.handleMcpRequest(req, res);
}

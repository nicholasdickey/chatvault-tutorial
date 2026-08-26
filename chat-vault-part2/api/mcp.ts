import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vercel Serverless Function: /api/mcp
 * - Also supports /mcp via vercel.json rewrite
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const apiStartedAt = Date.now();
  // CORS for external callers (ChatGPT, Findexar, etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  const isFullProfile =
    process.env.CHATVAULT_TOOL_METADATA_PROFILE?.trim().toLowerCase() === "full";
  res.setHeader(
    "Access-Control-Allow-Headers",
    isFullProfile
      ? "content-type, mcp-session-id, authorization, x-a6-canonical-user-id, x-a6-user-uuid"
      : "content-type, mcp-session-id, authorization"
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

  const moduleImportStartedAt = Date.now();
  const mod = await import("../src/server.js");
  const moduleImportMs = Date.now() - moduleImportStartedAt;
  await mod.handleMcpRequest(req, res);
  console.log(JSON.stringify({
    level: "info",
    event: "chatvault.performance.api_request",
    totalMs: Date.now() - apiStartedAt,
    phasesMs: { moduleImport: moduleImportMs },
  }));
}

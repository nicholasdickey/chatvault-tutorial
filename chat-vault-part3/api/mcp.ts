import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpAppsServer } from "../mcp_server/src/createMcpAppsServer.js";

function getBearerTokenFromAuthHeader(
  header: string | string[] | undefined,
): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = raw.match(/^\s*Bearer\s+(.+)\s*$/i);
  return match?.[1] ?? null;
}

function isAuthorized(
  req: IncomingMessage,
): { ok: true } | { ok: false; status: number; message: string } {
  const expected = process.env.API_KEY;
  console.log("[AUTH] Checking API_KEY authorization");
  console.log("[AUTH] API_KEY env var present =", Boolean(expected));
  if (!expected) {
    console.log(
      "[AUTH] DENY: missing API_KEY env var (server misconfigured)",
    );
    return {
      ok: false,
      status: 500,
      message: "Server misconfigured: missing API_KEY env var",
    };
  }

  const token = getBearerTokenFromAuthHeader(req.headers.authorization);
  console.log(
    "[AUTH] Authorization header present =",
    Boolean(req.headers.authorization),
  );
  console.log("[AUTH] Bearer token parsed =", Boolean(token));
  if (!token) {
    console.log(
      "[AUTH] DENY: missing/invalid Authorization header (expected Bearer)",
    );
    return {
      ok: false,
      status: 401,
      message: "Missing Authorization: Bearer <API_KEY>",
    };
  }

  // Avoid leaking timing differences
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  console.log(
    "[AUTH] token length =",
    a.length,
    "expected length =",
    b.length,
  );
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.log("[AUTH] DENY: token mismatch");
    return { ok: false, status: 401, message: "Invalid API key" };
  }

  console.log("[AUTH] ALLOW: token matched");
  return { ok: true };
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const parsed = body.length ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Vercel Serverless Function: /api/mcp
 * - Also supports /mcp via vercel.json rewrite
 * - Uses StreamableHTTPServerTransport for MCP Apps-compatible HTTP transport
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

  const auth = isAuthorized(req);
  if (!auth.ok) {
    console.log("[MCP] Auth failed:", {
      status: auth.status,
      message: auth.message,
    });
    res.setHeader("WWW-Authenticate", "Bearer");
    res.writeHead(auth.status);
    res.end(JSON.stringify({ error: auth.message }));
    return;
  }

  console.log("[MCP] Auth OK, starting request handling");

  try {
    console.log("[MCP] Creating MCP Apps server...");
    const server = createMcpAppsServer();
    console.log("[MCP] MCP Apps server created");

    console.log("[MCP] Reading request body...");
    const requestBody = await readRequestBody(req);
    const bodyStr =
      typeof requestBody === "object" && requestBody !== null
        ? JSON.stringify(requestBody)
        : String(requestBody);
    const bodyPreview =
      bodyStr.slice(0, 200) + (bodyStr.length > 200 ? "..." : "");
    console.log("[MCP] Request body read", {
      hasBody: Boolean(requestBody),
      bodyKeys:
        typeof requestBody === "object" && requestBody !== null
          ? Object.keys(requestBody as object)
          : [],
      bodyLength: bodyStr.length,
      bodyPreview,
    });

    console.log("[MCP] Creating StreamableHTTPServerTransport");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    console.log("[MCP] Transport created, connecting server...");

    res.on("close", () => transport.close());
    await server.connect(transport);
    console.log("[MCP] Server connected, calling transport.handleRequest");
    await transport.handleRequest(req, res, requestBody);
    console.log("[MCP] handleRequest completed");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown internal error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[MCP] Internal error in api/mcp handler:", message);
    if (stack) console.error("[MCP] Stack:", stack);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message },
      }),
    );
  }
}



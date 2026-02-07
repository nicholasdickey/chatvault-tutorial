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
  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "Server misconfigured: missing API_KEY env var",
    };
  }
  const token = getBearerTokenFromAuthHeader(req.headers.authorization);
  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "Missing Authorization: Bearer <API_KEY>",
    };
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Invalid API key" };
  }
  return { ok: true };
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
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
  if (auth.ok === false) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.writeHead(auth.status);
    res.end(JSON.stringify({ error: auth.message }));
    return;
  }

  try {
    const server = createMcpAppsServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => transport.close());
    await server.connect(transport);

    const requestBodyStr = await readRequestBody(req);
    let requestBody: unknown = undefined;
    if (requestBodyStr.length > 0) {
      try {
        requestBody = JSON.parse(requestBodyStr);
      } catch {
        requestBody = requestBodyStr;
      }
    }

    await transport.handleRequest(req, res, requestBody);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown internal error";
    console.error("[MCP] Internal error in api/mcp handler:", message);
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

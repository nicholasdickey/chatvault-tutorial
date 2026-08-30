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

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

/** Wrap res to log final status and body for debugging */
function wrapResponseToLog(res: ServerResponse): ServerResponse {
  let statusCode: number | undefined;
  const chunks: Buffer[] = [];
  const originalWriteHead = res.writeHead.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  // @ts-expect-error - wrapper signature conflicts with ServerResponse overloads
  res.writeHead = function (
    ...args: Parameters<typeof originalWriteHead>
  ): ServerResponse {
    statusCode = typeof args[0] === "number" ? args[0] : undefined;
    console.log("[MCP] res.writeHead", { statusCode });
    return originalWriteHead(...args);
  };

  // @ts-expect-error - wrapper signature conflicts with ServerResponse overloads
  res.write = function (
    ...args: Parameters<typeof originalWrite>
  ): boolean {
    const chunk = args[0];
    let len = 0;
    let preview: string | undefined;

    if (typeof chunk === "string") {
      len = Buffer.byteLength(chunk);
      const buf = Buffer.from(chunk);
      chunks.push(buf);
      preview = chunk.slice(0, 100);
    } else if (chunk && Buffer.isBuffer(chunk)) {
      len = chunk.length;
      chunks.push(chunk);
      preview = chunk.toString("utf8").slice(0, 100);
    } else if (chunk && chunk instanceof Uint8Array) {
      const buf = Buffer.from(chunk);
      len = buf.length;
      chunks.push(buf);
      preview = buf.toString("utf8").slice(0, 100);
    }

    console.log("[MCP] res.write called", {
      chunkLength: len,
      chunkPreview:
        preview ??
        "non-string/buffer",
      chunkType: chunk === null ? "null" : typeof chunk,
      chunkConstructor: chunk && (chunk as any).constructor
        ? (chunk as any).constructor.name
        : undefined,
    });

    return originalWrite(...args);
  };

  // @ts-expect-error - wrapper signature conflicts with ServerResponse overloads
  res.end = function (
    ...args: Parameters<typeof originalEnd>
  ): ServerResponse {
    const chunk = args[0];
    let endChunkLen = 0;

    if (typeof chunk === "string") {
      endChunkLen = Buffer.byteLength(chunk);
      chunks.push(Buffer.from(chunk));
      console.log("[MCP] res.end called with string chunk", {
        length: endChunkLen,
        preview: chunk.slice(0, 200),
      });
    } else if (chunk && Buffer.isBuffer(chunk)) {
      endChunkLen = chunk.length;
      chunks.push(chunk);
      console.log("[MCP] res.end called with Buffer chunk", {
        length: endChunkLen,
        preview: chunk.toString("utf8").slice(0, 200),
      });
    } else if (chunk && chunk instanceof Uint8Array) {
      const buf = Buffer.from(chunk);
      endChunkLen = buf.length;
      chunks.push(buf);
      console.log("[MCP] res.end called with Uint8Array chunk", {
        length: endChunkLen,
        preview: buf.toString("utf8").slice(0, 200),
      });
    } else {
      console.log("[MCP] res.end called with no chunk or unrecognized chunk", {
        argsLength: args.length,
        firstArgType: typeof args[0],
        chunkType: chunk === null ? "null" : typeof chunk,
        chunkConstructor: chunk && (chunk as any).constructor
          ? (chunk as any).constructor.name
          : undefined,
      });
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const preview =
      body.slice(0, 500) + (body.length > 500 ? "..." : "");
    
    // Try to parse JSON to check for _meta in tools/call responses
    let parsedBody: any = null;
    let hasMeta = false;
    let metaInfo: any = null;
    try {
      parsedBody = JSON.parse(body);
      if (parsedBody?.result && typeof parsedBody.result === "object") {
        hasMeta = "_meta" in parsedBody.result;
        if (hasMeta) {
          metaInfo = {
            hasMeta: true,
            metaKeys: Object.keys(parsedBody.result._meta || {}),
            hasUiResourceUri: Boolean(parsedBody.result._meta?.ui?.resourceUri),
            resourceUri: parsedBody.result._meta?.ui?.resourceUri,
          };
        }
      }
    } catch (e) {
      // Not JSON or parse error - ignore
    }
    
    console.log("[MCP] Response sent", {
      statusCode,
      totalChunks: chunks.length,
      endChunkLength: endChunkLen,
      bodyLength: body.length,
      bodyPreview: preview,
      ...(hasMeta ? { _meta: metaInfo } : { hasMeta: false }),
    });

    return originalEnd(...args);
  };

  return res;
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
  if (auth.ok === false) {
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

    console.log("[MCP] Creating StreamableHTTPServerTransport");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    console.log("[MCP] Transport created, connecting server...");

    // Wrap response before connecting server so the transport always sees
    // the wrapped instance (for logging) and we can track all writes.
    const resToLog = wrapResponseToLog(res);

    resToLog.on("close", () => transport.close());

    console.log("[MCP] Connecting server to transport");
    await server.connect(transport);

    console.log("[MCP] Before handleRequest", {
      headersSent: resToLog.headersSent,
      writableEnded: resToLog.writableEnded,
      writable: resToLog.writable,
    });

    try {
      console.log("[MCP] Server connected, calling transport.handleRequest");
      // Read body as string for logging and parsing
      console.log("[MCP] Reading request body...");
      const requestBodyStr = await readRequestBody(req);
      const bodyPreview =
        requestBodyStr.slice(0, 200) +
        (requestBodyStr.length > 200 ? "..." : "");
      console.log("[MCP] Request body read", {
        hasBody: Boolean(requestBodyStr),
        bodyLength: requestBodyStr.length,
        bodyPreview,
      });

      // Parse to JSON object for handleRequest, matching Express's req.body
      let requestBody: unknown = undefined;
      if (requestBodyStr.length > 0) {
        try {
          requestBody = JSON.parse(requestBodyStr);
        } catch (parseErr) {
          const msg =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.error("[MCP] Failed to parse request body as JSON:", msg);
          // Let the transport still see the raw string if parsing fails
          requestBody = requestBodyStr;
        }
      }

      await transport.handleRequest(req, resToLog, requestBody);
      console.log("[MCP] handleRequest completed");
    } catch (handleErr) {
      const message =
        handleErr instanceof Error ? handleErr.message : String(handleErr);
      console.error("[MCP] Error during transport.handleRequest:", message);
      if (handleErr instanceof Error && handleErr.stack) {
        console.error("[MCP] handleRequest stack:", handleErr.stack);
      }
      throw handleErr;
    }

    console.log("[MCP] After handleRequest", {
      headersSent: resToLog.headersSent,
      writableEnded: resToLog.writableEnded,
      writable: resToLog.writable,
    });
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



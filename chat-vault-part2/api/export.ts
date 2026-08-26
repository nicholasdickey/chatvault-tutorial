import type { IncomingMessage, ServerResponse } from "node:http";

import { buildSavedEntriesExport } from "../src/tools/exportSavedEntries.js";
import { getExportTokenRecord } from "../src/utils/redis.js";

function writeJsonError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify({ error: message }));
}

function getMaximumExportBytes(): number {
  const parsed = Number.parseInt(process.env.CHATVAULT_EXPORT_MAX_BYTES ?? "10485760", 10);
  return Number.isFinite(parsed)
    ? Math.min(50 * 1024 * 1024, Math.max(1024, parsed))
    : 10 * 1024 * 1024;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    writeJsonError(res, 405, "Method not allowed");
    return;
  }

  try {
    const requestUrl = new URL(req.url ?? "/api/export", "https://chatvault.invalid");
    const token = requestUrl.searchParams.get("token") ?? "";
    const tokenRecord = await getExportTokenRecord(token);
    if (!tokenRecord) {
      writeJsonError(res, 404, "Export link is invalid or expired");
      return;
    }

    const payload = await buildSavedEntriesExport(tokenRecord.canonicalUserId);
    const body = JSON.stringify(payload, null, 2);
    const byteLength = Buffer.byteLength(body, "utf8");
    if (byteLength > getMaximumExportBytes()) {
      writeJsonError(res, 413, "Export is too large to download");
      return;
    }

    const filename = `chat-vault-export-${payload.exportedAt.slice(0, 10)}.json`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(body);
  } catch (error) {
    console.error("[export] Failed to build export", {
      message: error instanceof Error ? error.message : String(error),
    });
    writeJsonError(res, 503, "Export service is temporarily unavailable");
  }
}


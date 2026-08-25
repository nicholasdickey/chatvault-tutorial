import type { IncomingMessage, ServerResponse } from "node:http";
import { loadMyChats, type FullChat } from "../src/tools/loadMyChats.js";
import { verifyDataExportToken } from "../src/utils/dataExport.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/api/export", "https://chatvault.invalid");
    const token = requestUrl.searchParams.get("token");
    const payload = token ? verifyDataExportToken(token) : null;
    if (!payload) {
      res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: "This download link is invalid or has expired." }));
      return;
    }

    const chats: Array<Omit<FullChat, "userId">> = [];
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await loadMyChats({
        userId: payload.userId,
        page,
        size: 100,
        aboveTheFoldOnly: false,
        userContext: {
          isAnon: payload.isAnon,
          isAnonymousPlan: payload.isAnonymousPlan,
        },
      });
      chats.push(
        ...result.chats.map(({ userId: _userId, ...chat }) => chat),
      );
      hasMore = result.pagination.hasMore;
      page += 1;
    }

    const exportedAt = new Date();
    const archive = {
      format: "chat-vault-export",
      version: 1,
      exportedAt: exportedAt.toISOString(),
      chatCount: chats.length,
      chats,
    };
    const body = JSON.stringify(archive, null, 2);
    const filename = `chat-vault-${exportedAt.toISOString().slice(0, 10)}.json`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  } catch (error) {
    console.error("[dataExport] Download failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Unable to export Chat Vault data." }));
  }
}

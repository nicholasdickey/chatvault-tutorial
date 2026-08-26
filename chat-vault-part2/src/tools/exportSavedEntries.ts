import { desc } from "drizzle-orm";
import { chatListDb } from "../db/index.js";
import { chats } from "../db/schema.js";
import { chatsUserIdInCanonicalScope } from "../user/userMerge.js";
import { getTopicsForChatIds } from "./topicQueries.js";

export interface SavedEntriesExport {
  schemaVersion: 1;
  exportedAt: string;
  entries: Array<{
    id: string;
    title: string;
    timestamp: string;
    turns: Array<{ prompt: string; response: string }>;
    topics: string[];
  }>;
}

export async function buildSavedEntriesExport(
  canonicalUserId: string,
): Promise<SavedEntriesExport> {
  const rows = await chatListDb
    .select({
      id: chats.id,
      title: chats.title,
      timestamp: chats.timestamp,
      turns: chats.turns,
    })
    .from(chats)
    .where(chatsUserIdInCanonicalScope(canonicalUserId))
    .orderBy(desc(chats.timestamp), desc(chats.id));

  const topicsByChatId = new Map<string, string[]>();
  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const chunkTopics = await getTopicsForChatIds(
      chunk.map((chat) => chat.id),
      true,
    );
    for (const [chatId, topicList] of chunkTopics) {
      topicsByChatId.set(chatId, topicList.map((topic) => topic.name));
    }
  }

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    entries: rows.map((chat) => ({
      id: chat.id,
      title: chat.title,
      timestamp: chat.timestamp.toISOString(),
      turns: chat.turns.map((turn) => ({
        prompt: turn.prompt,
        response: turn.response,
      })),
      topics: topicsByChatId.get(chat.id) ?? [],
    })),
  };
}


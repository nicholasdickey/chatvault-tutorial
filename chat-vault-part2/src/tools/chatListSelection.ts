import { chats } from "../db/schema.js";

/**
 * Ordinary list reads intentionally exclude embeddings. Embeddings are large
 * and belong only on the vector-search path.
 */
export const chatListSelection = {
  id: chats.id,
  userId: chats.userId,
  title: chats.title,
  timestamp: chats.timestamp,
  turns: chats.turns,
};

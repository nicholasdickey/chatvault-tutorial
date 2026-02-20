/**
 * loadFullTurn tool - fetch full prompt and response for a single turn by chatId, userId, turnIndex
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface LoadFullTurnParams {
  chatId: string;
  userId: string;
  turnIndex: number;
}

export interface LoadFullTurnResult {
  turn: {
    prompt: string;
    response: string;
  };
}

/**
 * Load full turn content by chatId, userId, and turnIndex. Validates that the chat belongs to the user.
 */
export async function loadFullTurn(params: LoadFullTurnParams): Promise<LoadFullTurnResult | null> {
  const { chatId, userId, turnIndex } = params;

  if (!chatId || !userId || turnIndex == null || turnIndex < 0) {
    throw new Error("chatId, userId, and turnIndex (>= 0) are required");
  }

  const [row] = await db
    .select({ turns: chats.turns })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);

  if (!row) {
    return null;
  }

  const turns = row.turns ?? [];
  const turn = turns[turnIndex];
  if (!turn || typeof turn.prompt !== "string" || typeof turn.response !== "string") {
    return null;
  }

  return {
    turn: {
      prompt: turn.prompt,
      response: turn.response,
    },
  };
}

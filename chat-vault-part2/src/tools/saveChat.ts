/**
 * saveChat tool implementation
 * Queues chat for async embeddings; worker processes and saves to DB.
 *
 * IMPORTANT: This tool is called by AI with structured data.
 * The turns array is already properly structured - NO PARSING is performed.
 * The structure is used as-is and queued for async save.
 *
 * For parsing unstructured content (HTML/text), use widgetAdd instead.
 */

import { randomUUID } from "node:crypto";
import { pushChatSaveJob, isRedisConfigured } from "../utils/redis.js";
import { saveChatCore } from "../utils/saveChatCore.js";

export interface SaveChatParams {
    userId: string;
    title: string;
    turns: Array<{ prompt: string; response: string }>;
}

export type SaveChatResult =
    | { jobId: string }
    | { chatId: string; saved: boolean };

/**
 * Queue a chat for async save, or run sync when Redis is not configured (e.g. tests).
 *
 * @param params - Structured chat data with pre-parsed turns array
 * @returns Result with jobId (async) or chatId+saved (sync fallback)
 */
export async function saveChat(params: SaveChatParams): Promise<SaveChatResult> {
    // Validate turns structure
    if (!params.turns || !Array.isArray(params.turns)) {
        throw new Error("turns must be an array");
    }

    for (let i = 0; i < params.turns.length; i++) {
        const turn = params.turns[i];
        if (!turn || typeof turn !== "object") {
            throw new Error(`Turn ${i} must be an object`);
        }
        if (typeof turn.prompt !== "string" || typeof turn.response !== "string") {
            throw new Error(`Turn ${i} must have prompt and response as strings`);
        }
    }

    if (isRedisConfigured()) {
        const jobId = randomUUID();
        await pushChatSaveJob({
            jobId,
            userId: params.userId,
            title: params.title,
            turns: params.turns,
            source: "saveChat",
        });
        return { jobId };
    }

    // Sync fallback when Redis not configured (e.g. test env)
    return saveChatCore(params);
}

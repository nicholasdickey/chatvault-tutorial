/**
 * saveChat tool implementation
 * Uses shared core logic from saveChatCore
 */

import { saveChatCore, type SaveChatCoreParams, type SaveChatCoreResult } from "../utils/saveChatCore.js";

export interface SaveChatParams {
    userId: string;
    title: string;
    turns: Array<{ prompt: string; response: string }>;
}

export interface SaveChatResult {
    chatId: string;
    saved: boolean;
}

/**
 * Save a chat to the database with embedding
 * This is a thin wrapper around saveChatCore for the widget's saveChat tool
 */
export async function saveChat(params: SaveChatParams): Promise<SaveChatResult> {
    return await saveChatCore(params);
}


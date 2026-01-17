/**
 * saveChat tool implementation
 * Uses shared core logic from saveChatCore
 * 
 * IMPORTANT: This tool is called by AI with structured data.
 * The turns array is already properly structured - NO PARSING is performed.
 * The structure is used as-is and saved directly to the database.
 * 
 * For parsing unstructured content (HTML/text), use saveChatManually instead.
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
 * 
 * This is a thin wrapper around saveChatCore for the widget's saveChat tool.
 * The turns structure is respected exactly as provided - no parsing or transformation.
 * 
 * @param params - Structured chat data with pre-parsed turns array
 * @returns Result with chatId and saved status
 */
export async function saveChat(params: SaveChatParams): Promise<SaveChatResult> {
    // Validate turns structure before passing to core
    if (!params.turns || !Array.isArray(params.turns)) {
        throw new Error("turns must be an array");
    }
    
    // Validate each turn has the expected structure
    for (let i = 0; i < params.turns.length; i++) {
        const turn = params.turns[i];
        if (!turn || typeof turn !== 'object') {
            throw new Error(`Turn ${i} must be an object`);
        }
        if (typeof turn.prompt !== 'string' || typeof turn.response !== 'string') {
            throw new Error(`Turn ${i} must have prompt and response as strings`);
        }
    }
    
    // Pass validated structure directly to core - no parsing
    return await saveChatCore(params);
}


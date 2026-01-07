/**
 * Core shared logic for saving chats
 * Used by both saveChat and saveChatManually
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generateEmbedding, combineChatText } from "./embeddings.js";

export interface SaveChatCoreParams {
    userId: string;
    title: string;
    turns: Array<{ prompt: string; response: string }>;
}

export interface SaveChatCoreResult {
    chatId: string;
    saved: boolean;
}

/**
 * Check if an identical chat already exists for idempotency
 * If the same save operation is called multiple times (retries, double-clicks, etc.),
 * we return the existing chat ID instead of creating a duplicate
 * This check happens BEFORE generating embeddings to save API costs
 */
export async function checkForExistingChat(
    userId: string,
    title: string,
    turns: Array<{ prompt: string; response: string }>
): Promise<string | null> {
    // Query for chats with same userId, title, and turns (JSON comparison)
    // This ensures idempotency: same inputs = same result
    const existingChats = await db
        .select({ id: chats.id, timestamp: chats.timestamp })
        .from(chats)
        .where(
            and(
                eq(chats.userId, userId),
                eq(chats.title, title),
                sql`turns = ${JSON.stringify(turns)}::jsonb`
            )
        )
        .orderBy(sql`timestamp DESC`)
        .limit(1);

    if (existingChats.length > 0) {
        const existing = existingChats[0];
        console.log("[saveChatCore] Idempotency check: found existing chat:", existing.id, "at", existing.timestamp);
        return existing.id;
    }

    return null;
}

/**
 * Core logic for saving a chat to the database with embedding
 * This is the shared implementation used by both saveChat and saveChatManually
 */
export async function saveChatCore(params: SaveChatCoreParams): Promise<SaveChatCoreResult> {
    const { userId, title, turns } = params;

    console.log("[saveChatCore] Saving chat - userId:", userId, "title:", title, "turns:", turns.length);

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!title) {
            throw new Error("title is required");
        }
        if (!turns || turns.length === 0) {
            throw new Error("turns must be a non-empty array");
        }

        // Idempotency check: if same chat already exists, return existing ID
        // This prevents duplicates from retries, double-clicks, etc.
        console.log("[saveChatCore] Checking for existing chat (idempotency)...");
        const existingId = await checkForExistingChat(userId, title, turns);
        if (existingId) {
            console.log("[saveChatCore] Existing chat found, returning existing chat ID:", existingId);
            return {
                chatId: existingId,
                saved: false, // Not newly saved, but operation is idempotent
            };
        }

        // Combine all prompts and responses into a single text
        const chatText = combineChatText(turns);
        console.log("[saveChatCore] Combined chat text length:", chatText.length, "chars");

        // Generate embedding for the entire chat
        console.log("[saveChatCore] Generating embedding...");
        const embedding = await generateEmbedding(chatText);
        console.log("[saveChatCore] Embedding generated, dimensions:", embedding.length);

        // Save to database
        console.log("[saveChatCore] Inserting chat into database...");
        const [savedChat] = await db
            .insert(chats)
            .values({
                userId,
                title,
                turns,
                embedding,
            })
            .returning({ id: chats.id });

        if (!savedChat) {
            throw new Error("Failed to save chat - no ID returned");
        }

        console.log("[saveChatCore] Chat saved successfully - id:", savedChat.id);

        return {
            chatId: savedChat.id,
            saved: true,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[saveChatCore] Error saving chat:", errorMessage);
        throw error;
    }
}



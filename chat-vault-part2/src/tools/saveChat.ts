/**
 * saveChat tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generateEmbedding, combineChatText } from "../utils/embeddings.js";

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
 * Check if an identical chat already exists for idempotency
 * If the same save operation is called multiple times (retries, double-clicks, etc.),
 * we return the existing chat ID instead of creating a duplicate
 * This check happens BEFORE generating embeddings to save API costs
 */
async function checkForExistingChat(
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
        console.log("[saveChat] Idempotency check: found existing chat:", existing.id, "at", existing.timestamp);
        return existing.id;
    }
    
    return null;
}

/**
 * Save a chat to the database with embedding
 */
export async function saveChat(params: SaveChatParams): Promise<SaveChatResult> {
    const { userId, title, turns } = params;

    console.log("[saveChat] Saving chat - userId:", userId, "title:", title, "turns:", turns.length);

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
        console.log("[saveChat] Checking for existing chat (idempotency)...");
        const existingId = await checkForExistingChat(userId, title, turns);
        if (existingId) {
            console.log("[saveChat] Existing chat found, returning existing chat ID:", existingId);
            return {
                chatId: existingId,
                saved: false, // Not newly saved, but operation is idempotent
            };
        }

        // Combine all prompts and responses into a single text
        const chatText = combineChatText(turns);
        console.log("[saveChat] Combined chat text length:", chatText.length, "chars");

        // Generate embedding for the entire chat
        console.log("[saveChat] Generating embedding...");
        const embedding = await generateEmbedding(chatText);
        console.log("[saveChat] Embedding generated, dimensions:", embedding.length);

        // Save to database
        console.log("[saveChat] Inserting chat into database...");
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

        console.log("[saveChat] Chat saved successfully - id:", savedChat.id);

        return {
            chatId: savedChat.id,
            saved: true,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[saveChat] Error saving chat:", errorMessage);
        throw error;
    }
}


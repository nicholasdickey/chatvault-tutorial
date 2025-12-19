/**
 * saveChatManually tool implementation
 * Parses HTML/text content from ChatGPT copy/paste and saves as structured chat
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generateEmbedding, combineChatText } from "../utils/embeddings.js";

export interface SaveChatManuallyParams {
    userId: string;
    htmlContent: string;
    title?: string;
}

export interface SaveChatManuallyResult {
    chatId: string;
    saved: boolean;
    turnsCount: number;
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
        console.log("[saveChatManually] Idempotency check: found existing chat:", existing.id, "at", existing.timestamp);
        return existing.id;
    }
    
    return null;
}

/**
 * Parse HTML/text content to extract chat turns
 * Supports two formats:
 * 1. With markers: "You said: ... ChatGPT said: ..."
 * 2. Plain alternating: user message, ChatGPT response, user message, etc.
 */
function parseChatContent(content: string): Array<{ prompt: string; response: string }> {
    const turns: Array<{ prompt: string; response: string }> = [];
    
    // Remove HTML tags if present (simple strip)
    let text = content.replace(/<[^>]*>/g, "").trim();
    
    // Try format 1: "You said:" / "ChatGPT said:" markers
    const youSaidRegex = /You said:\s*/gi;
    const hasMarkers = youSaidRegex.test(text);
    
    if (hasMarkers) {
        // Reset regex (it's global and we already tested)
        const parts = text.split(/You said:\s*/gi);
        
        // Skip the first part (everything before first "You said:")
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i].trim();
            if (!part) continue;
            
            // Find "ChatGPT said:" marker
            const chatGptSaidIndex = part.search(/ChatGPT said:\s*/i);
            
            if (chatGptSaidIndex === -1) {
                // No ChatGPT response found, skip this turn
                console.warn("[saveChatManually] No 'ChatGPT said:' found for turn", i);
                continue;
            }
            
            const prompt = part.substring(0, chatGptSaidIndex).trim();
            const responsePart = part.substring(chatGptSaidIndex);
            
            // Extract response (remove "ChatGPT said:" prefix)
            const responseMatch = responsePart.match(/ChatGPT said:\s*(.*)/is);
            if (!responseMatch) {
                console.warn("[saveChatManually] Could not extract response for turn", i);
                continue;
            }
            
            let response = responseMatch[1].trim();
            
            // Remove next "You said:" if it exists in the response
            const nextYouSaidIndex = response.search(/You said:\s*/i);
            if (nextYouSaidIndex !== -1) {
                response = response.substring(0, nextYouSaidIndex).trim();
            }
            
            if (prompt && response) {
                turns.push({ prompt, response });
            } else {
                console.warn("[saveChatManually] Empty prompt or response for turn", i);
            }
        }
        
        if (turns.length > 0) {
            return turns;
        }
    }
    
    // Format 2: Plain alternating messages (user, ChatGPT, user, ChatGPT, ...)
    // Split by double newlines (common separator) or single newlines if double doesn't work
    let messages: string[] = [];
    
    // Try splitting by double newlines first
    if (text.includes("\n\n")) {
        messages = text.split(/\n\n+/).map(m => m.trim()).filter(m => m.length > 0);
    } else {
        // Fall back to single newlines
        messages = text.split(/\n+/).map(m => m.trim()).filter(m => m.length > 0);
    }
    
    // If we have messages, pair them up (first is user, second is ChatGPT, etc.)
    if (messages.length >= 2) {
        for (let i = 0; i < messages.length - 1; i += 2) {
            const prompt = messages[i].trim();
            const response = messages[i + 1].trim();
            
            if (prompt && response) {
                turns.push({ prompt, response });
            }
        }
        
        // If we have an odd number of messages, the last one might be incomplete
        // We could either skip it or pair it with an empty response
        // For now, we'll skip it to avoid incomplete turns
        if (messages.length % 2 === 1 && messages.length > 2) {
            console.warn("[saveChatManually] Odd number of messages, last message may be incomplete");
        }
    }
    
    return turns;
}

/**
 * Generate default title with timestamp
 */
function generateDefaultTitle(): string {
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    return `manual save ${timestamp}`;
}

/**
 * Save a manually pasted chat to the database with embedding
 */
export async function saveChatManually(
    params: SaveChatManuallyParams
): Promise<SaveChatManuallyResult> {
    const { userId, htmlContent, title } = params;

    console.log("[saveChatManually] Saving manual chat - userId:", userId, "hasTitle:", !!title);

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!htmlContent || !htmlContent.trim()) {
            throw new Error("htmlContent is required");
        }

        // Parse the content to extract turns
        console.log("[saveChatManually] Parsing content...");
        const turns = parseChatContent(htmlContent);
        
        if (turns.length === 0) {
            throw new Error(
                "Could not parse any chat turns from the content. " +
                "Please ensure the content is in one of these formats:\n" +
                "1. With markers: 'You said: ... ChatGPT said: ...'\n" +
                "2. Plain alternating: user message, ChatGPT response, user message, etc."
            );
        }

        console.log("[saveChatManually] Parsed", turns.length, "turns");

        // Use provided title or generate default
        const finalTitle = title?.trim() || generateDefaultTitle();
        console.log("[saveChatManually] Using title:", finalTitle);

        // Idempotency check: if same chat already exists, return existing ID
        // This prevents duplicates from retries, double-clicks, etc.
        console.log("[saveChatManually] Checking for existing chat (idempotency)...");
        const existingId = await checkForExistingChat(userId, finalTitle, turns);
        if (existingId) {
            console.log("[saveChatManually] Existing chat found, returning existing chat ID:", existingId);
            return {
                chatId: existingId,
                saved: false, // Not newly saved, but operation is idempotent
                turnsCount: turns.length,
            };
        }

        // Combine all prompts and responses into a single text
        const chatText = combineChatText(turns);
        console.log("[saveChatManually] Combined chat text length:", chatText.length, "chars");

        // Generate embedding for the entire chat
        console.log("[saveChatManually] Generating embedding...");
        const embedding = await generateEmbedding(chatText);
        console.log("[saveChatManually] Embedding generated, dimensions:", embedding.length);

        // Save to database
        console.log("[saveChatManually] Inserting chat into database...");
        const [savedChat] = await db
            .insert(chats)
            .values({
                userId,
                title: finalTitle,
                turns,
                embedding,
            })
            .returning({ id: chats.id });

        if (!savedChat) {
            throw new Error("Failed to save chat - no ID returned");
        }

        console.log("[saveChatManually] Chat saved successfully - id:", savedChat.id);

        return {
            chatId: savedChat.id,
            saved: true,
            turnsCount: turns.length,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[saveChatManually] Error saving chat:", errorMessage);
        throw error;
    }
}


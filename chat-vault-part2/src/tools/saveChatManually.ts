/**
 * saveChatManually tool implementation
 * Parses HTML/text content from ChatGPT copy/paste and saves as structured chat
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generateEmbedding, combineChatText } from "../utils/embeddings.js";
import type { UserContext } from "../server.js";
import { ANON_CHAT_EXPIRY_DAYS, ANON_MAX_CHATS } from "../server.js";

export interface SaveChatManuallyParams {
    userId: string;
    htmlContent: string;
    title?: string;
    userContext?: UserContext; // User context from Findexar headers
}

export interface SaveChatManuallyResult {
    chatId: string;
    saved: boolean;
    turnsCount: number;
    error?: "limit_reached" | "parse_error" | "server_error";
    message?: string;
    portalLink?: string | null;
}

/**
 * Count non-expired chats for anonymous users
 */
async function countNonExpiredChats(userId: string): Promise<number> {
    const allChats = await db
        .select({ timestamp: chats.timestamp })
        .from(chats)
        .where(eq(chats.userId, userId));

    const now = new Date();
    const expiryDate = new Date(now.getTime() - ANON_CHAT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    return allChats.filter((chat) => {
        const chatDate = new Date(chat.timestamp);
        return chatDate >= expiryDate;
    }).length;
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
 * Expected format: "You said:" followed by prompt, "ChatGPT said:" followed by response
 */
function parseChatContent(content: string): Array<{ prompt: string; response: string }> {
    const turns: Array<{ prompt: string; response: string }> = [];

    // Remove HTML tags if present (simple strip)
    let text = content.replace(/<[^>]*>/g, "").trim();

    // Split by "You said:" markers
    const youSaidRegex = /You said:\s*/gi;
    const parts = text.split(youSaidRegex);

    // Skip the first part (everything before first "You said:")
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;

        // Find "ChatGPT said:" or "AI said:" marker (ChatGPT copy uses "ChatGPT said:", widget copy uses "AI said:")
        const chatGptSaidIndex = part.search(/ChatGPT said:\s*/i);
        const aiSaidIndex = part.search(/AI said:\s*/i);

        let saidIndex = -1;
        let saidPattern = "";

        if (chatGptSaidIndex !== -1 && aiSaidIndex !== -1) {
            // Both found, use whichever comes first
            saidIndex = chatGptSaidIndex < aiSaidIndex ? chatGptSaidIndex : aiSaidIndex;
            saidPattern = chatGptSaidIndex < aiSaidIndex ? "ChatGPT said:" : "AI said:";
        } else if (chatGptSaidIndex !== -1) {
            saidIndex = chatGptSaidIndex;
            saidPattern = "ChatGPT said:";
        } else if (aiSaidIndex !== -1) {
            saidIndex = aiSaidIndex;
            saidPattern = "AI said:";
        }

        if (saidIndex === -1) {
            // No response marker found, skip this turn
            console.warn("[saveChatManually] No 'ChatGPT said:' or 'AI said:' found for turn", i, "part preview:", part.substring(0, 200));
            continue;
        }

        const prompt = part.substring(0, saidIndex).trim();
        const responsePart = part.substring(saidIndex);

        // Extract response (remove "ChatGPT said:" or "AI said:" prefix)
        const responseMatch = responsePart.match(new RegExp(`${saidPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.*)`, 'is'));
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
    const { userId, htmlContent, title, userContext } = params;
    const isAnon = userContext?.isAnon ?? false;
    const portalLink = userContext?.portalLink ?? null;

    console.log("[saveChatManually] Saving manual chat - userId:", userId, "hasTitle:", !!title, "isAnon:", isAnon);

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!htmlContent || !htmlContent.trim()) {
            throw new Error("htmlContent is required");
        }

        // Check chat limit for anonymous users only (normal users are not affected)
        if (isAnon) {
            const nonExpiredCount = await countNonExpiredChats(userId);
            console.log("[saveChatManually] Anonymous user - non-expired chats:", nonExpiredCount, "limit:", ANON_MAX_CHATS);

            if (nonExpiredCount >= ANON_MAX_CHATS) {
                const message = `You've reached the limit of ${ANON_MAX_CHATS} free chats. Please delete a chat in the widget to save more, or upgrade your account to save unlimited chats.`;
                console.log("[saveChatManually] Limit reached for anonymous user");
                return {
                    chatId: "",
                    saved: false,
                    turnsCount: 0,
                    error: "limit_reached",
                    message,
                    portalLink,
                };
            }
        }

        // Parse the content to extract turns
        console.log("[saveChatManually] Parsing content...");
        console.log("[saveChatManually] Content preview (first 500 chars):", htmlContent.substring(0, 500));
        const turns = parseChatContent(htmlContent);
        console.log("[saveChatManually] Parsed turns count:", turns.length);
        if (turns.length > 0) {
            console.log("[saveChatManually] First turn preview:", {
                prompt: turns[0].prompt.substring(0, 100),
                response: turns[0].response.substring(0, 100)
            });
        }

        if (turns.length === 0) {
            const message = "Can't parse the chat";
            console.log("[saveChatManually] Failed to parse content, returning error response");
            return {
                chatId: "",
                saved: false,
                turnsCount: 0,
                error: "parse_error",
                message,
                portalLink: null,
            };
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
        console.error("[saveChatManually] Error stack:", error instanceof Error ? error.stack : "N/A");
        // Return structured error instead of throwing
        return {
            chatId: "",
            saved: false,
            turnsCount: 0,
            error: "server_error",
            message: "An error occurred while saving the chat. Please try again.",
            portalLink: null,
        };
    }
}


/**
 * saveChatManually tool implementation
 * Parses HTML/text content from ChatGPT copy/paste and saves as structured chat
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
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
                "Please ensure the content follows the format: 'You said: ... ChatGPT said: ...'"
            );
        }

        console.log("[saveChatManually] Parsed", turns.length, "turns");

        // Use provided title or generate default
        const finalTitle = title?.trim() || generateDefaultTitle();
        console.log("[saveChatManually] Using title:", finalTitle);

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


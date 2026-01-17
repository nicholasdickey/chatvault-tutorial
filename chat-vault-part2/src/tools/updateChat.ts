/**
 * updateChat tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { generateEmbedding, combineChatText } from "../utils/embeddings.js";

export interface UpdateChatParams {
    chatId: string;
    userId: string;
    chat: {
        title?: string;
        turns?: Array<{ prompt: string; response: string }>;
    };
}

export interface UpdateChatResult {
    updated: boolean;
    chatId: string;
    title?: string;
    turns?: Array<{ prompt: string; response: string }>;
    message: string;
}

/**
 * Update a chat by ID, verifying it belongs to the user
 * Supports updating title and/or turns
 * When turns are updated, embeddings are regenerated
 */
export async function updateChat(params: UpdateChatParams): Promise<UpdateChatResult> {
    const { chatId, userId, chat } = params;

    console.log("[updateChat] Updating chat - chatId:", chatId, "userId:", userId, "hasTitle:", !!chat.title, "hasTurns:", !!chat.turns);

    try {
        // Validate required parameters
        if (!chatId) {
            throw new Error("chatId is required");
        }
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!chat || typeof chat !== "object") {
            throw new Error("chat object is required");
        }
        if (!chat.title && !chat.turns) {
            throw new Error("At least one of chat.title or chat.turns must be provided");
        }

        // Verify chat exists and belongs to user (security check)
        const existingChat = await db
            .select({ id: chats.id, title: chats.title, turns: chats.turns })
            .from(chats)
            .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
            .limit(1);

        if (existingChat.length === 0) {
            throw new Error("Chat not found or does not belong to user");
        }

        const currentChat = existingChat[0];
        const updateData: { title?: string; turns?: Array<{ prompt: string; response: string }>; embedding?: number[] } = {};

        // Validate and prepare title update
        if (chat.title !== undefined) {
            const title = String(chat.title).trim();
            if (title.length === 0) {
                throw new Error("Title cannot be empty");
            }
            if (title.length > 2048) {
                throw new Error("Title cannot exceed 2048 characters");
            }
            updateData.title = title;
        }

        // Validate and prepare turns update
        if (chat.turns !== undefined) {
            if (!Array.isArray(chat.turns)) {
                throw new Error("turns must be an array");
            }
            if (chat.turns.length === 0) {
                throw new Error("turns must be a non-empty array");
            }

            // Validate each turn structure
            for (let i = 0; i < chat.turns.length; i++) {
                const turn = chat.turns[i];
                if (!turn || typeof turn !== "object") {
                    throw new Error(`Turn ${i} must be an object`);
                }
                if (typeof turn.prompt !== "string" || typeof turn.response !== "string") {
                    throw new Error(`Turn ${i} must have prompt and response as strings`);
                }
            }

            updateData.turns = chat.turns;

            // Regenerate embedding when turns are updated
            console.log("[updateChat] Regenerating embedding for updated turns...");
            const chatText = combineChatText(chat.turns);
            console.log("[updateChat] Combined chat text length:", chatText.length, "chars");
            const embedding = await generateEmbedding(chatText);
            console.log("[updateChat] Embedding generated, dimensions:", embedding.length);
            updateData.embedding = embedding;
        }

        // Update the chat
        const updatedChats = await db
            .update(chats)
            .set(updateData)
            .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
            .returning({ id: chats.id, title: chats.title, turns: chats.turns });

        if (updatedChats.length === 0) {
            throw new Error("Failed to update chat");
        }

        const updatedChat = updatedChats[0];
        console.log("[updateChat] Chat updated successfully - id:", chatId);

        return {
            updated: true,
            chatId,
            title: updatedChat.title,
            turns: updatedChat.turns,
            message: "Chat updated successfully",
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[updateChat] Error updating chat:", errorMessage);

        // Handle UUID validation errors - convert to "Chat not found"
        if (errorMessage.includes("invalid input syntax for type uuid")) {
            throw new Error("Chat not found or does not belong to user");
        }

        throw error;
    }
}

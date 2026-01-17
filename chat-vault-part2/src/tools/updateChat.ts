/**
 * updateChat tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface UpdateChatParams {
    chatId: string;
    userId: string;
    chat: {
        title: string;
    };
}

export interface UpdateChatResult {
    updated: boolean;
    chatId: string;
    title: string;
    message: string;
}

/**
 * Update a chat by ID, verifying it belongs to the user
 */
export async function updateChat(params: UpdateChatParams): Promise<UpdateChatResult> {
    const { chatId, userId, chat } = params;

    console.log("[updateChat] Updating chat - chatId:", chatId, "userId:", userId, "title:", chat.title);

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
        if (chat.title === undefined || chat.title === null) {
            throw new Error("chat.title is required");
        }

        // Validate title
        const title = String(chat.title).trim();
        if (title.length === 0) {
            throw new Error("Title cannot be empty");
        }
        if (title.length > 2048) {
            throw new Error("Title cannot exceed 2048 characters");
        }

        // Verify chat exists and belongs to user (security check)
        const existingChat = await db
            .select({ id: chats.id })
            .from(chats)
            .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
            .limit(1);

        if (existingChat.length === 0) {
            throw new Error("Chat not found or does not belong to user");
        }

        // Update the chat
        const updatedChats = await db
            .update(chats)
            .set({ title })
            .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
            .returning({ id: chats.id, title: chats.title });

        if (updatedChats.length === 0) {
            throw new Error("Failed to update chat");
        }

        console.log("[updateChat] Chat updated successfully - id:", chatId, "new title:", title);

        return {
            updated: true,
            chatId,
            title: updatedChats[0].title,
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

/**
 * deleteChat tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface DeleteChatParams {
    chatId: string;
    userId: string;
}

export interface DeleteChatResult {
    deleted: boolean;
    chatId: string;
    message: string;
}

/**
 * Delete a chat by ID, verifying it belongs to the user
 */
export async function deleteChat(params: DeleteChatParams): Promise<DeleteChatResult> {
    const { chatId, userId } = params;

    console.log("[deleteChat] Deleting chat - chatId:", chatId, "userId:", userId);

    try {
        // Validate required parameters
        if (!chatId) {
            throw new Error("chatId is required");
        }
        if (!userId) {
            throw new Error("userId is required");
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

        // Delete the chat
        const deletedChats = await db
            .delete(chats)
            .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
            .returning({ id: chats.id });

        if (deletedChats.length === 0) {
            throw new Error("Failed to delete chat");
        }

        console.log("[deleteChat] Chat deleted successfully - id:", chatId);

        return {
            deleted: true,
            chatId,
            message: "Chat deleted successfully",
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[deleteChat] Error deleting chat:", errorMessage);
        throw error;
    }
}


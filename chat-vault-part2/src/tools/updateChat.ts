/**
 * updateChat tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { getMergedUserIdScopeForReads, chatsUserIdInScope } from "../user/userMerge.js";
import { generateEmbedding, combineChatText } from "../utils/embeddings.js";
import { setChatTopicsManual } from "../utils/setChatTopicsManual.js";
import type { TopicSummary } from "../tools/topicQueries.js";

export interface UpdateChatParams {
    chatId: string;
    userId: string;
    chat: {
        title?: string;
        turns?: Array<{ prompt: string; response: string }>;
        /** Full replacement list: topic UUIDs and/or display names */
        topics?: string[];
    };
}

export interface UpdateChatResult {
    updated: boolean;
    chatId: string;
    title?: string;
    turns?: Array<{ prompt: string; response: string }>;
    topics?: TopicSummary[];
    message: string;
}

/**
 * Update a chat by ID, verifying it belongs to the user
 * Supports updating title and/or turns
 * Supports updating title, turns, and/or topics (full topic set replacement).
 * When turns are updated, embeddings are regenerated.
 */
export async function updateChat(params: UpdateChatParams): Promise<UpdateChatResult> {
    const { chatId, userId, chat } = params;

    console.log(
        "[updateChat] Updating chat - chatId:",
        chatId,
        "userId:",
        userId,
        "hasTitle:",
        !!chat.title,
        "hasTurns:",
        !!chat.turns,
        "hasTopics:",
        chat.topics !== undefined,
    );

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
        if (!chat.title && !chat.turns && chat.topics === undefined) {
            throw new Error(
                "At least one of chat.title, chat.turns, or chat.topics must be provided",
            );
        }

        const userIdScope = await getMergedUserIdScopeForReads(userId);
        // Verify chat exists and belongs to user (security check)
        const existingChat = await db
            .select({ id: chats.id, title: chats.title, turns: chats.turns })
            .from(chats)
            .where(and(eq(chats.id, chatId), chatsUserIdInScope(userIdScope)))
            .limit(1);

        if (existingChat.length === 0) {
            throw new Error("Chat not found or does not belong to user");
        }

        const currentChat = existingChat[0];
        const updateData: {
            title?: string;
            turns?: Array<{ prompt: string; response: string }>;
            embedding?: number[];
        } = {};

        let updatedTopics: TopicSummary[] | undefined;

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

        if (chat.topics !== undefined) {
            if (!Array.isArray(chat.topics)) {
                throw new Error("topics must be an array");
            }
            updatedTopics = await setChatTopicsManual({
                userId,
                chatId,
                topicRefs: chat.topics.map(String),
            });
        }

        let updatedChat = currentChat;

        if (Object.keys(updateData).length > 0) {
            const updatedRows = await db
                .update(chats)
                .set(updateData)
                .where(and(eq(chats.id, chatId), chatsUserIdInScope(userIdScope)))
                .returning({ id: chats.id, title: chats.title, turns: chats.turns });

            if (updatedRows.length === 0) {
                throw new Error("Failed to update chat");
            }

            updatedChat = updatedRows[0]!;
        } else if (updatedTopics === undefined) {
            throw new Error("Failed to update chat");
        }

        console.log("[updateChat] Chat updated successfully - id:", chatId);

        return {
            updated: true,
            chatId,
            title: updatedChat.title,
            turns: updatedChat.turns,
            topics: updatedTopics,
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

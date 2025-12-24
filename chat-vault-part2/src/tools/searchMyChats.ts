/**
 * searchMyChats tool implementation - Vector similarity search
 */

import { performVectorSearch } from "./vectorSearch.js";

export interface SearchChatsParams {
    userId: string;
    query: string;
    page?: number; // 0-indexed, default 0
    size?: number; // default 10
}

export interface SearchChatsResult {
    chats: Array<{
        id: string;
        userId: string;
        title: string;
        timestamp: Date;
        turns: Array<{ prompt: string; response: string }>;
        similarity?: number; // Cosine similarity score (1 - distance)
    }>;
    search: {
        query: string;
    };
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasMore: boolean;
    };
}

/**
 * Perform vector similarity search on chat embeddings
 */
export async function searchMyChats(params: SearchChatsParams): Promise<SearchChatsResult> {
    const { userId, query, page = 0, size = 10 } = params;

    console.log(
        "[searchMyChats] Searching chats - userId:",
        userId,
        "query:",
        query.substring(0, 50) + "...",
        "page:",
        page,
        "size:",
        size
    );

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!query || query.trim().length === 0) {
            throw new Error("query is required and cannot be empty");
        }

        // Use shared vector search function
        const searchResult = await performVectorSearch({
            userId,
            query: query.trim(),
            page,
            size,
        });

        const result: SearchChatsResult = {
            chats: searchResult.chats,
            search: {
                query,
            },
            pagination: {
                page: searchResult.page,
                limit: searchResult.size,
                total: searchResult.total,
                totalPages: searchResult.totalPages,
                hasMore: searchResult.hasMore,
            },
        };

        console.log(
            "[searchMyChats] Returning",
            searchResult.chats.length,
            "chats for query:",
            query.substring(0, 30) + "...",
            "page",
            searchResult.page,
            "of",
            searchResult.totalPages
        );

        return result;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[searchMyChats] Error searching chats:", errorMessage);
        throw error;
    }
}


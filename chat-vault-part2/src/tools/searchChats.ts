/**
 * searchChats tool implementation - Vector similarity search
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, sql, and, isNotNull } from "drizzle-orm";
import { generateEmbedding } from "../utils/embeddings.js";

export interface SearchChatsParams {
    userId: string;
    query: string;
    limit?: number; // default 10
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
        limit: number;
        total: number;
    };
}

/**
 * Perform vector similarity search on chat embeddings
 */
export async function searchChats(params: SearchChatsParams): Promise<SearchChatsResult> {
    const { userId, query, limit = 10 } = params;

    console.log(
        "[searchChats] Searching chats - userId:",
        userId,
        "query:",
        query.substring(0, 50) + "...",
        "limit:",
        limit
    );

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!query || query.trim().length === 0) {
            throw new Error("query is required and cannot be empty");
        }

        // Validate limit
        const limitNum = Math.max(1, Math.min(100, Math.floor(limit))); // Limit between 1 and 100

        // Generate embedding for search query
        console.log("[searchChats] Generating embedding for search query...");
        const queryEmbedding = await generateEmbedding(query);
        console.log("[searchChats] Query embedding generated, dimensions:", queryEmbedding.length);

        // Convert embedding array to pgvector format string
        const embeddingString = `[${queryEmbedding.join(",")}]`;
        // Escape single quotes in userId to prevent SQL injection
        const safeUserId = userId.replace(/'/g, "''");

        // Perform vector similarity search using pgvector cosine distance operator (<=>)
        // We use 1 - distance to get similarity (higher is better)
        // Only search chats that:
        // 1. Belong to the specified userId
        // 2. Have non-null embeddings
        console.log("[searchChats] Performing vector similarity search...");

        // Use sql.raw with proper escaping for the vector search
        // Note: For production, consider using a prepared statement or parameterized query
        const searchResults = await db.execute(
            sql.raw(`
        SELECT 
          id,
          user_id,
          title,
          timestamp,
          turns,
          1 - (embedding <=> '${embeddingString}'::vector) as similarity
        FROM chats
        WHERE user_id = '${safeUserId}'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> '${embeddingString}'::vector
        LIMIT ${limitNum}
      `)
        );

        console.log("[searchChats] Found", searchResults.length, "matching chats");

        // Get total count of chats with embeddings for this user (for metadata)
        const totalResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(chats)
            .where(and(eq(chats.userId, userId), isNotNull(chats.embedding)));

        const total = Number(totalResult[0]?.count ?? 0);

        // Format results
        const formattedChats = searchResults.map((row: any) => ({
            id: row.id,
            userId: row.user_id,
            title: row.title,
            timestamp: row.timestamp,
            turns: row.turns,
            similarity: row.similarity ? Number(row.similarity) : undefined,
        }));

        const result: SearchChatsResult = {
            chats: formattedChats,
            search: {
                query,
                limit: limitNum,
                total,
            },
        };

        console.log(
            "[searchChats] Returning",
            formattedChats.length,
            "chats for query:",
            query.substring(0, 30) + "..."
        );

        return result;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[searchChats] Error searching chats:", errorMessage);
        throw error;
    }
}


/**
 * Shared vector search functionality for loadMyChats and searchMyChats
 */

import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "../utils/embeddings.js";

/**
 * Deduplicate chats by keeping only the most recent one for each unique (userId, title, turns) combination
 * This ensures pagination works correctly by removing duplicates before pagination calculations
 */
function deduplicateChats<T extends { userId: string; title: string; turns: Array<{ prompt: string; response: string }>; timestamp: Date }>(
    chatList: T[]
): T[] {
    const seen = new Map<string, T>();

    for (const chat of chatList) {
        // Create a signature based on userId, title, and turns
        const signature = `${chat.userId}|${chat.title}|${JSON.stringify(chat.turns)}`;

        if (!seen.has(signature)) {
            seen.set(signature, chat);
        } else {
            // If we've seen this before, keep the one with the latest timestamp
            const existing = seen.get(signature)!;
            const existingTime = new Date(existing.timestamp).getTime();
            const currentTime = new Date(chat.timestamp).getTime();

            if (currentTime > existingTime) {
                seen.set(signature, chat);
            }
        }
    }

    return Array.from(seen.values());
}

export interface VectorSearchParams {
    userId: string;
    query: string;
    page: number; // 0-indexed
    size: number;
}

export interface VectorSearchResult {
    chats: Array<{
        id: string;
        userId: string;
        title: string;
        timestamp: Date;
        turns: Array<{ prompt: string; response: string }>;
        similarity?: number; // Cosine similarity score (1 - distance)
    }>;
    total: number;
    page: number;
    size: number;
    totalPages: number;
    hasMore: boolean;
}

/**
 * Perform vector similarity search on chat embeddings
 */
export async function performVectorSearch(
    params: VectorSearchParams
): Promise<VectorSearchResult> {
    const { userId, query, page, size } = params;

    console.log(
        "[vectorSearch] Performing vector search - userId:",
        userId,
        "query:",
        query.substring(0, 50) + "...",
        "page:",
        page,
        "size:",
        size
    );

    // Validate pagination parameters
    const pageNum = Math.max(0, Math.floor(page)); // Ensure page is at least 0
    const sizeNum = Math.max(1, Math.min(100, Math.floor(size))); // Size between 1 and 100

    // Calculate offset (0-indexed page to SQL offset)
    const offset = pageNum * sizeNum;

    // Generate embedding for search query
    console.log("[vectorSearch] Generating embedding for search query...");
    const queryEmbedding = await generateEmbedding(query);
    console.log("[vectorSearch] Query embedding generated, dimensions:", queryEmbedding.length);

    // Convert embedding array to pgvector format string
    const embeddingString = `[${queryEmbedding.join(",")}]`;
    // Escape single quotes in userId to prevent SQL injection
    const safeUserId = userId.replace(/'/g, "''");

    // Perform vector similarity search using pgvector cosine distance operator (<=>)
    // We use 1 - distance to get similarity (higher is better)
    // Only search chats that:
    // 1. Belong to the specified userId
    // 2. Have non-null embeddings
    console.log("[vectorSearch] Performing vector similarity search...");

    // Minimum similarity threshold to filter out low-relevance results
    // Cosine similarity ranges from -1 to 1, but for embeddings it's typically 0 to 1
    // A threshold of 0.2 filters out low-relevance matches, keeping moderately to highly relevant results
    const minSimilarity = 0.2;

    // Fetch all matching results (we need to deduplicate before pagination)
    // We'll fetch more than needed to account for deduplication, but cap it reasonably
    const maxFetch = Math.min(1000, sizeNum * 10); // Fetch up to 10x the page size, max 1000
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
        AND 1 - (embedding <=> '${embeddingString}'::vector) >= ${minSimilarity}
      ORDER BY embedding <=> '${embeddingString}'::vector
      LIMIT ${maxFetch}
    `)
    );

    console.log("[vectorSearch] Found", searchResults.length, "matching chats before deduplication");

    // Format results
    const formattedChats = searchResults.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        timestamp: row.timestamp,
        turns: row.turns,
        similarity: row.similarity ? Number(row.similarity) : undefined,
    }));

    // Deduplicate chats (keep most recent for each unique title+turns combination)
    const deduplicatedChats = deduplicateChats(formattedChats);
    console.log("[vectorSearch] After deduplication:", deduplicatedChats.length, "unique chats");

    // Apply pagination to deduplicated results
    const total = deduplicatedChats.length;
    const paginatedChats = deduplicatedChats.slice(offset, offset + sizeNum);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / sizeNum);
    const hasMore = pageNum + 1 < totalPages;

    return {
        chats: paginatedChats,
        total,
        page: pageNum,
        size: sizeNum,
        totalPages,
        hasMore,
    };
}


/**
 * Shared vector search functionality for loadChats and searchChats
 */

import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "../utils/embeddings.js";

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
    // A threshold of 0.3 filters out low-relevance matches, keeping only highly relevant results
    const minSimilarity = 0.3;

    // First, get total count of matching results above threshold
    const countQuery = sql.raw(`
      SELECT COUNT(*) as total
      FROM chats
      WHERE user_id = '${safeUserId}'
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> '${embeddingString}'::vector) >= ${minSimilarity}
    `);
    const countResult = await db.execute(countQuery);
    const total = Number((countResult[0] as any)?.total ?? 0);
    console.log("[vectorSearch] Total matching chats (similarity >= " + minSimilarity + "):", total);

    // Perform vector similarity search with pagination and similarity threshold
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
      LIMIT ${sizeNum}
      OFFSET ${offset}
    `)
    );

    console.log("[vectorSearch] Found", searchResults.length, "matching chats on page", pageNum);

    // Format results
    const formattedChats = searchResults.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        title: row.title,
        timestamp: row.timestamp,
        turns: row.turns,
        similarity: row.similarity ? Number(row.similarity) : undefined,
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / sizeNum);
    const hasMore = pageNum + 1 < totalPages;

    return {
        chats: formattedChats,
        total,
        page: pageNum,
        size: sizeNum,
        totalPages,
        hasMore,
    };
}


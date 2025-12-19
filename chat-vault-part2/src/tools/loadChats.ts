/**
 * loadChats tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, desc, count } from "drizzle-orm";
import { performVectorSearch } from "./vectorSearch.js";

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

export interface LoadChatsParams {
  userId: string;
  page?: number; // 0-indexed, default 0
  size?: number; // default 10
  query?: string; // Optional search query - when provided, uses vector similarity search (same as searchChats)
}

export interface LoadChatsResult {
  chats: Array<{
    id: string;
    userId: string;
    title: string;
    timestamp: Date;
    turns: Array<{ prompt: string; response: string }>;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Load paginated chats for a user
 */
export async function loadChats(params: LoadChatsParams): Promise<LoadChatsResult> {
  const { userId, page = 0, size = 10, query } = params;

  console.log(
    "[loadChats] Loading chats - userId:",
    userId,
    "page:",
    page,
    "size:",
    size,
    "query:",
    query || "none"
  );

  try {
    // Validate required parameters
    if (!userId) {
      throw new Error("userId is required");
    }

    // Validate pagination parameters
    const pageNum = Math.max(0, Math.floor(page)); // Ensure page is at least 0
    const sizeNum = Math.max(1, Math.min(100, Math.floor(size))); // Size between 1 and 100

    // Calculate offset (0-indexed page to SQL offset)
    const offset = pageNum * sizeNum;

    // If query is provided, use vector search (same as searchChats)
    const searchQuery = query?.trim();
    if (searchQuery) {
      console.log("[loadChats] Using vector search for query");
      const searchResult = await performVectorSearch({
        userId,
        query: searchQuery,
        page: pageNum,
        size: sizeNum,
      });

      const result: LoadChatsResult = {
        chats: searchResult.chats,
        pagination: {
          page: searchResult.page,
          limit: searchResult.size,
          total: searchResult.total,
          totalPages: searchResult.totalPages,
          hasMore: searchResult.hasMore,
        },
      };

      return result;
    }

    // No query - load chats by timestamp (original behavior)
    // Fetch all chats for the user (we need to deduplicate before pagination)
    console.log("[loadChats] Fetching all chats for user:", userId);
    const allChatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.timestamp));

    console.log("[loadChats] Retrieved", allChatResults.length, "chats before deduplication");

    // Deduplicate chats (keep most recent for each unique title+turns combination)
    const deduplicatedChats = deduplicateChats(allChatResults);
    console.log("[loadChats] After deduplication:", deduplicatedChats.length, "unique chats");

    // Apply pagination to deduplicated results
    const total = deduplicatedChats.length;
    const paginatedChats = deduplicatedChats.slice(offset, offset + sizeNum);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / sizeNum);
    const hasMore = pageNum + 1 < totalPages;

    // Format response (exclude embedding from response)
    const formattedChats = paginatedChats.map((chat) => ({
      id: chat.id,
      userId: chat.userId,
      title: chat.title,
      timestamp: chat.timestamp,
      turns: chat.turns,
    }));

    const result: LoadChatsResult = {
      chats: formattedChats,
      pagination: {
        page: pageNum,
        limit: sizeNum,
        total,
        totalPages,
        hasMore,
      },
    };

    console.log(
      "[loadChats] Returning",
      formattedChats.length,
      "chats, page",
      pageNum,
      "of",
      totalPages
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[loadChats] Error loading chats:", errorMessage);
    throw error;
  }
}


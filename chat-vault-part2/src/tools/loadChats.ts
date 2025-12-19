/**
 * loadChats tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, desc, count } from "drizzle-orm";
import { performVectorSearch } from "./vectorSearch.js";

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
    // Get total count
    console.log("[loadChats] Counting total chats for user:", userId);
    const totalResult = await db
      .select({ count: count() })
      .from(chats)
      .where(eq(chats.userId, userId));

    const total = totalResult[0]?.count ?? 0;
    console.log("[loadChats] Total chats found:", total);

    // Query chats with pagination
    console.log("[loadChats] Querying chats with offset:", offset, "size:", sizeNum);
    const chatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.timestamp))
      .limit(sizeNum)
      .offset(offset);

    console.log("[loadChats] Retrieved", chatResults.length, "chats");

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / sizeNum);
    const hasMore = pageNum + 1 < totalPages;

    // Format response (exclude embedding from response)
    const formattedChats = chatResults.map((chat) => ({
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


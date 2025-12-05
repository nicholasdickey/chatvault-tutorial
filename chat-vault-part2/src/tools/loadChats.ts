/**
 * loadChats tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, desc, count } from "drizzle-orm";

export interface LoadChatsParams {
  userId: string;
  page?: number; // 1-indexed, default 1
  limit?: number; // default 10
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
  const { userId, page = 1, limit = 10 } = params;

  console.log(
    "[loadChats] Loading chats - userId:",
    userId,
    "page:",
    page,
    "limit:",
    limit
  );

  try {
    // Validate required parameters
    if (!userId) {
      throw new Error("userId is required");
    }

    // Validate pagination parameters
    const pageNum = Math.max(1, Math.floor(page)); // Ensure page is at least 1
    const limitNum = Math.max(1, Math.min(100, Math.floor(limit))); // Limit between 1 and 100

    // Calculate offset (1-indexed to 0-indexed for SQL)
    const offset = (pageNum - 1) * limitNum;

    // Get total count
    console.log("[loadChats] Counting total chats for user:", userId);
    const totalResult = await db
      .select({ count: count() })
      .from(chats)
      .where(eq(chats.userId, userId));

    const total = totalResult[0]?.count ?? 0;
    console.log("[loadChats] Total chats found:", total);

    // Query chats with pagination
    console.log("[loadChats] Querying chats with offset:", offset, "limit:", limitNum);
    const chatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.timestamp))
      .limit(limitNum)
      .offset(offset);

    console.log("[loadChats] Retrieved", chatResults.length, "chats");

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limitNum);
    const hasMore = pageNum < totalPages;

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
        limit: limitNum,
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


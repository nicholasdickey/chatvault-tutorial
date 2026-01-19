/**
 * loadMyChats tool implementation
 */

import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq, desc, count } from "drizzle-orm";
import { performVectorSearch } from "./vectorSearch.js";
import type { UserContext } from "../server.js";
import { ANON_CHAT_EXPIRY_DAYS, ANON_MAX_CHATS } from "../server.js";
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
  query?: string; // Optional search query - when provided, uses vector similarity search (same as searchMyChats)
  widgetVersion?: string; // Widget version (optional, for tracking which widget version is calling)
  userContext?: UserContext; // User context from Findexar headers
  headers?: Record<string, string | string[] | undefined>; // All request headers for logging
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
  userInfo: {
    portalLink: string | null;
    loginLink: string | null;
    isAnon: boolean;
    isAnonymousPlan?: boolean; // True if user is on an anonymous (free/limited) subscription plan
    totalChats: number;
    remainingSlots?: number;
    userName?: string | null;
    message?: string | null; // Optional message to display at bottom of widget (supports markdown)
    messageType?: 'alert' | 'normal' | 'success' | 'error'; // Message type for styling
  };
  content?: {
    helpText: string;
    subTitle?: string;
    limits: {
      counterTooltip: string;
      limitReachedTooltip: string;
      limitReachedMessageWithPortal: string;
      limitReachedMessageWithoutPortal: string;
    };
    config: {
      freeChatLimit: number;
      chatExpirationDays: number;
    };
  };
}

/**
 * Filter out expired chats for anonymous users (older than ANON_CHAT_EXPIRY_DAYS)
 */
function filterExpiredChats<T extends { timestamp: Date }>(
  chatList: T[],
  isAnon: boolean
): T[] {
  if (!isAnon) {
    return chatList; // Normal users see all chats
  }

  const now = new Date();
  const expiryDate = new Date(now.getTime() - ANON_CHAT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return chatList.filter((chat) => {
    const chatDate = new Date(chat.timestamp);
    return chatDate >= expiryDate;
  });
}

/**
 * Load paginated chats for a user
 */
export async function loadMyChats(params: LoadChatsParams): Promise<LoadChatsResult> {
  let { userId, page = 0, size = 10, query, widgetVersion, userContext, headers } = params;
  const isAnon = userContext?.isAnon ?? false;
  const isAnonymousPlan = userContext?.isAnonymousPlan;
  const portalLink = userContext?.portalLink ?? null;
  const loginLink = userContext?.loginLink ?? null;

  // Extract userName from x-a6-username header
  let userName: string | null = null;
  if (headers) {
    const userNameHeader = headers['x-a6-username'];
    if (userNameHeader) {
      userName = Array.isArray(userNameHeader) ? userNameHeader[0] : userNameHeader;
    }
    // Dump all headers to log
    console.log("[loadMyChats] All request headers:", JSON.stringify(headers, null, 2));
  }
  if (!widgetVersion) {
    widgetVersion = "1.0.0";
  }
  console.log("[loadMyChats] Widget version:", widgetVersion);
  console.log(
    "[loadMyChats] Loading chats - userId:",
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
    const contentMetadata = {
      helpText: '',
      subTitle: `If your AI chatbot is having trouble saving a chat into the vault, you can copy the chat manually and either paste it into your chatbot, asking it to parse and save the chat turn-by-turn into the vault, or use the manual chat save.`,

      limits: {
        counterTooltip: "Click to learn about chat limits",
        limitReachedTooltip: "Chat limit reached - delete a chat or upgrade",
        limitReachedMessageWithPortal: "You've reached the limit of {maxChats} free chats. Delete a chat to add more, or upgrade your account to save unlimited chats.",
        limitReachedMessageWithoutPortal: "You've reached the limit of {maxChats} free chats. Please delete a chat to add more.",
      },
      config: {
        freeChatLimit: 10,
        chatExpirationDays: 7,
      },
    };
    // Validate pagination parameters
    const pageNum = Math.max(0, Math.floor(page)); // Ensure page is at least 0
    const sizeNum = Math.max(1, Math.min(100, Math.floor(size))); // Size between 1 and 100

    // Calculate offset (0-indexed page to SQL offset)
    const offset = pageNum * sizeNum;

    // If query is provided, use vector search (same as searchMyChats)
    const searchQuery = query?.trim();
    if (searchQuery) {
      console.log("[loadMyChats] Using vector search for query");
      const searchResult = await performVectorSearch({
        userId,
        query: searchQuery,
        page: pageNum,
        size: sizeNum,
      });

      // Get total chat count for user (before filtering) for userInfo
      const allChatsForUser = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, userId));
      const totalChats = allChatsForUser.length;

      // Filter expired chats for anonymous users
      const filteredChats = filterExpiredChats(searchResult.chats, isAnon);
      const filteredTotal = isAnon
        ? filterExpiredChats(allChatsForUser, isAnon).length
        : searchResult.total;

      // Recalculate pagination after filtering
      const filteredTotalPages = Math.ceil(filteredTotal / sizeNum);
      const filteredHasMore = pageNum + 1 < filteredTotalPages;
      const filteredOffset = pageNum * sizeNum;
      const paginatedFilteredChats = filteredChats.slice(filteredOffset, filteredOffset + sizeNum);
      console.log("[loadMyChats] remaining slots:", Math.max(0, ANON_MAX_CHATS - totalChats));


      const result: LoadChatsResult = {
        chats: paginatedFilteredChats,
        pagination: {
          page: searchResult.page,
          limit: searchResult.size,
          total: filteredTotal,
          totalPages: filteredTotalPages,
          hasMore: filteredHasMore,
        },
        userInfo: {
          portalLink,
          loginLink,
          isAnon,
          ...(isAnonymousPlan !== undefined && { isAnonymousPlan }),
          totalChats,
          userName,
          ...(isAnonymousPlan !== undefined && { remainingSlots: Math.max(0, ANON_MAX_CHATS - totalChats) }),
        },
        //content: contentMetadata,

      };

      return result;
    }

    // No query - load chats by timestamp (original behavior)
    // Fetch all chats for the user (we need to deduplicate before pagination)
    console.log("[loadMyChats] Fetching all chats for user:", userId);
    const allChatResults = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.timestamp));

    console.log("[loadMyChats] Retrieved", allChatResults.length, "chats before deduplication");
    const totalChats = allChatResults.length;

    // Deduplicate chats (keep most recent for each unique title+turns combination)
    const deduplicatedChats = deduplicateChats(allChatResults);
    console.log("[loadMyChats] After deduplication:", deduplicatedChats.length, "unique chats");

    // Filter expired chats for anonymous users
    const nonExpiredChats = filterExpiredChats(deduplicatedChats, isAnon);
    const totalBeforeFilter = deduplicatedChats.length;
    const total = isAnon ? nonExpiredChats.length : totalBeforeFilter;
    console.log(
      "[loadMyChats] After expiration filter:",
      total,
      "chats",
      isAnon ? `(filtered from ${totalBeforeFilter})` : ""
    );

    // Apply pagination to filtered results
    const paginatedChats = nonExpiredChats.slice(offset, offset + sizeNum);

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
      userInfo: {
        portalLink,
        loginLink,
        isAnon,
        ...(isAnonymousPlan !== undefined && { isAnonymousPlan }),
        totalChats,
        userName,
        ...(isAnonymousPlan !== undefined && { remainingSlots: Math.max(0, ANON_MAX_CHATS - totalChats) }),
        //message: "This is a **test message** with markdown. Check out [OpenAI](https://openai.com) and [ChatGPT](https://chat.openai.com) for more info.", // TODO: Replace with dynamic message logic
        //messageType: widgetVersion === "1.0.0" ? "normal" : "success",
      },
      content: contentMetadata,
    };

    console.log(
      "[loadMyChats] Returning",
      formattedChats.length,
      "chats, page",
      pageNum,
      "of",
      totalPages
    );

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[loadMyChats] Error loading chats:", errorMessage);
    throw error;
  }
}


/**
 * widgetAdd tool implementation
 * Saves pasted HTML/text content as structured chat.
 * Async path: pushes raw htmlContent to queue; mcp-worker parses with LLM.
 * Sync path: parses with LLM in-process, then saveChatCore.
 * WIDGET-ONLY: This tool is only for use within the widget UI, not for LLM calls
 */

import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { chats } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { pushChatSaveJob, isRedisConfigured, getRedisConfigStatus } from "../utils/redis.js";
import { saveChatCore } from "../utils/saveChatCore.js";
import { parsePastedChatWithLLM } from "../utils/parsePastedChatWithLLM.js";
import type { UserContext } from "../server.js";
import { ANON_CHAT_EXPIRY_DAYS, ANON_MAX_CHATS } from "../server.js";

export interface WidgetAddParams {
    userId: string;
    htmlContent: string;
    title?: string;
    widgetVersion?: string; // Widget version (optional, for tracking which widget version is calling)
    userContext?: UserContext; // User context from Findexar headers
}

export interface WidgetAddResult {
    jobId?: string;
    chatId?: string;
    turnsCount: number;
    error?: "limit_reached" | "parse_error" | "server_error";
    message?: string;
    portalLink?: string | null;
}

/**
 * Count non-expired chats for anonymous users
 */
async function countNonExpiredChats(userId: string): Promise<number> {
    const allChats = await db
        .select({ timestamp: chats.timestamp })
        .from(chats)
        .where(eq(chats.userId, userId));

    const now = new Date();
    const expiryDate = new Date(now.getTime() - ANON_CHAT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    return allChats.filter((chat) => {
        const chatDate = new Date(chat.timestamp);
        return chatDate >= expiryDate;
    }).length;
}

/**
 * Generate default title with timestamp
 */
function generateDefaultTitle(): string {
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    return `manual save ${timestamp}`;
}

/**
 * Save a manually pasted chat to the database with embedding
 * WIDGET-ONLY: This function is only for use within the widget UI
 */
export async function widgetAdd(
    params: WidgetAddParams
): Promise<WidgetAddResult> {
    const { userId, htmlContent, title, userContext } = params;
    const isAnon = userContext?.isAnon ?? false;
    const isAnonymousPlan = userContext?.isAnonymousPlan;
    const portalLink = userContext?.portalLink ?? null;

    console.log("[widgetAdd] ===== ENTRY =====");
    console.log("[widgetAdd] Received params:", {
        userId: userId?.substring(0, 20) + "...",
        htmlContentLength: htmlContent?.length || 0,
        htmlContentPreview: htmlContent?.substring(0, 200) || "(empty)",
        title: title || "(none)",
        isAnon,
        hasPortalLink: !!portalLink,
        hasLoginLink: !!userContext?.loginLink,
    });
    console.log("[widgetAdd] Saving manual chat - userId:", userId, "hasTitle:", !!title, "isAnon:", isAnon);

    try {
        // Validate required parameters
        if (!userId) {
            throw new Error("userId is required");
        }
        if (!htmlContent || !htmlContent.trim()) {
            throw new Error("htmlContent is required");
        }

        // Content size check: anonymous/free plan 20k, authenticated paid 1M
        const contentLength = htmlContent.length;
        const isFreePlan = isAnon || isAnonymousPlan === true;
        const maxLength = isFreePlan ? 20000 : 1000000;
        if (contentLength > maxLength) {
            const limitType = isFreePlan ? "20,000 characters" : "1,000,000 characters";
            const message = isFreePlan
                ? `Content exceeds the ${limitType} limit for users on the free plan. Please shorten your content or sign in to save longer chats and notes (up to 1,000,000 characters).`
                : `Content exceeds the ${limitType} limit. Please shorten your content.`;
            console.log("[widgetAdd] ❌ Content size limit exceeded:", { contentLength, maxLength });
            return {
                turnsCount: 0,
                error: "limit_reached" as const,
                message,
                portalLink: isAnon ? portalLink : null,
            };
        }

        // Check chat limit for anonymous users only
        if (isAnon) {
            const nonExpiredCount = await countNonExpiredChats(userId);
            console.log("[widgetAdd] Anonymous user - non-expired chats:", nonExpiredCount, "limit:", ANON_MAX_CHATS);
            if (nonExpiredCount >= ANON_MAX_CHATS) {
                const message = `You've reached the limit of ${ANON_MAX_CHATS} free chats. Please delete a chat in the widget to save more, or upgrade your account to save unlimited chats.`;
                return {
                    turnsCount: 0,
                    error: "limit_reached" as const,
                    message,
                    portalLink,
                };
            }
        }

        const finalTitle = title?.trim() || generateDefaultTitle();
        const redisStatus = getRedisConfigStatus();
        console.log("[widgetAdd] Redis config check:", redisStatus);

        if (isRedisConfigured()) {
            // ASYNC PATH: Push raw htmlContent; mcp-worker parses with LLM
            const jobId = randomUUID();
            console.log("[widgetAdd] Taking ASYNC path - pushing htmlContent to queue", {
                jobId,
                queue: redisStatus.queueName,
                userId,
                title: finalTitle,
                htmlContentLength: htmlContent.length,
            });
            await pushChatSaveJob({
                jobId,
                userId,
                title: finalTitle,
                htmlContent,
                source: "widgetAdd",
            });
            console.log("[widgetAdd] ===== EXIT (async, queued) =====", { jobId });
            return { jobId, turnsCount: 0 };
        }

        // SYNC PATH: Parse with LLM, then saveChatCore
        console.log("[widgetAdd] Taking SYNC path - parsing with LLM, then saveChatCore");
        const turns = await parsePastedChatWithLLM(htmlContent);
        if (turns == null || turns.length === 0) {
            console.warn("[widgetAdd] ❌ LLM parse failed or returned empty");
            return {
                turnsCount: 0,
                error: "parse_error" as const,
                message: "Content could not be processed. Please ensure it contains a valid chat conversation.",
                portalLink: null,
            };
        }
        const result = await saveChatCore({ userId, title: finalTitle, turns });
        console.log("[widgetAdd] ===== EXIT (sync, saved) =====", { chatId: result.chatId, turnsCount: turns.length });
        return { chatId: result.chatId, turnsCount: turns.length };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[widgetAdd] ❌ EXCEPTION:", {
            error: errorMessage,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            stack: error instanceof Error ? error.stack : "N/A",
        });
        // Return structured error instead of throwing
        const errorResult = {
            turnsCount: 0,
            error: "server_error" as const,
            message: "An error occurred while saving the chat. Please try again.",
            portalLink: null,
        };
        console.log("[widgetAdd] ===== EXIT (exception) =====", errorResult);
        return errorResult;
    }
}

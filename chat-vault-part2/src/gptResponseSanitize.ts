/**
 * Strip account identifiers and other fields not needed for ChatGPT / Apps SDK review.
 * Applied when CHATVAULT_TOOL_METADATA_PROFILE is gpt (or limited).
 */

import type { LoadChatsResult } from "./tools/loadMyChats.js";

type ChatLike = {
    userId?: string;
    [key: string]: unknown;
};

export function stripUserIdFromChat<T extends ChatLike>(chat: T): Omit<T, "userId"> {
    const { userId: _removed, ...rest } = chat;
    return rest;
}

export function sanitizeUserInfoForGpt(
    userInfo: LoadChatsResult["userInfo"],
): LoadChatsResult["userInfo"] {
    const { userName: _removed, ...rest } = userInfo;
    return rest;
}

export function sanitizeLoadSavedEntriesForGpt(result: LoadChatsResult): LoadChatsResult {
    return {
        ...result,
        chats: result.chats.map((chat) => stripUserIdFromChat(chat)),
        userInfo: sanitizeUserInfoForGpt(result.userInfo),
    };
}

export function sanitizeSearchKnowledgePayloadForGpt(payload: {
    chats: ChatLike[];
    search: { query: string };
    pagination: LoadChatsResult["pagination"];
}): {
    chats: Omit<ChatLike, "userId">[];
    search: { query: string };
    pagination: LoadChatsResult["pagination"];
} {
    return {
        ...payload,
        chats: payload.chats.map((chat) => stripUserIdFromChat(chat)),
    };
}

/** Remove duplicate / nested payloads from tool results (e.g. searchKnowledge _meta). */
export function omitToolMetaForGpt<T extends { _meta?: unknown }>(result: T): Omit<T, "_meta"> {
    const { _meta: _removed, ...rest } = result;
    return rest;
}

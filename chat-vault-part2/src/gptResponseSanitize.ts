/**
 * Strip account identifiers and other fields not needed for ChatGPT / Apps SDK review.
 * Applied when CHATVAULT_TOOL_METADATA_PROFILE is gpt (or limited).
 */

import type { FullChat, LoadChatsResult } from "./tools/loadMyChats.js";
import type { SearchChatsResult } from "./tools/searchMyChats.js";

export type GptPublicFullChat = Omit<FullChat, "userId">;
export type GptLoadSavedEntriesResult = Omit<LoadChatsResult, "chats"> & {
    chats: GptPublicFullChat[];
};
export type GptSearchChat = Omit<SearchChatsResult["chats"][number], "userId">;

export function stripUserIdFromChat<T extends { userId: string }>(
    chat: T,
): Omit<T, "userId"> {
    const { userId: _removed, ...rest } = chat;
    return rest;
}

export function sanitizeUserInfoForGpt(
    userInfo: LoadChatsResult["userInfo"],
): LoadChatsResult["userInfo"] {
    const { userName: _removed, ...rest } = userInfo;
    return rest;
}

export function sanitizeLoadSavedEntriesForGpt(
    result: LoadChatsResult,
): GptLoadSavedEntriesResult {
    return {
        ...result,
        chats: result.chats.map(stripUserIdFromChat),
        userInfo: sanitizeUserInfoForGpt(result.userInfo),
    };
}

export function sanitizeSearchKnowledgePayloadForGpt(payload: {
    chats: SearchChatsResult["chats"];
    search: SearchChatsResult["search"];
    pagination: SearchChatsResult["pagination"];
}): {
    chats: GptSearchChat[];
    search: SearchChatsResult["search"];
    pagination: SearchChatsResult["pagination"];
} {
    return {
        ...payload,
        chats: payload.chats.map(stripUserIdFromChat),
    };
}

/** Remove duplicate / nested payloads from tool results (e.g. searchKnowledge _meta). */
export function omitToolMetaForGpt<T extends { _meta?: unknown }>(result: T): Omit<T, "_meta"> {
    const { _meta: _removed, ...rest } = result;
    return rest;
}

/**
 * listTopics tool — returns a user's topics for widget filter dropdowns.
 */

import { chatListDb } from "../db/index.js";
import { getMergedUserIdScopeForReads } from "../user/userMerge.js";
import {
    getAvailableTopicsForUserScope,
    type AvailableTopic,
} from "./topicQueries.js";

export interface ListTopicsParams {
    userId: string;
}

export interface ListTopicsResult {
    topics: AvailableTopic[];
}

export async function listTopics(params: ListTopicsParams): Promise<ListTopicsResult> {
    const { userId } = params;

    if (!userId) {
        throw new Error("userId is required");
    }

    const userIdScope = await getMergedUserIdScopeForReads(userId);
    const topicsForUser = await getAvailableTopicsForUserScope(userIdScope, true);

    return { topics: topicsForUser };
}

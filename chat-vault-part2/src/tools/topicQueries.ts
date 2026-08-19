/**
 * Topic read helpers for list/filter paths.
 * Intentionally excludes topic embeddings from all queries here.
 */

import { db, chatListDb } from "../db/index.js";
import { chatTopics, chats, topics, userIdMerges } from "../db/schema.js";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { chatsUserIdInScope } from "../user/userMerge.js";

export interface TopicSummary {
    id: string;
    name: string;
}

export interface AvailableTopic extends TopicSummary {
    chatCount: number;
}

function emptyTopicsByChatId(): Map<string, TopicSummary[]> {
    return new Map();
}

function topicsUserIdInScope(userIdScope: string[]) {
    if (userIdScope.length === 0) {
        return eq(topics.userId, "__no_user_scope__");
    }
    if (userIdScope.length === 1) {
        return eq(topics.userId, userIdScope[0]!);
    }
    return inArray(topics.userId, userIdScope);
}

/** Match topics owned by the canonical user or any legacy user merged into it. */
function topicsUserIdInCanonicalScope(canonicalUserId: string) {
    const mergedUserIds = sql`(select ${userIdMerges.fromUserId}
        from ${userIdMerges}
        where ${userIdMerges.toUserId} = ${canonicalUserId})`;

    return or(
        eq(topics.userId, canonicalUserId),
        inArray(topics.userId, mergedUserIds)
    )!;
}

/** Topics linked to each chat id (id + name only). */
export async function getTopicsForChatIds(
    chatIds: string[],
    useListDb = true
): Promise<Map<string, TopicSummary[]>> {
    if (chatIds.length === 0) {
        return emptyTopicsByChatId();
    }

    const queryDb = useListDb ? chatListDb : db;
    const rows = await queryDb
        .select({
            chatId: chatTopics.chatId,
            id: topics.id,
            name: topics.name,
        })
        .from(chatTopics)
        .innerJoin(topics, eq(chatTopics.topicId, topics.id))
        .where(inArray(chatTopics.chatId, chatIds))
        .orderBy(topics.name);

    const byChatId = emptyTopicsByChatId();
    for (const row of rows) {
        const existing = byChatId.get(row.chatId) ?? [];
        existing.push({ id: row.id, name: row.name });
        byChatId.set(row.chatId, existing);
    }
    return byChatId;
}

/** All topics for a user scope with usage counts for filter dropdowns. */
export async function getAvailableTopicsForUserScope(
    userIdScope: string[],
    useListDb = true
): Promise<AvailableTopic[]> {
    if (userIdScope.length === 0) {
        return [];
    }

    const queryDb = useListDb ? chatListDb : db;
    const rows = await queryDb
        .select({
            id: topics.id,
            name: topics.name,
            chatCount: sql<number>`count(${chatTopics.chatId})::int`,
        })
        .from(topics)
        .leftJoin(chatTopics, eq(chatTopics.topicId, topics.id))
        .where(topicsUserIdInScope(userIdScope))
        .groupBy(topics.id, topics.name)
        .orderBy(topics.name);

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        chatCount: Number(row.chatCount ?? 0),
    }));
}

/** All topics for a canonical user, including legacy merged IDs, in one query. */
export async function getAvailableTopicsForCanonicalUser(
    canonicalUserId: string,
    useListDb = true
): Promise<AvailableTopic[]> {
    const queryDb = useListDb ? chatListDb : db;
    const rows = await queryDb
        .select({
            id: topics.id,
            name: topics.name,
            chatCount: sql<number>`count(${chatTopics.chatId})::int`,
        })
        .from(topics)
        .leftJoin(chatTopics, eq(chatTopics.topicId, topics.id))
        .where(topicsUserIdInCanonicalScope(canonicalUserId))
        .groupBy(topics.id, topics.name)
        .orderBy(topics.name);

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        chatCount: Number(row.chatCount ?? 0),
    }));
}

/**
 * Chat ids owned by the user scope that have ANY of the given topic ids.
 * Returns null when topicIds is empty (no filter).
 */
export async function getChatIdsMatchingAnyTopics(
    userIdScope: string[],
    topicIds: string[],
    useListDb = true
): Promise<Set<string> | null> {
    const uniqueTopicIds = [...new Set(topicIds.filter(Boolean))];
    if (uniqueTopicIds.length === 0) {
        return null;
    }

    const queryDb = useListDb ? chatListDb : db;
    const rows = await queryDb
        .select({ chatId: chatTopics.chatId })
        .from(chatTopics)
        .innerJoin(chats, eq(chatTopics.chatId, chats.id))
        .where(and(inArray(chatTopics.topicId, uniqueTopicIds), chatsUserIdInScope(userIdScope)));

    return new Set(rows.map((row) => row.chatId));
}

/** Attach topics[] to chat rows from a preloaded map. */
export function attachTopicsToChats<T extends { id: string }>(
    chatRows: T[],
    topicsByChatId: Map<string, TopicSummary[]>
): Array<T & { topics: TopicSummary[] }> {
    return chatRows.map((chat) => ({
        ...chat,
        topics: topicsByChatId.get(chat.id) ?? [],
    }));
}

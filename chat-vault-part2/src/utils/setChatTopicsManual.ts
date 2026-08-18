/**
 * Replace a chat's topic links from manual widget edits.
 */

import { count, eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { chatTopics, chats, topics } from "../db/schema.js";
import { getMergedUserIdScopeForReads, chatsUserIdInScope } from "../user/userMerge.js";
import { generateEmbedding } from "./embeddings.js";
import { normalizeTopicName, sanitizeTopicDisplayName } from "./topicNames.js";
import { getTopicsForChatIds, type TopicSummary } from "../tools/topicQueries.js";
import { MAX_TOPICS_PER_USER } from "./assignTopics.js";

export const MAX_MANUAL_TOPICS_PER_CHAT = 5;

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
    return UUID_RE.test(value);
}

interface ExistingTopic {
    id: string;
    name: string;
    nameNorm: string;
}

/**
 * Resolve topic refs (UUID or display name) to topic ids for the user.
 * Creates missing topics with source manual.
 */
export async function setChatTopicsManual(params: {
    userId: string;
    chatId: string;
    topicRefs: string[];
}): Promise<TopicSummary[]> {
    const { userId, chatId } = params;
    const uniqueRefs = [...new Set(params.topicRefs.map((ref) => ref.trim()).filter(Boolean))];

    if (uniqueRefs.length > MAX_MANUAL_TOPICS_PER_CHAT) {
        throw new Error(`At most ${MAX_MANUAL_TOPICS_PER_CHAT} topics per chat`);
    }

    const userIdScope = await getMergedUserIdScopeForReads(userId);

    const existingChat = await db
        .select({ id: chats.id, userId: chats.userId })
        .from(chats)
        .where(and(eq(chats.id, chatId), chatsUserIdInScope(userIdScope)))
        .limit(1);

    if (existingChat.length === 0) {
        throw new Error("Chat not found or does not belong to user");
    }

    const ownerUserId = existingChat[0]!.userId;

    const existingTopics = await db
        .select({
            id: topics.id,
            name: topics.name,
            nameNorm: topics.nameNorm,
        })
        .from(topics)
        .where(eq(topics.userId, ownerUserId));

    const byId = new Map<string, ExistingTopic>();
    const byNorm = new Map<string, ExistingTopic>();
    for (const topic of existingTopics) {
        byId.set(topic.id, topic);
        byNorm.set(topic.nameNorm, topic);
    }

    const [{ value: userTopicCount }] = await db
        .select({ value: count() })
        .from(topics)
        .where(eq(topics.userId, ownerUserId));

    let createdCount = 0;
    const resolvedIds: string[] = [];
    const seenIds = new Set<string>();

    for (const ref of uniqueRefs) {
        let topicId: string | null = null;

        if (isUuid(ref)) {
            const match = byId.get(ref);
            if (!match) {
                throw new Error("Topic not found or does not belong to user");
            }
            topicId = match.id;
        } else {
            let displayName: string;
            try {
                displayName = sanitizeTopicDisplayName(ref);
            } catch {
                throw new Error("Invalid topic name");
            }

            const nameNorm = normalizeTopicName(displayName);
            const exact = byNorm.get(nameNorm);
            if (exact) {
                topicId = exact.id;
            } else {
                if (Number(userTopicCount) + createdCount >= MAX_TOPICS_PER_USER) {
                    throw new Error("User topic limit reached");
                }

                const embedding = await generateEmbedding(displayName);
                const [created] = await db
                    .insert(topics)
                    .values({
                        userId: ownerUserId,
                        name: displayName,
                        nameNorm,
                        embedding,
                    })
                    .onConflictDoNothing({ target: [topics.userId, topics.nameNorm] })
                    .returning({ id: topics.id, name: topics.name, nameNorm: topics.nameNorm });

                if (created) {
                    const newTopic: ExistingTopic = {
                        id: created.id,
                        name: created.name,
                        nameNorm: created.nameNorm,
                    };
                    byId.set(created.id, newTopic);
                    byNorm.set(nameNorm, newTopic);
                    topicId = created.id;
                    createdCount++;
                } else {
                    const raced = byNorm.get(nameNorm);
                    if (!raced) {
                        throw new Error("Failed to create topic");
                    }
                    topicId = raced.id;
                }
            }
        }

        if (topicId && !seenIds.has(topicId)) {
            seenIds.add(topicId);
            resolvedIds.push(topicId);
        }
    }

    await db.delete(chatTopics).where(eq(chatTopics.chatId, chatId));

    if (resolvedIds.length > 0) {
        await db.insert(chatTopics).values(
            resolvedIds.map((topicId) => ({
                chatId,
                topicId,
                source: "manual" as const,
            })),
        );
    }

    const byChatId = await getTopicsForChatIds([chatId], false);
    return byChatId.get(chatId) ?? [];
}

/**
 * Auto-assign topics to a chat after save.
 * Failures are logged and swallowed — they must not fail the save.
 */

import { db } from "../db/index.js";
import { chatTopics, topics } from "../db/schema.js";
import { count, eq } from "drizzle-orm";
import { isChatVaultAutoTopicsEnabled } from "./autoTopicsEnabled.js";
import { generateEmbedding } from "./embeddings.js";
import { normalizeTopicName, sanitizeTopicDisplayName } from "./topicNames.js";
import { findBestTopicMatch } from "./topicMatch.js";
import { suggestTopicsWithLLM } from "./suggestTopicsWithLLM.js";

export const TOPIC_MATCH_THRESHOLD = 0.82;
export const MAX_AUTO_TOPICS_PER_CHAT = 3;
export const MAX_TOPICS_PER_USER = 200;

export interface AssignTopicsParams {
    userId: string;
    chatId: string;
    title: string;
    turns: Array<{ prompt: string; response: string }>;
}

export interface AssignTopicsResult {
    assignedTopicIds: string[];
    createdCount: number;
    matchedExistingCount: number;
    skipped: boolean;
}

interface ExistingTopic {
    id: string;
    name: string;
    nameNorm: string;
    embedding: number[] | null;
}

export async function assignTopicsForChat(
    params: AssignTopicsParams
): Promise<AssignTopicsResult> {
    const empty: AssignTopicsResult = {
        assignedTopicIds: [],
        createdCount: 0,
        matchedExistingCount: 0,
        skipped: true,
    };

    if (!isChatVaultAutoTopicsEnabled()) {
        return empty;
    }

    const { userId, chatId, title, turns } = params;
    const startedAt = Date.now();

    try {
        const suggestedLabels = await suggestTopicsWithLLM(title, turns);
        if (suggestedLabels.length === 0) {
            console.log("[assignTopics] No topic suggestions for chat", chatId);
            return { ...empty, skipped: false };
        }

        const existingTopics = await db
            .select({
                id: topics.id,
                name: topics.name,
                nameNorm: topics.nameNorm,
                embedding: topics.embedding,
            })
            .from(topics)
            .where(eq(topics.userId, userId));

        const byNorm = new Map<string, ExistingTopic>();
        for (const topic of existingTopics) {
            byNorm.set(topic.nameNorm, topic);
        }

        const [{ value: userTopicCount }] = await db
            .select({ value: count() })
            .from(topics)
            .where(eq(topics.userId, userId));

        const topicIdsToLink: string[] = [];
        let createdCount = 0;
        let matchedExistingCount = 0;
        const seenNorms = new Set<string>();

        for (const rawLabel of suggestedLabels.slice(0, MAX_AUTO_TOPICS_PER_CHAT)) {
            let displayName: string;
            try {
                displayName = sanitizeTopicDisplayName(rawLabel);
            } catch {
                continue;
            }

            const nameNorm = normalizeTopicName(displayName);
            if (seenNorms.has(nameNorm)) continue;
            seenNorms.add(nameNorm);

            const exact = byNorm.get(nameNorm);
            if (exact) {
                topicIdsToLink.push(exact.id);
                matchedExistingCount++;
                continue;
            }

            const labelEmbedding = await generateEmbedding(displayName);

            const semanticMatchId = findBestTopicMatch(
                labelEmbedding,
                existingTopics.map((t) => ({ id: t.id, embedding: t.embedding })),
                TOPIC_MATCH_THRESHOLD
            );

            if (semanticMatchId) {
                topicIdsToLink.push(semanticMatchId);
                matchedExistingCount++;
                continue;
            }

            if (Number(userTopicCount) + createdCount >= MAX_TOPICS_PER_USER) {
                console.warn(
                    "[assignTopics] User topic cap reached, skipping new topic:",
                    userId
                );
                continue;
            }

            const [created] = await db
                .insert(topics)
                .values({
                    userId,
                    name: displayName,
                    nameNorm,
                    embedding: labelEmbedding,
                })
                .onConflictDoNothing({ target: [topics.userId, topics.nameNorm] })
                .returning({ id: topics.id, name: topics.name, nameNorm: topics.nameNorm });

            if (created) {
                const newTopic: ExistingTopic = {
                    id: created.id,
                    name: created.name,
                    nameNorm: created.nameNorm,
                    embedding: labelEmbedding,
                };
                existingTopics.push(newTopic);
                byNorm.set(nameNorm, newTopic);
                topicIdsToLink.push(created.id);
                createdCount++;
            } else {
                const raced = byNorm.get(nameNorm);
                if (raced) {
                    topicIdsToLink.push(raced.id);
                    matchedExistingCount++;
                }
            }
        }

        if (topicIdsToLink.length === 0) {
            return { assignedTopicIds: [], createdCount, matchedExistingCount, skipped: false };
        }

        await db
            .insert(chatTopics)
            .values(
                topicIdsToLink.map((topicId) => ({
                    chatId,
                    topicId,
                    source: "auto" as const,
                }))
            )
            .onConflictDoNothing();

        const elapsedMs = Date.now() - startedAt;
        console.log("[assignTopics] Assigned topics to chat", {
            chatId,
            topicCount: topicIdsToLink.length,
            createdCount,
            matchedExistingCount,
            elapsedMs,
        });

        return {
            assignedTopicIds: topicIdsToLink,
            createdCount,
            matchedExistingCount,
            skipped: false,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[assignTopics] Failed for chat", chatId, message);
        return { assignedTopicIds: [], createdCount: 0, matchedExistingCount: 0, skipped: false };
    }
}

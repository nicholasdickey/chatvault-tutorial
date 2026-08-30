/**
 * Integration tests for topic read/filter path on loadMyChats and listTopics.
 */

import { describe, test, expect, beforeAll, afterAll } from "@jest/globals";
import {
    cleanupTestDatabase,
    getTestDrizzle,
    runMigrations,
    startTestDatabase,
    stopTestDatabase,
    truncateAllTables,
} from "./db-helper.js";

const TEST_DB_URL =
    process.env.TEST_DATABASE_URL ||
    "postgresql://testuser:testpass@localhost:5433/testdb";

describe("loadMyChats topics", () => {
    let loadMyChats: typeof import("../src/tools/loadMyChats.js").loadMyChats;
    let listTopics: typeof import("../src/tools/listTopics.js").listTopics;
    let chats: typeof import("../src/db/schema.js").chats;
    let chatTopics: typeof import("../src/db/schema.js").chatTopics;
    let topics: typeof import("../src/db/schema.js").topics;
    let userIdMerges: typeof import("../src/db/schema.js").userIdMerges;
    let normalizeTopicName: typeof import("../src/utils/topicNames.js").normalizeTopicName;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DB_URL;
        await startTestDatabase();
        await runMigrations();
        await truncateAllTables();

        ({ loadMyChats } = await import("../src/tools/loadMyChats.js"));
        ({ listTopics } = await import("../src/tools/listTopics.js"));
        ({ chats, chatTopics, topics, userIdMerges } = await import("../src/db/schema.js"));
        ({ normalizeTopicName } = await import("../src/utils/topicNames.js"));
    }, 180000);

    afterAll(async () => {
        await cleanupTestDatabase();
        await stopTestDatabase();
    }, 180000);

    test("returns topics on chats and availableTopics in list response", async () => {
        const db = getTestDrizzle();
        const userId = "topics-user-1";

        const [chatA] = await db
            .insert(chats)
            .values({
                userId,
                title: "React chat",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [chatB] = await db
            .insert(chats)
            .values({
                userId,
                title: "Python chat",
                turns: [{ prompt: "Q2", response: "A2" }],
            })
            .returning({ id: chats.id });

        const [reactTopic] = await db
            .insert(topics)
            .values({
                userId,
                name: "React hooks",
                nameNorm: normalizeTopicName("React hooks"),
            })
            .returning({ id: topics.id, name: topics.name });

        const [pythonTopic] = await db
            .insert(topics)
            .values({
                userId,
                name: "Python",
                nameNorm: normalizeTopicName("Python"),
            })
            .returning({ id: topics.id, name: topics.name });

        await db.insert(chatTopics).values([
            { chatId: chatA!.id, topicId: reactTopic!.id, source: "manual" },
            { chatId: chatB!.id, topicId: pythonTopic!.id, source: "auto" },
        ]);

        const result = await loadMyChats({ userId, page: 0, size: 10 });

        expect(result.availableTopics).toEqual(
            expect.arrayContaining([
                { id: reactTopic!.id, name: "React hooks", chatCount: 1 },
                { id: pythonTopic!.id, name: "Python", chatCount: 1 },
            ])
        );

        const reactChat = result.chats.find((chat) => chat.id === chatA!.id);
        const pythonChat = result.chats.find((chat) => chat.id === chatB!.id);
        expect(reactChat?.topics).toEqual([{ id: reactTopic!.id, name: "React hooks" }]);
        expect(pythonChat?.topics).toEqual([{ id: pythonTopic!.id, name: "Python" }]);
    });

    test("filters chats by topicIds using ANY semantics", async () => {
        const db = getTestDrizzle();
        await truncateAllTables();
        const userId = "topics-user-2";

        const [chatA] = await db
            .insert(chats)
            .values({
                userId,
                title: "Tagged once",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [chatB] = await db
            .insert(chats)
            .values({
                userId,
                title: "Tagged twice",
                turns: [{ prompt: "Q2", response: "A2" }],
            })
            .returning({ id: chats.id });

        await db.insert(chats).values({
            userId,
            title: "Untagged",
            turns: [{ prompt: "Q3", response: "A3" }],
        });

        const [topicA] = await db
            .insert(topics)
            .values({
                userId,
                name: "DevOps",
                nameNorm: normalizeTopicName("DevOps"),
            })
            .returning({ id: topics.id });

        const [topicB] = await db
            .insert(topics)
            .values({
                userId,
                name: "Frontend",
                nameNorm: normalizeTopicName("Frontend"),
            })
            .returning({ id: topics.id });

        await db.insert(chatTopics).values([
            { chatId: chatA!.id, topicId: topicA!.id, source: "manual" },
            { chatId: chatB!.id, topicId: topicA!.id, source: "manual" },
            { chatId: chatB!.id, topicId: topicB!.id, source: "manual" },
        ]);

        const filtered = await loadMyChats({
            userId,
            topicIds: [topicA!.id],
            page: 0,
            size: 10,
        });

        expect(filtered.pagination.total).toBe(2);
        expect(filtered.chats.map((chat) => chat.id).sort()).toEqual(
            [chatA!.id, chatB!.id].sort()
        );

        const eitherTopic = await loadMyChats({
            userId,
            topicIds: [topicA!.id, topicB!.id],
            page: 0,
            size: 10,
        });
        expect(eitherTopic.pagination.total).toBe(2);
    });

    test("includes chats and topics from a legacy user merged into the canonical user", async () => {
        const db = getTestDrizzle();
        await truncateAllTables();
        const canonicalUserId = "canonical-topics-user";
        const legacyUserId = "legacy-topics-user";

        await db.insert(userIdMerges).values({
            fromUserId: legacyUserId,
            toUserId: canonicalUserId,
        });
        const [legacyChat] = await db.insert(chats).values({
            userId: legacyUserId,
            title: "Legacy chat",
            turns: [{ prompt: "Q", response: "A" }],
        }).returning({ id: chats.id });
        const [legacyTopic] = await db.insert(topics).values({
            userId: legacyUserId,
            name: "Legacy topic",
            nameNorm: normalizeTopicName("Legacy topic"),
        }).returning({ id: topics.id });
        await db.insert(chatTopics).values({
            chatId: legacyChat!.id,
            topicId: legacyTopic!.id,
            source: "manual",
        });

        const result = await loadMyChats({ userId: canonicalUserId });

        expect(result.chats.map((chat) => chat.id)).toContain(legacyChat!.id);
        expect(result.availableTopics).toContainEqual({
            id: legacyTopic!.id,
            name: "Legacy topic",
            chatCount: 1,
        });
    });

    test("listTopics returns scoped topics with chat counts", async () => {
        const db = getTestDrizzle();
        await truncateAllTables();
        const userId = "topics-user-3";

        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "One chat",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [topic] = await db
            .insert(topics)
            .values({
                userId,
                name: "Notes",
                nameNorm: normalizeTopicName("Notes"),
            })
            .returning({ id: topics.id, name: topics.name });

        await db.insert(chatTopics).values({
            chatId: chat!.id,
            topicId: topic!.id,
            source: "manual",
        });

        const result = await listTopics({ userId });
        expect(result.topics).toEqual([
            { id: topic!.id, name: "Notes", chatCount: 1 },
        ]);
    });

    test("does not expose other users' topics when filtering", async () => {
        const db = getTestDrizzle();
        await truncateAllTables();

        const [otherChat] = await db
            .insert(chats)
            .values({
                userId: "other-user",
                title: "Other",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [otherTopic] = await db
            .insert(topics)
            .values({
                userId: "other-user",
                name: "Secret",
                nameNorm: normalizeTopicName("Secret"),
            })
            .returning({ id: topics.id });

        await db.insert(chatTopics).values({
            chatId: otherChat!.id,
            topicId: otherTopic!.id,
            source: "manual",
        });

        await db.insert(chats).values({
            userId: "viewer-user",
            title: "Mine",
            turns: [{ prompt: "Q", response: "A" }],
        });

        const filtered = await loadMyChats({
            userId: "viewer-user",
            topicIds: [otherTopic!.id],
            page: 0,
            size: 10,
        });

        expect(filtered.pagination.total).toBe(0);
        expect(filtered.chats).toHaveLength(0);
    });
});

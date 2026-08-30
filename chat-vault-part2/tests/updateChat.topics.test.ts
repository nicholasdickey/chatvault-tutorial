/**
 * Integration tests for manual topic updates via updateChat.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { jest } from "@jest/globals";
import { eq } from "drizzle-orm";
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

const mockGenerateEmbedding = jest.fn<(text: string) => Promise<number[]>>();

jest.unstable_mockModule("../src/utils/embeddings.js", () => ({
    generateEmbedding: mockGenerateEmbedding,
    combineChatText: (turns: Array<{ prompt: string; response: string }>) =>
        turns.map((t) => `${t.prompt}\n${t.response}`).join("\n\n"),
    splitTurnsForEmbedding: (turns: Array<{ prompt: string; response: string }>) => [turns],
    MAX_EMBED_CHARS: 30_000,
}));

describe("updateChat topics", () => {
    let updateChat: typeof import("../src/tools/updateChat.js").updateChat;
    let chats: typeof import("../src/db/schema.js").chats;
    let chatTopics: typeof import("../src/db/schema.js").chatTopics;
    let topics: typeof import("../src/db/schema.js").topics;
    let normalizeTopicName: typeof import("../src/utils/topicNames.js").normalizeTopicName;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DB_URL;
        await startTestDatabase();
        await runMigrations();
        await truncateAllTables();

        ({ updateChat } = await import("../src/tools/updateChat.js"));
        ({ chats, chatTopics, topics } = await import("../src/db/schema.js"));
        ({ normalizeTopicName } = await import("../src/utils/topicNames.js"));
    }, 180000);

    afterAll(async () => {
        await cleanupTestDatabase();
        await stopTestDatabase();
    }, 180000);

    beforeEach(async () => {
        await truncateAllTables();
        mockGenerateEmbedding.mockReset();
        mockGenerateEmbedding.mockImplementation(async (text: string) => {
            const base = text.length % 100;
            return Array.from({ length: 1536 }, (_, i) => (i === 0 ? base / 100 : 0));
        });
    });

    async function seedChat(userId: string) {
        const db = getTestDrizzle();
        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "Test chat",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning();
        return chat!;
    }

    test("sets topics by existing id", async () => {
        const db = getTestDrizzle();
        const userId = "topics-user-1";
        const chat = await seedChat(userId);

        const [topic] = await db
            .insert(topics)
            .values({
                userId,
                name: "cooking",
                nameNorm: normalizeTopicName("cooking"),
                embedding: Array(1536).fill(0),
            })
            .returning();

        const result = await updateChat({
            chatId: chat.id,
            userId,
            chat: { topics: [topic!.id] },
        });

        expect(result.updated).toBe(true);
        expect(result.topics).toEqual([{ id: topic!.id, name: "cooking" }]);

        const links = await db.select().from(chatTopics).where(eq(chatTopics.chatId, chat.id));
        expect(links).toHaveLength(1);
        expect(links[0]!.source).toBe("manual");
    });

    test("creates topic by name and links chat", async () => {
        const userId = "topics-user-2";
        const chat = await seedChat(userId);

        const result = await updateChat({
            chatId: chat.id,
            userId,
            chat: { topics: ["programming"] },
        });

        expect(result.topics).toEqual([{ id: expect.any(String), name: "programming" }]);
        expect(mockGenerateEmbedding).toHaveBeenCalledWith("programming");

        const db = getTestDrizzle();
        const allTopics = await db.select().from(topics).where(eq(topics.userId, userId));
        expect(allTopics).toHaveLength(1);
    });

    test("replaces existing topic links", async () => {
        const db = getTestDrizzle();
        const userId = "topics-user-3";
        const chat = await seedChat(userId);

        const [a, b] = await db
            .insert(topics)
            .values([
                {
                    userId,
                    name: "cooking",
                    nameNorm: normalizeTopicName("cooking"),
                    embedding: Array(1536).fill(0),
                },
                {
                    userId,
                    name: "music",
                    nameNorm: normalizeTopicName("music"),
                    embedding: Array(1536).fill(0),
                },
            ])
            .returning();

        await db.insert(chatTopics).values({
            chatId: chat.id,
            topicId: a!.id,
            source: "auto",
        });

        const result = await updateChat({
            chatId: chat.id,
            userId,
            chat: { topics: [b!.id] },
        });

        expect(result.topics).toEqual([{ id: b!.id, name: "music" }]);

        const links = await db.select().from(chatTopics).where(eq(chatTopics.chatId, chat.id));
        expect(links).toHaveLength(1);
        expect(links[0]!.topicId).toBe(b!.id);
    });

    test("rejects more than 5 topics", async () => {
        const userId = "topics-user-4";
        const chat = await seedChat(userId);

        await expect(
            updateChat({
                chatId: chat.id,
                userId,
                chat: { topics: ["a", "b", "c", "d", "e", "f"] },
            }),
        ).rejects.toThrow(/At most 5 topics/);
    });

    test("rejects topic id owned by another user", async () => {
        const db = getTestDrizzle();
        const chat = await seedChat("topics-user-5");

        const [otherTopic] = await db
            .insert(topics)
            .values({
                userId: "other-user",
                name: "secret",
                nameNorm: normalizeTopicName("secret"),
                embedding: Array(1536).fill(0),
            })
            .returning();

        await expect(
            updateChat({
                chatId: chat.id,
                userId: "topics-user-5",
                chat: { topics: [otherTopic!.id] },
            }),
        ).rejects.toThrow(/Topic not found/);
    });
});

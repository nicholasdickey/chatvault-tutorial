/**
 * Integration tests for assignTopicsForChat with mocked OpenAI calls.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
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

const mockSuggestTopicsWithLLM = jest.fn<() => Promise<string[]>>();
const mockGenerateEmbedding = jest.fn<(text: string) => Promise<number[]>>();

jest.unstable_mockModule("../src/utils/suggestTopicsWithLLM.js", () => ({
    suggestTopicsWithLLM: mockSuggestTopicsWithLLM,
    SUGGEST_TOPICS_MODEL: "gpt-4o-mini",
}));

jest.unstable_mockModule("../src/utils/embeddings.js", () => ({
    generateEmbedding: mockGenerateEmbedding,
    combineChatText: (turns: Array<{ prompt: string; response: string }>) =>
        turns.map((t) => `${t.prompt}\n${t.response}`).join("\n\n"),
    splitTurnsForEmbedding: (turns: Array<{ prompt: string; response: string }>) => [turns],
    MAX_EMBED_CHARS: 30_000,
}));

describe("assignTopicsForChat", () => {
    let assignTopicsForChat: typeof import("../src/utils/assignTopics.js").assignTopicsForChat;
    let chats: typeof import("../src/db/schema.js").chats;
    let chatTopics: typeof import("../src/db/schema.js").chatTopics;
    let topics: typeof import("../src/db/schema.js").topics;
    let normalizeTopicName: typeof import("../src/utils/topicNames.js").normalizeTopicName;

    const originalAutoTopics = process.env.CHATVAULT_AUTO_TOPICS;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DB_URL;
        await startTestDatabase();
        await runMigrations();
        await truncateAllTables();

        ({ assignTopicsForChat } = await import("../src/utils/assignTopics.js"));
        ({ chats, chatTopics, topics } = await import("../src/db/schema.js"));
        ({ normalizeTopicName } = await import("../src/utils/topicNames.js"));
    }, 180000);

    afterAll(async () => {
        if (originalAutoTopics === undefined) delete process.env.CHATVAULT_AUTO_TOPICS;
        else process.env.CHATVAULT_AUTO_TOPICS = originalAutoTopics;
        await cleanupTestDatabase();
        await stopTestDatabase();
    }, 180000);

    beforeEach(async () => {
        await truncateAllTables();
        mockSuggestTopicsWithLLM.mockReset();
        mockGenerateEmbedding.mockReset();
        process.env.CHATVAULT_AUTO_TOPICS = "true";
    });

    afterEach(() => {
        if (originalAutoTopics === undefined) delete process.env.CHATVAULT_AUTO_TOPICS;
        else process.env.CHATVAULT_AUTO_TOPICS = originalAutoTopics;
    });

    test("skips when feature flag is off", async () => {
        process.env.CHATVAULT_AUTO_TOPICS = "false";
        const db = getTestDrizzle();
        const userId = "assign-user-off";

        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "Test",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        mockSuggestTopicsWithLLM.mockResolvedValue(["react hooks"]);

        const result = await assignTopicsForChat({
            userId,
            chatId: chat!.id,
            title: "Test",
            turns: [{ prompt: "Q", response: "A" }],
        });

        expect(result.skipped).toBe(true);
        expect(mockSuggestTopicsWithLLM).not.toHaveBeenCalled();

        const links = await db.select().from(chatTopics).where(eq(chatTopics.chatId, chat!.id));
        expect(links).toHaveLength(0);
    });

    test("exact name match links existing topic without creating duplicate", async () => {
        const db = getTestDrizzle();
        const userId = "assign-user-exact";

        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "React chat",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [existing] = await db
            .insert(topics)
            .values({
                userId,
                name: "React hooks",
                nameNorm: normalizeTopicName("React hooks"),
            })
            .returning({ id: topics.id });

        mockSuggestTopicsWithLLM.mockResolvedValue(["react hooks"]);
        mockGenerateEmbedding.mockResolvedValue([1, 0, 0]);

        const result = await assignTopicsForChat({
            userId,
            chatId: chat!.id,
            title: "React chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        expect(result.assignedTopicIds).toEqual([existing!.id]);
        expect(result.matchedExistingCount).toBe(1);
        expect(result.createdCount).toBe(0);
        expect(mockSuggestTopicsWithLLM).toHaveBeenCalledWith(
            "React chat",
            [{ prompt: "Q", response: "A" }],
            ["React hooks"],
        );

        const allTopics = await db.select().from(topics).where(eq(topics.userId, userId));
        expect(allTopics).toHaveLength(1);

        const links = await db.select().from(chatTopics).where(eq(chatTopics.chatId, chat!.id));
        expect(links).toHaveLength(1);
        expect(links[0]!.source).toBe("auto");
    });

    test("semantic match uses existing topic when similarity is high", async () => {
        const db = getTestDrizzle();
        const userId = "assign-user-semantic";
        const sharedEmbedding = [1, 0, 0, ...Array<number>(1533).fill(0)];

        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "Hooks chat",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [existing] = await db
            .insert(topics)
            .values({
                userId,
                name: "React hooks",
                nameNorm: normalizeTopicName("React hooks"),
                embedding: sharedEmbedding,
            })
            .returning({ id: topics.id });

        mockSuggestTopicsWithLLM.mockResolvedValue(["react state management"]);
        mockGenerateEmbedding.mockResolvedValue(sharedEmbedding);

        const result = await assignTopicsForChat({
            userId,
            chatId: chat!.id,
            title: "Hooks chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        expect(result.assignedTopicIds).toEqual([existing!.id]);
        expect(result.matchedExistingCount).toBe(1);
        expect(result.createdCount).toBe(0);

        const allTopics = await db.select().from(topics).where(eq(topics.userId, userId));
        expect(allTopics).toHaveLength(1);
    });

    test("creates new topic when no match found", async () => {
        const db = getTestDrizzle();
        const userId = "assign-user-create";
        const newEmbedding = [0, 1, 0, ...Array<number>(1533).fill(0)];

        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "Python chat",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        mockSuggestTopicsWithLLM.mockResolvedValue(["python asyncio"]);
        mockGenerateEmbedding.mockResolvedValue(newEmbedding);

        const result = await assignTopicsForChat({
            userId,
            chatId: chat!.id,
            title: "Python chat",
            turns: [{ prompt: "Q", response: "A" }],
        });

        expect(result.createdCount).toBe(1);
        expect(result.assignedTopicIds).toHaveLength(1);

        const allTopics = await db.select().from(topics).where(eq(topics.userId, userId));
        expect(allTopics).toHaveLength(1);
        expect(allTopics[0]!.name).toBe("python asyncio");

        const links = await db.select().from(chatTopics).where(eq(chatTopics.chatId, chat!.id));
        expect(links).toHaveLength(1);
    });

    test("does not throw when LLM returns empty suggestions", async () => {
        const db = getTestDrizzle();
        const userId = "assign-user-empty";

        const [chat] = await db
            .insert(chats)
            .values({
                userId,
                title: "Empty",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        mockSuggestTopicsWithLLM.mockResolvedValue([]);

        await expect(
            assignTopicsForChat({
                userId,
                chatId: chat!.id,
                title: "Empty",
                turns: [{ prompt: "Q", response: "A" }],
            })
        ).resolves.toMatchObject({ assignedTopicIds: [], skipped: false });
    });
});

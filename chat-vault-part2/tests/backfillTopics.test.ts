/**
 * Tests for backfill-topics script helpers and run flow.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
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

const mockAssignTopicsForChat = jest.fn<() => Promise<{
    assignedTopicIds: string[];
    createdCount: number;
    matchedExistingCount: number;
    skipped: boolean;
}>>();

jest.unstable_mockModule("../src/utils/assignTopics.js", () => ({
    assignTopicsForChat: mockAssignTopicsForChat,
}));

describe("backfill-topics", () => {
    let fetchUntaggedChats: typeof import("../scripts/backfill-topics.js").fetchUntaggedChats;
    let runBackfillTopics: typeof import("../scripts/backfill-topics.js").runBackfillTopics;
    let chats: typeof import("../src/db/schema.js").chats;
    let chatTopics: typeof import("../src/db/schema.js").chatTopics;
    let topics: typeof import("../src/db/schema.js").topics;
    let normalizeTopicName: typeof import("../src/utils/topicNames.js").normalizeTopicName;

    beforeAll(async () => {
        process.env.DATABASE_URL = TEST_DB_URL;
        await startTestDatabase();
        await runMigrations();
        await truncateAllTables();

        ({ fetchUntaggedChats, runBackfillTopics } = await import("../scripts/backfill-topics.js"));
        ({ chats, chatTopics, topics } = await import("../src/db/schema.js"));
        ({ normalizeTopicName } = await import("../src/utils/topicNames.js"));
    }, 180000);

    afterAll(async () => {
        await cleanupTestDatabase();
        await stopTestDatabase();
    }, 180000);

    beforeEach(async () => {
        await truncateAllTables();
        mockAssignTopicsForChat.mockReset();
        delete process.env.CHATVAULT_AUTO_TOPICS;
    });

    test("fetchUntaggedChats returns only chats without topic links", async () => {
        const db = getTestDrizzle();
        const userId = "backfill-user-1";

        const [untagged] = await db
            .insert(chats)
            .values({
                userId,
                title: "No topics yet",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        const [tagged] = await db
            .insert(chats)
            .values({
                userId,
                title: "Already tagged",
                turns: [{ prompt: "Q2", response: "A2" }],
            })
            .returning({ id: chats.id });

        const [topic] = await db
            .insert(topics)
            .values({
                userId,
                name: "React",
                nameNorm: normalizeTopicName("React"),
            })
            .returning({ id: topics.id });

        await db.insert(chatTopics).values({
            chatId: tagged!.id,
            topicId: topic!.id,
            source: "manual",
        });

        const rows = await fetchUntaggedChats({ userId });
        expect(rows).toHaveLength(1);
        expect(rows[0]!.id).toBe(untagged!.id);
    });

    test("runBackfillTopics dry-run does not assign topics", async () => {
        const db = getTestDrizzle();
        await db.insert(chats).values({
            userId: "backfill-user-2",
            title: "Pending",
            turns: [{ prompt: "Q", response: "A" }],
        });

        const summary = await runBackfillTopics({
            dryRun: true,
            concurrency: 5,
            batchDelayMs: 0,
        });

        expect(summary.candidates).toBe(1);
        expect(summary.processed).toBe(0);
        expect(mockAssignTopicsForChat).not.toHaveBeenCalled();
    });

    test("runBackfillTopics assigns topics for untagged chats", async () => {
        const db = getTestDrizzle();
        const [chat] = await db
            .insert(chats)
            .values({
                userId: "backfill-user-3",
                title: "Needs tags",
                turns: [{ prompt: "Q", response: "A" }],
            })
            .returning({ id: chats.id });

        mockAssignTopicsForChat.mockResolvedValue({
            assignedTopicIds: ["topic-1"],
            createdCount: 1,
            matchedExistingCount: 0,
            skipped: false,
        });

        const summary = await runBackfillTopics({
            dryRun: false,
            concurrency: 1,
            batchDelayMs: 0,
        });

        expect(summary.processed).toBe(1);
        expect(summary.assigned).toBe(1);
        expect(summary.topicsCreated).toBe(1);
        expect(process.env.CHATVAULT_AUTO_TOPICS).toBe("true");
        expect(mockAssignTopicsForChat).toHaveBeenCalledWith({
            userId: "backfill-user-3",
            chatId: chat!.id,
            title: "Needs tags",
            turns: [{ prompt: "Q", response: "A" }],
        });
    });
});

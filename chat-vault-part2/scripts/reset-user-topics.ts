/**
 * Delete all topic links and topics for a user, then optionally run backfill.
 *
 * Usage:
 *   pnpm tsx scripts/reset-user-topics.ts --userId=<id>
 *   pnpm tsx scripts/reset-user-topics.ts --userId=<id> --backfill
 */

import * as dotenv from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { chatTopics, chats, topics } from "../src/db/schema.js";
import { runBackfillTopics } from "./backfill-topics.js";

dotenv.config();

const TEST_USER_ID = "cbbc93e8-ea74-4918-bc84-1713c2079973";

function parseArgs(argv: string[]): { userId: string; backfill: boolean } {
    let userId = TEST_USER_ID;
    let backfill = false;

    for (const arg of argv) {
        if (arg.startsWith("--userId=")) {
            userId = arg.slice("--userId=".length).trim();
            continue;
        }
        if (arg === "--backfill") {
            backfill = true;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    if (!userId) {
        throw new Error("--userId is required");
    }

    return { userId, backfill };
}

async function resetUserTopics(userId: string): Promise<void> {
    const userChats = await db
        .select({ id: chats.id })
        .from(chats)
        .where(eq(chats.userId, userId));

    const chatIds = userChats.map((c) => c.id);
    console.log("[reset-user-topics] User chats:", chatIds.length);

    if (chatIds.length > 0) {
        const deletedLinks = await db
            .delete(chatTopics)
            .where(inArray(chatTopics.chatId, chatIds))
            .returning({ chatId: chatTopics.chatId });
        console.log("[reset-user-topics] Deleted chat_topics rows:", deletedLinks.length);
    }

    const userTopics = await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(eq(topics.userId, userId));

    if (userTopics.length > 0) {
        const topicIds = userTopics.map((t) => t.id);
        const orphanedLinks = await db
            .delete(chatTopics)
            .where(inArray(chatTopics.topicId, topicIds))
            .returning({ topicId: chatTopics.topicId });
        if (orphanedLinks.length > 0) {
            console.log(
                "[reset-user-topics] Deleted extra chat_topics by topic:",
                orphanedLinks.length,
            );
        }

        const deletedTopics = await db
            .delete(topics)
            .where(eq(topics.userId, userId))
            .returning({ id: topics.id, name: topics.name });
        console.log(
            "[reset-user-topics] Deleted topics:",
            deletedTopics.map((t) => t.name).join(", ") || "(none)",
        );
    } else {
        console.log("[reset-user-topics] No topics to delete");
    }

    const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(topics)
        .where(eq(topics.userId, userId));
    console.log("[reset-user-topics] Remaining topics for user:", count);
}

async function main(): Promise<void> {
    const { userId, backfill } = parseArgs(process.argv.slice(2));
    process.env.CHATVAULT_AUTO_TOPICS = "true";

    console.log("[reset-user-topics] Resetting topics for user:", userId);
    await resetUserTopics(userId);

    if (backfill) {
        console.log("[reset-user-topics] Running backfill...");
        const summary = await runBackfillTopics({
            dryRun: false,
            userId,
            concurrency: 3,
            batchDelayMs: 300,
        });
        console.log("[reset-user-topics] Backfill summary:", summary);
    }
}

main().catch((error) => {
    console.error("[reset-user-topics] Failed:", error);
    process.exit(1);
});

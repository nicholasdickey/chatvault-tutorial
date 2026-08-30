/**
 * Backfill auto-assigned topics for chats that have no topic links yet.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-topics.ts --dry-run
 *   pnpm tsx scripts/backfill-topics.ts --userId=<id> --limit=50
 *   pnpm tsx scripts/backfill-topics.ts --batch-size=20
 *   pnpm tsx scripts/backfill-topics.ts --retag
 *   pnpm tsx scripts/backfill-topics.ts --retag --userId=<id>
 *
 * --retag clears existing topic links (and topic catalog for affected users) before re-assigning.
 *
 * Requires DATABASE_URL and OPENAI_API_KEY. Sets CHATVAULT_AUTO_TOPICS=true for the run.
 */

import * as dotenv from "dotenv";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { chatTopics, chats, topics } from "../src/db/schema.js";
import { assignTopicsForChat } from "../src/utils/assignTopics.js";

dotenv.config();

interface CliOptions {
    dryRun: boolean;
    retag: boolean;
    userId?: string;
    limit?: number;
    concurrency: number;
    batchDelayMs: number;
}

interface ChatCandidate {
    id: string;
    userId: string;
    title: string;
    turns: Array<{ prompt: string; response: string }>;
}

interface BackfillSummary {
    candidates: number;
    processed: number;
    assigned: number;
    emptySuggestions: number;
    failed: number;
    topicsCreated: number;
    topicsMatched: number;
    linksCleared: number;
    topicsDeleted: number;
    elapsedMs: number;
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        dryRun: false,
        retag: false,
        concurrency: 5,
        batchDelayMs: 200,
    };

    for (const arg of argv) {
        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }
        if (arg === "--retag") {
            options.retag = true;
            continue;
        }
        if (arg.startsWith("--userId=")) {
            options.userId = arg.slice("--userId=".length).trim() || undefined;
            continue;
        }
        if (arg.startsWith("--limit=")) {
            options.limit = parsePositiveInt(arg.slice("--limit=".length), "limit");
            continue;
        }
        if (arg.startsWith("--batch-size=")) {
            options.limit = parsePositiveInt(arg.slice("--batch-size=".length), "batch-size");
            continue;
        }
        if (arg.startsWith("--concurrency=")) {
            options.concurrency = parsePositiveInt(arg.slice("--concurrency=".length), "concurrency");
            continue;
        }
        if (arg.startsWith("--batch-delay-ms=")) {
            options.batchDelayMs = parsePositiveInt(
                arg.slice("--batch-delay-ms=".length),
                "batch-delay-ms",
            );
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

function parsePositiveInt(raw: string, name: string): number {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chats with no rows in chat_topics (resume-safe). */
export async function fetchUntaggedChats(params: {
    userId?: string;
    limit?: number;
}): Promise<ChatCandidate[]> {
    const filters = [isNull(chatTopics.chatId)];
    if (params.userId) {
        filters.push(eq(chats.userId, params.userId));
    }

    let query = db
        .select({
            id: chats.id,
            userId: chats.userId,
            title: chats.title,
            turns: chats.turns,
        })
        .from(chats)
        .leftJoin(chatTopics, eq(chatTopics.chatId, chats.id))
        .where(and(...filters))
        .orderBy(asc(chats.timestamp))
        .$dynamic();

    if (params.limit !== undefined) {
        query = query.limit(params.limit);
    }

    return query;
}

/** All chats, optionally filtered by user (for --retag). */
export async function fetchAllChats(params: {
    userId?: string;
    limit?: number;
}): Promise<ChatCandidate[]> {
    const filters = params.userId ? [eq(chats.userId, params.userId)] : [];

    let query = db
        .select({
            id: chats.id,
            userId: chats.userId,
            title: chats.title,
            turns: chats.turns,
        })
        .from(chats)
        .orderBy(asc(chats.timestamp))
        .$dynamic();

    if (filters.length > 0) {
        query = query.where(and(...filters));
    }

    if (params.limit !== undefined) {
        query = query.limit(params.limit);
    }

    return query;
}

/** Remove topic links and catalog for users whose chats will be retagged. */
export async function clearTopicsForRetag(params: {
    userId?: string;
    chatIds: string[];
}): Promise<{ linksCleared: number; topicsDeleted: number }> {
    let linksCleared = 0;
    let topicsDeleted = 0;

    if (params.chatIds.length > 0) {
        const deletedLinks = await db
            .delete(chatTopics)
            .where(inArray(chatTopics.chatId, params.chatIds))
            .returning({ chatId: chatTopics.chatId });
        linksCleared = deletedLinks.length;
    }

    const userIds = params.userId
        ? [params.userId]
        : [
              ...new Set(
                  (
                      await db
                          .select({ userId: chats.userId })
                          .from(chats)
                          .where(inArray(chats.id, params.chatIds))
                  ).map((row) => row.userId),
              ),
          ];

    for (const userId of userIds) {
        const userTopics = await db
            .select({ id: topics.id })
            .from(topics)
            .where(eq(topics.userId, userId));

        if (userTopics.length === 0) {
            continue;
        }

        const topicIds = userTopics.map((t) => t.id);
        const extraLinks = await db
            .delete(chatTopics)
            .where(inArray(chatTopics.topicId, topicIds))
            .returning({ topicId: chatTopics.topicId });
        linksCleared += extraLinks.length;

        const deletedTopics = await db
            .delete(topics)
            .where(eq(topics.userId, userId))
            .returning({ id: topics.id });
        topicsDeleted += deletedTopics.length;
    }

    return { linksCleared, topicsDeleted };
}

async function processInBatches<T>(
    items: T[],
    concurrency: number,
    batchDelayMs: number,
    handler: (item: T) => Promise<void>,
): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        await Promise.all(batch.map((item) => handler(item)));

        const hasMore = i + concurrency < items.length;
        if (hasMore && batchDelayMs > 0) {
            await sleep(batchDelayMs);
        }
    }
}

export async function runBackfillTopics(options: CliOptions): Promise<BackfillSummary> {
    const startedAt = Date.now();
    const summary: BackfillSummary = {
        candidates: 0,
        processed: 0,
        assigned: 0,
        emptySuggestions: 0,
        failed: 0,
        topicsCreated: 0,
        topicsMatched: 0,
        linksCleared: 0,
        topicsDeleted: 0,
        elapsedMs: 0,
    };

    const candidates = options.retag
        ? await fetchAllChats({ userId: options.userId, limit: options.limit })
        : await fetchUntaggedChats({ userId: options.userId, limit: options.limit });
    summary.candidates = candidates.length;

    console.log(
        options.retag
            ? "[backfill-topics] Retag candidates:"
            : "[backfill-topics] Found untagged chats:",
        {
            count: summary.candidates,
            userId: options.userId ?? "(all users)",
            limit: options.limit ?? "(none)",
            dryRun: options.dryRun,
            retag: options.retag,
        },
    );

    if (options.dryRun || candidates.length === 0) {
        if (options.dryRun && candidates.length > 0) {
            const preview = candidates.slice(0, 10).map((chat) => chat.id);
            console.log("[backfill-topics] Dry-run preview chat IDs:", preview);
            if (candidates.length > preview.length) {
                console.log(
                    "[backfill-topics] Dry-run preview truncated:",
                    candidates.length - preview.length,
                    "more",
                );
            }
        }
        summary.elapsedMs = Date.now() - startedAt;
        return summary;
    }

    if (options.retag) {
        const chatIds = candidates.map((chat) => chat.id);
        const cleared = await clearTopicsForRetag({
            userId: options.userId,
            chatIds,
        });
        summary.linksCleared = cleared.linksCleared;
        summary.topicsDeleted = cleared.topicsDeleted;
        console.log("[backfill-topics] Cleared for retag:", cleared);
    }

    process.env.CHATVAULT_AUTO_TOPICS = "true";

    await processInBatches(
        candidates,
        options.concurrency,
        options.batchDelayMs,
        async (chat) => {
            summary.processed++;
            try {
                const result = await assignTopicsForChat({
                    userId: chat.userId,
                    chatId: chat.id,
                    title: chat.title,
                    turns: chat.turns,
                });

                if (result.skipped) {
                    return;
                }

                if (result.assignedTopicIds.length > 0) {
                    summary.assigned++;
                    summary.topicsCreated += result.createdCount;
                    summary.topicsMatched += result.matchedExistingCount;
                    console.log("[backfill-topics] Assigned", {
                        chatId: chat.id,
                        topicCount: result.assignedTopicIds.length,
                        createdCount: result.createdCount,
                        matchedExistingCount: result.matchedExistingCount,
                    });
                    return;
                }

                summary.emptySuggestions++;
            } catch (error) {
                summary.failed++;
                const message = error instanceof Error ? error.message : String(error);
                console.error("[backfill-topics] Failed for chat:", chat.id, message);
            }
        },
    );

    summary.elapsedMs = Date.now() - startedAt;
    return summary;
}

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is required");
    }
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required");
    }

    const options = parseArgs(process.argv.slice(2));
    const summary = await runBackfillTopics(options);

    console.log("[backfill-topics] Summary:", {
        candidates: summary.candidates,
        processed: summary.processed,
        assigned: summary.assigned,
        emptySuggestions: summary.emptySuggestions,
        failed: summary.failed,
        topicsCreated: summary.topicsCreated,
        topicsMatched: summary.topicsMatched,
        linksCleared: summary.linksCleared,
        topicsDeleted: summary.topicsDeleted,
        elapsedMs: summary.elapsedMs,
    });
}

const isMain =
    process.argv[1]?.endsWith("backfill-topics.ts") ||
    process.argv[1]?.endsWith("backfill-topics.js");

if (isMain) {
    main().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[backfill-topics] Failed:", message);
        process.exit(1);
    });
}

/**
 * saveChatTurnsFinalize - Finalize a chat save session
 * Queues job for async embeddings; worker processes and saves to chats.
 * Removes temporary data before returning.
 */

import { db } from "../db/index.js";
import { chatSaveJobs, chatSaveJobTurns } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { pushChatSaveJob, isRedisConfigured, getRedisConfigStatus } from "../utils/redis.js";
import { saveChatCore } from "../utils/saveChatCore.js";

export interface SaveChatTurnsFinalizeParams {
    userId: string;
    jobId: string;
}

export type SaveChatTurnsFinalizeResult = { jobId: string } | { chatId: string };

export async function saveChatTurnsFinalize(
    params: SaveChatTurnsFinalizeParams
): Promise<SaveChatTurnsFinalizeResult> {
    const { userId, jobId } = params;

    if (!userId) {
        throw new Error("userId is required");
    }
    if (!jobId) {
        throw new Error("jobId is required");
    }

    // Verify job exists and belongs to user
    const [job] = await db
        .select()
        .from(chatSaveJobs)
        .where(and(eq(chatSaveJobs.id, jobId), eq(chatSaveJobs.userId, userId)))
        .limit(1);

    if (!job) {
        throw new Error("Job not found or does not belong to user");
    }

    // Fetch all turns ordered by turnIndex
    const turnsRows = await db
        .select({
            prompt: chatSaveJobTurns.prompt,
            response: chatSaveJobTurns.response,
        })
        .from(chatSaveJobTurns)
        .where(eq(chatSaveJobTurns.jobId, jobId))
        .orderBy(asc(chatSaveJobTurns.turnIndex));

    if (turnsRows.length === 0) {
        throw new Error("No turns saved for this job");
    }

    const turns = turnsRows.map((r) => ({ prompt: r.prompt, response: r.response }));

    const redisStatus = getRedisConfigStatus();
    console.log("[saveChatTurnsFinalize] Redis config check:", redisStatus);

    if (isRedisConfigured()) {
        console.log("[saveChatTurnsFinalize] Taking ASYNC path - pushing to queue", {
            jobId,
            queue: redisStatus.queueName,
            userId,
            title: job.title,
            turnsCount: turns.length,
        });
        await pushChatSaveJob({
            jobId,
            userId,
            title: job.title,
            turns,
            source: "saveChatTurnsFinalize",
        });
        await db.delete(chatSaveJobTurns).where(eq(chatSaveJobTurns.jobId, jobId));
        await db.delete(chatSaveJobs).where(eq(chatSaveJobs.id, jobId));
        const asyncResult = { jobId };
        console.log("[saveChatTurnsFinalize] ===== EXIT (async, queued) =====", asyncResult);
        return asyncResult;
    }

    console.log("[saveChatTurnsFinalize] Taking SYNC path - running saveChatCore in-process", {
        jobId,
        userId,
        title: job.title,
        turnsCount: turns.length,
        reason: !redisStatus.hasUrl
            ? "UPSTASH_REDIS_REST_URL missing"
            : !redisStatus.hasToken
              ? "UPSTASH_REDIS_REST_TOKEN missing"
              : "Redis env vars not set",
    });
    const result = await saveChatCore({ userId, title: job.title, turns });
    await db.delete(chatSaveJobTurns).where(eq(chatSaveJobTurns.jobId, jobId));
    await db.delete(chatSaveJobs).where(eq(chatSaveJobs.id, jobId));
    const syncResult = { chatId: result.chatId };
    console.log("[saveChatTurnsFinalize] ===== EXIT (sync, saved) =====", syncResult);
    return syncResult;
}

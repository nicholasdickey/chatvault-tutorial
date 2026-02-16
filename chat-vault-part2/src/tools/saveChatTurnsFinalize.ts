/**
 * saveChatTurnsFinalize - Finalize a chat save session
 * Runs embeddings, saves to chats, removes temporary data
 */

import { db } from "../db/index.js";
import { chatSaveJobs, chatSaveJobTurns } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";
import { saveChatCore } from "../utils/saveChatCore.js";

export interface SaveChatTurnsFinalizeParams {
    userId: string;
    jobId: string;
}

export interface SaveChatTurnsFinalizeResult {
    chatId: string;
}

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

    // Save via core (embeddings + insert into chats)
    const result = await saveChatCore({
        userId,
        title: job.title,
        turns,
    });

    // Clean up: delete turns first (CASCADE would handle, but explicit is fine), then job
    await db.delete(chatSaveJobTurns).where(eq(chatSaveJobTurns.jobId, jobId));
    await db.delete(chatSaveJobs).where(eq(chatSaveJobs.id, jobId));

    return { chatId: result.chatId };
}

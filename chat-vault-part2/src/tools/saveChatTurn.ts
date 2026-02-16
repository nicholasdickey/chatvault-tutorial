/**
 * saveChatTurn - Add one turn to a chat save session
 * Call after saveChatTurnsBegin, once per turn, in order
 */

import { db } from "../db/index.js";
import { chatSaveJobs, chatSaveJobTurns } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface SaveChatTurnParams {
    userId: string;
    jobId: string;
    turnIndex: number;
    turn: { prompt: string; response: string };
}

export interface SaveChatTurnResult {
    ok: boolean;
    turnIndex: number;
}

export async function saveChatTurn(params: SaveChatTurnParams): Promise<SaveChatTurnResult> {
    const { userId, jobId, turnIndex, turn } = params;

    if (!userId) {
        throw new Error("userId is required");
    }
    if (!jobId) {
        throw new Error("jobId is required");
    }
    if (typeof turnIndex !== "number" || turnIndex < 0) {
        throw new Error("turnIndex must be a non-negative integer");
    }
    if (!turn || typeof turn !== "object") {
        throw new Error("turn must be an object with prompt and response");
    }
    if (typeof turn.prompt !== "string" || typeof turn.response !== "string") {
        throw new Error("turn must have prompt and response as strings");
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

    await db
        .insert(chatSaveJobTurns)
        .values({
            jobId,
            turnIndex,
            prompt: turn.prompt,
            response: turn.response,
        })
        .onConflictDoUpdate({
            target: [chatSaveJobTurns.jobId, chatSaveJobTurns.turnIndex],
            set: {
                prompt: turn.prompt,
                response: turn.response,
            },
        });

    return { ok: true, turnIndex };
}

/**
 * saveChatTurnsBegin - Begin an iterative chat save session
 * Returns jobId for use with saveChatTurn and saveChatTurnsFinalize
 */

import { db } from "../db/index.js";
import { chatSaveJobs } from "../db/schema.js";

export interface SaveChatTurnsBeginParams {
    userId: string;
    title: string;
}

export interface SaveChatTurnsBeginResult {
    jobId: string;
}

export async function saveChatTurnsBegin(
    params: SaveChatTurnsBeginParams
): Promise<SaveChatTurnsBeginResult> {
    const { userId, title } = params;

    if (!userId) {
        throw new Error("userId is required");
    }
    if (!title || typeof title !== "string") {
        throw new Error("title is required");
    }

    const [job] = await db
        .insert(chatSaveJobs)
        .values({
            userId,
            title,
        })
        .returning({ id: chatSaveJobs.id });

    if (!job) {
        throw new Error("Failed to create save job");
    }

    return { jobId: job.id };
}

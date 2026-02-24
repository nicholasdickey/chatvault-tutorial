/**
 * Upstash Redis utilities for async ChatVault job queue
 */

import { Redis } from "@upstash/redis";
import * as dotenv from "dotenv";

dotenv.config();

const CHAT_SAVE_QUEUE = process.env.CHATVAULT_CHAT_SAVE_QUEUE ?? "queue:mcp:chat-save";
const STATUS_KEY_PREFIX = "chatvault:job:";
const STATUS_TTL_SECONDS = 180;

/** True when Redis env vars are set (async mode). When false, tools fall back to sync saveChatCore. */
export function isRedisConfigured(): boolean {
    return !!(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

function getRedis(): Redis {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for async chat save");
    }
    return new Redis({ url, token });
}

export interface ChatSaveJobPayload {
    jobId: string;
    userId: string;
    title: string;
    turns: Array<{ prompt: string; response: string }>;
    source: "saveChat" | "saveChatTurnsFinalize" | "widgetAdd";
}

export interface JobStatus {
    status: "pending" | "completed" | "failed" | "expired";
    chatId?: string;
    chatIds?: string[];
    error?: string;
}

/**
 * Push a chat save job to the queue and set status to pending.
 * Returns the jobId.
 */
export async function pushChatSaveJob(payload: ChatSaveJobPayload): Promise<string> {
    const redis = getRedis();
    const statusKey = `${STATUS_KEY_PREFIX}${payload.jobId}`;

    await redis.lpush(CHAT_SAVE_QUEUE, JSON.stringify(payload));
    await redis.set(statusKey, JSON.stringify({ status: "pending" as const }), { ex: STATUS_TTL_SECONDS });

    console.log("[redis] Pushed chat save job:", payload.jobId, "status key:", statusKey);
    return payload.jobId;
}

/**
 * Get job status for polling.
 * Returns null if Redis not configured, key expired, or not found.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
    if (!isRedisConfigured()) return null;
    const redis = getRedis();
    const statusKey = `${STATUS_KEY_PREFIX}${jobId}`;
    const raw = await redis.get(statusKey);
    if (raw == null) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed as JobStatus;
}

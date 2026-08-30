/**
 * Upstash Redis utilities for async ChatVault job queue
 */

import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import * as dotenv from "dotenv";

dotenv.config();

export const CHAT_SAVE_QUEUE = process.env.CHATVAULT_CHAT_SAVE_QUEUE ?? "queue:mcp:chat-save";

/** Composite user-merge cache: SHA-256 of from + NUL + to (keep in sync with mcp-worker mergeCacheKey). */
export function buildUserMergeCacheKey(fromUserId: string, toUserId: string): string {
    const h = createHash("sha256")
        .update(fromUserId, "utf8")
        .update("\0", "utf8")
        .update(toUserId, "utf8")
        .digest("hex");
    return `chatvault:user_merge:v1:${h}`;
}

function getUserMergeCacheTtlSeconds(): number {
    const raw = process.env.CHATVAULT_USER_MERGE_CACHE_TTL_SEC?.trim();
    if (raw) {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 604800; // 7d default
}
const STATUS_KEY_PREFIX = "chatvault:job:";
const STATUS_TTL_SECONDS = 180;
const EXPORT_TOKEN_KEY_PREFIX = "chatvault:export:v1:";

export interface ExportTokenRecord {
    canonicalUserId: string;
    purpose: "saved-entries-export";
    createdAt: string;
    expiresAt: string;
}

function getExportTokenTtlSeconds(): number {
    const parsed = Number.parseInt(process.env.CHATVAULT_EXPORT_TOKEN_TTL_SECONDS ?? "300", 10);
    return Number.isFinite(parsed) ? Math.min(1800, Math.max(60, parsed)) : 300;
}

function exportTokenKey(token: string): string {
    const digest = createHash("sha256").update(token, "utf8").digest("hex");
    return `${EXPORT_TOKEN_KEY_PREFIX}${digest}`;
}

export async function createExportToken(canonicalUserId: string): Promise<{
    token: string;
    expiresAt: string;
}> {
    const redis = getRedis();
    const token = randomBytes(32).toString("base64url");
    const ttlSeconds = getExportTokenTtlSeconds();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const record: ExportTokenRecord = {
        canonicalUserId,
        purpose: "saved-entries-export",
        createdAt: now.toISOString(),
        expiresAt,
    };
    await redis.set(exportTokenKey(token), JSON.stringify(record), { ex: ttlSeconds });
    return { token, expiresAt };
}

export async function getExportTokenRecord(token: string): Promise<ExportTokenRecord | null> {
    if (!token) return null;
    const redis = getRedis();
    const raw = await redis.get(exportTokenKey(token));
    if (raw == null) return null;
    const record = (typeof raw === "string" ? JSON.parse(raw) : raw) as ExportTokenRecord;
    if (
        record.purpose !== "saved-entries-export" ||
        !record.canonicalUserId ||
        Date.parse(record.expiresAt) <= Date.now()
    ) {
        return null;
    }
    return record;
}

function maskUrl(url: string | undefined): string {
    if (!url) return "(missing)";
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.pathname ? "..." : ""}`;
    } catch {
        return "(invalid)";
    }
}

/** True when Redis env vars are set (async mode). When false, tools fall back to sync saveChatCore. */
export function isRedisConfigured(): boolean {
    return !!(process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

/** Returns Redis config status for logging (no secrets). */
export function getRedisConfigStatus(): {
    configured: boolean;
    hasUrl: boolean;
    hasToken: boolean;
    queueName: string;
    urlMasked: string;
} {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    return {
        configured: !!(url && token),
        hasUrl: !!url,
        hasToken: !!token,
        queueName: CHAT_SAVE_QUEUE,
        urlMasked: maskUrl(url || undefined),
    };
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
    turns?: Array<{ prompt: string; response: string }>;
    htmlContent?: string;
    source: "saveChat" | "saveChatTurnsFinalize" | "widgetAdd";
}

/** Async user-id row migration; same queue as chat save (mcp-worker processChatSaveJob). */
export interface UserMergeQueuePayload {
    jobId: string;
    source: "userMerge";
    fromUserId: string;
    toUserId: string;
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
 * Payload must have either turns (saveChat, saveChatTurnsFinalize) or htmlContent (widgetAdd).
 */
export async function pushChatSaveJob(payload: ChatSaveJobPayload): Promise<string> {
    const redis = getRedis();
    const statusKey = `${STATUS_KEY_PREFIX}${payload.jobId}`;
    const payloadJson = JSON.stringify(payload);
    const payloadSize = payloadJson.length;

    console.log("[redis] pushChatSaveJob ENTRY", {
        jobId: payload.jobId,
        queue: CHAT_SAVE_QUEUE,
        statusKey,
        source: payload.source,
        userId: payload.userId,
        title: payload.title,
        turnsCount: payload.turns?.length ?? "(htmlContent)",
        htmlContentLength: payload.htmlContent?.length,
        payloadSizeBytes: payloadSize,
        payloadKeys: Object.keys(payload),
        hasHtmlContent: "htmlContent" in payload,
        hasTurns: "turns" in payload,
    });
    await redis.lpush(CHAT_SAVE_QUEUE, payloadJson);
    await redis.set(statusKey, JSON.stringify({ status: "pending" as const }), { ex: STATUS_TTL_SECONDS });
    console.log("[redis] pushChatSaveJob SUCCESS", {
        jobId: payload.jobId,
        queue: CHAT_SAVE_QUEUE,
        statusKey,
    });
    return payload.jobId;
}

/**
 * True if Redis has the merge pair marker (mapping known; repair/migration may still run via DB row check).
 */
export async function getMergeCachedComplete(fromUserId: string, toUserId: string): Promise<boolean> {
    if (!isRedisConfigured()) return false;
    const redis = getRedis();
    const key = buildUserMergeCacheKey(fromUserId, toUserId);
    const v = await redis.get(key);
    return v != null;
}

export async function setMergeCachedComplete(fromUserId: string, toUserId: string): Promise<void> {
    if (!isRedisConfigured()) return;
    const redis = getRedis();
    const key = buildUserMergeCacheKey(fromUserId, toUserId);
    const ttl = getUserMergeCacheTtlSeconds();
    await redis.set(key, "1", { ex: ttl });
}

/**
 * Enqueue user merge migration (UPDATE chats / chat_save_jobs). No job status key (fire-and-forget).
 */
export async function pushUserMergeJob(payload: UserMergeQueuePayload): Promise<string> {
    const redis = getRedis();
    const payloadJson = JSON.stringify(payload);
    console.log("[redis] pushUserMergeJob", {
        jobId: payload.jobId,
        queue: CHAT_SAVE_QUEUE,
        fromUserId: payload.fromUserId,
        toUserId: payload.toUserId,
        bytes: payloadJson.length,
    });
    await redis.lpush(CHAT_SAVE_QUEUE, payloadJson);
    return payload.jobId;
}

/**
 * Get job status for polling.
 * Returns null if Redis not configured, key expired, or not found.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
    const config = getRedisConfigStatus();
    console.log("[redis] getJobStatus ENTRY:", {
        jobId: jobId || "(empty)",
        jobIdLength: jobId?.length ?? 0,
        statusKey: jobId ? `${STATUS_KEY_PREFIX}${jobId}` : "(none)",
        redisConfigured: config.configured,
    });
    if (!isRedisConfigured()) {
        console.log("[redis] getJobStatus EXIT: Redis not configured");
        return null;
    }
    const redis = getRedis();
    const statusKey = `${STATUS_KEY_PREFIX}${jobId}`;
    const raw = await redis.get(statusKey);
    const found = raw != null;
    console.log("[redis] getJobStatus LOOKUP:", {
        statusKey,
        found,
        rawPreview: raw != null ? (typeof raw === "string" ? (raw.length > 100 ? raw.substring(0, 100) + "..." : raw) : "(object)") : "(null)",
    });
    if (raw == null) {
        console.log("[redis] getJobStatus EXIT: key not found or expired");
        return null;
    }
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = parsed as JobStatus;
    console.log("[redis] getJobStatus EXIT: success", { status: result.status, chatId: result.chatId });
    return result;
}

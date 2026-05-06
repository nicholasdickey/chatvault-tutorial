/**
 * Trusted canonical user id (Findexar/A6) vs declared tool userId: idempotent merge + optional async migration.
 */

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { chats, chatSaveJobs, userIdMerges } from "../db/schema.js";
import {
    getMergeCachedComplete,
    isRedisConfigured,
    pushUserMergeJob,
    setMergeCachedComplete,
} from "../utils/redis.js";

/** Explicit trusted canonical id (preferred when set by upstream). */
export const CANONICAL_USER_ID_HEADER = "x-a6-canonical-user-id";

/** Agentsyx also sends asserted user uuid; used as trusted id when canonical header is absent. */
const ASSERTED_USER_UUID_HEADER = "x-a6-user-uuid";

function firstHeader(
    headers: Record<string, string | string[] | undefined>,
    lowerName: string
): string | null {
    const raw = headers[lowerName];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length ? t : null;
}

export function readTrustedCanonicalUserId(
    headers?: Record<string, string | string[] | undefined>
): string | null {
    if (!headers) return null;
    // Node lowercases incoming HTTP header names on IncomingMessage
    const explicit = firstHeader(headers, CANONICAL_USER_ID_HEADER);
    if (explicit) return explicit;
    return firstHeader(headers, ASSERTED_USER_UUID_HEADER);
}

async function hasPendingMigrationWork(fromUserId: string): Promise<boolean> {
    const [c] = await db.select({ id: chats.id }).from(chats).where(eq(chats.userId, fromUserId)).limit(1);
    if (c) return true;
    const [j] = await db
        .select({ id: chatSaveJobs.id })
        .from(chatSaveJobs)
        .where(eq(chatSaveJobs.userId, fromUserId))
        .limit(1);
    return !!j;
}

async function migrateUserRowsInDatabase(fromUserId: string, toUserId: string): Promise<void> {
    await db.update(chats).set({ userId: toUserId }).where(eq(chats.userId, fromUserId));
    await db.update(chatSaveJobs).set({ userId: toUserId }).where(eq(chatSaveJobs.userId, fromUserId));
}

async function maybeRepairMigration(fromUserId: string, toUserId: string): Promise<void> {
    const pending = await hasPendingMigrationWork(fromUserId);
    if (!pending) return;
    if (isRedisConfigured()) {
        await pushUserMergeJob({
            jobId: randomUUID(),
            source: "userMerge",
            fromUserId,
            toUserId,
        });
    } else {
        await migrateUserRowsInDatabase(fromUserId, toUserId);
    }
}

/**
 * Ensure merge row exists and rows are migrated (async queue or sync). Call when declared !== trusted.
 */
export async function ensureUserMerge(fromUserId: string, toUserId: string): Promise<void> {
    if (fromUserId === toUserId) return;

    if (isRedisConfigured()) {
        const cached = await getMergeCachedComplete(fromUserId, toUserId);
        if (cached) {
            await maybeRepairMigration(fromUserId, toUserId);
            return;
        }
    }

    const existing = await db
        .select({ toUserId: userIdMerges.toUserId })
        .from(userIdMerges)
        .where(eq(userIdMerges.fromUserId, fromUserId))
        .limit(1);

    if (existing.length > 0) {
        if (existing[0].toUserId !== toUserId) {
            throw new Error("User id merge conflict: from_user_id maps to a different canonical id");
        }
        if (isRedisConfigured()) {
            await setMergeCachedComplete(fromUserId, toUserId);
        }
        await maybeRepairMigration(fromUserId, toUserId);
        return;
    }

    await db.insert(userIdMerges).values({ fromUserId, toUserId }).onConflictDoNothing();

    const row = await db
        .select({ toUserId: userIdMerges.toUserId })
        .from(userIdMerges)
        .where(eq(userIdMerges.fromUserId, fromUserId))
        .limit(1);

    if (row.length === 0) {
        throw new Error("Failed to persist user id merge mapping");
    }
    if (row[0].toUserId !== toUserId) {
        throw new Error("User id merge conflict: from_user_id maps to a different canonical id");
    }

    if (isRedisConfigured()) {
        await setMergeCachedComplete(fromUserId, toUserId);
    }
    await maybeRepairMigration(fromUserId, toUserId);
}

/**
 * If headers carry a trusted canonical id that differs from args.userId, run merge pipeline and return args with userId rewritten.
 */
export async function resolveDeclaredUserIdWithMerge(
    args: Record<string, unknown>,
    headers?: Record<string, string | string[] | undefined>
): Promise<Record<string, unknown>> {
    const declared = args.userId;
    if (typeof declared !== "string" || !declared.trim()) {
        return args;
    }
    const trusted = readTrustedCanonicalUserId(headers);
    if (!trusted || trusted === declared) {
        return args;
    }
    await ensureUserMerge(declared, trusted);
    return { ...args, userId: trusted };
}

/**
 * For reads/ownership: canonical user id plus any from_user_id values merged into it (chats may still use legacy ids until migration completes).
 */
export async function getMergedUserIdScopeForReads(canonicalUserId: string): Promise<string[]> {
    const rows = await db
        .select({ from: userIdMerges.fromUserId })
        .from(userIdMerges)
        .where(eq(userIdMerges.toUserId, canonicalUserId));
    const set = new Set<string>([canonicalUserId]);
    for (const r of rows) {
        set.add(r.from);
    }
    return Array.from(set);
}

/** chats.userId IN scope (canonical + merged-from ids). */
export function chatsUserIdInScope(scope: string[]) {
    if (scope.length === 0) return eq(chats.userId, "__no_user_scope__");
    if (scope.length === 1) return eq(chats.userId, scope[0]!);
    return inArray(chats.userId, scope);
}

/** chat_save_jobs.userId IN scope. */
export function chatSaveJobsUserIdInScope(scope: string[]) {
    if (scope.length === 0) return eq(chatSaveJobs.userId, "__no_user_scope__");
    if (scope.length === 1) return eq(chatSaveJobs.userId, scope[0]!);
    return inArray(chatSaveJobs.userId, scope);
}

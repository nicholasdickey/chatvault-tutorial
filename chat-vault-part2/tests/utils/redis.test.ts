/**
 * Unit tests for redis utils (pushChatSaveJob, getJobStatus)
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for real Redis tests.
 * Skips integration tests if env vars are not set.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";

const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

describe("redis utils", () => {
    beforeAll(() => {
        if (!hasRedis) {
            console.log("Skipping redis integration tests - UPSTASH_REDIS_REST_URL/TOKEN not set");
        }
    });

    it("pushChatSaveJob and getJobStatus are exported", async () => {
        const redis = await import("../../src/utils/redis.js");
        expect(typeof redis.pushChatSaveJob).toBe("function");
        expect(typeof redis.getJobStatus).toBe("function");
    });

    it(
        "pushChatSaveJob queues job and getJobStatus returns pending",
        async () => {
            if (!hasRedis) return;
            const { pushChatSaveJob, getJobStatus } = await import("../../src/utils/redis.js");
            const jobId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            await pushChatSaveJob({
                jobId,
                userId: "test-user",
                title: "Test",
                turns: [{ prompt: "p", response: "r" }],
                source: "saveChat",
            });
            const status = await getJobStatus(jobId);
            expect(status).not.toBeNull();
            expect(status?.status).toBe("pending");
        },
        { timeout: 10000 }
    );
});

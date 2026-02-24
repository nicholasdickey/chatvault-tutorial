/**
 * Unit tests for saveChat tool - verifies it returns jobId and calls pushChatSaveJob
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockPushChatSaveJob = jest.fn().mockResolvedValue("mock-job-id");

jest.unstable_mockModule("../../src/utils/redis.js", () => ({
    pushChatSaveJob: mockPushChatSaveJob,
    getJobStatus: jest.fn(),
    isRedisConfigured: jest.fn().mockReturnValue(true),
}));

describe("saveChat", () => {
    beforeEach(() => {
        mockPushChatSaveJob.mockClear();
    });

    it("returns jobId and calls pushChatSaveJob", async () => {
        const { saveChat } = await import("../../src/tools/saveChat.js");
        const result = await saveChat({
            userId: "user-1",
            title: "Test Chat",
            turns: [{ prompt: "Hi", response: "Hello" }],
        });
        expect(result).toHaveProperty("jobId");
        expect(typeof result.jobId).toBe("string");
        expect(result.jobId.length).toBeGreaterThan(0);
        expect(mockPushChatSaveJob).toHaveBeenCalledTimes(1);
        expect(mockPushChatSaveJob).toHaveBeenCalledWith({
            jobId: expect.any(String),
            userId: "user-1",
            title: "Test Chat",
            turns: [{ prompt: "Hi", response: "Hello" }],
            source: "saveChat",
        });
    });

    it("throws if turns is not an array", async () => {
        const { saveChat } = await import("../../src/tools/saveChat.js");
        await expect(
            saveChat({
                userId: "user-1",
                title: "Test",
                turns: null as any,
            })
        ).rejects.toThrow("turns must be an array");
        expect(mockPushChatSaveJob).not.toHaveBeenCalled();
    });
});

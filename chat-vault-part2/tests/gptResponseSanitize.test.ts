import { describe, it, expect } from "@jest/globals";
import {
    sanitizeLoadSavedEntriesForGpt,
    sanitizeSearchKnowledgePayloadForGpt,
    stripUserIdFromChat,
} from "../src/gptResponseSanitize.js";

describe("gptResponseSanitize", () => {
    it("strips userId from chat objects", () => {
        const chat = {
            id: "c1",
            userId: "u-secret",
            title: "Test",
            timestamp: new Date(),
            turns: [{ prompt: "p", response: "r" }],
        };
        expect(stripUserIdFromChat(chat)).toEqual({
            id: "c1",
            title: "Test",
            timestamp: chat.timestamp,
            turns: [{ prompt: "p", response: "r" }],
        });
    });

    it("sanitizes loadSavedEntries userInfo and chats", () => {
        const result = sanitizeLoadSavedEntriesForGpt({
            chats: [
                {
                    id: "c1",
                    userId: "u1",
                    title: "A",
                    timestamp: new Date(),
                    turns: [],
                },
            ],
            pagination: {
                page: 0,
                limit: 10,
                total: 1,
                totalPages: 1,
                hasMore: false,
            },
            userInfo: {
                portalLink: null,
                loginLink: null,
                isAnon: false,
                totalChats: 1,
                userName: "Testy Testor",
            },
        });
        expect(result.chats[0]).not.toHaveProperty("userId");
        expect(result.userInfo).not.toHaveProperty("userName");
        expect(result.userInfo.totalChats).toBe(1);
    });

    it("sanitizes searchKnowledge payload", () => {
        const payload = sanitizeSearchKnowledgePayloadForGpt({
            chats: [
                {
                    id: "c1",
                    userId: "u1",
                    title: "A",
                    timestamp: new Date(),
                    turns: [{ prompt: "p", response: "r" }],
                },
            ],
            search: { query: "korma" },
            pagination: {
                page: 0,
                limit: 10,
                total: 1,
                totalPages: 1,
                hasMore: false,
            },
        });
        expect(payload.chats[0]).not.toHaveProperty("userId");
        expect(payload.search.query).toBe("korma");
    });
});

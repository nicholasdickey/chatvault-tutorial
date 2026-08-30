import { afterEach, describe, expect, it } from "@jest/globals";
import { isChatVaultAutoTopicsEnabled } from "../src/utils/autoTopicsEnabled.js";

const original = process.env.CHATVAULT_AUTO_TOPICS;

afterEach(() => {
    if (original === undefined) delete process.env.CHATVAULT_AUTO_TOPICS;
    else process.env.CHATVAULT_AUTO_TOPICS = original;
});

describe("isChatVaultAutoTopicsEnabled", () => {
    it("defaults to off", () => {
        delete process.env.CHATVAULT_AUTO_TOPICS;
        expect(isChatVaultAutoTopicsEnabled()).toBe(false);
    });

    it("enables when CHATVAULT_AUTO_TOPICS=true", () => {
        process.env.CHATVAULT_AUTO_TOPICS = "true";
        expect(isChatVaultAutoTopicsEnabled()).toBe(true);
    });

    it("is case-insensitive", () => {
        process.env.CHATVAULT_AUTO_TOPICS = "TRUE";
        expect(isChatVaultAutoTopicsEnabled()).toBe(true);
    });
});

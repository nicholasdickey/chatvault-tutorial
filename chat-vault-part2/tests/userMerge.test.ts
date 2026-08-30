import { describe, expect, it } from "@jest/globals";
import { buildUserMergeCacheKey } from "../src/utils/redis.js";
import { readTrustedCanonicalUserId, CANONICAL_USER_ID_HEADER } from "../src/user/userMerge.js";

describe("user merge cache key", () => {
    it("is stable for the same pair", () => {
        const a = buildUserMergeCacheKey("from-id", "to-id");
        const b = buildUserMergeCacheKey("from-id", "to-id");
        expect(a).toBe(b);
        expect(a.startsWith("chatvault:user_merge:v1:")).toBe(true);
    });

    it("differs when order swaps", () => {
        const a = buildUserMergeCacheKey("a", "b");
        const b = buildUserMergeCacheKey("b", "a");
        expect(a).not.toBe(b);
    });
});

describe("readTrustedCanonicalUserId", () => {
    it("returns null when header missing", () => {
        expect(readTrustedCanonicalUserId({})).toBeNull();
    });

    it("reads trimmed canonical id", () => {
        expect(
            readTrustedCanonicalUserId({
                "x-a6-canonical-user-id": "  canonical-1  ",
            })
        ).toBe("canonical-1");
    });

    it("falls back to x-a6-user-uuid when canonical header absent", () => {
        expect(
            readTrustedCanonicalUserId({
                "x-a6-user-uuid": "uuid-trusted",
            })
        ).toBe("uuid-trusted");
    });

    it("prefers x-a6-canonical-user-id over x-a6-user-uuid", () => {
        expect(
            readTrustedCanonicalUserId({
                "x-a6-canonical-user-id": "explicit",
                "x-a6-user-uuid": "other",
            })
        ).toBe("explicit");
    });

    it("exposes header constant for docs parity", () => {
        expect(CANONICAL_USER_ID_HEADER).toBe("x-a6-canonical-user-id");
    });
});

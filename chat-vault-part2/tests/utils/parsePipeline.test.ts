/**
 * Unit tests for judge feedback and pre-verify helpers.
 */

import { describe, it, expect } from "@jest/globals";
import { buildJudgeFeedback, preVerifyTurns } from "../../src/utils/verifyParsedChatWithLLM.js";
import { prepareRawPasteForLLM } from "../../src/utils/preprocessPastedChat.js";
import { buildParserInput } from "../../src/utils/parsePastedChatWithLLM.js";
import type { ParseVerificationResult } from "../../src/utils/chatTurnTypes.js";
import { decideVerificationOutcome } from "../../src/utils/parseAndVerifyPastedChat.js";

describe("decideVerificationOutcome", () => {
    const failVerdict: ParseVerificationResult = {
        verdict: "fail",
        issues: ["missing_turns"],
        turnsInSource: 3,
        turnsInOutput: 1,
        coverage: "low",
        explanation: "Missing turns 1 and 3",
    };

    it("accepts on pass verdict", () => {
        expect(
            decideVerificationOutcome(
                { ...failVerdict, verdict: "pass", issues: [] },
                1,
                2
            ).action
        ).toBe("accept");
    });

    it("retries on fail when attempts remain", () => {
        const outcome = decideVerificationOutcome(failVerdict, 1, 2);
        expect(outcome.action).toBe("retry");
        if (outcome.action === "retry") {
            expect(outcome.judgeFeedback).toContain("QUALITY REVIEW REJECTED");
        }
    });

    it("rejects fail on final attempt", () => {
        const outcome = decideVerificationOutcome(failVerdict, 2, 2);
        expect(outcome.action).toBe("reject");
    });

    it("rejects uncertain on final attempt", () => {
        const outcome = decideVerificationOutcome(
            { ...failVerdict, verdict: "uncertain" },
            2,
            2
        );
        expect(outcome.action).toBe("reject");
    });

    it("retries when judge unavailable and attempts remain", () => {
        const outcome = decideVerificationOutcome(null, 1, 2);
        expect(outcome.action).toBe("retry");
        if (outcome.action === "retry") {
            expect(outcome.judgeFeedback).toBeUndefined();
        }
    });

    it("rejects when judge unavailable on final attempt", () => {
        const outcome = decideVerificationOutcome(null, 2, 2);
        expect(outcome.action).toBe("reject");
        if (outcome.action === "reject") {
            expect(outcome.reason).toMatch(/verification unavailable/i);
        }
    });
});

describe("verifyParsedChatWithLLM helpers", () => {
    it("preVerifyTurns fails on empty turns", () => {
        const result = preVerifyTurns([]);
        expect(result?.verdict).toBe("fail");
        expect(result?.issues).toContain("empty_output");
    });

    it("preVerifyTurns returns null for non-empty turns", () => {
        expect(preVerifyTurns([{ prompt: "hi", response: "hello" }])).toBeNull();
    });

    it("buildJudgeFeedback includes explanation and issues", () => {
        const verification: ParseVerificationResult = {
            verdict: "fail",
            issues: ["missing_turns", "paraphrased"],
            turnsInSource: 3,
            turnsInOutput: 1,
            coverage: "low",
            explanation: "Only middle turn extracted",
        };
        const feedback = buildJudgeFeedback(verification);
        expect(feedback).toContain("QUALITY REVIEW REJECTED");
        expect(feedback).toContain("missing_turns");
        expect(feedback).toContain("Only middle turn extracted");
        expect(feedback).toContain("Turns in source (estimated): 3");
    });
});

describe("raw paste preparation", () => {
    it("prepareRawPasteForLLM strips script tags only", () => {
        const html = "<script>evil()</script><p>Hello</p><b>You said:</b> test";
        const { text, looksLikeHtml } = prepareRawPasteForLLM(html);
        expect(looksLikeHtml).toBe(true);
        expect(text).not.toContain("evil");
        expect(text).toContain("You said:");
        expect(text).not.toContain("<<<USER>>>");
    });

    it("buildParserInput prepends judge feedback on retry", () => {
        const input = buildParserInput("raw content", "Fix missing turns");
        expect(input).toContain("Fix missing turns");
        expect(input).toContain("--- PASTED CONTENT (parse again) ---");
        expect(input).toContain("raw content");
    });
});

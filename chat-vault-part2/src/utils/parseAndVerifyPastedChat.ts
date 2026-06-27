/**
 * Dual-LLM paste pipeline: parser (Stage 1) → judge (Stage 3) → retry with feedback.
 */

import type { ChatTurn, ParseVerificationResult } from "./chatTurnTypes.js";
import {
    parsePastedChatWithLLM,
    PARSE_CHAT_LLM_MODEL,
} from "./parsePastedChatWithLLM.js";
import {
    verifyParsedChatWithLLM,
    buildJudgeFeedback,
} from "./verifyParsedChatWithLLM.js";

const PARSE_CHAT_LLM_RETRY_MODEL =
    process.env.PARSE_CHAT_LLM_RETRY_MODEL?.trim() || PARSE_CHAT_LLM_MODEL;

const MAX_PARSE_ATTEMPTS = Math.min(
    5,
    Math.max(1, Number.parseInt(process.env.PARSE_MAX_ATTEMPTS?.trim() || "2", 10) || 2)
);

const MAX_JUDGE_RETRIES = Math.min(
    3,
    Math.max(0, Number.parseInt(process.env.PARSE_JUDGE_RETRIES?.trim() || "1", 10) || 1)
);

export interface ParseAndVerifyResult {
    turns: ChatTurn[];
    attempts: number;
}

export type VerificationOutcome =
    | { action: "accept" }
    | { action: "retry"; judgeFeedback?: string; reason: string }
    | { action: "reject"; reason: string };

/**
 * Pure decision logic after judge returns (or stays unavailable).
 * Exported for unit tests.
 */
export function decideVerificationOutcome(
    verification: ParseVerificationResult | null,
    attempt: number,
    maxAttempts: number
): VerificationOutcome {
    if (verification == null) {
        if (attempt >= maxAttempts) {
            return { action: "reject", reason: "Quality verification unavailable" };
        }
        return { action: "retry", reason: "Quality verification unavailable — retrying parse" };
    }

    if (verification.verdict === "pass") {
        return { action: "accept" };
    }

    const reason = verification.explanation || verification.verdict;

    if (attempt >= maxAttempts) {
        return { action: "reject", reason };
    }

    return {
        action: "retry",
        judgeFeedback: buildJudgeFeedback(verification),
        reason,
    };
}

async function verifyWithRetry(
    htmlOrText: string,
    turns: ChatTurn[]
): Promise<ParseVerificationResult | null> {
    let last: ParseVerificationResult | null = null;
    for (let i = 0; i <= MAX_JUDGE_RETRIES; i++) {
        last = await verifyParsedChatWithLLM(htmlOrText, turns);
        if (last != null) return last;
        if (i < MAX_JUDGE_RETRIES) {
            console.warn("[parseAndVerifyPastedChat] Judge unavailable — retrying judge call");
        }
    }
    return null;
}

/**
 * Parse pasted content with LLM verification. Returns null if all attempts fail or judge rejects.
 * Never saves when the judge is unavailable or returns fail/uncertain on the final attempt.
 */
export async function parseAndVerifyPastedChat(
    htmlOrText: string
): Promise<ParseAndVerifyResult | null> {
    console.log("[parseAndVerifyPastedChat] Starting pipeline, max attempts:", MAX_PARSE_ATTEMPTS);

    let judgeFeedback: string | undefined;
    let lastFailureReason: string | undefined;

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
        const model =
            attempt === 1 ? PARSE_CHAT_LLM_MODEL : PARSE_CHAT_LLM_RETRY_MODEL;

        console.log(`[parseAndVerifyPastedChat] Attempt ${attempt}/${MAX_PARSE_ATTEMPTS}, parser model: ${model}`);

        const turns = await parsePastedChatWithLLM(htmlOrText, undefined, {
            model,
            judgeFeedback,
        });

        if (turns == null || turns.length === 0) {
            console.warn(`[parseAndVerifyPastedChat] Attempt ${attempt}: parser returned no turns`);
            continue;
        }

        const verification = await verifyWithRetry(htmlOrText, turns);
        const outcome = decideVerificationOutcome(verification, attempt, MAX_PARSE_ATTEMPTS);

        if (outcome.action === "accept") {
            console.log(`[parseAndVerifyPastedChat] Attempt ${attempt}: judge PASS`);
            return { turns, attempts: attempt };
        }

        if (outcome.action === "reject") {
            lastFailureReason = outcome.reason;
            console.warn(`[parseAndVerifyPastedChat] Attempt ${attempt}: rejecting —`, outcome.reason);
            return null;
        }

        lastFailureReason = outcome.reason;
        console.warn(`[parseAndVerifyPastedChat] Attempt ${attempt}: retry —`, outcome.reason);
        judgeFeedback = outcome.judgeFeedback;
    }

    console.warn(
        "[parseAndVerifyPastedChat] All attempts exhausted.",
        lastFailureReason ?? ""
    );
    return null;
}

/** @deprecated Use parseAndVerifyPastedChat. Kept for callers expecting turns | null. */
export async function parsePastedChatWithLLMAndVerify(
    htmlOrText: string
): Promise<Array<ChatTurn> | null> {
    const result = await parseAndVerifyPastedChat(htmlOrText);
    return result?.turns ?? null;
}

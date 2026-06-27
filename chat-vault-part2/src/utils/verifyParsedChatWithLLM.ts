/**
 * Stage 3 — Judge LLM: verify parser output against raw pasted content.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as dotenv from "dotenv";
import type { ChatTurn, ParseIssue, ParseVerificationResult, ParseVerdict } from "./chatTurnTypes.js";
import { prepareRawPasteForLLM } from "./preprocessPastedChat.js";

dotenv.config();

const DEFAULT_MAX_INPUT_LENGTH = 1_000_000;
const DEFAULT_MAX_TURNS_JSON_LENGTH = 500_000;

export const VERIFY_CHAT_LLM_MODEL =
    process.env.VERIFY_CHAT_LLM_MODEL?.trim() || "gpt-5.5";

const IssueEnum = z.enum([
    "missing_turns",
    "paraphrased",
    "citations_included",
    "wrong_roles",
    "incomplete_coverage",
    "empty_output",
]);

const VerificationSchema = z.object({
    verdict: z.enum(["pass", "fail", "uncertain"]),
    issues: z.array(IssueEnum),
    turns_in_source: z.number().nullable(),
    turns_in_output: z.number(),
    coverage: z.enum(["high", "medium", "low"]),
    explanation: z.string(),
});

export const VERIFY_INSTRUCTIONS = `You are a quality reviewer for chat paste parsing.

You receive:
1. ORIGINAL — raw pasted content (HTML or text) from an AI chat client
2. PARSED — structured turns extracted by a parser ({ prompt, response } pairs)

Your job is to decide whether the parse correctly captured the full conversation.

Evaluate:
1. Are ALL user/assistant exchanges from the original present in the parsed output?
2. Is the text verbatim (not summarized, paraphrased, or re-sectioned)?
3. Is user text in \`prompt\` and assistant text in \`response\` (correct roles)?
4. Are citation/grounding/UI blocks ("N sites", link previews, nav) incorrectly included?
5. Count distinct Q&A exchanges in the source vs output.

Verdict rules:
- \`pass\`: All conversational content captured faithfully; turn count matches; no major omissions
- \`fail\`: Missing turns, cherry-picked subset, paraphrased content, or major coverage loss
- \`uncertain\`: Ambiguous source (e.g. screenshot OCR quality) or cannot determine with confidence

Be strict on \`fail\` when the source clearly has multiple Q&A pairs but output has fewer.
Be strict on \`fail\` when distinctive phrases from the source are missing from output.

Output JSON only.`;

export function formatTurnsForJudge(turns: ChatTurn[]): string {
    return JSON.stringify({ turns }, null, 2);
}

export function buildJudgeFeedback(verification: ParseVerificationResult): string {
    const lines = [
        "QUALITY REVIEW REJECTED YOUR PREVIOUS PARSE. Fix all issues below.",
        `Verdict: ${verification.verdict}`,
        `Issues: ${verification.issues.join(", ") || "none listed"}`,
        `Turns in source (estimated): ${verification.turnsInSource ?? "unknown"}`,
        `Turns in your output: ${verification.turnsInOutput}`,
        `Coverage: ${verification.coverage}`,
        `Explanation: ${verification.explanation}`,
        "",
        "Re-parse the content below. Include EVERY turn. Copy verbatim. Omit citation/UI blocks.",
    ];
    return lines.join("\n");
}

function toVerificationResult(parsed: z.infer<typeof VerificationSchema>): ParseVerificationResult {
    return {
        verdict: parsed.verdict as ParseVerdict,
        issues: parsed.issues as ParseIssue[],
        turnsInSource: parsed.turns_in_source,
        turnsInOutput: parsed.turns_in_output,
        coverage: parsed.coverage,
        explanation: parsed.explanation,
    };
}

/** Cheap pre-check before calling judge. */
export function preVerifyTurns(turns: ChatTurn[]): ParseVerificationResult | null {
    if (turns.length === 0) {
        return {
            verdict: "fail",
            issues: ["empty_output"],
            turnsInSource: null,
            turnsInOutput: 0,
            coverage: "low",
            explanation: "Parser returned no turns",
        };
    }
    return null;
}

/**
 * Judge whether parsed turns faithfully represent the raw paste.
 */
export async function verifyParsedChatWithLLM(
    htmlOrText: string,
    turns: ChatTurn[],
    maxInputLength: number = DEFAULT_MAX_INPUT_LENGTH
): Promise<ParseVerificationResult | null> {
    const pre = preVerifyTurns(turns);
    if (pre) return pre;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
        console.log("[verifyParsedChatWithLLM] OPENAI_API_KEY not set, skipping verify");
        return null;
    }

    const { text: rawText } = prepareRawPasteForLLM(htmlOrText);
    let turnsJson = formatTurnsForJudge(turns);
    if (turnsJson.length > DEFAULT_MAX_TURNS_JSON_LENGTH) {
        turnsJson = turnsJson.slice(0, DEFAULT_MAX_TURNS_JSON_LENGTH) + "\n… [truncated]";
    }

    let originalSection = rawText;
    if (originalSection.length > maxInputLength - turnsJson.length - 500) {
        const budget = Math.max(1000, maxInputLength - turnsJson.length - 500);
        originalSection =
            originalSection.slice(0, budget) + "\n\n[Original content truncated for verify context limit.]";
    }

    const input = `--- ORIGINAL PASTED CONTENT ---\n${originalSection}\n\n--- PARSED TURNS (JSON) ---\n${turnsJson}`;

    console.log("[verifyParsedChatWithLLM] Judge call — model:", VERIFY_CHAT_LLM_MODEL);
    console.log("[verifyParsedChatWithLLM] Original length:", rawText.length, "turns:", turns.length);

    const openai = new OpenAI({ apiKey });

    try {
        const response = await openai.responses.parse({
            model: VERIFY_CHAT_LLM_MODEL,
            instructions: VERIFY_INSTRUCTIONS,
            input,
            text: {
                format: zodTextFormat(VerificationSchema, "parse_verification"),
            },
        });

        if (response.status !== "completed") {
            console.warn("[verifyParsedChatWithLLM] Response not completed:", response.status, response.error);
            return null;
        }

        const parsed = response.output_parsed;
        if (parsed == null) {
            console.warn("[verifyParsedChatWithLLM] output_parsed is null");
            return null;
        }

        const result = toVerificationResult(parsed);
        console.log(
            "[verifyParsedChatWithLLM] Verdict:",
            result.verdict,
            "issues:",
            result.issues.join(", ") || "(none)",
            "—",
            result.explanation.slice(0, 200)
        );
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[verifyParsedChatWithLLM] Error:", message);
        return null;
    }
}

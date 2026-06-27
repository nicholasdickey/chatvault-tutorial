/**
 * Stage 1 — Parser LLM: raw pasted HTML/text → structured chat turns.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as dotenv from "dotenv";
import type { ChatTurn, ParseAttemptOptions } from "./chatTurnTypes.js";
import { prepareRawPasteForLLM, cleanupParsedTurns } from "./preprocessPastedChat.js";

dotenv.config();

export type { ChatTurn } from "./chatTurnTypes.js";

const DEFAULT_MAX_INPUT_LENGTH = 1_000_000;

export const PARSE_CHAT_LLM_MODEL =
    process.env.PARSE_CHAT_LLM_MODEL?.trim() || "gpt-5.5";

const ChatTurnsSchema = z.object({
    turns: z.array(
        z.object({
            prompt: z.string(),
            response: z.string(),
        })
    ),
});

export const PARSE_INSTRUCTIONS = `You are a parser. The user will paste HTML or text from a chat (from any AI chat client: ChatGPT, Claude, Google Gemini, Perplexity, etc.).

Your job is to EXTRACT and COPY the exact text—verbatim—from the input. Do NOT summarize, paraphrase, interpret, or invent content. Do NOT output meta-descriptions. Do NOT synthesize "References:" lists—omit citation/grounding blocks entirely.

CRITICAL — ALL TURNS REQUIRED:
- The input almost always contains MULTIPLE user/assistant exchanges. You MUST output EVERY exchange as a SEPARATE object in the \`turns\` array.
- NEVER collapse multiple pairs into one turn. NEVER cherry-pick a single middle exchange.
- Scan the ENTIRE input from start to end. One user message + its immediately following assistant reply = exactly one turn.

SOURCE-AGNOSTIC RULES:
- User messages may appear as "You said:", "Human:", "User:", HTML role attributes, or visual bubbles (screenshots).
- Content BEFORE the first clear user marker is often turn 1: use the title/opening query as \`prompt\` and the following assistant text as \`response\`.
- Omit UI chrome: "N sites", link previews, "Show all", nav, footers — not part of conversational turns.

For each turn:
- \`prompt\`: EXACT user message (markdown if from HTML). No role prefixes, no timestamps.
- \`response\`: EXACT assistant reply (markdown if from HTML). No citation blocks.

FORMATTING — preserve structure as markdown when input is HTML:
- Bold/italic/code/lists/tables/headings → equivalent markdown
- Line breaks and paragraphs preserved

Output JSON with one key \`turns\`: array of { prompt, response }. Only for a genuinely single-message paste, output one turn. No commentary.`;

export function buildParserInput(rawText: string, judgeFeedback?: string): string {
    if (!judgeFeedback?.trim()) {
        return rawText;
    }
    return `${judgeFeedback.trim()}\n\n--- PASTED CONTENT (parse again) ---\n${rawText}`;
}

async function callParseLLM(
    openai: OpenAI,
    model: string,
    instructions: string,
    input: string
): Promise<Array<ChatTurn> | null> {
    const response = await openai.responses.parse({
        model,
        instructions,
        input,
        text: {
            format: zodTextFormat(ChatTurnsSchema, "chat_turns"),
        },
    });

    if (response.status !== "completed") {
        console.warn("[parsePastedChatWithLLM] Response not completed:", response.status, response.error);
        return null;
    }

    const parsed = response.output_parsed;
    if (parsed == null) {
        const firstOutput = response.output?.[0];
        if (firstOutput && "content" in firstOutput) {
            const refusalItem = firstOutput.content?.find(
                (c: { type?: string }) => c.type === "refusal" || "refusal" in c
            );
            if (refusalItem) {
                console.warn("[parsePastedChatWithLLM] Model refused");
                return null;
            }
        }
        console.warn("[parsePastedChatWithLLM] output_parsed is null");
        return null;
    }

    const turns = parsed.turns;
    if (!Array.isArray(turns) || turns.length === 0) {
        console.warn("[parsePastedChatWithLLM] turns missing or empty");
        return null;
    }

    const validTurns = turns.filter(
        (t): t is ChatTurn =>
            t != null && typeof t.prompt === "string" && typeof t.response === "string"
    );
    if (validTurns.length === 0) {
        console.warn("[parsePastedChatWithLLM] no valid turns");
        return null;
    }

    return cleanupParsedTurns(validTurns);
}

/**
 * Parse raw pasted HTML or text into turns. Does not verify quality — use parseAndVerifyPastedChat.
 */
export async function parsePastedChatWithLLM(
    htmlOrText: string,
    maxInputLength: number = DEFAULT_MAX_INPUT_LENGTH,
    options: ParseAttemptOptions = {}
): Promise<Array<ChatTurn> | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
        console.log("[parsePastedChatWithLLM] OPENAI_API_KEY not set, skipping LLM parse");
        return null;
    }

    const model = options.model?.trim() || PARSE_CHAT_LLM_MODEL;
    const { text, looksLikeHtml } = prepareRawPasteForLLM(htmlOrText);
    const composed = buildParserInput(text, options.judgeFeedback);

    const wasTruncated = composed.length > maxInputLength;
    const input = wasTruncated
        ? composed.slice(0, maxInputLength) + "\n\n[Content truncated for context limit.]"
        : composed;

    console.log("[parsePastedChatWithLLM] Parser call — model:", model);
    console.log("[parsePastedChatWithLLM] Original length:", htmlOrText.length, "looksLikeHtml:", looksLikeHtml);
    console.log("[parsePastedChatWithLLM] Sent length:", input.length, wasTruncated ? "(TRUNCATED)" : "(full)");
    if (options.judgeFeedback) {
        console.log("[parsePastedChatWithLLM] Retry with judge feedback");
    }

    const openai = new OpenAI({ apiKey });

    try {
        const turns = await callParseLLM(openai, model, PARSE_INSTRUCTIONS, input);
        if (turns) {
            console.log("[parsePastedChatWithLLM] Parsed", turns.length, "turns");
        }
        return turns;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[parsePastedChatWithLLM] Error:", message);
        return null;
    }
}

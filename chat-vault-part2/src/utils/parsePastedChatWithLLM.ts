/**
 * Parse pasted HTML/text chat blobs using OpenAI Responses API with structured output.
 * Returns null on missing API key, errors, refusals, or invalid/empty result so caller can fall back to heuristic parsing.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const DEFAULT_MAX_INPUT_LENGTH = 1_000_000;

const ChatTurnsSchema = z.object({
    turns: z.array(
        z.object({
            prompt: z.string(),
            response: z.string(),
        })
    ),
});

const PARSE_INSTRUCTIONS = `You are a parser. The user will paste HTML or text from a chat (from any AI chat client: ChatGPT, Claude, Gemini, etc.).

Your job is to EXTRACT and COPY the exact text—verbatim—from the input. Do NOT summarize, paraphrase, interpret, or describe the content. Do NOT output meta-descriptions (e.g. "extract user messages...", "The provided HTML contains...", "The key questions include...").

CRITICAL: If the input contains multiple user/assistant exchanges (multiple back-and-forth message pairs), you MUST output EVERY exchange as a separate object in the \`turns\` array. Do NOT collapse or summarize multiple pairs into a single turn. One user message plus its following assistant reply = one turn. Scan the entire input and include every such pair.

For each turn:
- \`prompt\`: copy the EXACT text of the user message as it appears in the input (strip HTML tags but keep the raw message text unchanged).
- \`response\`: copy the EXACT text of the assistant reply as it appears in the input (strip HTML tags but keep the raw reply text unchanged).

Output JSON with one key \`turns\`: an array of objects with \`prompt\` and \`response\` strings. Preserve markdown and line breaks from the original. Only if the input genuinely contains a single message or no distinguishable user/assistant pairs, output a single turn (with the other field as empty string). Do not add any commentary—only valid JSON matching the schema.`;

/**
 * Parse pasted HTML or text into structured chat turns using the OpenAI Responses API (gpt-4.1-nano, structured output).
 * Returns null if OPENAI_API_KEY is missing, the API errors, the model refuses, or the parsed result is empty/invalid.
 */
export async function parsePastedChatWithLLM(
    htmlOrText: string,
    maxInputLength: number = DEFAULT_MAX_INPUT_LENGTH
): Promise<Array<{ prompt: string; response: string }> | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
        console.log("[parsePastedChatWithLLM] OPENAI_API_KEY not set, skipping LLM parse");
        return null;
    }

    const wasTruncated = htmlOrText.length > maxInputLength;
    const input = wasTruncated
        ? htmlOrText.slice(0, maxInputLength) + "\n\n[Content truncated for context limit.]"
        : htmlOrText;

    console.log("[parsePastedChatWithLLM] ========== INPUT TO LLM ==========");
    console.log("[parsePastedChatWithLLM] Original length:", htmlOrText.length, "chars");
    console.log("[parsePastedChatWithLLM] Sent length:", input.length, "chars", wasTruncated ? "(TRUNCATED)" : "(full)");
    // console.log("[parsePastedChatWithLLM] Input (full):", input);
    console.log("[parsePastedChatWithLLM] Instructions length:", PARSE_INSTRUCTIONS.length, "chars");

    const openai = new OpenAI({ apiKey });

    try {
        console.log("[parsePastedChatWithLLM] Calling openai.responses.parse (model: gpt-4.1-nano)...");
        const response = await openai.responses.parse({
            model: "gpt-4.1-nano",
            instructions: PARSE_INSTRUCTIONS,
            input,
            text: {
                format: zodTextFormat(ChatTurnsSchema, "chat_turns"),
            },
        });

        console.log("[parsePastedChatWithLLM] ========== RAW RESPONSE FROM LLM ==========");
        console.log("[parsePastedChatWithLLM] response.status:", response.status);
        if (response.error) console.log("[parsePastedChatWithLLM] response.error:", response.error);
        console.log("[parsePastedChatWithLLM] response.output (item count):", response.output?.length ?? 0);
        if (response.output?.length) {
            response.output.forEach((item, i) => {
                const content = "content" in item ? item.content : null;
                console.log("[parsePastedChatWithLLM] response.output[" + i + "] type:", item.type ?? "unknown");
                if (content && Array.isArray(content)) {
                    content.forEach((c: { type?: string; text?: string }, j: number) => {
                        const full = "text" in c && typeof (c as { text?: string }).text === "string"
                            ? String((c as { text?: string }).text)
                            : JSON.stringify(c);
                        console.log("[parsePastedChatWithLLM]   content[" + j + "] type:", c.type, "full:", full);
                    });
                }
            });
        }
        console.log("[parsePastedChatWithLLM] response.output_parsed is null?", response.output_parsed == null);
        if (response.output_parsed != null) {
            const p = response.output_parsed as { turns?: unknown[] };
            console.log("[parsePastedChatWithLLM] output_parsed.turns length:", p.turns?.length ?? "n/a");
        }

        if (response.status !== "completed") {
            console.warn("[parsePastedChatWithLLM] Response not completed:", response.status, response.error);
            return null;
        }

        const parsed = response.output_parsed;
        if (parsed == null) {
            // Check for refusal in output
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
            (t): t is { prompt: string; response: string } =>
                t != null && typeof t.prompt === "string" && typeof t.response === "string"
        );
        if (validTurns.length === 0) {
            console.warn("[parsePastedChatWithLLM] no valid turns");
            return null;
        }

        console.log("[parsePastedChatWithLLM] ========== PARSED TURNS (what we return) ==========");
        console.log("[parsePastedChatWithLLM] Parsed", validTurns.length, "turns via LLM");
        validTurns.forEach((t, i) => {
            console.log("[parsePastedChatWithLLM] Turn", i + 1, "prompt length:", t.prompt.length, "| prompt (full):", t.prompt);
            console.log("[parsePastedChatWithLLM] Turn", i + 1, "response length:", t.response.length, "| response (full):", t.response);
        });
        console.log("[parsePastedChatWithLLM] ========== END LLM DEBUG ==========");
        return validTurns;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[parsePastedChatWithLLM] Error:", message);
        return null;
    }
}

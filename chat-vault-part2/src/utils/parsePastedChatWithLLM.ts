/**
 * Parse pasted HTML/text chat blobs using OpenAI Responses API with structured output.
 * Returns null on missing API key, errors, refusals, or invalid/empty result so caller can fall back to heuristic parsing.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const DEFAULT_MAX_INPUT_LENGTH = 80_000;

const ChatTurnsSchema = z.object({
    turns: z.array(
        z.object({
            prompt: z.string(),
            response: z.string(),
        })
    ),
});

const PARSE_INSTRUCTIONS = `You are a parser. The user will paste HTML or text from a chat (e.g. ChatGPT, Claude, Gemini). Extract each user message and assistant reply into a list of turns. Output JSON with one key \`turns\`: an array of objects with \`prompt\` (user message) and \`response\` (assistant reply). Preserve markdown and formatting. If there is only one block of text or no clear back-and-forth, output one turn with the other field as empty string. Do not add commentary, only valid JSON matching the schema.`;

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

    const input =
        htmlOrText.length > maxInputLength
            ? htmlOrText.slice(0, maxInputLength) + "\n\n[Content truncated for context limit.]"
            : htmlOrText;

    const openai = new OpenAI({ apiKey });

    try {
        const response = await openai.responses.parse({
            model: "gpt-4.1-nano",
            instructions: PARSE_INSTRUCTIONS,
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

        console.log("[parsePastedChatWithLLM] Parsed", validTurns.length, "turns via LLM");
        return validTurns;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[parsePastedChatWithLLM] Error:", message);
        return null;
    }
}

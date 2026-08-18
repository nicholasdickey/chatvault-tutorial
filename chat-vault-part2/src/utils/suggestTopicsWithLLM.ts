/**
 * LLM topic suggestion for auto-tagging on save.
 * Uses structured JSON output; prompts/responses are not logged.
 */

import OpenAI from "openai";
import { z } from "zod";
import * as dotenv from "dotenv";
import { combineChatText } from "./embeddings.js";

dotenv.config();

const TopicsSchema = z.object({
    topics: z.array(z.string()).max(3),
});

export const SUGGEST_TOPICS_MODEL =
    process.env.CHATVAULT_SUGGEST_TOPICS_MODEL?.trim() || "gpt-4o-mini";

const MAX_CONTEXT_CHARS = 2000;

const SUGGEST_TOPICS_INSTRUCTIONS = `You assign short topic labels to saved AI chat conversations.

Given a chat title and excerpt, return 1–3 concise topic labels (2–4 words each) that describe what the conversation is about.

Rules:
- Use lowercase-friendly short phrases (e.g. "react hooks", "python debugging")
- No duplicates in the response
- Prefer specific topics over generic ones
- Return fewer labels when the chat has a narrow focus`;

function buildSuggestTopicsInput(
    title: string,
    turns: Array<{ prompt: string; response: string }>
): string {
    const combined = combineChatText(turns);
    const excerpt =
        combined.length > MAX_CONTEXT_CHARS
            ? combined.slice(0, MAX_CONTEXT_CHARS) + "…"
            : combined;

    return `Title: ${title}\n\nExcerpt:\n${excerpt}`;
}

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey?.trim()) {
            throw new Error("OPENAI_API_KEY environment variable is not set");
        }
        _openai = new OpenAI({ apiKey });
    }
    return _openai;
}

/** Ask OpenAI for 1–3 topic labels. Returns empty array on failure. */
export async function suggestTopicsWithLLM(
    title: string,
    turns: Array<{ prompt: string; response: string }>
): Promise<string[]> {
    try {
        const openai = getOpenAI();
        const response = await openai.chat.completions.create({
            model: SUGGEST_TOPICS_MODEL,
            messages: [
                { role: "system", content: SUGGEST_TOPICS_INSTRUCTIONS },
                { role: "user", content: buildSuggestTopicsInput(title, turns) },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.warn("[suggestTopicsWithLLM] Empty response from model");
            return [];
        }

        const parsed = TopicsSchema.safeParse(JSON.parse(content));
        if (!parsed.success) {
            console.warn("[suggestTopicsWithLLM] Invalid response shape");
            return [];
        }

        return parsed.data.topics
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 3);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[suggestTopicsWithLLM] Failed to suggest topics:", message);
        return [];
    }
}

/**
 * LLM topic suggestion for auto-tagging on save.
 * Uses structured output via responses.parse; prompts/responses are not logged.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as dotenv from "dotenv";
import { combineChatText } from "./embeddings.js";

dotenv.config();

const TopicsSchema = z.object({
    topics: z.array(z.string()).max(1),
});

export const SUGGEST_TOPICS_MODEL =
    process.env.CHATVAULT_SUGGEST_TOPICS_MODEL?.trim() || "gpt-4o-mini";

const MAX_CONTEXT_CHARS = 2000;
const MAX_EXISTING_TOPICS_IN_PROMPT = 150;

const SUGGEST_TOPICS_INSTRUCTIONS = `You assign one broad subject-area topic label to saved AI chat conversations.

The goal is filtering: users pick a topic to see chats about that activity or domain (e.g. bread making, cooking, programming).

Given a chat title, excerpt, and the user's existing topic list, return exactly 1 broad label (1–3 words).

Rules:
- REUSE FIRST: when existing topics are provided, pick the best-fitting label from that list
  - Use exact spelling from the list when reusing
  - Only propose a new label when nothing on the list reasonably fits
  - Do not invent synonyms (e.g. do not return "baking" if "bread making" already exists and fits)
- Classify by the user's primary ACTIVITY or subject, not incidental setting, hardware, or aesthetics
  - Ask: "What is this conversation mainly about doing or learning?"
  - Food, recipes, baking, dough, ovens used for cooking → prefer "bread making" or "cooking"
  - Kitchen/stove/oven tweaks done to improve cooking or baking → same food labels, NOT home improvement or kitchen design
  - Use "home improvement" or "kitchen design" only when the chat is mainly about renovation, decor, or construction — not food prep
- Food-domain preference (pick the most specific that fits):
  - Bread, dough, ciabatta, sourdough, fermentation, oven/stone for crust → "bread making" (prefer over generic "baking" or "cooking")
  - General meals, recipes, spices, cuisines without a bread focus → "cooking"
- Labels must be general subject areas, NOT specific recipes, dishes, or narrow subtopics
  Good: "bread making", "cooking", "programming", "music"
  Bad: "chicken korma", "ciabatta", "cast iron griddle", "react hooks"
- Return exactly 1 label unless the conversation has two equally primary unrelated subjects (rare); default to 1

Examples:
- "Baking ciabatta at home" → bread making
- "Same-day ciabatta bread" → bread making
- "Adding stone effect to the stove" (stone slab in oven for baking) → bread making or cooking — NOT home improvement, NOT kitchen design
- "Chicken korma recipe" → cooking
- "Remodeling kitchen cabinets and countertops" → home improvement

Output a JSON object with one key "topics": an array of exactly 1 topic label string.`;

function formatExistingTopicsForPrompt(existingTopicNames: string[]): string {
    const unique = [...new Set(existingTopicNames.map((n) => n.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b),
    );
    if (unique.length === 0) {
        return "Existing topics for this user: (none yet — you may propose new broad labels)";
    }

    const listed = unique.slice(0, MAX_EXISTING_TOPICS_IN_PROMPT);
    const lines = listed.map((name) => `- ${name}`).join("\n");
    const truncated =
        unique.length > listed.length
            ? `\n… and ${unique.length - listed.length} more (still prefer reusing any listed label when it fits)`
            : "";

    return `Existing topics for this user (reuse when possible — exact spelling):\n${lines}${truncated}`;
}

function buildSuggestTopicsInput(
    title: string,
    turns: Array<{ prompt: string; response: string }>,
    existingTopicNames: string[],
): string {
    const combined = combineChatText(turns);
    const excerpt =
        combined.length > MAX_CONTEXT_CHARS
            ? combined.slice(0, MAX_CONTEXT_CHARS) + "…"
            : combined;

    return `${formatExistingTopicsForPrompt(existingTopicNames)}

Title: ${title}

Excerpt:
${excerpt}`;
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

/** Ask OpenAI for 1 topic label, biasing toward existingTopicNames when provided. */
export async function suggestTopicsWithLLM(
    title: string,
    turns: Array<{ prompt: string; response: string }>,
    existingTopicNames: string[] = [],
): Promise<string[]> {
    try {
        const openai = getOpenAI();
        const response = await openai.responses.parse({
            model: SUGGEST_TOPICS_MODEL,
            instructions: SUGGEST_TOPICS_INSTRUCTIONS,
            input: buildSuggestTopicsInput(title, turns, existingTopicNames),
            text: {
                format: zodTextFormat(TopicsSchema, "topic_suggestions"),
            },
        });

        if (response.status !== "completed") {
            console.warn(
                "[suggestTopicsWithLLM] Response not completed:",
                response.status,
                response.error,
            );
            return [];
        }

        const parsed = response.output_parsed;
        if (!parsed) {
            console.warn("[suggestTopicsWithLLM] Invalid response shape");
            return [];
        }

        return parsed.topics
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[suggestTopicsWithLLM] Failed to suggest topics:", message);
        return [];
    }
}

/**
 * LLM topic suggestion for auto-tagging on save.
 * Uses structured output via responses.parse; prompts/responses are not logged.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as dotenv from "dotenv";
import { combineChatText } from "./embeddings.js";
import { applyTopicSuggestionGuardrails } from "./topicSuggestionGuardrails.js";

dotenv.config();

const TopicsSchema = z.object({
    topics: z.array(z.string()).max(2),
});

export const SUGGEST_TOPICS_MODEL =
    process.env.CHATVAULT_SUGGEST_TOPICS_MODEL?.trim() || "gpt-4o-mini";

const MAX_CONTEXT_CHARS = 2000;
const MAX_EXISTING_TOPICS_IN_PROMPT = 150;

const SUGGEST_TOPICS_INSTRUCTIONS = `You assign broad subject-area topic labels to saved AI chat conversations.

The goal is filtering: users pick topics to see chats in that domain (e.g. filter "cooking" OR "bread making" to find food chats).

Given a chat title, excerpt, and the user's existing topic list, return 1–2 broad labels (1–3 words each).

Rules:
- REUSE FIRST: when existing topics are provided, pick labels from that list when they fit
  - Use exact spelling from the list when reusing
  - Only propose a new label when nothing on the list reasonably fits
  - Do not invent synonyms (e.g. do not return "baking" if "bread making" already exists)
  - NEVER reuse "home improvement" or "kitchen design" for food, cooking, baking, or bread conversations — even if those labels are on the list
- Classify by the user's primary ACTIVITY or subject, not incidental setting, hardware, or aesthetics
  - Kitchen/stove/oven tweaks done to improve cooking or baking → food labels, NOT home improvement or kitchen design
  - Use "home improvement" or "kitchen design" only for renovation, decor, or construction — not food prep
- When to return 1 vs 2 labels:
  - Return 1 when a single domain clearly dominates (e.g. a curry recipe → cooking only)
  - Return 2 when the chat genuinely spans both a specific sub-domain AND a broader one that users might filter on separately
    - Bread/dough/baking chats (ciabatta, sourdough, oven stone for crust) → ["bread making", "cooking"] so they appear under either filter
    - Do NOT add a second label unless it helps filtering (related pair like bread making + cooking, not cooking + music)
- Food-domain preference:
  - Bread-focused → always include "bread making"; also include "cooking" when the chat is about making food (most bread chats)
  - General meals/recipes without bread focus → "cooking" only
- Labels must be general subject areas, NOT specific recipes or narrow subtopics
  Good: "bread making", "cooking"
  Bad: "chicken korma", "ciabatta", "home improvement" (for a bread oven hack)

Examples:
- "Baking ciabatta at home" → bread making, cooking
- "Same-day ciabatta bread" → bread making, cooking
- "Adding stone effect to the stove" (stone slab for baking) → bread making, cooking
- "Chicken korma recipe" → cooking
- "Remodeling kitchen cabinets" → home improvement

Output a JSON object with one key "topics": an array of 1–2 topic label strings.`;

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

/** Ask OpenAI for 1–2 topic labels, biasing toward existingTopicNames when provided. */
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

        return applyTopicSuggestionGuardrails(
            title,
            turns,
            parsed.topics
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 2),
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[suggestTopicsWithLLM] Failed to suggest topics:", message);
        return [];
    }
}

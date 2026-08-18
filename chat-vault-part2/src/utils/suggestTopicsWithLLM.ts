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
    topics: z.array(z.string()).max(2),
});

export const SUGGEST_TOPICS_MODEL =
    process.env.CHATVAULT_SUGGEST_TOPICS_MODEL?.trim() || "gpt-4o-mini";

const MAX_CONTEXT_CHARS = 2000;
const MAX_EXISTING_TOPICS_IN_PROMPT = 150;

const SUGGEST_TOPICS_INSTRUCTIONS = `You assign broad subject-area topic labels to saved AI chat conversations.

The goal is filtering: users pick topics to see only chats in that domain (e.g. recipes and cooking, not programming or music).

Given a chat title, excerpt, and the user's existing topic list, return 1–2 broad topic labels (1–3 words each).

Rules:
- REUSE FIRST: when existing topics are provided, strongly prefer picking labels from that list
  - Use the exact spelling from the existing list when reusing
  - Only propose a new label when no existing topic reasonably fits the chat's primary domain
  - Do not invent synonyms (e.g. do not return "home cooking" if "cooking" already exists)
- New labels (only when necessary) must be general subject areas, NOT specific recipes, dishes, tools, or narrow subtopics
  Good: "cooking", "bread making", "programming", "music", "home improvement"
  Bad: "chicken korma", "ciabatta", "react hooks", "python asyncio", "kantian ethics"
- Identify the primary domain of the conversation; ignore minor tangents
- When multiple domains apply equally, return at most 2 labels; otherwise return 1
- No duplicates in the response

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

        return parsed.topics
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 2);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[suggestTopicsWithLLM] Failed to suggest topics:", message);
        return [];
    }
}

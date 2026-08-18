/**
 * Guardrails on LLM topic suggestions — prompt alone is not always enough.
 */

import { combineChatText } from "./embeddings.js";
import { normalizeTopicName } from "./topicNames.js";

/** Labels that describe setting/hardware/aesthetics, not food activity. */
const SETTING_TOPIC_NORMS = new Set(
    ["home improvement", "kitchen design", "interior design", "diy", "renovation"].map(
        normalizeTopicName,
    ),
);

const FOOD_ACTIVITY_RE =
    /\b(bread|baking|bake|ciabatta|sourdough|dough|oven|recipe|cook|cooking|korma|stove|crust|ferment|flour|yeast|meal|food|griddle|stone slab|cast iron|hydration|loaf)\b/i;

const BREAD_FOCUS_RE =
    /\b(bread|baking|bake|ciabatta|sourdough|dough|crust|ferment|flour|yeast|loaf|hydration|oven|stone)\b/i;

function chatText(title: string, turns: Array<{ prompt: string; response: string }>): string {
    return `${title}\n${combineChatText(turns)}`;
}

/**
 * Drop setting/aesthetic labels when the chat is clearly about food activity.
 * Substitute bread making + cooking when nothing remains.
 */
export function applyTopicSuggestionGuardrails(
    title: string,
    turns: Array<{ prompt: string; response: string }>,
    suggested: string[],
): string[] {
    const text = chatText(title, turns);
    if (!FOOD_ACTIVITY_RE.test(text)) {
        return suggested.slice(0, 2);
    }

    const filtered = suggested.filter(
        (label) => !SETTING_TOPIC_NORMS.has(normalizeTopicName(label)),
    );

    if (filtered.length > 0) {
        return filtered.slice(0, 2);
    }

    if (BREAD_FOCUS_RE.test(text)) {
        return ["bread making", "cooking"];
    }

    return ["cooking"];
}

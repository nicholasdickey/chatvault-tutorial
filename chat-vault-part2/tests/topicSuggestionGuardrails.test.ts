import { describe, test, expect } from "@jest/globals";
import { applyTopicSuggestionGuardrails } from "../src/utils/topicSuggestionGuardrails.js";

describe("applyTopicSuggestionGuardrails", () => {
    test("strips home improvement and kitchen design from stove baking chat", () => {
        const result = applyTopicSuggestionGuardrails(
            "Adding stone effect to the stove",
            [{ prompt: "How to add a stone slab for better bread crust?", response: "Use cordierite..." }],
            ["home improvement", "kitchen design"],
        );
        expect(result).toEqual(["bread making", "cooking"]);
    });

    test("keeps bread making and cooking for ciabatta chat", () => {
        const result = applyTopicSuggestionGuardrails(
            "Baking ciabatta at home",
            [{ prompt: "Recipe?", response: "Mix flour and yeast..." }],
            ["bread making", "cooking"],
        );
        expect(result).toEqual(["bread making", "cooking"]);
    });

    test("does not strip labels for non-food chats", () => {
        const result = applyTopicSuggestionGuardrails(
            "Remodeling kitchen cabinets",
            [{ prompt: "Cabinet options?", response: "Shaker style..." }],
            ["home improvement"],
        );
        expect(result).toEqual(["home improvement"]);
    });
});

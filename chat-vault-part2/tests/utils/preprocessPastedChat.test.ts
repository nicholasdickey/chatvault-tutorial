/**
 * Unit tests for preprocessPastedChat — Gemini paste boundary detection and quality validation.
 */

import { describe, it, expect } from "@jest/globals";
import {
    countUserMarkers,
    estimateMinimumTurns,
    injectParseBoundaries,
    preprocessPastedChat,
    cleanupParsedTurn,
    validateParseQuality,
} from "../../src/utils/preprocessPastedChat.js";

/** Minimal slice of the ciabatta Gemini paste (structure only). */
const GEMINI_CIABATTA_SNIPPET = `baking ciabatta at home12:07 PM
Baking ciabatta at home is all about managing a high-hydration dough.
Step-by-Step Method
1. Mixing
31 sites
Homemade Ciabatta Bread - Sally's Baking Addiction
Show all
You said: what about autolyse?12:07 PM
Using an autolyse stage is an excellent way to improve your ciabatta.
14 sites
Reddit discussion
Show all
You said: How to get the best crust in the normal oven?12:08 PM
To get a shatteringly crisp ciabatta crust in a standard home oven.`;

describe("preprocessPastedChat", () => {
    it("counts You said: markers in Gemini paste", () => {
        expect(countUserMarkers(GEMINI_CIABATTA_SNIPPET)).toBe(2);
    });

    it("estimates 3 minimum turns for two You said markers", () => {
        expect(estimateMinimumTurns(GEMINI_CIABATTA_SNIPPET)).toBe(3);
    });

    it("injects USER and CITATION boundaries", () => {
        const out = injectParseBoundaries(GEMINI_CIABATTA_SNIPPET);
        expect(out).toContain("<<<USER>>>");
        expect(out).toContain("<<<CITATIONS");
        expect(out).toContain("31 sites");
        expect(out).toMatch(/home\n12:07 PM/);
    });

    it("preprocess includes parsing hints with expected turn count", () => {
        const result = preprocessPastedChat(GEMINI_CIABATTA_SNIPPET);
        expect(result.estimatedMinTurns).toBe(3);
        expect(result.userMarkerCount).toBe(2);
        expect(result.textForLLM).toContain("Expected minimum turns: 3");
        expect(result.textForLLM).toContain("--- PASTED CONTENT ---");
    });

    it("cleanupParsedTurn strips You said and timestamps from prompt", () => {
        const cleaned = cleanupParsedTurn({
            prompt: "You said: what about autolyse?12:07 PM",
            response: "Using an autolyse stage. 12:07 PM",
        });
        expect(cleaned.prompt).toBe("what about autolyse?");
        expect(cleaned.response).toBe("Using an autolyse stage.");
    });

    it("validateParseQuality rejects middle-turn cherry-pick (1 turn when 3 expected)", () => {
        const badParse = [
            {
                prompt: "what about autolyse?",
                response: "Using an autolyse stage is an excellent way to improve your ciabatta.",
            },
        ];
        const result = validateParseQuality(badParse, GEMINI_CIABATTA_SNIPPET, 3);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/turn count 1/);
    });

    it("validateParseQuality accepts three-turn parse with sufficient content", () => {
        const goodParse = [
            {
                prompt: "baking ciabatta at home",
                response: "Baking ciabatta at home is all about managing a high-hydration dough. Step-by-Step Method 1. Mixing",
            },
            {
                prompt: "what about autolyse?",
                response: "Using an autolyse stage is an excellent way to improve your ciabatta.",
            },
            {
                prompt: "How to get the best crust in the normal oven?",
                response: "To get a shatteringly crisp ciabatta crust in a standard home oven.",
            },
        ];
        const result = validateParseQuality(goodParse, GEMINI_CIABATTA_SNIPPET, 3);
        expect(result.ok).toBe(true);
    });
});

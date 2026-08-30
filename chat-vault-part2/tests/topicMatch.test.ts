import { describe, expect, it } from "@jest/globals";
import { cosineSimilarity, findBestTopicMatch } from "../src/utils/topicMatch.js";

describe("topicMatch", () => {
    it("returns 1 for identical unit vectors", () => {
        const v = [1, 0, 0];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    it("returns 0 for orthogonal vectors", () => {
        expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    });

    it("findBestTopicMatch returns id when above threshold", () => {
        const label = [1, 0, 0];
        const match = findBestTopicMatch(
            label,
            [
                { id: "a", embedding: [0.5, 0.5, 0] },
                { id: "b", embedding: [0.99, 0.01, 0] },
            ],
            0.82
        );
        expect(match).toBe("b");
    });

    it("findBestTopicMatch returns null when below threshold", () => {
        const match = findBestTopicMatch(
            [1, 0, 0],
            [{ id: "a", embedding: [0, 1, 0] }],
            0.82
        );
        expect(match).toBeNull();
    });
});

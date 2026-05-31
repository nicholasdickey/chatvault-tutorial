import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
    getListedTools,
    getToolMetadataProfile,
    normalizeToolName,
    TOOL_NAME_ALIASES,
} from "../src/server.js";

const GPT_SAFE_TOOL_NAMES = [
    "searchKnowledge",
    "loadSavedEntries",
    "loadFullTurn",
    "explainHowToUse",
];

const EXCLUDED_FROM_GPT = [
    "saveConversation",
    "saveConversationBegin",
    "saveConversationTurn",
    "saveConversationFinalize",
    "widgetAdd",
    "updateSavedEntry",
    "deleteSavedEntry",
    "getSaveJobStatus",
    "internalOnlyWidget1",
    "internalOnlyWidget2",
    "internalOnlyWidget3",
    "internalOnlyWidget4",
];

const BROAD_SCHEMA_MARKERS = [
    "htmlContent",
    "turns",
    "turn.prompt",
    "turn.response",
];

describe("tool metadata profiles", () => {
    const originalProfile = process.env.CHATVAULT_TOOL_METADATA_PROFILE;

    afterEach(() => {
        if (originalProfile === undefined) {
            delete process.env.CHATVAULT_TOOL_METADATA_PROFILE;
        } else {
            process.env.CHATVAULT_TOOL_METADATA_PROFILE = originalProfile;
        }
    });

    it("defaults to full profile", () => {
        delete process.env.CHATVAULT_TOOL_METADATA_PROFILE;
        expect(getToolMetadataProfile()).toBe("full");
    });

    it("accepts gpt and limited profile aliases", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        expect(getToolMetadataProfile()).toBe("gpt");

        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "limited";
        expect(getToolMetadataProfile()).toBe("gpt");
    });

    it("lists full metadata with scrambled internal widget names", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const tools = getListedTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toEqual(
            expect.arrayContaining([
                "internalOnlyWidget1",
                "internalOnlyWidget2",
                "internalOnlyWidget3",
                "internalOnlyWidget4",
                "saveConversation",
                "saveConversationBegin",
                "saveConversationTurn",
                "saveConversationFinalize",
                ...GPT_SAFE_TOOL_NAMES,
            ]),
        );
        expect(names).not.toEqual(expect.arrayContaining(["widgetAdd", "updateSavedEntry", "deleteSavedEntry", "getSaveJobStatus"]));
        expect(tools).toHaveLength(12);
    });

    it("lists only GPT-safe tools in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const tools = getListedTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual([...GPT_SAFE_TOOL_NAMES].sort());
        expect(names.some((name) => EXCLUDED_FROM_GPT.includes(name))).toBe(false);
    });

    it("does not expose broad save/import input schemas in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const inputSchemas = getListedTools().map((tool) => tool.inputSchema);
        const serialized = JSON.stringify(inputSchemas);

        for (const marker of BROAD_SCHEMA_MARKERS) {
            expect(serialized.includes(marker)).toBe(false);
        }
    });

    it("normalizes scrambled widget tool names to legacy handlers", () => {
        expect(normalizeToolName("internalOnlyWidget1")).toBe("widgetAdd");
        expect(normalizeToolName("internalOnlyWidget2")).toBe("updateSavedEntry");
        expect(normalizeToolName("internalOnlyWidget3")).toBe("deleteSavedEntry");
        expect(normalizeToolName("internalOnlyWidget4")).toBe("getSaveJobStatus");
        expect(normalizeToolName("searchKnowledge")).toBe("searchKnowledge");
        expect(Object.keys(TOOL_NAME_ALIASES)).toHaveLength(4);
    });
});

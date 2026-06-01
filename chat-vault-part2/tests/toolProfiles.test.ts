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

const LLM_SAVE_TOOL_NAMES = [
    "saveConversation",
    "saveConversationBegin",
    "saveConversationTurn",
    "saveConversationFinalize",
];

const LEGACY_WIDGET_TOOL_NAMES = [
    "widgetAdd",
    "updateSavedEntry",
    "deleteSavedEntry",
    "getSaveJobStatus",
];

const GPT_PROFILE_TOOL_NAMES = [
    "internalOnlyWidget1",
    "internalOnlyWidget2",
    "internalOnlyWidget3",
    "internalOnlyWidget4",
    ...GPT_SAFE_TOOL_NAMES,
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

    it("lists scrambled widget tools plus read/search tools in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const tools = getListedTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual([...GPT_PROFILE_TOOL_NAMES].sort());
        expect(names.some((name) => LLM_SAVE_TOOL_NAMES.includes(name))).toBe(false);
        expect(names.some((name) => LEGACY_WIDGET_TOOL_NAMES.includes(name))).toBe(false);
        expect(tools).toHaveLength(8);
    });

    it("uses the same scrambled widget metadata in gpt and full profiles", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const fullWidgetTools = getListedTools().filter((tool) =>
            tool.name.startsWith("internalOnlyWidget"),
        );

        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const gptWidgetTools = getListedTools().filter((tool) =>
            tool.name.startsWith("internalOnlyWidget"),
        );

        expect(gptWidgetTools).toEqual(fullWidgetTools);
    });

    it("does not expose LLM save/import tools in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const saveToolNames = getListedTools()
            .map((tool) => tool.name)
            .filter((name) => name.startsWith("saveConversation"));

        expect(saveToolNames).toEqual([]);
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

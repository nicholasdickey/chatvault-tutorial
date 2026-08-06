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

const WIDGET_TOOL_NAMES = [
    "savePastedContent",
    "updateSavedEntry",
    "deleteSavedEntry",
    "getSaveJobStatus",
];

const GPT_PROFILE_TOOL_NAMES = [
    ...WIDGET_TOOL_NAMES,
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

    it("lists functional widget tools and model save tools in full profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const tools = getListedTools();
        const names = tools.map((tool) => tool.name);

        expect(names).toEqual(
            expect.arrayContaining([
                ...WIDGET_TOOL_NAMES,
                "saveConversation",
                "saveConversationBegin",
                "saveConversationTurn",
                "saveConversationFinalize",
                ...GPT_SAFE_TOOL_NAMES,
            ]),
        );
        expect(tools).toHaveLength(12);
    });

    it("lists app-only widget tools plus read/search tools in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const tools = getListedTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual([...GPT_PROFILE_TOOL_NAMES].sort());
        expect(names.some((name) => LLM_SAVE_TOOL_NAMES.includes(name))).toBe(false);
        expect(tools).toHaveLength(8);
    });

    it("uses the same app-only widget metadata in gpt and full profiles", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const fullWidgetTools = getListedTools().filter((tool) =>
            WIDGET_TOOL_NAMES.includes(tool.name),
        );

        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const gptWidgetTools = getListedTools().filter((tool) =>
            WIDGET_TOOL_NAMES.includes(tool.name),
        );

        expect(gptWidgetTools).toEqual(fullWidgetTools);
        for (const tool of gptWidgetTools) {
            expect((tool._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["app"]);
        }
    });

    it("does not expose LLM save/import tools in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const saveToolNames = getListedTools()
            .map((tool) => tool.name)
            .filter((name) => name.startsWith("saveConversation"));

        expect(saveToolNames).toEqual([]);
    });

    it("gives every listed tool a human-readable title", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const tools = getListedTools();

        for (const tool of tools) {
            expect(tool.title).toBeTruthy();
            expect(tool.title).not.toBe(tool.name);
        }

        const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool.title]));
        expect(byName.saveConversation).toBe("Save conversation");
        expect(byName.saveConversationBegin).toBe("Start multi-turn save");
        expect(byName.saveConversationTurn).toBe("Add save turn");
        expect(byName.saveConversationFinalize).toBe("Finalize multi-turn save");
        expect(byName.searchKnowledge).toBe("Search saved knowledge");
        expect(byName.explainHowToUse).toBe("How to use Chat Vault");
        expect(byName.loadSavedEntries).toBe("Load saved entries");
        expect(byName.loadFullTurn).toBe("Load full turn");
        expect(byName.savePastedContent).toBe("Save pasted content");
        expect(byName.updateSavedEntry).toBe("Update saved entry");
        expect(byName.deleteSavedEntry).toBe("Delete saved entry");
        expect(byName.getSaveJobStatus).toBe("Get save job status");
    });

    it("discloses Chat Vault storage in LLM save tool descriptions", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const saveTools = getListedTools().filter((tool) =>
            LLM_SAVE_TOOL_NAMES.includes(tool.name),
        );

        expect(saveTools).toHaveLength(4);
        for (const tool of saveTools) {
            expect(tool.description).toMatch(/sent to Chat Vault and stored/i);
        }
        const begin = saveTools.find((tool) => tool.name === "saveConversationBegin");
        const finalize = saveTools.find((tool) => tool.name === "saveConversationFinalize");
        expect(begin?.description).toMatch(/Do not poll job status yourself/);
        expect(finalize?.description).toMatch(/Do not poll job status yourself/);
        expect((begin?._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["model"]);
        expect((finalize?._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["model"]);
    });

    it("maps only the renamed paste tool to its implementation handler", () => {
        expect(normalizeToolName("savePastedContent")).toBe("widgetAdd");
        expect(normalizeToolName("updateSavedEntry")).toBe("updateSavedEntry");
        expect(normalizeToolName("deleteSavedEntry")).toBe("deleteSavedEntry");
        expect(normalizeToolName("getSaveJobStatus")).toBe("getSaveJobStatus");
        expect(normalizeToolName("searchKnowledge")).toBe("searchKnowledge");
        expect(Object.keys(TOOL_NAME_ALIASES)).toHaveLength(1);
    });

    it("marks shared read tools for both model and app visibility", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const sharedReadTools = getListedTools().filter((tool) =>
            GPT_SAFE_TOOL_NAMES.includes(tool.name),
        );

        for (const tool of sharedReadTools) {
            expect((tool._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["model", "app"]);
        }
    });
});

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
    getListedTools,
    getToolMetadataProfile,
    normalizeToolName,
    TOOL_NAME_ALIASES,
} from "../src/server.js";
import { explainHowToUse } from "../src/tools/explainHowToUse.js";

const GPT_SAFE_TOOL_NAMES = [
    "searchKnowledge",
    "loadSavedEntries",
    "loadFullTurn",
    "explainHowToUse",
];

const MULTI_TURN_SAVE_TOOL_NAMES = [
    "saveConversationBegin",
    "saveConversationTurn",
    "saveConversationFinalize",
];

const WIDGET_TOOL_NAMES = [
    "savePastedContent",
    "updateSavedEntry",
    "deleteSavedEntry",
    "getSaveJobStatus",
    "listTopics",
];

const GPT_PROFILE_TOOL_NAMES = [
    ...WIDGET_TOOL_NAMES,
    "saveConversation",
    ...MULTI_TURN_SAVE_TOOL_NAMES,
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

    it("omits assistant-driven save instructions from GPT help", () => {
        const result = explainHowToUse({ userId: "reviewer" }, "gpt");

        expect(result.helpText).toContain("Manual Save Using the Widget");
        expect(result.helpText).toContain("Browsing Your Knowledge");
        expect(result.helpText).toContain("Searching Your Knowledge");
        expect(result.helpText).not.toContain("Ask the AI Assistant to Save");
        expect(result.helpText).not.toContain("Paste Content Into the Chat");
        expect(result.helpText).not.toContain("Save this conversation to Chat Vault");
    });

    it("preserves assistant-driven save instructions in full-profile help", () => {
        const result = explainHowToUse({ userId: "reviewer" }, "full");

        expect(result.helpText).toContain("Ask the AI Assistant to Save");
        expect(result.helpText).toContain("Paste Content Into the Chat");
        expect(result.helpText).toContain("Save this conversation to Chat Vault");
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
        expect(tools).toHaveLength(13);
    });

    it("lists app-only widget tools plus read/search tools in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const tools = getListedTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual([...GPT_PROFILE_TOOL_NAMES].sort());
        expect(tools).toHaveLength(13);
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

    it("marks entry replacement and deletion as destructive", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const tools = getListedTools();

        for (const name of ["updateSavedEntry", "deleteSavedEntry"]) {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool?.annotations?.destructiveHint).toBe(true);
        }
    });

    it("keeps every conversation save tool app-only in gpt profile", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
        const tools = getListedTools();

        for (const name of ["saveConversation", ...MULTI_TURN_SAVE_TOOL_NAMES]) {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool).toBeDefined();
            expect((tool?._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["app"]);
        }
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
        expect(byName.listTopics).toBe("List topics");
    });

    it("discloses Chat Vault storage in LLM save tool descriptions", () => {
        process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
        const saveTools = getListedTools().filter((tool) =>
            ["saveConversation", ...MULTI_TURN_SAVE_TOOL_NAMES].includes(tool.name),
        );

        expect(saveTools).toHaveLength(4);
        for (const tool of saveTools) {
            expect(tool.description).toMatch(/sent to Chat Vault and stored/i);
        }
        const begin = saveTools.find((tool) => tool.name === "saveConversationBegin");
        const finalize = saveTools.find((tool) => tool.name === "saveConversationFinalize");
        const shortSave = saveTools.find((tool) => tool.name === "saveConversation");
        expect(begin?.description).toMatch(/Do not poll job status yourself/);
        expect(finalize?.description).toMatch(/Do not poll job status yourself/);
        expect((shortSave?._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["model", "app"]);
        expect((begin?._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["model", "app"]);
        expect((finalize?._meta?.ui as { visibility?: string[] } | undefined)?.visibility).toEqual(["model", "app"]);
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

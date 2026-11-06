/**
 * Mirrors server MCP deployment profile (full vs ChatGPT / Apps SDK).
 * Use for responses that need different copy per host.
 */
export type ToolMetadataProfile = "full" | "gpt";

export function getToolMetadataProfile(): ToolMetadataProfile {
    const raw = (process.env.CHATVAULT_TOOL_METADATA_PROFILE ?? "full").toLowerCase();
    if (raw === "gpt" || raw === "limited") return "gpt";
    return "full";
}

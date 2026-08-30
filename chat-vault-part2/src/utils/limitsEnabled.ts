/**
 * Claude/full deployments retain the existing limit experience. GPT deployments
 * can disable it for app review without requiring a widget rebuild.
 */
export function areChatVaultLimitsEnabled(): boolean {
  const profile = (process.env.CHATVAULT_TOOL_METADATA_PROFILE ?? "full")
    .trim()
    .toLowerCase();
  const isGptProfile = profile === "gpt" || profile === "limited";

  if (!isGptProfile) return true;

  return process.env.CHATVAULT_LIMITS_ENABLED?.trim().toLowerCase() === "true";
}

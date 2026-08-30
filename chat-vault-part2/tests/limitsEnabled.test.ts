import { afterEach, describe, expect, it } from "@jest/globals";
import { areChatVaultLimitsEnabled } from "../src/utils/limitsEnabled.js";

const originalProfile = process.env.CHATVAULT_TOOL_METADATA_PROFILE;
const originalLimitsEnabled = process.env.CHATVAULT_LIMITS_ENABLED;

afterEach(() => {
  if (originalProfile === undefined) delete process.env.CHATVAULT_TOOL_METADATA_PROFILE;
  else process.env.CHATVAULT_TOOL_METADATA_PROFILE = originalProfile;
  if (originalLimitsEnabled === undefined) delete process.env.CHATVAULT_LIMITS_ENABLED;
  else process.env.CHATVAULT_LIMITS_ENABLED = originalLimitsEnabled;
});

describe("areChatVaultLimitsEnabled", () => {
  it("defaults limits off for the GPT profile", () => {
    process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
    delete process.env.CHATVAULT_LIMITS_ENABLED;
    expect(areChatVaultLimitsEnabled()).toBe(false);
  });

  it("enables the complete limit experience for GPT when requested", () => {
    process.env.CHATVAULT_TOOL_METADATA_PROFILE = "gpt";
    process.env.CHATVAULT_LIMITS_ENABLED = "true";
    expect(areChatVaultLimitsEnabled()).toBe(true);
  });

  it("does not change the existing full/Claude profile", () => {
    process.env.CHATVAULT_TOOL_METADATA_PROFILE = "full";
    process.env.CHATVAULT_LIMITS_ENABLED = "false";
    expect(areChatVaultLimitsEnabled()).toBe(true);
  });
});

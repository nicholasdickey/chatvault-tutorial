declare const __CHATVAULT_PROFILE__: "gpt" | "full";

export const chatVaultProfile: "gpt" | "full" = __CHATVAULT_PROFILE__;
export const isGptProfile = chatVaultProfile === "gpt";

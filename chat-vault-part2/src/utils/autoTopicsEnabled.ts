/** When true, newly saved chats receive auto-assigned topics via OpenAI. */
export function isChatVaultAutoTopicsEnabled(): boolean {
    return process.env.CHATVAULT_AUTO_TOPICS?.trim().toLowerCase() === "true";
}

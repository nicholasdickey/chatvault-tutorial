/**
 * explainHowToUse tool implementation
 * Returns help text describing how to use ChatVault
 */

export interface ExplainHowToUseParams {
    userId: string;
}

export interface ExplainHowToUseResult {
    helpText: string;
}

/**
 * Generate help text explaining how to use ChatVault
 */
export function explainHowToUse(params: ExplainHowToUseParams): ExplainHowToUseResult {
    const { userId } = params;

    if (!userId) {
        throw new Error("userId is required");
    }

    console.log("[explainHowToUse] Generating help text for userId:", userId);

    const helpText = `# How to Use ChatVault

ChatVault helps you save, organize, and search your ChatGPT conversations. Think of it as a personal archive for your most valuable chats.

## Saving Conversations

You have three flexible ways to save conversations to your vault:

### 1. Ask ChatGPT to Save
Simply ask ChatGPT to save the current conversation to your vault. You can specify:
- **By subject**: "Save this conversation about [topic] to my ChatVault"
- **By number of turns**: "Save the last 5 turns to my ChatVault"
- **The entire conversation**: "Add this entire chat to my ChatVault"

### 2. Manual Save via Widget
Use the '+' button in the ChatVault widget to manually add conversations:
1. Copy a conversation from ChatGPT (or anywhere)
2. Click the '+' button in the ChatVault widget header
3. Paste the conversation into the text area
4. Optionally add a custom title
5. Click "Save"

## Accessing Your Vault

Just ask ChatGPT to 'browse my chats' or to find a chat in the vault by topic, date, or other criteria.

## Subscription Management

To see your current subscription or to upgrade, ask ChatGPT to "manage my subscription".

## Getting Started

The easiest way to start is to simply ask ChatGPT: "Save this conversation to my ChatVault" or "Add this chat about [topic] to my vault". ChatGPT will handle the rest!

For manual saves, use the '+' button in the widget and paste your conversation. The widget will automatically format and save it.

Need help? Ask ChatGPT or check the widget interface for more options!`;

    return {
        helpText,
    };
}


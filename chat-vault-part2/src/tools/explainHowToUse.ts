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
export const helpText = `# How to Use The Chat Vault App

Chat Vault helps you save, organize, and search your Claude, Gemini, ChatGPT, etc. "aha! moments" and knowledge-building conversations. Think of it as a personal archive for your most valuable chats. Your knowldge base. Your AI chatbot's long-term memory. That you can own and can take with you to any new platform or AI environment.

## Saving Conversations

You have three flexible ways to save conversations to your vault:

### 1. Ask the Chatbot to Save
Simply ask ChatGPT or the chatbot you are using to save the current conversation to your vault. You can specify:
- **By subject**: "Save this conversation about [topic] to my ChatVault"
- **By number of turns**: "Save the last 5 turns to my ChatVault"
- **The entire conversation**: "Add this entire chat to my ChatVault"
Note, in works best when the start is from a fresh chat, and the chatbot is not already in the middle of a long conversation.
If the chatbot is having trouble saving a verbatim chat - you can copy the chat manually, start a new chat, paste the chat into the new chat, and ask the chatbot to parse and save the chat turn-by-turn into the vault.

### 2. Manual Save via Widget
Use the '+' button in the ChatVault widget to manually add conversations or notes:
1. Copy a conversation from Claude, ChatGPT, Gemini, etc. (or anywhere)
2. Click the '+' button in the ChatVault widget header
3. Paste the conversation into the text area
4. Optionally add a custom title
5. Click "Save"

## Accessing Your Vault

Just ask Claude, ChatGPT or whatever the chatbot you are using to 'browse my chats' or to find a chat in the vault by topic, date, or other criteria.
To leverage the true power of Chat Vault, you can ask the chatbot to user the chat vault as your personal knowledge base and search it automatically to include in the context when researching or any other agentic tasks. 

## Getting Started in ChatGPT

The easiest way to start is to simply ask ChatGPT: "Save this conversation to my ChatVault" or "Add this chat about [topic] to my vault". ChatGPT will handle the rest!

For manual saves, use the '+' button in the widget and paste your conversation. The widget will automatically format and save it.

Need help? Ask ChatGPT or check the widget interface for more options!`;

/**
 * Generate help text explaining how to use ChatVault
 */
export function explainHowToUse(params: ExplainHowToUseParams): ExplainHowToUseResult {
    const { userId } = params;

    if (!userId) {
        throw new Error("userId is required");
    }

    console.log("[explainHowToUse] Generating help text for userId:", userId);


    return {
        helpText,
    };
}


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

export type ExplainHowToUseProfile = "full" | "gpt";

export const helpText = `# How to Use Chat Vault

Chat Vault is a personal knowledge base that helps you turn saved notes and conversations into distilled, accessible long-term knowledge using AI.

Use Chat Vault to save useful ideas, research, conversations, and insights so they can be searched and retrieved later using natural language.

## Saving Knowledge

You can save conversations, notes, or other useful content into your vault in several ways.

### 1. Ask the AI Assistant to Save the Conversation
You can ask the AI assistant to save the current conversation or selected turns into Chat Vault.

Examples:
- "Save this conversation to Chat Vault"
- "Save the last 5 turns to Chat Vault"
- "Save this discussion about vector databases"

For best results, save from shorter focused conversations.

### 2. Paste Content Into the Chat
You can paste copied conversation text or notes into the chat and ask the assistant to save it into Chat Vault.

Examples:
- "Save this pasted conversation to Chat Vault"
- "Parse and save this conversation"

### 3. Manual Save Using the Widget
Use the '+' button in the Chat Vault widget to manually save conversations or notes.

1. Copy a conversation, note, or text
2. Click the '+' button in the Chat Vault widget
3. Paste the content
4. Optionally add a title
5. Click "Save"

## Searching Your Knowledge

Ask the assistant to search Chat Vault using natural language.

Examples:
- "Search my knowledge about embeddings"
- "Find saved conversations about MCP"
- "What do I already know about RAG pipelines?"

You can also ask the assistant to use Chat Vault as additional context during research, brainstorming, or other AI-assisted workflows.

## Getting Started

A simple way to begin is:

- "Save this conversation to Chat Vault"
- "Search my saved knowledge about AI agents"

You can also manually save content using the Chat Vault widget.`;

export const gptHelpText = `# How to Use Chat Vault

Chat Vault is a personal knowledge base that helps you turn saved notes and conversations into distilled, accessible long-term knowledge using AI.

Use Chat Vault to save useful ideas, research, conversations, and insights so they can be searched and retrieved later using natural language.

## Saving Knowledge

### Manual Save Using the Widget
Use the '+' button in the Chat Vault widget to manually save conversations or notes.

1. Copy a conversation, note, or text
2. Click the '+' button in the Chat Vault widget
3. Paste the content
4. Optionally add a title
5. Click "Save"

## Browsing Your Knowledge

Open the Chat Vault widget to browse the conversations and notes already saved in your vault.

## Searching Your Knowledge

Ask the assistant to search Chat Vault using natural language.

Examples:
- "Search my knowledge about embeddings"
- "Find saved conversations about MCP"
- "What do I already know about RAG pipelines?"

You can also ask the assistant to use Chat Vault as additional context during research, brainstorming, or other AI-assisted workflows.

## Getting Started

- Open Chat Vault to browse your saved knowledge
- Use the '+' button in the widget to manually save content
- Ask the assistant to search your saved knowledge`;

/**
 * Generate help text explaining how to use ChatVault
 */
export function explainHowToUse(
    params: ExplainHowToUseParams,
    profile: ExplainHowToUseProfile = "full",
): ExplainHowToUseResult {
    const { userId } = params;

    if (!userId) {
        throw new Error("userId is required");
    }

    console.log("[explainHowToUse] Generating help text for userId:", userId);


    return {
        helpText: profile === "gpt" ? gptHelpText : helpText,
    };
}

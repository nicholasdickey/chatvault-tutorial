# Claude App Directory - End-user listing copy (draft)

**Date:** 2026-08-02  
**Product framing:** Chat Vault by Genisent is a **personal knowledge base**, not Claude-only memory. Save conversations from any AI chat, plus ideas and notes; then bring that knowledge into Claude and other AI chats as searchable context.

Related tool titles/descriptions: [anthropic-directory-tool-surface-proposal.md](./anthropic-directory-tool-surface-proposal.md).

---

## Short description (directory card / one-liner)

**Chat Vault by Genisent.** A personal knowledge base. Save conversations from any AI chat, plus ideas and notes, then include them in Claude and other AI chats as searchable context.

---

## Full description (directory detail page)

### Chat Vault by Genisent

Chat Vault is your personal knowledge base. Capture conversations from any AI chat, along with ideas and notes you want to keep. When you use Chat Vault with Claude (or other AI chats via connectors), that stored knowledge can be searched and included as context, so useful work carries forward instead of disappearing in old threads.

**What you can do**

- **Save** conversations, ideas, and notes into your personal vault (from Claude here, and from other AI chats via Chat Vault / connectors)
- **Search** your vault by meaning and pull matching knowledge into the current chat as context
- **Browse** and manage what you've stored in the Chat Vault app UI

**Storage model (plain language)**

- Content you choose to save is **sent to Chat Vault and stored** in your personal knowledge base.
- You control what is kept; Claude (and other connected AI chats) can search and use that knowledge when you use this connector.
- Paste/import flows may use OpenAI models to parse unstructured chat text into turns, and OpenAI embeddings (`text-embedding-3-small`) for semantic search. See the Chat Vault privacy policy for current model details.

**Who it's for**

Anyone building a durable personal knowledge base from AI conversations, ideas, and notes, and who wants that knowledge available again inside Claude and other AI chats.

---

## Tagline options (pick one)

1. Your personal knowledge base for AI conversations, ideas, and notes.
2. Save from any AI chat. Search it back into Claude and beyond.
3. Personal knowledge that travels with you across AI chats.

**Recommended:** option 1, or the short description above for the card.

---

## Capability bullets (for listing form / "what this app does")

Use live tool names if the form asks for capabilities:

- Save conversation (`saveConversation`)
- Save long conversations turn by turn (`saveConversationBegin` / `saveConversationTurn` / `saveConversationFinalize`)
- Search saved knowledge (`searchKnowledge`)
- Browse Chat Vault UI (`browseMyChatVault`)
- How to use Chat Vault (`explainHowToUse`)

Do **not** list widget-internal tools (`internalOnlyWidget*`) as end-user Claude capabilities.

---

## Privacy blurb (if the directory has a short privacy field)

Chat Vault stores content you explicitly save in your personal knowledge base. For paste/import parsing and vector search, Chat Vault uses OpenAI models (parser models configured in production, and `text-embedding-3-small` for embeddings). Full details: Chat Vault / Genisent privacy policy.

---

## Suggested reply framing to Anthropic (end-user listing)

> Chat Vault by Genisent is a personal knowledge base. Users save conversations from any AI chat, plus ideas and notes; that content is sent to Chat Vault and stored. In Claude (and other AI chats via connectors), saved knowledge can be searched and included as context. Listing capabilities match the live tools: saveConversation (and multi-turn save helpers), searchKnowledge, browseMyChatVault, and explainHowToUse.

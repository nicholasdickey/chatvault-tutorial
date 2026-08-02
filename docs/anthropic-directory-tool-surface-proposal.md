# Anthropic MCP Directory — LLM Tool Titles & Descriptions

**Date:** 2026-08-02  
**Source of truth:** part2 `Tool.title` + `Tool.description` in [`chat-vault-part2/src/server.ts`](../chat-vault-part2/src/server.ts).  
**Agentsyx upstream:** overrides only (you will check/clear id-duplicate titles yourself).  
**Out of scope:** path/URL issues, widget name unscrambling, frontend dual builds.

---

## Anthropic requirements this copy addresses

1. Human-readable **`title`** on every tool (not a copy of `name`).
2. Save descriptions state plainly that conversation content is **sent to Chat Vault and stored**.
3. Names stay as live today (`saveConversation*`, etc.); update the directory listing to match — do not rename tools back to `saveChat*`.

Privacy policy model naming is separate (OpenAI parse models + `text-embedding-3-small`).

---

## Final copy — part2 tools

Use these strings when implementing. `name` is unchanged.

### LLM save family (must satisfy storage disclosure)

#### `saveConversation`

- **title:** `Save conversation`
- **description:**  
  `Save a short conversation the user selected (up to about 3 turns). The conversation content is sent to Chat Vault and stored in the user's personal vault. Prefer this for short saves. On success, tell the user their conversation was saved (or is being saved). For longer conversations, use saveConversationBegin, then saveConversationTurn for each turn in order, then saveConversationFinalize.`

#### `saveConversationBegin`

- **title:** `Start multi-turn save`
- **description:**  
  `Begin a multi-turn save session for a longer conversation. Call this first, then call saveConversationTurn for each turn in order, then call saveConversationFinalize. After finalize, the conversation content is sent to Chat Vault and stored in the user's personal vault. Pass the returned jobId into each saveConversationTurn and into saveConversationFinalize. Do not poll job status yourself.`

#### `saveConversationTurn`

- **title:** `Add save turn`
- **description:**  
  `Add one turn (prompt and response) to an open multi-turn save session. Call after saveConversationBegin, once per turn, with the session jobId and turnIndex 0, 1, 2, and so on without skipping. Content is accumulated and will be sent to Chat Vault and stored when saveConversationFinalize is called.`

#### `saveConversationFinalize`

- **title:** `Finalize multi-turn save`
- **description:**  
  `Finalize a multi-turn save session after all turns have been added (pass the session jobId from saveConversationBegin). The full conversation content is sent to Chat Vault and stored in the user's personal vault. On success, tell the user their conversation was saved (or is being saved). Do not poll job status yourself.`

### Note on `jobId`

- **`jobId` is still needed** as a session handle: Begin → Turn(s) → Finalize must pass the same id.
- **Status polling** (`internalOnlyWidget4`) stays widget-only. LLM save descriptions must **not** tell Claude to call a job-status tool.
- Short `saveConversation` may also return a queue `jobId` or a sync `chatId` in structured content; the model should treat that as an implementation detail and confirm save to the user, not chase status via an INTERNAL tool.
---

### Other LLM-facing tools

#### `searchKnowledge`

- **title:** `Search saved knowledge`
- **description:**  
  `Search the user's Chat Vault with semantic search. Use matching saved conversations as context when answering. Only searches content the user has previously stored in Chat Vault.`

#### `explainHowToUse`

- **title:** `How to use Chat Vault`
- **description:**  
  `Return help text explaining how to save conversations to Chat Vault, search stored knowledge, and open the Chat Vault browser.`

#### `loadSavedEntries`

- **title:** `Load saved entries`
- **description:**  
  `Load a paginated list of the user's saved Chat Vault entries, with optional text filtering. Used to browse or inspect what is already stored.`

#### `loadFullTurn`

- **title:** `Load full turn`
- **description:**  
  `Load the full content of one saved turn when a listed entry was returned truncated. Requires entryId and turnIndex.`

---

### Widget-internal tools (titles for schema completeness; keep INTERNAL in description)

Not for the Claude directory capability list. Still get real titles so `tools/list` is never title-less.

#### `internalOnlyWidget1`

- **title:** `Widget save (internal)`
- **description:**  
  `INTERNAL ONLY. Called by the Chat Vault widget UI. Do not call from assistant or model responses. Saves user-pasted HTML or text; content is sent to Chat Vault and stored after parsing.`

#### `internalOnlyWidget2`

- **title:** `Widget update (internal)`
- **description:**  
  `INTERNAL ONLY. Called by the Chat Vault widget UI. Do not call from assistant or model responses. Updates title and/or turns on a saved entry already stored in Chat Vault.`

#### `internalOnlyWidget3`

- **title:** `Widget delete (internal)`
- **description:**  
  `INTERNAL ONLY. Called by the Chat Vault widget UI. Do not call from assistant or model responses. Deletes a saved entry from Chat Vault.`

#### `internalOnlyWidget4`

- **title:** `Save job status (internal)`
- **description:**  
  `INTERNAL ONLY. Called by the Chat Vault widget UI. Do not call from assistant or model responses. Polls status of an async save job (pending, completed, failed, or expired).`

---

### part-mcp-app (already set; no change required)

#### `browseMyChatVault`

- **title:** `Browse Chat Vault` (existing)
- **description:**  
  `Open the Chat Vault widget to browse, search, and manage saved knowledge.` (existing — optional later tweak only)

---

## Quick reference table

| name | title |
|---|---|
| `saveConversation` | Save conversation |
| `saveConversationBegin` | Start multi-turn save |
| `saveConversationTurn` | Add save turn |
| `saveConversationFinalize` | Finalize multi-turn save |
| `searchKnowledge` | Search saved knowledge |
| `explainHowToUse` | How to use Chat Vault |
| `loadSavedEntries` | Load saved entries |
| `loadFullTurn` | Load full turn |
| `internalOnlyWidget1` | Widget save (internal) |
| `internalOnlyWidget2` | Widget update (internal) |
| `internalOnlyWidget3` | Widget delete (internal) |
| `internalOnlyWidget4` | Save job status (internal) |
| `browseMyChatVault` | Browse Chat Vault |

---

## Implementation (when approved)

1. In part2 `server.ts`, add `title` and replace `description` on each tool with the copy above.
2. Keep `CHATVAULT_TOOL_METADATA_PROFILE` behavior unchanged (`full` lists saves; `gpt` hides them).
3. You clear conflicting Agentsyx upstream title overrides.
4. Privacy policy: name production OpenAI parse + embedding models (separate from this code change).

## Listing note for Anthropic reply

Update the directory listing to these live names (`saveConversation*`, `searchKnowledge`, `browseMyChatVault`, …). Do not advertise `internalOnlyWidget*` / old `widgetAdd` / `deleteChat` / `updateChat` as Claude-facing capabilities.

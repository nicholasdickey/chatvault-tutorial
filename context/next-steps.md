# Next Steps - Prompt4 Implementation

## Overview

According to `prompts/part1/chatVaultPrompts.md`, Prompt4 requires implementing the actual ChatVault functionality.

## Required Changes

### 1. MCP Tool Implementation

**Current State:**

- Tool name: `chat-vault` (placeholder)
- Parameter: `pizzaTopping` (wrong - leftover from pizzaz)
- Response: Generic "Opened ChatVault!" message

**Required:**

- Tool name: `browseSavedChats`
- Parameters: None (or search query if needed)
- Response: Should trigger widget display

**Actions to Implement:**

1. `saveChat`: Save current conversation
   - Need to store chat data somewhere (file system? database?)
   - Format: JSON with metadata (title, date, content)
2. `loadChats`: Load saved conversations
   - Read from storage
   - Return list of chats
3. `searchChat`: Search saved conversations
   - Filter by query string
   - Return matching chats
4. `browseSavedChats`: Browse and display saved chats
   - This is the widget action
   - Should return widget resource

### 2. Widget UI Implementation

**Current State:**

- Placeholder showing "No chats found"
- Static UI with "Save Chat" button (non-functional)

**Required:**

- Display list of saved chats
- Each chat item should show:
  - Title/name
  - Date saved
  - Preview/snippet
- Search/filter functionality
- "Save Chat" button functionality
- Click to view full chat

**File to Update:**

- `src/chat-vault/index.jsx`

### 3. Storage Implementation

**Decision Needed:**

- Where to store saved chats?
  - File system: `~/.chatvault/chats/` or `./data/chats/`
  - JSON files: One file per chat or single JSON array
  - Database: SQLite? (probably overkill for now)

**Recommendation:**

- Start with file system storage
- Directory: `mcp_server/data/chats/`
- Format: JSON files, one per chat
- Filename: `{timestamp}-{slug}.json`
- Metadata file: `chats.json` with index of all chats

### 4. Tool Schema Updates

**File:** `mcp_server/src/server.ts`

**Current:**

```typescript
inputSchema: {
  type: "object",
  properties: {
    pizzaTopping: { type: "string", ... }
  },
  required: ["pizzaTopping"]
}
```

**Required:**

```typescript
// For browseSavedChats - no parameters needed
inputSchema: {
  type: "object",
  properties: {},
  required: []
}

// For saveChat - need chat data
inputSchema: {
  type: "object",
  properties: {
    title: { type: "string" },
    content: { type: "string" },
    // ... other metadata
  },
  required: ["title", "content"]
}
```

### 5. Widget Data Passing

**Current:**

- Widget receives no data (empty `places` array)
- Widget HTML is static

**Required:**

- Pass chat data to widget
- Options:
  1. Embed data in widget HTML (inline JSON)
  2. Use MCP resource with data URI
  3. Widget makes MCP requests itself (probably not)

**Recommendation:**

- Embed chat list as JSON in widget HTML
- Use `<script type="application/json" id="chat-data">` tag
- Widget reads this on mount

## Implementation Checklist

- [ ] Create storage directory structure
- [ ] Implement `saveChat` function
- [ ] Implement `loadChats` function
- [ ] Implement `searchChat` function
- [ ] Update `browseSavedChats` tool to load and pass data
- [ ] Update widget to display chat list
- [ ] Implement search/filter in widget
- [ ] Implement "Save Chat" button functionality
- [ ] Update tool schemas
- [ ] Update tests to match new tool names/schemas
- [ ] Test end-to-end flow

## Files to Modify

1. `mcp_server/src/server.ts`

   - Add storage functions
   - Update tool definitions
   - Update tool handlers
   - Pass data to widget HTML

2. `src/chat-vault/index.jsx`

   - Implement chat list display
   - Add search functionality
   - Add save chat functionality
   - Style the UI

3. `tests/browse-saved-chats.test.ts`
   - Update tool name from `chat-vault` to `browseSavedChats`
   - Update parameter expectations
   - Add tests for save/load/search

## Testing Strategy

1. **Unit Tests:**

   - Storage functions (save/load/search)
   - Data formatting

2. **Integration Tests:**

   - MCP tool calls
   - Widget data passing

3. **E2E Tests:**
   - Full save → browse → search flow
   - Widget rendering with data

## Notes

- Keep it simple for Prompt4 - file-based storage is fine
- Can enhance with database later if needed
- Widget should be functional but doesn't need to be perfect
- Focus on core functionality first

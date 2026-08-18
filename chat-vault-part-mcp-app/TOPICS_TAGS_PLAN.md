# ChatVault Topics Feature Plan

Date: August 18, 2026  
Status: Planning (decisions locked: ANY filter, Topic label, backfill included)  
Systems: `chat-vault-part2` (MCP backend + DB), `chat-vault-part-mcp-app` (widget UI), `monorepo/apps/mcp-worker` (async save worker)

## Context

The MCP performance pass is complete (see [mcp-performance-retrospective-2026-08.md](/home/nick/monorepo/apps/saas-starter/docs/performance/mcp-performance-retrospective-2026-08.md)). Warm list loads are now ~850 ms end-to-end with `chatsQuery` around 189 ms. New feature work must preserve that path: no extra embeddings on list reads, no synchronous OpenAI calls on the widget load path, and topic metadata kept small in list responses.

This plan adds **topics** (labeled **Topic** in the UI) for organizing and filtering saved chats.

## Goals

1. **Filter bar**: multi-select topic filter above the chats table, with a combobox that supports picking existing topics and free-typing new ones.
2. **Auto-tag on save**: when a chat is saved, assign one or more existing topics by semantic match, or create new topics when no good match exists.
3. **Display topics on chats**: show topic chips on each row in the chats list.
4. **Manual topic edit**: allow users to add/remove topics on a chat using the same combobox UX as the filter bar.
5. **Preserve performance**: topic assignment runs asynchronously on the save path; list/filter queries stay SQL-only with no embedding loads.

## Non-goals (v1)

- Topic hierarchy (parent/child topics)
- Shared topics across users
- Topic rename/merge admin UI (can be a follow-up)
- Replacing semantic text search (`query` on `loadSavedEntries`) with topic-only search
- LLM-facing tools for topic management (widget-only for manual edits in v1)

## Terminology

| Layer | Term |
| --- | --- |
| Database / API | `topic` |
| UI copy | **Topic** (confirmed — use "Topic" / "Topics" everywhere in widget copy) |
| Filter state | `selectedTopicIds: string[]` |
| Filter semantics | **ANY** — a chat matches if it has at least one of the selected topics |

## Current architecture (relevant pieces)

```text
chat-vault-part-mcp-app (widget)
  └─ callServerTool("loadSavedEntries" | "updateSavedEntry" | "widgetAdd" | ...)
       ↓
chat-vault-part2 (Vercel MCP server)
  └─ loadMyChats / updateChat / saveChat / widgetAdd
       ↓
Neon PostgreSQL (chats + pgvector embeddings)
       ↓ (async)
monorepo/apps/mcp-worker
  └─ processChatSaveJob → saveChatCore → embeddings + insert
```

Today:

- `chats` table: `id`, `userId`, `title`, `timestamp`, `turns`, `embedding`
- List reads use `chatListSelection` (no embedding column) via Neon HTTP
- Text search uses vector similarity on chat embeddings
- Saves queue to Redis; worker generates embedding and inserts

There is **no topic model** today.

---

## Proposed data model

### Tables

```sql
-- Canonical topic per user (case-insensitive unique name within user scope)
CREATE TABLE topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,           -- display name, e.g. "React hooks"
  name_norm   TEXT NOT NULL,           -- lower(trim(name)) for dedup
  embedding   vector(1536),            -- text-embedding-3-small on topic name (+ optional description later)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX topics_user_name_norm_idx ON topics (user_id, name_norm);
CREATE INDEX topics_user_id_idx ON topics (user_id);

-- Many-to-many: a chat can have multiple topics
CREATE TABLE chat_topics (
  chat_id   UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  topic_id  UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  source    TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, topic_id)
);

CREATE INDEX chat_topics_topic_id_idx ON chat_topics (topic_id);
CREATE INDEX chat_topics_chat_id_idx ON chat_topics (chat_id);
```

### Design notes

- **Normalized topics** (not a JSON array on `chats`) so autocomplete, dedup, and semantic matching stay consistent.
- **`name_norm`** avoids duplicate topics like "React" vs "react".
- **`source`** distinguishes auto-assigned vs manually edited topics (useful for analytics and future "don't overwrite manual topics" rules).
- Topic embeddings are **small** (name-only in v1) and used only on save/auto-tag paths, never on list reads.

### Drizzle schema additions

Extend `chat-vault-part2/src/db/schema.ts` with `topics`, `chatTopics`, relations, and types. Generate migration via existing `db:generate` / `db:migrate` workflow.

---

## Semantic auto-tagging on save

### When it runs

After `saveChatCore` successfully inserts a chat (both sync fallback and async worker path):

1. Chat embedding already exists (generated for the chat body).
2. Run topic assignment as a **post-save step** in the worker / sync path.
3. Do **not** block the MCP tool response waiting for topic assignment in the async path (same pattern as embeddings today).

For sync/test path without Redis, topic assignment can run inline after insert since tests expect synchronous behavior.

### Algorithm (v1)

```text
Input: userId, chatId, title, turns (or combined chat text)

1. Fetch user's existing topics (id, name, embedding) — typically small N
2. Ask OpenAI for suggested topic labels (structured output, 1–3 short labels)
   - Prompt includes title + first ~2k chars of combined turns
   - Constrain: lowercase-friendly short phrases, no duplicates in response
3. For each suggested label:
   a. Normalize name → name_norm
   b. Exact match on name_norm → use existing topic
   c. Else if user has topics with embeddings:
        - Embed the suggested label (or reuse batch)
        - Find best cosine similarity among user's topics
        - If similarity ≥ TOPIC_MATCH_THRESHOLD (start with 0.82), use existing
   d. Else create new topic:
        - Insert topic with name + embedding
4. Insert chat_topics rows (source = 'auto'), ON CONFLICT DO NOTHING
```

### OpenAI usage

| Call | Model | When | Notes |
| --- | --- | --- | --- |
| Topic suggestion | `gpt-4o-mini` (or current cost-effective model) | After chat save | JSON schema: `{ topics: string[] }`, max 3 |
| Topic name embedding | `text-embedding-3-small` | New topic or similarity check | Reuse existing `embeddings.ts` helpers |

Keep prompts and responses out of production logs (consistent with performance retrospective sanitization).

### Thresholds and limits

- `TOPIC_MATCH_THRESHOLD`: 0.82 initial; tune with fixtures
- Max topics per chat (auto): 3
- Max topic name length: 64 chars (truncate/normalize in API)
- Max topics per user: soft cap 200 (return error on manual create if exceeded)

### Worker changes

`monorepo/apps/mcp-worker` has a fork of `saveChatCore`. Topic assignment logic should live in a **shared module pattern**:

- Implement in `chat-vault-part2/src/utils/assignTopics.ts`
- Port/copy to `monorepo/apps/mcp-worker/src/chatvault/assignTopics.ts` (same approach as existing `saveChatCore` duplication), **or** extract a tiny shared package later if duplication becomes painful.

Call `assignTopicsForChat(...)` at end of `processChatSaveJob` after successful DB insert.

---

## Backend API / MCP tool changes

### 1. Extend `loadSavedEntries` (`loadMyChats`)

**New input:**

```ts
topicIds?: string[];   // filter: chats matching ANY selected topic (confirmed semantics)
// topicMatch "all" deferred to v2 — v1 always uses ANY
```

**New output fields:**

```ts
// Per chat in list response
topics?: Array<{ id: string; name: string }>;

// Top-level (for filter bar population without extra round trip on first load)
availableTopics?: Array<{ id: string; name: string; chatCount?: number }>;
```

**Query strategy:**

- Join `chat_topics` + `topics` when returning list rows (aggregate topic names per chat).
- When `topicIds` provided, filter with `EXISTS` or inner join:

```sql
WHERE chat_id IN (
  SELECT chat_id FROM chat_topics WHERE topic_id = ANY($topicIds)
)
```

- Respect existing user scope (`getMergedUserIdScopeForReads` / `chatsUserIdInCanonicalScope`).
- Keep `chatListSelection` lean; add a separate lightweight topic aggregation subquery or lateral join.
- Do **not** select `topics.embedding` on list path.

**Performance budget:** target ≤ 25 ms added to `chatsQuery` phase for typical users (< 50 topics, < 500 chats). Add timing log `topicAggregationMs` alongside existing `chatvault.performance.load_saved_entries` event.

### 2. New tool: `listTopics` (app-only)

```ts
listTopics({ userId }) → { topics: [{ id, name, chatCount }] }
```

Used when filter dropdown opens if `availableTopics` from list load is stale. Read-only, cacheable per user for ~60 s in widget state.

### 3. Extend `updateSavedEntry` (`updateChat`)

**New input:**

```ts
topics?: string[];  // full replacement list of topic IDs OR topic names (decide one; recommend IDs with name-based resolve helper)
```

Behavior:

- Replace entire topic set (v1: **replace full set** — simpler UX when user edits topics on a row).
- Accept topic names in input for free-type UX: resolve to existing topic by `name_norm`, else create topic (source `manual`) with embedding.
- Return updated `topics` array in structured content.

Validation:

- Max 5 topics per chat (manual)
- User must own chat and topics

### 4. Save tools (`saveConversation`, `widgetAdd`, finalize)

No new required arguments in v1. Auto-tagging is server-side post-save.

Optional future: `topics?: string[]` on manual save modal to pre-seed topics.

---

## Widget UI (`chat-vault-part-mcp-app`)

The main UI lives in a large `src/chat-vault/index.tsx`. Extract new components to keep changes reviewable.

### Shared component: `TopicCombobox`

A reusable multi-select combobox:

- **Selected state**: chips for chosen topics, each with remove (×).
- **Input area**: clicking outside chips focuses a text input.
- **Dropdown** (on focus or typing):
  - Filter existing topics by prefix/substring match
  - Highlight exact matches
  - "Create `<typed value>`" row when no exact match
- **Keyboard**: Enter selects/creates; Backspace on empty input removes last chip; Escape closes dropdown.
- **Props**: `selected: Topic[]`, `options: Topic[]`, `onChange`, `allowCreate`, `maxItems`, `disabled`, `placeholder`.

Consider extracting to `src/chat-vault/TopicCombobox.tsx`.

### Filter bar (list view)

Place below the existing text search box (or combine into one toolbar row on wide layouts):

```text
[ Search conversations...                    ] [Search btn]
[ Topics: [chip] [chip] [type a topic... ▼]               ]
```

State:

- `filterTopicIds: string[]` — separate from text `searchQuery`
- Changing filter triggers `loadSavedEntries` with `topicIds` + existing pagination
- Clear-all control when any topic filter active
- Text search + topic filter compose: **both apply** (AND): query matches semantically AND chat has **any** of the selected topics

Empty filter → no topic constraint (current behavior).

### Chats table rows

Each row currently shows title, date, note/chat icon, turn count, delete.

Add below the metadata line:

```text
[React hooks] [Debugging] [+]
```

- Render up to 3 topic chips; if more, show `+N`.
- Small **+** or chip area opens inline `TopicCombobox` (popover) for manual edit.
- On save → `updateSavedEntry` with new topic list → optimistic UI update.

Row layout must stay compact for mobile (widget runs in ChatGPT/Claude surfaces).

### Chat detail view

Repeat topic chips + edit control under the title block (same component), so users can edit topics while reading a chat.

### Types

Extend `src/chat-vault/types.ts`:

```ts
export interface Topic {
  id: string;
  name: string;
}

export interface ChatPreview {
  // ...
  topics?: Topic[];
}
```

### Initial load

On first `loadSavedEntries`, persist `availableTopics` from response into widget state for combobox options.

---

## UX flows

### Flow A: Browse with topic filter

1. User opens widget → `loadSavedEntries` returns chats + `availableTopics`.
2. User clicks topic filter, types "react" → dropdown shows matching topics.
3. User selects "React hooks" → chip appears → list reloads with `topicIds: [id]`.
4. User adds second topic → ANY filter shows chats that have either topic.
5. User clears chips → full list returns.

### Flow B: Auto-tag on save

1. User saves chat via AI tool or manual paste.
2. Save returns immediately (async jobId or sync chatId).
3. Worker saves chat + runs `assignTopicsForChat`.
4. Widget poll (`getSaveJobStatus`) completes → refresh list → new chat shows auto-assigned topic chips.

If auto-tag fails, chat still saves; topics simply empty (log warning, no user-facing error).

### Flow C: Manual topic edit on existing chat

1. User clicks topic area on row → combobox opens with current topics selected.
2. User types new topic "WSL2" → creates via `updateSavedEntry`.
3. Row updates with new chips; `availableTopics` updated locally.

---

## Performance and safety constraints

Carry forward lessons from the performance retrospective:

| Constraint | Approach |
| --- | --- |
| No embedding on list path | Topic embeddings only in assign/create flows |
| Keep list payload small | Return `{ id, name }` only; max 5 topics × N rows |
| Neon HTTP list reads | Topic join must work on `chatListDb` transport |
| Async expensive work | OpenAI topic suggestion in worker, not Vercel tool handler |
| Sanitized logs | Log topic IDs/counts/timings, not chat content or prompts |
| Idempotent saves | Auto-tag uses `ON CONFLICT DO NOTHING` on `chat_topics` |

Add regression test similar to `listPathRegression.test.ts` asserting list query does not touch embedding columns and response size stays bounded.

---

## Testing plan

### Backend (`chat-vault-part2/tests`)

| Test | Coverage |
| --- | --- |
| `topics.test.ts` | CRUD, name normalization, unique per user |
| `assignTopics.test.ts` | exact match, semantic match above threshold, create new |
| `loadMyChats.topics.test.ts` | filter by topicIds, topics included in response |
| `updateChat.topics.test.ts` | manual set, create-by-name, ownership checks |
| `listPathRegression.test.ts` | extend — no embedding load with topics join |

Use mocked OpenAI for deterministic tests (fixture responses).

### Worker (`monorepo/apps/mcp-worker`)

- Integration test: job payload → save + topics assigned (mock OpenAI)

### Widget

- Component tests for `TopicCombobox` (selection, create, keyboard)
- Manual QA checklist in ChatGPT widget host (dark mode, pagination + filter, mobile width)

---

## Implementation phases

### Phase 1 — Schema and read path (backend + types)

- [x] Migration: `topics`, `chat_topics` (via `pnpm db:generate` + `pnpm db:migrate`)
- [x] Drizzle schema + relations
- [x] `listTopics` tool
- [x] Extend `loadMyChats` to return `topics` per chat + `availableTopics`
- [x] Extend `loadMyChats` with `topicIds` filter (ANY semantics)
- [x] Tests + list path regression

**Exit criteria:** API returns topics on list; filter works; no measurable regression in `chatsQuery` timing in tests.

### Phase 2 — Auto-tag on save (backend + worker)

- [ ] `assignTopics.ts` with OpenAI suggestion + semantic match
- [ ] Hook into sync `saveChatCore` path (tests)
- [ ] Hook into `mcp-worker` post-save
- [ ] Feature flag `CHATVAULT_AUTO_TOPICS=true` for rollout

**Exit criteria:** New saves get topics in DB; failures don't fail save.

### Phase 2b — Backfill existing chats

Run after Phase 2 so `assignTopicsForChat` is stable. Goal: populate topics on existing vault data so the widget filter bar and row chips are meaningful before wider rollout.

- [ ] Add `scripts/backfill-topics.ts` in `chat-vault-part2`
- [ ] Select chats with no rows in `chat_topics` (optionally scoped by `userId`)
- [ ] Reuse `assignTopicsForChat` per chat (same logic as save path)
- [ ] Rate-limit OpenAI calls (e.g. 5 concurrent, 200 ms between batches) to avoid burst cost
- [ ] Dry-run mode (`--dry-run`) prints counts without writing
- [ ] Resume support: skip chats that already have topics
- [ ] Log summary only (chat IDs, topic counts, timings — no content)

**Suggested usage:**

```bash
# Preview
pnpm tsx scripts/backfill-topics.ts --dry-run

# Backfill one user (dev/staging first)
pnpm tsx scripts/backfill-topics.ts --userId=<id> --limit=50

# Full backfill (production, after staging validation)
pnpm tsx scripts/backfill-topics.ts --batch-size=20
```

**Exit criteria:** Staging/dev vault shows topic chips on previously untagged chats; filter bar has a usable topic list.

### Phase 3 — Widget filter bar

- [ ] `TopicCombobox` component
- [ ] Filter state wired to `loadSavedEntries`
- [ ] Compose with text search
- [ ] Deploy widget (`WIDGET_VERSION` bump)

**Exit criteria:** User can filter list by topics with create-on-the-fly in filter bar.

### Phase 4 — Widget row + detail tagging

- [ ] Topic chips on list rows
- [ ] Inline edit → `updateSavedEntry`
- [ ] Topic edit on detail view
- [ ] Optimistic updates + error toast

**Exit criteria:** Manual topic edit works end-to-end.

### Phase 5 — Polish and rollout

- [ ] Tune `TOPIC_MATCH_THRESHOLD` with real data
- [ ] Remove feature flag after soak
- [ ] Update submission copy / help text if needed
- [ ] Brief note in performance retrospective doc: new list join phase to watch

---

## Decisions (confirmed)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Filter match: ANY vs ALL topics? | **ANY** — chat matches if it has any selected topic |
| 2 | UI label: "Topic" or "Tag"? | **Topic** — all widget copy uses "Topic" / "Topics" |
| 3 | Backfill existing chats? | **Yes** — offline script after auto-tag ships, so UI can be evaluated on real data |
| 4 | Replace vs merge on manual topic edit? | **Replace full set** from combobox state (unchanged) |
| 5 | Pre-seed topics on manual save modal? | Defer to v1.1 |
| 6 | Share assignTopics via npm package? | Defer; copy to worker for v1 |

---

## Files likely touched

### chat-vault-part2

- `src/db/schema.ts`
- `drizzle/0004_*.sql` (new migration)
- `src/tools/loadMyChats.ts`
- `src/tools/updateChat.ts`
- `src/tools/chatListSelection.ts` (or new `chatListWithTopics.ts`)
- `src/tools/listTopics.ts` (new)
- `src/utils/assignTopics.ts` (new)
- `src/utils/topicMatch.ts` (new)
- `src/server.ts` (tool registration)
- `scripts/backfill-topics.ts` (new)
- `tests/*`

### chat-vault-part-mcp-app

- `src/chat-vault/types.ts`
- `src/chat-vault/TopicCombobox.tsx` (new)
- `src/chat-vault/index.tsx` (integrate filter + row tags)
- `src/chat-vault/TopicChips.tsx` (new, optional)

### monorepo

- `apps/mcp-worker/src/chat-save-job.ts`
- `apps/mcp-worker/src/chatvault/assignTopics.ts` (new)

---

## Success metrics

- List load p95 stays under 1 s warm (no regression vs August 2026 baseline)
- ≥ 80% of new saves receive at least one auto-topic (after tuning)
- Manual topic edit completes in < 500 ms perceived (optimistic UI)
- Zero save failures caused by topic assignment errors

---

## References

- Performance retrospective: `monorepo/apps/saas-starter/docs/performance/mcp-performance-retrospective-2026-08.md`
- Async save architecture: `chatvault-tutorial/ASYNC_EMBEDDINGS_REFACTOR_PLAN.md`
- Current list selection: `chat-vault-part2/src/tools/chatListSelection.ts`
- Widget list UI: `chat-vault-part-mcp-app/src/chat-vault/index.tsx`

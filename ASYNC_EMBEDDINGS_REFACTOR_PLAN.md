# Async ChatVault Embeddings Refactor Plan

## Project Structure

- **chatvault-tutorial** (this workspace): `chat-vault-part2`, `chat-vault-part-mcp-app`
- **monorepo** (separate workspace): `apps/mcp-worker` — shared worker that runs on Render.com; not part of ChatVault but will add a ChatVault job handler

## Overview

Refactor `saveChatTurnsFinalize`, `saveChat`, and `widgetAdd` in chat-vault-part2 to push parsed chat jobs to Upstash Redis instead of running embeddings synchronously. Add a ChatVault job handler to mcp-worker (monorepo) on Render.com to process jobs (embeddings + DB insert), plus a polling tool and UI updates for async status.

---

## Current Architecture

- **saveChat**, **widgetAdd**, **saveChatTurnsFinalize** all call `saveChatCore`
- `saveChatCore` runs `generateEmbedding` (OpenAI API) synchronously and inserts into Neon PostgreSQL
- On Vercel serverless this can hit time limits for large chats

---

## Target Architecture

- **chat-vault-part2 (Vercel)**: Parse/assemble chat → push job to Upstash Redis → return `jobId`
- **Upstash Redis**: Job queue (list) + status keys (`chatvault:job:{jobId}`) with 3-min TTL
- **mcp-worker (monorepo, Render.com)**: Uses existing blocking BRPOP pattern — no polling; blocks until job arrives, processes it
- **chat-vault-part2**: New `getChatSaveJobStatus` tool for widget to poll status
- **Widget (chat-vault-part-mcp-app)**: Poll status until completed/failed, then update UI

---

## 1. Job Payload and Status Schema

### Job payload (stored in Redis list, consumed by worker)

```ts
interface ChatSaveJobPayload {
  jobId: string;
  userId: string;
  title: string;
  turns: Array<{ prompt: string; response: string }>;
  source: "saveChat" | "saveChatTurnsFinalize" | "widgetAdd";
}
```

### Status key

- **Key**: `chatvault:job:{jobId}`
- **Value**: `{ status: "pending" | "completed" | "failed", chatId?: string, chatIds?: string[], error?: string }`
- **TTL**: 180 seconds (3 minutes)

---

## 2. monorepo/apps/mcp-worker: Add ChatVault Job Handler

mcp-worker is in the **monorepo** workspace (not ChatVault). It already uses **blocking BRPOP** on multiple queues. Add a new queue and handler following the same pattern as the email queue.

### Existing pattern

- **monorepo/apps/mcp-worker/src/lib/redis.ts**: Defines `QUEUE`, `EMAIL_QUEUE`, `DLQ`, `EMAIL_DLQ`; `blockingPop([QUEUE, EMAIL_QUEUE], 30)`
- **monorepo/apps/mcp-worker/src/index.ts**: `blockingPop` returns `[queueName, item]`; dispatch by `queueName`:
  - `EMAIL_QUEUE` → `processEmailJob(rawString)`
  - else → `processJob(rawString)`
- Producers push jobs via `redis.lpush(queueName, JSON.stringify(payload))`

### Changes for ChatVault

#### 2.1 monorepo/apps/mcp-worker/src/lib/redis.ts

Add:

```ts
export const CHAT_SAVE_QUEUE = process.env.MCP_CHAT_SAVE_QUEUE ?? "queue:mcp:chat-save";
export const CHAT_SAVE_DLQ = `${CHAT_SAVE_QUEUE}:dlq`;
```

#### 2.2 monorepo/apps/mcp-worker/src/index.ts

- Add `CHAT_SAVE_QUEUE` to `blockingPop`: `blockingPop([QUEUE, EMAIL_QUEUE, CHAT_SAVE_QUEUE], 30)`
- Add branch: when `queueName === CHAT_SAVE_QUEUE` → call `processChatSaveJob(rawString)`
- On job failure: push to `CHAT_SAVE_DLQ` (same pattern as `EMAIL_DLQ`)

#### 2.3 New file: monorepo/apps/mcp-worker/src/chat-save-job.ts

Similar to `monorepo/apps/mcp-worker/src/email-job.ts`:

- Parse JSON payload
- Validate `ChatSaveJobPayload` (jobId, userId, title, turns)
- Run embeddings + DB insert (copy logic from part2 `saveChatCore`)
- On success: `redis.set(statusKey, JSON.stringify({ status: "completed", chatId, chatIds? }), { ex: 180 })`
- On failure: `redis.set(statusKey, JSON.stringify({ status: "failed", error }), { ex: 180 })`

#### 2.4 Dependencies and DB

- mcp-worker already has Postgres/Drizzle for Agentsyx (saas-starter). Add a **second DB connection** for ChatVault.
- New env: `CHATVAULT_DATABASE_URL` (or `CHATVAULT_POSTGRES_URL`) — Neon connection string for ChatVault
- Add `openai` for embeddings
- Copy/adapt from chatvault-tutorial `chat-vault-part2`: ChatVault schema (`chats` table), `utils/embeddings.ts`, and embeddings+insert logic

---

## 3. chatvault-tutorial/chat-vault-part2 Changes

### 3.1 Add Upstash Redis

- Add `@upstash/redis` to `package.json`
- Create `src/utils/redis.ts`:
  - `Redis` client (env: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)
  - `pushChatSaveJob(payload)`: `redis.lpush("queue:mcp:chat-save", JSON.stringify(payload))`, then `redis.set("chatvault:job:{jobId}", '{"status":"pending"}', { ex: 180 })`, return `jobId`
  - `getJobStatus(jobId)`: `redis.get("chatvault:job:{jobId}")`, parse JSON

### 3.2 Refactor saveChatTurnsFinalize

- Keep: fetch turns from DB, validate job
- Replace: instead of `saveChatCore`, call `pushChatSaveJob` with `{ jobId, userId, title, turns, source: "saveChatTurnsFinalize" }`
- Delete temp data (chatSaveJobTurns, chatSaveJobs) before returning
- Return `{ jobId }` instead of `{ chatId }`

### 3.3 Refactor saveChat

- Generate `jobId` (crypto.randomUUID), call `pushChatSaveJob`, return `{ jobId }` instead of `{ chatId, saved }`

### 3.4 Refactor widgetAdd

- Keep: validation, anon limits, parsing (LLM/heuristic)
- Replace: instead of `saveChatCore`, call `pushChatSaveJob` with parsed turns
- Return `{ jobId, turnsCount }` on success; preserve error returns (`limit_reached`, `parse_error`, `server_error`)

### 3.5 New tool: getChatSaveJobStatus

- Input: `{ jobId: string }`
- Logic: call `getJobStatus(jobId)` from redis utils
- Output: `{ status: "pending" | "completed" | "failed", chatId?: string, chatIds?: string[], error?: string }`

### 3.6 Update tool schemas

- Update descriptions for saveChat, saveChatTurnsFinalize, widgetAdd to mention async flow and `jobId` return
- Note use of `getChatSaveJobStatus` for polling

---

## 4. chatvault-tutorial/chat-vault-part-mcp-app UI Changes

### handleManualSave (widgetAdd)

- Expect `structuredContent.jobId` instead of `chatId` on success
- Start polling: call `getChatSaveJobStatus` every 1–2 seconds with `jobId`
- When `status === "completed"`: close modal, reload `loadMyChats`, show success
- When `status === "failed"`: show `error` in alert/modal
- Keep `isSaving` true until completed/failed
- Add timeout (e.g. 3 min) — if still pending, show "Still processing, check back later"

### saveChat / saveChatTurnsFinalize (LLM-called)

- No polling in widget; user can refresh or rely on next `loadMyChats` to show the chat

---

## 5. Preserve Split Logic

- `splitTurnsForEmbedding` in `embeddings.ts` stays unchanged
- mcp-worker uses the same logic for long chats

---

## 6. Out of Scope

- **updateChat**: stays synchronous for now
- **LLM save flow**: no polling in widget initially

---

## 7. Environment Variables

| App | New/Updated |
|-----|-------------|
| chat-vault-part2 | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| mcp-worker | `CHATVAULT_DATABASE_URL` (Neon for ChatVault; existing `POSTGRES_URL` stays for Agentsyx), `OPENAI_API_KEY` |

---

## 8. File Summary

| Action | Path | Workspace |
|--------|------|-----------|
| Create | `chat-vault-part2/src/utils/redis.ts` | chatvault-tutorial |
| Modify | `chat-vault-part2/src/tools/saveChatTurnsFinalize.ts` | chatvault-tutorial |
| Modify | `chat-vault-part2/src/tools/saveChat.ts` | chatvault-tutorial |
| Modify | `chat-vault-part2/src/tools/widgetAdd.ts` | chatvault-tutorial |
| Modify | `chat-vault-part2/src/server.ts` | chatvault-tutorial |
| Modify | `chat-vault-part2/package.json` | chatvault-tutorial |
| Create | `apps/mcp-worker/src/chat-save-job.ts` | monorepo |
| Modify | `apps/mcp-worker/src/lib/redis.ts` | monorepo |
| Modify | `apps/mcp-worker/src/index.ts` | monorepo |
| Create/copy | `apps/mcp-worker/src/chatvault-db/` (schema + connection from part2) | monorepo |
| Create/copy | `apps/mcp-worker/src/utils/embeddings.ts` | monorepo |
| Modify | `apps/mcp-worker/package.json` | monorepo |
| Modify | `chat-vault-part-mcp-app/src/chat-vault/index.tsx` | chatvault-tutorial |
| Create | `chat-vault-part2/tests/utils/redis.test.ts` | chatvault-tutorial |
| Create | `chat-vault-part2/tests/tools/saveChat.test.ts` (or extend existing) | chatvault-tutorial |
| Create | `chat-vault-part2/tests/tools/saveChatTurnsFinalize.test.ts` | chatvault-tutorial |
| Create | `chat-vault-part2/tests/tools/widgetAdd.test.ts` | chatvault-tutorial |

---

## 9. Tests

chat-vault-part2 uses Jest (`tests/**/*.test.ts`). Add:

- **Unit tests** for `src/utils/redis.ts`: `pushChatSaveJob` (mock Redis), `getJobStatus` (mock Redis)
- **Unit tests** for refactored tools: saveChat, saveChatTurnsFinalize, widgetAdd — assert they return `jobId` and call `pushChatSaveJob` instead of `saveChatCore` (mock redis + db)
- **Integration test** (optional): end-to-end with real Redis (or Upstash local) — push job, worker processes, status completes

mcp-worker: add unit test for `processChatSaveJob` with mocked db + OpenAI if test infra exists.

---

## 10. Manual Testing Checklist

- [ ] saveChat returns jobId; polling returns completed with chatId; chat appears in loadMyChats
- [ ] saveChatTurnsFinalize returns jobId; same flow
- [ ] widgetAdd returns jobId; manual save modal polls and shows completion
- [ ] Large chat (exceeding embedding limit) is split into multiple parts by worker
- [ ] Failed job: worker sets status "failed" with error; polling returns it; UI shows error
- [ ] Status key expires after 3 min; polling returns null/expired for old jobIds

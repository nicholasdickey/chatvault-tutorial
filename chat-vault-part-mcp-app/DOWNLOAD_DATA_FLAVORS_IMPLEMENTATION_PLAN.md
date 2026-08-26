# Download Data Implementation Plan

## Goal

Add **Download Data** for Agentsyx and Claude without changing the widget or Part 2 tool surface used by the submitted OpenAI app.

There are two separate Vercel frontend deployments and two separate Part 2 backend deployments:

| Deployment pair | `CHATVAULT_TOOL_METADATA_PROFILE` | Download Data |
| --- | --- | --- |
| OpenAI/ChatGPT | `gpt` | No |
| Agentsyx/Claude | `full` | Yes |

Both frontend deployments build from `chat-vault-part-mcp-app`. Both backend deployments run `chat-vault-part2`. Each paired frontend and backend must use the same profile value.

The profile is selected at build/deployment time. The widget will not attempt to detect its host at runtime.

## Two Release Preconditions

Complete these checks on the portable-host deployments before releasing the export feature:

1. **Identity check:** Confirm that the Agentsyx and Claude paths provide Part 2 with a trusted canonical user identity. The export must not authorize access using an arbitrary widget/model-provided `userId` alone.
2. **Download check:** Use a minimal test attachment endpoint to confirm that Agentsyx and Claude can save a file opened through `app.openLink({ url })`. If a host does not support this, verify a normal-link fallback before continuing.

The code may be built behind the `full` profile before these checks pass, but do not enable or release the portable-host deployment until both checks pass.

## Phase 1: Add Frontend Flavors

Use `CHATVAULT_TOOL_METADATA_PROFILE` in the frontend production build (`build-all.mts`).

- Default to the unchanged `gpt` build when the value is absent; require an explicit `full` value to enable the portable-host feature.
- Inject the selected profile into the widget as a build-time constant.
- `gpt` renders the current widget without Download Data.
- `full` renders Download Data to the right of **Add Chat**.
- Do not use browser globals, referrers, user-agent strings, or host feature detection to choose the flavor.

Keep the existing ChatGPT resource URI and launcher metadata unchanged:

```text
ui://chat-vault/mcp-app.html
browseMyChatVault
```

Configure the frontend domain separately for each Vercel frontend deployment instead of using the currently hardcoded domain.

### Frontend tests

- A `gpt` build does not render Download Data and cannot call the export tool.
- A `full` build renders Download Data.
- Both builds compile successfully.
- Existing launcher/resource tests continue to pass for the GPT deployment.

## Phase 2: Add the Full-Only Export Tool

Add `exportSavedEntries` to `chat-vault-part2` only when the profile is `full`.

- Do not list the tool in the `gpt` profile.
- Reject direct calls to the tool in `gpt` mode.
- Require the trusted user identity confirmed in the precondition check.
- Treat the tool as non-destructive; it must not modify saved chats.

The export contains every stored chat row belonging to the resolved canonical/merged user scope:

- Chat ID
- Title
- Timestamp
- Complete turns
- User-facing topic names

Exclude embeddings, stored user IDs, merge records, save jobs, topic IDs, and other internal fields. Do not apply widget pagination, preview truncation, display deduplication, or anonymous display-expiration filtering.

JSON envelope:

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-26T00:00:00.000Z",
  "entries": []
}
```

Use dedicated bulk database queries for chats and topics. Do not repeatedly call `loadSavedEntries`.

### Backend tests

- GPT tool listing remains unchanged and excludes `exportSavedEntries`.
- GPT rejects a direct export call.
- Full tool listing includes `exportSavedEntries`.
- Missing trusted identity is rejected.
- Only the resolved user's stored chats are exported.
- Complete turns and topic names are included.
- Internal fields are excluded.
- Empty vaults produce valid JSON with `entries: []`.

## Phase 3: Deliver the JSON File

Use a short-lived opaque download URL:

1. `exportSavedEntries` creates a cryptographically random token.
2. Part 2 stores the token mapping with a short expiry in the existing Upstash Redis deployment.
3. The tool returns the download URL, filename, and expiry.
4. A Part 2 GET endpoint validates the token, loads the user's current saved chats, and returns the JSON attachment.

The URL must not contain the shared MCP API key, user ID, or chat data. Configure its origin explicitly on the portable Part 2 deployment; do not derive it from request headers.

Attachment response:

```text
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="chat-vault-export-YYYY-MM-DD.json"
Cache-Control: private, no-store
```

Set a short token expiry and a conservative maximum JSON size. Reuse the existing Redis integration rather than introducing a new storage service.

### Delivery tests

- A valid token returns a JSON attachment.
- Unknown and expired tokens fail.
- Tokens cannot select or override another user.
- URLs contain no API key, user ID, or chat data.
- Oversized exports return a clear error.

## Phase 4: Widget Flow

The UI exists only in the `full` build.

1. User clicks **Download Data**.
2. A confirmation modal opens.
3. User clicks **Prepare export**.
4. The widget calls `exportSavedEntries` once and shows a preparing state.
5. When ready, the modal shows the filename and expiry.
6. User explicitly clicks **Download JSON**.
7. The widget calls `app.openLink({ url })` or the host fallback verified during the precondition check.
8. The modal remains open until the user closes it.

Prevent double submission while preparing. A retry after failure may create one new export request.

### Widget acceptance tests

- Preparing, ready, error, retry, and expiry states work.
- Double-clicking does not create duplicate preparation calls.
- The final download requires a real user click.
- The modal does not close automatically.
- Agentsyx downloads and parses a real export file.
- Claude downloads and parses a real export file.
- ChatGPT still has no Download Data button.

## Deployment

Configure the paired deployments explicitly:

| Setting | ChatGPT pair | Agentsyx/Claude pair |
| --- | --- | --- |
| `CHATVAULT_TOOL_METADATA_PROFILE` | `gpt` | `full` |
| Frontend domain | Existing submitted domain | Separate portable-host domain |
| Export URL/Redis configuration | Not required | Required |

Frontend variables:

- `CHATVAULT_TOOL_METADATA_PROFILE=gpt|full` (absent defaults to the unchanged `gpt` build)
- `CHATVAULT_WIDGET_DOMAIN=https://...` (the origin serving that widget)
- `WIDGET_VERSION=...` (the version reported by that widget artifact)

Portable Part 2 variables:

- `CHATVAULT_TOOL_METADATA_PROFILE=full`
- `CHATVAULT_EXPORT_BASE_URL=https://...` (the public origin serving `/api/export`)
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Optional: `CHATVAULT_EXPORT_TOKEN_TTL_SECONDS` (default 300, bounded to 60–1800)
- Optional: `CHATVAULT_EXPORT_MAX_BYTES` (default 10 MiB, bounded to 1 KiB–50 MiB)

Deploy and verify the full Agentsyx/Claude pair first. Do not change the submitted ChatGPT deployment while developing or testing the full flavor.

## Definition of Done

- The same environment variable selects matching frontend and backend flavors.
- The ChatGPT widget has no Download Data UI and its Part 2 tool list is unchanged.
- The full widget exposes Download Data and the full backend exposes the export tool.
- Export authorization uses trusted host identity.
- The JSON contains all stored chats for that user and no internal data.
- Agentsyx and Claude successfully download and parse the file.
- Frontend, backend, and existing regression tests pass.

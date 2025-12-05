Title: ChatVault Backend – Apps SDK / MCP Vibe Coding PROMPTS

project name - chat-vault-part2

This project uses the **generic backend MCP server prompts** defined in:

- `prompts/part2/cursor/openai-AppsSDK-prompt.md`

Use that file for:

- **Prompt0**: Setup Neon PostgreSQL Database
- **Prompt1**: Initialize Node.js Project with Drizzle + Apps SDK
- **Prompt2**: Refactor to Monorepo Structure
- **Prompt3**: Create Basic MCP HTTP Streaming Server
- **Prompt4**: Install Dependencies + Initialize Drizzle
- **Prompt5**: Setup Generic Test Framework

This file defines the **ChatVault-specific backend behavior** starting from Prompt6.

## Engineering Principles (ChatVault-specific)

- **Align with the generic prompts**: All work here inherits the engineering principles from `openai-AppsSDK-prompt.md` (verify, test with real databases, graceful degradation, separate concerns). Do not introduce project-specific shortcuts that violate those principles.
- **Maintain Part 1 compatibility**: The `loadChats` tool must return data in the same format as Part 1: `{ chats: [...], pagination: {...} }` with `_meta` structure. This ensures the widget from Part 1 can work with the Part 2 backend without changes.
- **Design for observability**: All database operations should be logged (queries, results, errors). Use structured logging where possible to make debugging easier.
- **Vector search quality**: When implementing vector search, test with various query types (short, long, technical terms, natural language) to ensure embeddings capture semantic meaning correctly.

---

Prompt6: Implement `saveChat` Tool

Define the Chat schema in Drizzle with fields for id, userId, title, timestamp, turns (as JSONB), and embedding (vector type). Create an embeddings utility that can generate vector embeddings for text—use OpenAI's Embeddings API. Implement the `saveChat` MCP tool that takes userId, title, and turns as parameters, generates an embedding for the entire chat (combining all prompts and responses), and saves it to the database. Register the tool in the MCP server and add comprehensive logging.

**Non-negotiables:**

- `userId` must be a required parameter (not optional)
- Embedding must be generated for the entire chat (all prompts + responses combined)
- All errors must be caught and returned as JSON-RPC errors
- Tool must return chat ID in response for reference

---

Prompt7: Implement `loadChats` Tool

Implement the `loadChats` MCP tool that retrieves paginated chat data from PostgreSQL. It should take userId (required), page (optional, default 1), and limit (optional, default 10) as parameters. Query the database for chats matching the userId, ordered by timestamp descending. Return the response in the exact same format as Part 1: `{ chats: [...], pagination: {...} }` wrapped in `_meta` structure. Handle pagination correctly (1-indexed pages) and edge cases like empty results.

**Non-negotiables:**

- Response format must exactly match Part 1 format (same structure, same field names)
- `_meta` structure must be used (ChatGPT transforms this to `meta` in widgets)

---

Prompt8: Implement `searchChats` Tool (Vector Search)

Implement the `searchChats` MCP tool that performs vector similarity search on chat embeddings. Create a vector search query function that uses pgvector's cosine similarity operator to find chats matching a query embedding. The tool should take userId (required), query (required), and limit (optional, default 10) as parameters. Generate an embedding for the search query, perform the vector similarity search, and return results ordered by similarity (most similar first). Format the response similar to `loadChats` but include search-specific metadata. Handle cases where chats don't have embeddings gracefully.

**Non-negotiables:**

- `userId` and `query` must be required parameters
- Search must only return chats that belong to the specified `userId`
- Search must only return chats with non-null embeddings
- Results must be ordered by similarity (most similar first)
- Default `limit` must be 10
- Must handle empty results gracefully (not an error)

---

Prompt9: Update Tests for ChatVault Actions

Add comprehensive end-to-end tests for `saveChat`, `loadChats`, and `searchChats` tools using a real test database. Write tests for each tool covering success cases, error cases (missing parameters, invalid data), and edge cases. Create integration tests that test the full workflow (save → load → search). Add test data helpers for creating and cleaning up test chats. Update existing protocol tests to verify all three tools are present in `tools/list`.

**Non-negotiables:**

- All tests must use real database (local PostgreSQL)
- All tests must clean up after themselves (no leftover data)
- Tests must verify database state, not just API responses
- Tests must cover error cases (missing params, invalid data)
- Tests must verify response formats match Part 1 exactly
- All tests must be independent (can run in any order)

---

Prompt10: ChatGPT Integration and Testing

Start the backend server, set up an ngrok tunnel, and configure ChatGPT to connect to the MCP server. Ensure production DB is up-to-date with migrations. Test all three tools (`saveChat`, `loadChats`, `searchChats`) from ChatGPT with various prompts. Verify error handling works correctly and that responses are clear and actionable. Optionally test integration with the Part 1 widget if available. Document the integration steps for future reference.

**Non-negotiables:**

- All three tools must work from ChatGPT
- Error messages must be clear and actionable
- Database operations must be visible in server logs
- Integration must be documented for future reference

---

**Next Steps:**

After completing Prompt10, the ChatVault backend is complete and ready for:

- Integration with Part 1 widget (if desired)
- Production deployment (Part 4)
- SaaS layer integration (Part 3)

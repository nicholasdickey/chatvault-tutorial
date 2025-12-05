Title: Generic Backend MCP Server with Database PROMPTS

Prerequisites:

- git
- ngrok
- Node.js 18+
- PostgreSQL (local for testing, Neon for production)
- Cursor (these prompts are tuned for running inside the Cursor editor)
- ChatGPT Plus membership. OpenAI API Key (to use with embeddings API)

This document defines **generic prompts** for building a backend MCP server with database integration (PostgreSQL + pgvector).  
Project-specific behavior (tools, data model, schema) should be defined in that project's own prompt file as **Prompt5** and onwards.

## Engineering Principles (for all prompts)

- **Verify, don't guess**: When behavior depends on external systems (Apps SDK, MCP spec, PostgreSQL, pgvector), consult the latest docs or run a minimal experiment before changing code. Do not rely solely on heuristics or assumptions.
- **Test with real databases**: Use a local PostgreSQL instance for e2e tests. Avoid mocks for database operations—test against real database behavior to catch schema, transaction, and query issues early.
- **Design for graceful degradation and bounded behavior**: Database operations should handle connection failures, query timeouts, and constraint violations in a controlled, observable way (clear error messages, no infinite retries or unbounded logging).
- **Separate concerns**: Keep database schema, MCP protocol handling, and business logic in separate modules. This makes testing, debugging, and future refactoring easier.

project name - `${PROJECT_NAME}`

---

Prompt0: Setup Neon PostgreSQL Database

Instruct the user to set up a PostgreSQL database in Neon for development and production. Create an account, create a project, and get the connection string. Enable the pgvector extension in the database so we can do vector similarity search later.

---

Prompt1: Initialize Node.js Project with Drizzle + Apps SDK

Create a new Node.js project for the backend MCP server. Set it up as a sibling to any existing frontend/widget projects (for example, if you have `chat-vault-part1`, create `chat-vault-part2` in the same parent directory). Initialize it with TypeScript, Drizzle ORM, and the Apps SDK. Install the necessary dependencies for PostgreSQL, pgvector support, and environment variable management.

--

Prompt2: Refactor to Monorepo Structure

Refactor the project tree to have a single root repository with `chatvault-tutorial` as the root directory. Preserve the git history from `chat-vault-part1` when moving it into the monorepo structure. Add `${PROJECT_NAME}` to the repo. Detach repo from its current origin. Verify that all existing functionality still works—tests pass, builds succeed, and the MCP server starts correctly.

- remove pre-commit configuration (if present)

--

Prompt3: Create Basic MCP HTTP Streaming Server

Build a minimal MCP server with HTTP streaming transport. Create an HTTP server that handles `POST /mcp` for MCP requests and `OPTIONS /mcp` for CORS preflight. Use the `@modelcontextprotocol/sdk` Server instance internally.

**Non-negotiables:**

- Must use HTTP POST (not SSE)
- Must handle JSON-RPC 2.0 format correctly
- Must implement session management with `mcp-session-id` header
- Must return proper error responses for invalid requests
- Must log all MCP operations for debugging
- For ALL responses: Set `Content-Type: application/json` header (NOT `application/x-ndjson`), send a single JSON-RPC response object and immediately end the HTTP response
- For notifications (requests without `id`): Respond with HTTP `204 No Content`

---

Prompt4: Install Dependencies + Initialize Drizzle

Install all dependencies and set up Drizzle ORM. Configure Drizzle to connect to your Neon database, create the initial schema file (we'll add tables in the project-specific prompts), and set up a database connection utility. Create a migration to enable the pgvector extension. Test the database connection on server startup and verify pgvector is available.

**Non-negotiables:**

- `.env` file must be in `.gitignore`
- Database connection must be tested on server startup
- pgvector extension must be enabled before any schema migrations
- All database operations must go through the Drizzle `db` instance
- Schema file must be in `src/db/schema.ts`

---

Prompt5: Setup Generic Test Framework

Set up a local PostgreSQL test database using Docker. Check if Docker is installed, and if not, guide the user to install it. Create a Docker Compose file or docker run command to start a PostgreSQL container with pgvector extension enabled. Configure the test database connection string and verify the database is accessible.

Then set up Jest for end-to-end testing. Create an MCP client test utility that can send requests to the server and manage session IDs. Create server helper utilities to start and stop the test server, and database helpers to set up and tear down a test database (using the local PostgreSQL Docker container).

Set up test database lifecycle: in `beforeAll`, run database migrations to create the schema, then truncate all tables to ensure a clean state. In `afterAll`, clean up any remaining test data. Each test should start with a fresh database state.

Write tests for the initialize handshake, session management, JSON-RPC compliance, and the empty tools/list and resources/list handlers.

**Non-negotiables:**

- Docker must be installed and running before tests
- PostgreSQL container must have pgvector extension enabled
- Tests must use real database (local PostgreSQL Docker container)
- Database migrations must run in `beforeAll` before any tests
- All tables must be truncated in `beforeAll` after migrations to ensure clean state
- Tests must verify JSON-RPC 2.0 compliance
- Tests must verify session management works correctly
- All tests must clean up after themselves (ports, processes, database state)

---

**Next Steps:**

After completing these generic prompts, proceed to the project-specific prompts in `chatVaultPrompts.md` (starting at Prompt6) to implement:

- Database schema for ChatVault
- `saveChat`, `loadChats`, `searchChats` tools
- Vector search implementation
- Updated tests for ChatVault-specific behavior
- ChatGPT integration

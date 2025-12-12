# ChatVault Part 2 - Backend MCP Server

Backend MCP server for ChatVault with PostgreSQL database and vector search capabilities using pgvector and OpenAI embeddings.

## Features

- ✅ **Three MCP Tools**: `saveChat`, `loadChats`, `searchChats`
- ✅ **Vector Search**: Semantic search using pgvector and OpenAI embeddings
- ✅ **PostgreSQL Database**: Neon PostgreSQL with pgvector extension
- ✅ **Comprehensive Tests**: 60+ tests covering all tools, error cases, and integration
- ✅ **ChatGPT Integration**: Ready for ChatGPT MCP connection
- ✅ **Part 1 Compatible**: Response formats match Part 1 widget requirements

## Prerequisites

- Node.js 18+
- PostgreSQL database with pgvector extension (Neon recommended)
- OpenAI API key (for embeddings)
- Docker (for test database)

## Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   Create a `.env` file in the root directory:

   ```env
   DATABASE_URL=postgresql://username:password@host/database?sslmode=require
   OPENAI_API_KEY=sk-proj-...
   PORT_BACKEND=8001
   NODE_ENV=development
   ```

3. **Run database migrations:**

   ```bash
   pnpm run db:migrate
   ```

   This will:

   - Enable the `pgvector` extension
   - Create the `chats` table with vector embeddings support

4. **Start the server:**
   ```bash
   pnpm start
   ```

## Development

- **Start in watch mode:**

  ```bash
  pnpm dev
  ```

- **Run tests:**

  ```bash
  pnpm test
  ```

  Tests use a local Docker PostgreSQL database and are completely isolated from production.

- **Generate database migrations:**

  ```bash
  pnpm run db:generate
  ```

- **Open Drizzle Studio (database GUI):**

  ```bash
  pnpm run db:studio
  ```

- **Cleanup production database** (use with caution):
  ```bash
  pnpm run db:cleanup
  ```

## Project Structure

```
chat-vault-part2/
├── src/
│   ├── server.ts              # MCP server entry point
│   ├── db/
│   │   ├── schema.ts          # Drizzle schema definitions
│   │   ├── index.ts           # Database connection
│   │   └── migrate.ts         # Migration runner
│   ├── tools/
│   │   ├── saveChat.ts        # Save chat with embeddings
│   │   ├── loadChats.ts       # Load paginated chats
│   │   └── searchChats.ts     # Vector similarity search
│   └── utils/
│       └── embeddings.ts      # OpenAI embeddings utility
├── tests/
│   ├── mcp-protocol-compliance.test.ts
│   ├── saveChat.test.ts
│   ├── loadChats.test.ts
│   ├── searchChats.test.ts
│   ├── chatvault-integration.test.ts
│   ├── chatvault-error-cases.test.ts
│   └── helpers/               # Test utilities
├── scripts/
│   └── cleanup-prod-db.ts     # Production cleanup script
├── docker-compose.test.yml    # Test database setup
├── CHATGPT_INTEGRATION.md     # ChatGPT setup guide
├── QUICK_START.md             # Quick start guide
└── README.md
```

## MCP Tools

### `saveChat`

Save a chat conversation with automatic embedding generation.

**Parameters:**

- `userId` (required): User ID
- `title` (required): Chat title
- `turns` (required): Array of {prompt, response} pairs

**Returns:** Chat ID and saved status

### `loadChats`

Load paginated chats for a user, ordered by timestamp (newest first).

**Parameters:**

- `userId` (required): User ID
- `page` (optional, default 1): Page number (1-indexed)
- `limit` (optional, default 10): Results per page

**Returns:** Array of chats with pagination metadata

### `searchChats`

Perform semantic search on chat embeddings using vector similarity.

**Parameters:**

- `userId` (required): User ID
- `query` (required): Search query text
- `limit` (optional, default 10): Maximum results

**Returns:** Array of chats ordered by similarity, with search metadata

## Testing

The test suite includes:

- **Protocol Compliance Tests**: MCP protocol validation
- **Tool Tests**: Individual tool testing (8-9 tests per tool)
- **Integration Tests**: Full workflow testing (save → load → search)
- **Error Case Tests**: Missing parameters, invalid data, edge cases

All tests use a local Docker PostgreSQL database and are completely isolated from production.

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test saveChat
pnpm test loadChats
pnpm test searchChats
pnpm test integration
```

## ChatGPT Integration

See `CHATGPT_INTEGRATION.md` for detailed setup instructions.

Quick setup:

1. Start the server: `pnpm start`
2. Start ngrok: `ngrok http 8001`
3. Configure ChatGPT Desktop App with the ngrok URL + `/mcp`
4. Test the tools in ChatGPT

## Database Schema

The `chats` table includes:

- `id`: UUID primary key
- `user_id`: Text (required)
- `title`: Text (required)
- `timestamp`: Timestamp (auto-generated)
- `turns`: JSONB array of {prompt, response} pairs
- `embedding`: Vector(1536) - OpenAI text-embedding-3-small embeddings

## Important Notes

- **Test Database**: Tests automatically use a Docker PostgreSQL database on port 5433
- **Production Safety**: The database connection respects environment variables, so tests never touch production
- **Embeddings**: Uses OpenAI `text-embedding-3-small` model (1536 dimensions)
- **Vector Search**: Uses pgvector cosine distance operator (`<=>`) for similarity

## License

ISC

# ChatVault Part 2 - Backend MCP Server

Backend MCP server for ChatVault with PostgreSQL database and vector search capabilities.

## Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended)
- OpenAI API key (for embeddings)

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
   PORT=8000
   NODE_ENV=development
   ```

3. **Run database migrations:**

   ```bash
   pnpm run db:migrate
   ```

4. **Start the server:**
   ```bash
   pnpm start
   ```

## Development

- **Start in watch mode:**

  ```bash
  pnpm dev
  ```

- **Generate database migrations:**

  ```bash
  pnpm run db:generate
  ```

- **Open Drizzle Studio (database GUI):**
  ```bash
  pnpm run db:studio
  ```

## Project Structure

```
chat-vault-part2/
├── src/
│   ├── server.ts          # MCP server entry point
│   ├── db/
│   │   ├── schema.ts      # Drizzle schema definitions
│   │   ├── index.ts       # Database connection
│   │   └── migrate.ts     # Migration runner
│   └── tools/             # MCP tool implementations
├── package.json
├── tsconfig.json
└── README.md
```

## MCP Tools

- `saveChat` - Save a chat with embeddings
- `loadChats` - Load paginated chats
- `searchChats` - Vector similarity search

## License

ISC


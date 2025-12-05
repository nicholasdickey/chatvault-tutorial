# ChatGPT Integration Guide

This guide explains how to connect the ChatVault Part 2 MCP server to ChatGPT for testing.

## Prerequisites

1. **Production Database**: Ensure your Neon PostgreSQL database is set up and accessible
2. **Environment Variables**: Create a `.env` file with:
   ```
   DATABASE_URL=postgresql://user:password@host/database
   OPENAI_API_KEY=sk-...
   PORT=8000
   ```
3. **ngrok**: Install ngrok for tunneling (if not already installed)
   ```bash
   # Install ngrok
   # Visit https://ngrok.com/download or use package manager
   ```

## Step 1: Run Database Migrations

Ensure your production database is up-to-date:

```bash
cd chat-vault-part2
pnpm run db:migrate
```

This will:

- Enable the `pgvector` extension
- Create the `chats` table with all required columns
- Set up the database schema

## Step 2: Start the MCP Server

Start the backend server:

```bash
cd chat-vault-part2
pnpm start
```

The server will:

- Test database connection
- Verify pgvector extension is available
- Start listening on `http://localhost:8000`
- Log all database operations

Expected output:

```
[DB] Testing database connection...
[DB] Database connection successful
[DB] pgvector extension is available
ChatVault Part 2 MCP server listening on http://localhost:8000
  MCP endpoint: POST http://localhost:8000/mcp
  CORS preflight: OPTIONS http://localhost:8000/mcp
```

## Step 3: Set Up ngrok Tunnel

In a new terminal, start ngrok to expose your local server:

```bash
ngrok http 8000
```

This will output something like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:8000
```

**Important**: Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`). This is your public endpoint.

## Step 4: Configure ChatGPT

### Option A: Using ChatGPT Desktop App (Recommended)

1. Open ChatGPT Desktop App
2. Go to Settings → Model Context Protocol
3. Add a new MCP server:
   - **Name**: ChatVault Part 2
   - **Transport**: HTTP
   - **URL**: `https://abc123.ngrok-free.app/mcp` (use your ngrok URL)
   - **Headers**: (optional, for authentication if needed)

### Option B: Using ChatGPT Web Interface

If using the web interface, you may need to configure MCP through browser extensions or API settings. Refer to OpenAI's documentation for the latest method.

## Step 5: Test the Tools

Once connected, test all three tools in ChatGPT:

### Test 1: saveChat

```
Save a chat with the following:
- User ID: test-user-123
- Title: "My First Chat"
- Turns:
  - Prompt: "What is Python?"
  - Response: "Python is a programming language."
```

Expected: Chat should be saved successfully with a chat ID returned.

### Test 2: loadChats

```
Load chats for user test-user-123, page 1, limit 10
```

Expected: Should return the chat you just saved, with pagination metadata.

### Test 3: searchChats

```
Search for chats about "programming language" for user test-user-123
```

Expected: Should return the saved chat, ordered by similarity.

## Step 6: Verify Error Handling

Test error cases to ensure clear error messages:

1. **Missing userId**: Try saving a chat without userId
2. **Missing query**: Try searching without a query
3. **Invalid page**: Try loading with page -1
4. **Empty results**: Search for something that doesn't exist

All errors should return clear, actionable messages.

## Troubleshooting

### Database Connection Issues

- Verify `DATABASE_URL` in `.env` is correct
- Check that your Neon database is accessible
- Ensure the database has the `pgvector` extension enabled

### Server Not Starting

- Check that port 8000 is not already in use
- Verify all environment variables are set
- Check server logs for specific error messages

### ngrok Issues

- Ensure ngrok is authenticated: `ngrok config add-authtoken YOUR_TOKEN`
- Check that the tunnel is active: `ngrok http 8000`
- Verify the ngrok URL is accessible from the internet

### ChatGPT Connection Issues

- Verify the ngrok URL is correct (must be HTTPS)
- Check that the endpoint is `/mcp` (not just the base URL)
- Ensure CORS is properly configured (should be handled automatically)
- Check server logs for incoming requests

### Tool Not Working

- Verify the tool is in the tools list: Ask ChatGPT "What tools are available?"
- Check server logs for the tool call
- Verify database state matches expectations
- Test the tool directly via HTTP if needed

## Server Logs

The server logs all operations. Watch for:

- `[DB]` - Database operations
- `[MCP]` - MCP protocol messages
- `[MCP Handler]` - Tool handler execution
- `[saveChat]` - Save chat operations
- `[loadChats]` - Load chats operations
- `[searchChats]` - Search chats operations
- `[Embeddings]` - Embedding generation

## Production Checklist

Before deploying to production:

- [ ] Database migrations run successfully
- [ ] All environment variables set
- [ ] Server starts without errors
- [ ] All three tools work from ChatGPT
- [ ] Error handling returns clear messages
- [ ] Database operations are logged
- [ ] ngrok tunnel is stable (or use production URL)
- [ ] CORS is properly configured
- [ ] Security considerations addressed (authentication, rate limiting, etc.)

## Next Steps

After successful ChatGPT integration:

1. **Part 1 Widget Integration**: Connect the Part 1 frontend widget to this backend
2. **Production Deployment**: Deploy to a production server (Part 4)
3. **SaaS Layer**: Add authentication and multi-tenancy (Part 3)

## Support

For issues or questions:

- Check server logs for detailed error messages
- Verify database state using `pnpm run db:studio`
- Test individual tools using the test suite: `pnpm test`

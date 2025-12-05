# Quick Start Guide - ChatGPT Integration

## ✅ Step 1: Database Migrations (COMPLETED)

Migrations have been run successfully on your production database. The `chats` table is ready.

## 🚀 Step 2: Start the Server

In terminal 1, start the MCP server:

```bash
cd chat-vault-part2
pnpm start
```

You should see:

```
[DB] Database connection successful
[DB] pgvector extension is available
ChatVault Part 2 MCP server listening on http://localhost:8000
```

**Keep this terminal open** - the server must stay running.

## 🌐 Step 3: Start ngrok Tunnel

In terminal 2, start ngrok:

```bash
ngrok http 8000
```

You'll see output like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:8000
```

**Copy the HTTPS URL** (e.g., `https://abc123.ngrok-free.app`) - you'll need this for ChatGPT.

**Keep this terminal open** - ngrok must stay running.

## 💬 Step 4: Configure ChatGPT

### For ChatGPT Desktop App:

1. Open ChatGPT Desktop App
2. Go to **Settings** → **Model Context Protocol** (or **MCP Servers**)
3. Click **Add Server** or **+**
4. Configure:

   - **Name**: `ChatVault Part 2`
   - **Transport**: `HTTP`
   - **URL**: `https://abc123.ngrok-free.app/mcp` (use your ngrok URL + `/mcp`)
   - **Headers**: (leave empty unless you need authentication)

5. Save and restart ChatGPT if needed

### Verify Connection:

Ask ChatGPT: **"What MCP tools are available?"**

You should see:

- `saveChat`
- `loadChats`
- `searchChats`

## 🧪 Step 5: Test the Tools

### Test saveChat:

```
Save a chat with:
- userId: "test-user-123"
- title: "Python Introduction"
- turns:
  - prompt: "What is Python?"
  - response: "Python is a high-level programming language."
```

### Test loadChats:

```
Load chats for user "test-user-123", page 1, limit 10
```

### Test searchChats:

```
Search for chats about "programming language" for user "test-user-123"
```

## ✅ Verification Checklist

- [ ] Server is running on port 8000
- [ ] ngrok tunnel is active
- [ ] ChatGPT shows all three tools available
- [ ] saveChat works and returns a chat ID
- [ ] loadChats returns the saved chat
- [ ] searchChats finds the chat by semantic similarity
- [ ] Error messages are clear when testing invalid inputs

## 📝 Notes

- **Server logs**: Watch terminal 1 for all database operations
- **ngrok URL**: Changes each time you restart ngrok (unless using a static domain)
- **Database**: All operations are logged in server console
- **Testing**: Use the test suite: `pnpm test` to verify everything works

## 🐛 Troubleshooting

**Server won't start:**

- Check port 8000 is free: `lsof -i :8000`
- Verify `.env` file has `DATABASE_URL` and `OPENAI_API_KEY`

**ngrok not working:**

- Ensure ngrok is authenticated: `ngrok config add-authtoken YOUR_TOKEN`
- Check firewall isn't blocking

**ChatGPT can't connect:**

- Verify ngrok URL includes `/mcp` at the end
- Check server logs for incoming requests
- Ensure both server and ngrok are running

**Tools not appearing:**

- Restart ChatGPT after adding MCP server
- Check server logs for initialization errors
- Verify the ngrok URL is correct

## 📚 Full Documentation

See `CHATGPT_INTEGRATION.md` for detailed documentation.

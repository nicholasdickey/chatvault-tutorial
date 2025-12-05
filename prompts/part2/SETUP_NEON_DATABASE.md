# Prompt0: Setup Neon PostgreSQL Database

This guide walks you through setting up a Neon PostgreSQL database for the ChatVault Part 2 backend.

## Step 1: Create Neon Account

1. Go to [https://neon.tech](https://neon.tech)
2. Click "Sign Up" or "Get Started"
3. Sign up using GitHub, Google, or email
4. Complete the account setup

## Step 2: Create a New Project

1. After logging in, click "Create Project" or "New Project"
2. Fill in the project details:
   - **Project Name**: `chat-vault-part2` (or your preferred name)
   - **Region**: Choose a region close to you (e.g., `us-east-1`, `eu-west-1`)
   - **PostgreSQL Version**: Use the latest available version (15+ recommended)
3. Click "Create Project"

## Step 3: Get Connection String

1. Once your project is created, you'll see the Neon dashboard
2. Look for the "Connection Details" or "Connection String" section
3. You'll see a connection string that looks like:
   ```
   postgresql://username:password@ep-xxxx-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
4. **Copy this connection string** - you'll need it for the `.env` file

### Alternative: Get Connection String from Settings

1. Click on your project name in the sidebar
2. Go to "Settings" or "Connection Details"
3. Find the "Connection String" section
4. Copy the connection string (it may be labeled as "Connection URI" or "Postgres connection string")

## Step 4: Enable pgvector Extension

pgvector is required for vector similarity search. Let's enable it:

### Option A: Via Neon SQL Editor (Recommended)

1. In the Neon dashboard, click on "SQL Editor" or "Query"
2. Open a new query tab
3. Run this SQL command:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Verify it worked by running:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```
   You should see a row with `extname = 'vector'`

### Option B: Via psql (Command Line)

If you have `psql` installed:

```bash
psql "your-connection-string-here"
```

Then run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
\q
```

## Step 5: Verify Setup

Run this query in the Neon SQL Editor to verify everything is set up:

```sql
-- Check PostgreSQL version
SELECT version();

-- Check pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check if vector type is available
SELECT typname FROM pg_type WHERE typname = 'vector';
```

You should see:

- PostgreSQL version (15+)
- A row for the `vector` extension
- A row with `typname = 'vector'`

## Step 6: Save Connection String

Once you have your connection string, you'll save it in the `.env` file when we set up the project in Prompt1. For now, keep it safe - you'll need it soon!

**Important Notes:**

- Keep your connection string secure - never commit it to git
- The connection string includes your password - treat it as sensitive
- Neon provides both pooled and direct connection strings - we'll use the direct connection string for Drizzle

## Troubleshooting

### pgvector Extension Not Available

If you get an error that the `vector` extension is not available:

- Make sure you're using a Neon project (not a local PostgreSQL)
- Neon should have pgvector pre-installed, but if not, contact Neon support
- Try creating a new project if the extension is missing

### Connection String Issues

- Make sure you copied the entire connection string (it's long!)
- The connection string should start with `postgresql://`
- Check that SSL mode is set (usually `?sslmode=require` at the end)

## Next Steps

After completing this setup:

- ✅ Neon account created
- ✅ Project created
- ✅ Connection string obtained
- ✅ pgvector extension enabled
- ✅ Setup verified

Proceed to **Prompt1: Initialize Node.js Project with Drizzle + Apps SDK**

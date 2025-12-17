Prompt0:

1. Refactor tests for part1 and part2. Combine all existing tests for the part in a single file. Structure each test file (all.test.ts) for both parts (separate jobs) as a single flow, single test suite, with a single level of describe blocks. All cleanup will happen at the top (file) level in beforeAll - port cleanup, DB truncate (part2 only). Also start MCP server only once at the top of the file in beforeAll. Remove old test files after refactoring.

2. Use a single port (like, 8007, for example) with no fallback. No port cleanup or db truncate outside of file's beforeAll. Saturate tests with console.log.

3. Only server and DB teardown after the tests, not a port cleanup or db truncate.

4. Make sure node is the latest LTS

Prompt1:
Using part1 and part2 tests, create a CI config for GitHub Actions with the following requirements:

**Requirements:**

1. Run only on `dev` branch
2. Build widget before the tests.
3. Use GitHub Actions PostgreSQL service with pgvector extension (image: `pgvector/pgvector:pg16`). Do not use docker if the db is already available.
4. Use `test` repository environment for secrets (specify `environment: test` in the job that needs secrets)
5. Make sure that console.log output is saved in the file and uploaded to github after tests.

Prompt2

1. Create vercel deployment config files, install Vercel cli. We will deploy a monorepo with two projects for prod1 (mcp_server) and prod2.
2. Vercel routes should be /api/mcp. Use dynamic imports where needed (Part1) to avoid ESM import issues.
3. Part 1 assets are bundled with the widget (serverless MCP functions)
4. We will use the same prod DB as in dev - Neon serverless. Same .env variables will be setup in Vercel as in dev: DATABASE_URL, OPENAI_API_KEY, PORT (8000), PORT_BACKEND(8001), NODE_ENV
5. Make sure CORS headers are set - these MCP servers are called externally (Findexar, ChatGPT).
6. Ensure widget build targets browser ESM, not Node/CJS. Use type: module and jest.config.cjs
7. Connect vercel preview environment to dev branch in git and prod environment to main.

Prompt3

1. Add Authorization:Bearer API_KEY to both MCP servers. Check against API_KEY env var. 

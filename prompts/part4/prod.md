Prompt0:
Refactor tests for part1 and part2. Make each a single single-level file (all.test.ts), with a IMPORTANT _single_ cleanup (port or truncate DB) in the IMPORTANT _beginning_ of each, and a single MCP server start. Only use one port 8017. No fallback. Saturate tests with console.log

Prompt1:
Using part1 and part2 tests, create a CI config for GitHub Actions with the following requirements:

**Requirements:**

1. Run only on `dev` branch
2. Build widget before the tests.
3. Use GitHub Actions PostgreSQL service with pgvector extension (image: `pgvector/pgvector:pg16`). Do not use docker if the db is already available.
4. Use `test` repository environment for secrets (specify `environment: test` in the job that needs secrets)
5. Make sure that console.log output is saved in the file and uploaded to github after tests.

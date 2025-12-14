Prompt0:

1. Refactor tests for part1 and part2. Combine all existing tests for the part in a single file. Structure each test file (all.test.ts) for both parts as a single flow, with a single level of describes. All cleanup will happen at the top (file) level in beforeAll - port cleanup, DB truncate (part2 only). Also start MCP server only once at the top of the file in beforeAll.

2. Use a single port (like, 8007, for example) with no fallback. No port cleanup or db truncate outside of file's beforeAll. Saturate tests with console.log.

3. Only server and DB teardown after the tests, not a port cleanup or db truncate

Prompt1:
Using part1 and part2 tests, create a CI config for GitHub Actions with the following requirements:

**Requirements:**

1. Run only on `dev` branch
2. Build widget before the tests.
3. Use GitHub Actions PostgreSQL service with pgvector extension (image: `pgvector/pgvector:pg16`). Do not use docker if the db is already available.
4. Use `test` repository environment for secrets (specify `environment: test` in the job that needs secrets)
5. Make sure that console.log output is saved in the file and uploaded to github after tests.

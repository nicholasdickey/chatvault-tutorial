Prompt0:
Using part1 and part2 tests, create a CI config for GitHub Actions with the following requirements:

**Requirements:**

1. Run only on `dev` branch (both push and pull_request events)
2. Use GitHub Actions PostgreSQL service with pgvector extension (image: `pgvector/pgvector:pg16`)
3. Use `test` repository environment for secrets (specify `environment: test` in the job that needs secrets)
4. Run jobs sequentially: part2 should depend on part1 completing (`needs: test-part1`)
5. For Jest tests, use these flags: `--runInBand --verbose --useStderr --testLocationInResults --detectOpenHandles`
   - DO NOT use `--forceExit` or `--coverage=false`
   - DO NOT set `NODE_OPTIONS` memory limits - let Node.js use available memory
6. Database configuration:
   - PostgreSQL service should use port 5433 (map to 5432 internally)
   - Use credentials: user `testuser`, password `testpass`, database `testdb`
   - The database helper should check if database is already available (from GitHub Actions service) before attempting to start Docker Compose
7. For part2, ensure OPENAI_API_KEY secret is available from the `test` environment
8. Both test suites are in separate directories: `chat-vault-part1` and `chat-vault-part2`
9. Use Node.js 22 and pnpm 10.13.1
10. Set up proper pnpm caching

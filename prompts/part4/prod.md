Prompt0:
Refactor test for part1 and part2. Make each a single file, with a single cleanup (port or truncate DB) in the beginning of each. Only use one port 8017.

Prompt1:
Using part1 and part2 tests, create a CI config for GitHub Actions with the following requirements:

**Requirements:**

1. Run only on `dev` branch (both push and pull_request events)
2. Use GitHub Actions PostgreSQL service with pgvector extension (image: `pgvector/pgvector:pg16`)
3. Use `test` repository environment for secrets (specify `environment: test` in the job that needs secrets)
4. Run jobs sequentially: part2 should depend on part1 completing (`needs: test-part1`)

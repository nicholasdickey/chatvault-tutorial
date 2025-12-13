Prompt0:
Using part1 and part2 tests, create a CI config for GitHub Actions with the following requirements:

**Requirements:**

1. Run only on `dev` branch (both push and pull_request events)
2. Use GitHub Actions PostgreSQL service with pgvector extension (image: `pgvector/pgvector:pg16`)
3. Use `test` repository environment for secrets (specify `environment: test` in the job that needs secrets)
4. Run jobs sequentially: part2 should depend on part1 completing (`needs: test-part1`)
5. For Jest tests, use these flags: `--verbose --useStderr --testLocationInResults --detectOpenHandles`
   - DO NOT include `--runInBand` in the workflow command - it's already in package.json test scripts
   - DO NOT use `--forceExit` or `--coverage=false`
   - DO NOT set `NODE_OPTIONS` memory limits - let Node.js use available memory
   - Use `2>&1 | tee "$RUNNER_TEMP/jest-<part>.log"` pattern to capture both stdout and stderr, display logs in real-time, and save to file
   - Include `set -o pipefail` before the test command to ensure step fails if Jest fails
   - Upload Jest logs as artifacts using `actions/upload-artifact@v4` with `if: always()` so logs are available even if tests fail
6. For part1, build assets before running tests (`pnpm run build` in chat-vault-part1 directory)
7. Database configuration:
   - PostgreSQL service should use port 5433 (map to 5432 internally)
   - Use credentials: user `testuser`, password `testpass`, database `testdb`
   - The database helper should check if database is already available (from GitHub Actions service) before attempting to start Docker Compose
8. For part2, ensure OPENAI_API_KEY secret is available from the `test` environment
9. Both test suites are in separate directories: `chat-vault-part1` and `chat-vault-part2`
10. Use Node.js 22 and pnpm 10.13.1
11. Set up proper pnpm caching
12. Ensure Jest config files have `silent: false` and `verbose: true` to prevent output suppression and ensure logs are visible in CI

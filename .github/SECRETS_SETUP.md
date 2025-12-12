# GitHub Secrets Setup Guide

## Where to Configure Secrets

GitHub provides two places to store secrets:

### 1. Repository Secrets (Recommended for most cases)

- **Location**: Repository Settings → Secrets and variables → Actions → Repository secrets
- **Scope**: Available to all workflows in the repository
- **Use case**: Shared secrets across all environments (like API keys for testing)

**To add a repository secret:**

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Enter name: `OPENAI_API_KEY`
5. Enter the value and click **Add secret**

### 2. Environment Secrets (Recommended for different environments)

- **Location**: Repository Settings → Environments → [Environment Name] → Secrets
- **Scope**: Only available to jobs that specify that environment
- **Use case**: Different secrets for test/staging/production environments

**To add an environment secret:**

1. Go to your repository on GitHub
2. Click **Settings** → **Environments**
3. Click **New environment** (or select existing, e.g., "test")
4. In the environment settings, scroll to **Secrets**
5. Click **Add secret**
6. Enter name: `OPENAI_API_KEY`
7. Enter the value and click **Add secret**

## Current Workflow Configuration

The workflow currently uses:

- **Environment**: `test` (specified in the `test-part2` job)
- **Secret reference**: `${{ secrets.OPENAI_API_KEY }}`

GitHub will look for the secret in this order:

1. Environment secrets (from the `test` environment) - takes precedence
2. Repository secrets (if not found in environment)

## Recommended Setup

For this CI workflow, we recommend:

**Option A: Repository Secret (Simpler)**

- Add `OPENAI_API_KEY` as a repository secret
- All jobs can access it
- Good for shared test credentials

**Option B: Environment Secret (More secure)**

- Create a `test` environment
- Add `OPENAI_API_KEY` as an environment secret in the `test` environment
- Only jobs using `environment: test` can access it
- Better for isolating secrets by environment

## Creating the Environment (if using Option B)

If you want to use environment secrets:

1. Go to: **Settings** → **Environments**
2. Click **New environment**
3. Name it: `test`
4. Optionally add protection rules (e.g., required reviewers, wait timer)
5. Click **Configure environment**
6. In **Secrets**, add your `OPENAI_API_KEY`

## Secret Names Used in This Workflow

- `OPENAI_API_KEY` - Required for part2 tests (for generating embeddings)

/**
 * Database helper utilities for tests
 * Manages test database lifecycle: setup, migrations, cleanup
 */

import postgres from "postgres";
import type { Sql } from "postgres";
import { execSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";

export const TEST_DB_URL = "postgresql://testuser:testpass@localhost:5433/testdb";

let dbClient: Sql | null = null;

/**
 * Get database client for test database
 */
export function getTestDb(): Sql {
    if (!dbClient) {
        dbClient = postgres(TEST_DB_URL, { max: 1 });
    }
    return dbClient;
}

/**
 * Get Drizzle instance for test database
 */
export function getTestDrizzle() {
    return drizzle(getTestDb());
}

/**
 * Check if Docker container is running
 */
export async function isDockerContainerRunning(): Promise<boolean> {
    try {
        const result = execSync(
            'docker ps --filter "name=chatvault-part2-test-db" --format "{{.Names}}"',
            { encoding: "utf-8" }
        );
        return result.trim() === "chatvault-part2-test-db";
    } catch (e) {
        return false;
    }
}

/**
 * Start Docker container for test database
 */
export async function startTestDatabase(): Promise<void> {
    // First, check if database is already available (e.g., from GitHub Actions services)
    console.log("[DB Helper] Checking if database is already available...");
    let retries = 5;
    while (retries > 0) {
        try {
            const testClient = postgres(TEST_DB_URL, { max: 1, connect_timeout: 2 });
            await testClient`SELECT 1`;
            await testClient.end();
            console.log("[DB Helper] Database is already available (likely from CI service)");
            return;
        } catch (e) {
            retries--;
            if (retries > 0) {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
    }

    // Database not available, check if docker container is running
    const isRunning = await isDockerContainerRunning();
    if (isRunning) {
        console.log("[DB Helper] Test database container is already running");
        return;
    }

    // Try to start docker compose
    console.log("[DB Helper] Starting test database container...");
    try {
        execSync(
            "docker compose -f docker-compose.test.yml up -d",
            { cwd: process.cwd(), stdio: "inherit" }
        );

        // Wait for database to be ready
        console.log("[DB Helper] Waiting for database to be ready...");
        retries = 30;
        let lastError: Error | null = null;
        while (retries > 0) {
            try {
                const testClient = postgres(TEST_DB_URL, { max: 1, connect_timeout: 2 });
                await testClient`SELECT 1`;
                await testClient.end();
                console.log("[DB Helper] Test database is ready");
                return;
            } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                retries--;
                if (retries > 0) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
        }
        throw new Error(
            `Test database failed to start within 30 seconds. Last error: ${lastError?.message || "Unknown error"}`
        );
    } catch (e) {
        throw new Error(
            `Failed to start test database: ${e instanceof Error ? e.message : String(e)}`
        );
    }
}

/**
 * Stop Docker container for test database
 */
export async function stopTestDatabase(): Promise<void> {
    try {
        execSync(
            "docker compose -f docker-compose.test.yml down",
            { cwd: process.cwd(), stdio: "inherit" }
        );
        console.log("[DB Helper] Test database container stopped");
    } catch (e) {
        // Ignore errors - container might not be running
        console.log("[DB Helper] Test database container stop (ignored)");
    }
}

/**
 * Enable pgvector extension
 */
export async function enablePgVector(): Promise<void> {
    const db = getTestDb();
    await db`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log("[DB Helper] pgvector extension enabled");
}

/**
 * Run database migrations
 */
export async function runMigrations(): Promise<void> {
    // Enable pgvector extension (must be done before schema migrations)
    await enablePgVector();

    // Run Drizzle migrations
    const db = getTestDrizzle();
    try {
        // Get the project root directory (where drizzle folder is)
        const projectRoot = process.cwd();
        const migrationsPath = `${projectRoot}/drizzle`;
        console.log("[DB Helper] Running migrations from:", migrationsPath);
        await migrate(db, { migrationsFolder: migrationsPath });
        console.log("[DB Helper] Drizzle migrations completed");
    } catch (error) {
        console.error("[DB Helper] Migration error:", error);
        throw error;
    }
}

/**
 * Truncate all tables (clean state)
 */
export async function truncateAllTables(): Promise<void> {
    const db = getTestDrizzle();
    // Get all table names using Drizzle
    try {
    const result = await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    const tables = (result as unknown) as Array<{ tablename: string }>;

        if (tables.length > 0) {
            const tableNames = tables.map((t) => t.tablename).join(", ");
            await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`));
            console.log(`[DB Helper] Truncated ${tables.length} tables`);
        } else {
            console.log("[DB Helper] No tables to truncate");
        }
    } catch (error) {
        // If tables don't exist yet, that's okay - migrations will create them
        console.log("[DB Helper] No tables to truncate (may not exist yet)");
    }
}

/**
 * Clean up test database (close connection)
 */
export async function cleanupTestDatabase(): Promise<void> {
    if (dbClient) {
        await dbClient.end();
        dbClient = null;
        console.log("[DB Helper] Database connection closed");
    }
}


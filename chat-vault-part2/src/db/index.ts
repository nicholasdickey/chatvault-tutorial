import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";

// Only load .env if DATABASE_URL is not already set (allows tests to override)
if (!process.env.DATABASE_URL) {
    dotenv.config();
}

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
}

// Create the connection
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString, { max: 1 });

const databaseClientCreatedAt = Date.now();
let databaseOperationObserved = false;

/**
 * Report whether this is the first observed database operation in this
 * serverless instance. postgres.js connects lazily, so the first operation is
 * the one that can include connection establishment and database wake-up.
 */
export function observeDatabaseOperation(): {
    firstInInstance: boolean;
    clientAgeMs: number;
} {
    const firstInInstance = !databaseOperationObserved;
    databaseOperationObserved = true;
    return {
        firstInInstance,
        clientAgeMs: Date.now() - databaseClientCreatedAt,
    };
}

// Create the Drizzle instance
export const db = drizzle(client);

// Test connection function
export async function testConnection(): Promise<boolean> {
    try {
        await client`SELECT 1`;
        return true;
    } catch (error) {
        console.error("Database connection test failed:", error);
        return false;
    }
}


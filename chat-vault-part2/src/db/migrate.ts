import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index.js";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config();

async function runMigrations() {
    try {
        console.log("Running database migrations...");

        // First, enable pgvector extension if not already enabled
        // This must be done before any schema migrations
        try {
            await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
            console.log("pgvector extension enabled");
        } catch (error) {
            console.error("Failed to enable pgvector extension:", error);
            throw error;
        }

        // Run Drizzle migrations
        await migrate(db, { migrationsFolder: "./drizzle" });
        console.log("Migrations completed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
}

runMigrations();



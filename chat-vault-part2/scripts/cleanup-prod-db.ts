/**
 * Script to clean up test data from production database
 * WARNING: This will delete all data from the chats table
 * 
 * Usage: tsx scripts/cleanup-prod-db.ts
 */

import { db } from "../src/db/index.js";
import { chats } from "../src/db/schema.js";
import { sql } from "drizzle-orm";
import * as dotenv from "dotenv";
import * as readline from "readline";

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function question(query: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
}

async function cleanup() {
    try {
        console.log("⚠️  WARNING: This will delete ALL data from the chats table!");
        console.log("Database:", process.env.DATABASE_URL?.replace(/:[^@]*@/, ":***@"));
        console.log("");

        const answer = await question("Are you sure you want to proceed? Type 'DELETE ALL' to confirm: ");

        if (answer !== "DELETE ALL") {
            console.log("Aborted. No data was deleted.");
            process.exit(0);
        }

        console.log("\nDeleting all chats from database...");

        // Get count before deletion
        const countResult = await db.execute(sql`SELECT COUNT(*) as count FROM chats`);
        const count = Number((countResult[0] as { count: string | number })?.count ?? 0);

        console.log(`Found ${count} chats to delete.`);

        if (count === 0) {
            console.log("No chats to delete. Database is already clean.");
            process.exit(0);
        }

        // Delete all chats
        await db.delete(chats);
        console.log(`✓ Deleted ${count} chats successfully.`);

        // Verify deletion
        const verifyResult = await db.execute(sql`SELECT COUNT(*) as count FROM chats`);
        const remaining = Number((verifyResult[0] as { count: string | number })?.count ?? 0);

        if (remaining === 0) {
            console.log("✓ Verification: Database is now clean.");
        } else {
            console.log(`⚠️  Warning: ${remaining} chats still remain.`);
        }

        process.exit(0);
    } catch (error) {
        console.error("Error cleaning up database:", error);
        process.exit(1);
    } finally {
        rl.close();
    }
}

cleanup();


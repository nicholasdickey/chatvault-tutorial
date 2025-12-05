import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";

// Define vector type for pgvector
// Note: Drizzle doesn't have native pgvector support, so we use a custom type
// The actual SQL will be handled in migrations
const vector = customType<{ data: number[]; driverData: string }>({
    dataType() {
        return "vector(1536)"; // OpenAI text-embedding-3-small produces 1536 dimensions
    },
    toDriver(value: number[]): string {
        // Convert array to pgvector format: [1,2,3]
        return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
        // Parse pgvector format back to array
        if (typeof value === "string") {
            return JSON.parse(value);
        }
        return value;
    },
});

// Chat table schema
export const chats = pgTable("chats", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
    turns: jsonb("turns").notNull().$type<Array<{ prompt: string; response: string }>>(),
    embedding: vector("embedding"),
});

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

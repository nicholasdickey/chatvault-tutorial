import { pgTable, text, timestamp, jsonb, uuid, index, integer, primaryKey } from "drizzle-orm/pg-core";
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
}, (table) => ({
    // Index on userId for efficient filtering by user
    userIdIdx: index("chats_user_id_idx").on(table.userId),
    // Composite index on (userId, timestamp DESC) for efficient user queries ordered by time
    // This optimizes loadMyChats queries and expiration checks
    userIdTimestampIdx: index("chats_user_id_timestamp_idx").on(table.userId, table.timestamp),
}));

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

// Iterative save: temporary storage for turn-by-turn chat saves
export const chatSaveJobs = pgTable("chat_save_jobs", {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chatSaveJobTurns = pgTable(
    "chat_save_job_turns",
    {
        jobId: uuid("job_id")
            .notNull()
            .references(() => chatSaveJobs.id, { onDelete: "cascade" }),
        turnIndex: integer("turn_index").notNull(),
        prompt: text("prompt").notNull(),
        response: text("response").notNull(),
    },
    (table) => [primaryKey({ columns: [table.jobId, table.turnIndex] })]
);

export type ChatSaveJob = typeof chatSaveJobs.$inferSelect;
export type NewChatSaveJob = typeof chatSaveJobs.$inferInsert;
export type ChatSaveJobTurn = typeof chatSaveJobTurns.$inferSelect;
export type NewChatSaveJobTurn = typeof chatSaveJobTurns.$inferInsert;

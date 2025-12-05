CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"turns" jsonb NOT NULL,
	"embedding" vector(1536)
);

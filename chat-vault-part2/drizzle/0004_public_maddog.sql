CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_topics" (
	"chat_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_topics_chat_id_topic_id_pk" PRIMARY KEY("chat_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "chat_topics" ADD CONSTRAINT "chat_topics_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_topics" ADD CONSTRAINT "chat_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topics_user_id_idx" ON "topics" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_user_name_norm_idx" ON "topics" USING btree ("user_id","name_norm");--> statement-breakpoint
CREATE INDEX "chat_topics_topic_id_idx" ON "chat_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "chat_topics_chat_id_idx" ON "chat_topics" USING btree ("chat_id");

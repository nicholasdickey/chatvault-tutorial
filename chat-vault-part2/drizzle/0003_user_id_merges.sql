CREATE TABLE "user_id_merges" (
	"from_user_id" text PRIMARY KEY NOT NULL,
	"to_user_id" text NOT NULL,
	"merged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_id_merges_to_user_id_idx" ON "user_id_merges" USING btree ("to_user_id");

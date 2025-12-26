CREATE INDEX "chats_user_id_idx" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chats_user_id_timestamp_idx" ON "chats" USING btree ("user_id","timestamp");
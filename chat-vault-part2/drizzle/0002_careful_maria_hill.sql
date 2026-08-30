CREATE TABLE "chat_save_job_turns" (
	"job_id" uuid NOT NULL,
	"turn_index" integer NOT NULL,
	"prompt" text NOT NULL,
	"response" text NOT NULL,
	CONSTRAINT "chat_save_job_turns_job_id_turn_index_pk" PRIMARY KEY("job_id","turn_index")
);
--> statement-breakpoint
CREATE TABLE "chat_save_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_save_job_turns" ADD CONSTRAINT "chat_save_job_turns_job_id_chat_save_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."chat_save_jobs"("id") ON DELETE cascade ON UPDATE no action;
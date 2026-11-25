ALTER TABLE "data_submissions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "data_submissions" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "data_submissions" ADD COLUMN "reviewed_at" timestamp with time zone;
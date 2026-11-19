ALTER TABLE "trips" ADD COLUMN "plans" jsonb;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "plan_index" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ended_at" timestamp with time zone;
ALTER TABLE "places" ADD COLUMN "closed_weekdays" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "closed_ranges" jsonb;
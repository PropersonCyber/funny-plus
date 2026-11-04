ALTER TABLE "guides" ADD COLUMN "rating" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "badges" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "place_ids" text[] DEFAULT '{}' NOT NULL;
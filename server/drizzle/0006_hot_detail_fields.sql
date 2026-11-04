ALTER TABLE "cities" ADD COLUMN "days" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "tips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "rating" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "visitors" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plays" ADD COLUMN "chips" jsonb DEFAULT '[]'::jsonb NOT NULL;
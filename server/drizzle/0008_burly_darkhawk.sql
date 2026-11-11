ALTER TABLE "places" ALTER COLUMN "ticket" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "open_text" text;
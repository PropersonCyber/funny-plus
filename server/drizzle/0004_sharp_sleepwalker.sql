ALTER TABLE "places" ADD COLUMN "source" text DEFAULT '产品组按公开信息整理（未做官方核验）' NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "verified_at" date;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "trust" text DEFAULT 'pending' NOT NULL;
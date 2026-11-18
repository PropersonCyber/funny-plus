CREATE TABLE "guide_shares" (
	"token" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"user_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "guide_shares_user_idx" ON "guide_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guide_shares_draft_idx" ON "guide_shares" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "guide_shares_draft_active_idx" ON "guide_shares" USING btree ("draft_id","revoked_at");--> statement-breakpoint
CREATE INDEX "photos_user_idx" ON "photos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "photos_sha_idx" ON "photos" USING btree ("sha256");
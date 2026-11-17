CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"client_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guide_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_memories" (
	"trip_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text,
	"wechat_unionid" text,
	"apple_sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "constraint_reports" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "data_submissions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "fact_feedbacks" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "footprints" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "track_events" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_uq" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_client_idx" ON "auth_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "guide_drafts_user_idx" ON "guide_drafts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guide_drafts_trip_idx" ON "guide_drafts" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "sms_codes_phone_idx" ON "sms_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "trip_memories_user_idx" ON "trip_memories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wechat_uq" ON "users" USING btree ("wechat_unionid");--> statement-breakpoint
CREATE UNIQUE INDEX "users_apple_uq" ON "users" USING btree ("apple_sub");--> statement-breakpoint
CREATE INDEX "collections_user_idx" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "constraint_reports_user_idx" ON "constraint_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "data_submissions_user_idx" ON "data_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fact_feedbacks_user_idx" ON "fact_feedbacks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "footprints_user_idx" ON "footprints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "track_events_user_idx" ON "track_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trips_user_idx" ON "trips" USING btree ("user_id");
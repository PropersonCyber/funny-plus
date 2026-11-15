CREATE TABLE "constraint_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"rule_code" text NOT NULL,
	"trust_level" text NOT NULL,
	"plan_id" text,
	"note" text,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"note" text,
	"client_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lines" (
	"id" text PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"stops" jsonb NOT NULL,
	"first_bus" integer,
	"last_bus" integer,
	"interval_min" integer,
	"tickets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"need_advance" boolean,
	"capacity" integer,
	"ride_min" integer,
	"season_note" text,
	"ride_at_place_id" text,
	"source" text NOT NULL,
	"source_url" text,
	"verified_at" date,
	"trust" text DEFAULT 'pending' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "poi_group" text;--> statement-breakpoint
CREATE UNIQUE INDEX "constraint_reports_uq" ON "constraint_reports" USING btree ("issue_id","client_id");--> statement-breakpoint
CREATE INDEX "constraint_reports_rule_idx" ON "constraint_reports" USING btree ("rule_code");--> statement-breakpoint
CREATE UNIQUE INDEX "data_submissions_uq" ON "data_submissions" USING btree ("scope","target_id","field","client_id");--> statement-breakpoint
CREATE INDEX "data_submissions_target_idx" ON "data_submissions" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "lines_city_idx" ON "lines" USING btree ("city");--> statement-breakpoint
CREATE INDEX "lines_ride_place_idx" ON "lines" USING btree ("ride_at_place_id");--> statement-breakpoint
CREATE INDEX "facts_place_idx" ON "facts" USING btree ("place_id");
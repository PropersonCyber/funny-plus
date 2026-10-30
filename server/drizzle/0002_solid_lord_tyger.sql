CREATE TABLE "trip_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"note" text NOT NULL,
	"impact" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"demand" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trip_versions_trip_idx" ON "trip_versions" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trips_client_idx" ON "trips" USING btree ("client_id");
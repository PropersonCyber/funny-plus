CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"open_start" integer NOT NULL,
	"open_end" integer NOT NULL,
	"ticket" integer NOT NULL,
	"stay_min" integer NOT NULL,
	"walk" integer NOT NULL,
	"tags" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "places_city_idx" ON "places" USING btree ("city");
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"cover_image" text NOT NULL,
	"price_from" text NOT NULL,
	"rating" text NOT NULL,
	"visited_text" text NOT NULL,
	"desc" text NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "footprints" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"city" text NOT NULL,
	"place_id" text NOT NULL,
	"visited_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guides" (
	"id" text PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"title" text NOT NULL,
	"note" text NOT NULL,
	"cover_image" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"day_count" integer NOT NULL,
	"tags" text[] NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_places" (
	"play_id" text NOT NULL,
	"place_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "play_places_play_id_place_id_pk" PRIMARY KEY("play_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "plays" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"note" text NOT NULL,
	"cover_image" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "collections_client_target_uq" ON "collections" USING btree ("client_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "collections_client_idx" ON "collections" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "footprints_client_place_day_uq" ON "footprints" USING btree ("client_id","place_id","visited_on");--> statement-breakpoint
CREATE INDEX "footprints_client_idx" ON "footprints" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "guides_city_idx" ON "guides" USING btree ("city");
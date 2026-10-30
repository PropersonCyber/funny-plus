CREATE TABLE "fact_feedbacks" (
	"id" text PRIMARY KEY NOT NULL,
	"fact_id" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" text PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"scope" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"verified_at" date NOT NULL,
	"valid_until" date,
	"trust" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fact_feedbacks_fact_id_idx" ON "fact_feedbacks" USING btree ("fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fact_feedbacks_fact_client_uq" ON "fact_feedbacks" USING btree ("fact_id","client_id");--> statement-breakpoint
CREATE INDEX "facts_city_idx" ON "facts" USING btree ("city");
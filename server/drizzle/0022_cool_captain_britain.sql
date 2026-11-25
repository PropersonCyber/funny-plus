CREATE TABLE "field_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target_id" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "field_evidence_target_idx" ON "field_evidence" USING btree ("scope","target_id","field");
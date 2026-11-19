CREATE TABLE "ai_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"user_id" text,
	"kind" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"duration_ms" integer NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"tool_failures" integer DEFAULT 0 NOT NULL,
	"plan_generated" boolean DEFAULT false NOT NULL,
	"plan_attempts" integer DEFAULT 0 NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"degrade_reason" text,
	"journey" text,
	"stream" boolean DEFAULT false NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_calls_at_idx" ON "ai_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ai_calls_session_idx" ON "ai_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_calls_journey_at_idx" ON "ai_calls" USING btree ("journey","at");
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_messages_session_idx" ON "ai_messages" USING btree ("session_id","at");--> statement-breakpoint
CREATE INDEX "ai_sessions_user_idx" ON "ai_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_sessions_user_trip_idx" ON "ai_sessions" USING btree ("user_id","trip_id","updated_at");
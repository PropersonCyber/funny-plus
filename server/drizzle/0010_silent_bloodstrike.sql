CREATE TABLE "track_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"client_id" text NOT NULL,
	"platform" text,
	"event" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "track_events_session_idx" ON "track_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "track_events_event_at_idx" ON "track_events" USING btree ("event","at");--> statement-breakpoint
CREATE INDEX "track_events_client_idx" ON "track_events" USING btree ("client_id");
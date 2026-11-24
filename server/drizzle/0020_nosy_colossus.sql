ALTER TABLE "ai_calls" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "cost_micros" integer;
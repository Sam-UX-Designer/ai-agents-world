ALTER TABLE "agent_instructions" ALTER COLUMN "instructions" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "agent_instructions" ADD COLUMN "display_name" text;
ALTER TABLE "repos" ADD COLUMN "provider" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "host" text DEFAULT 'github.com' NOT NULL;
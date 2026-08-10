ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "finding_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "review_pr_idx" ON "reviews" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "review_ws_idx" ON "reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_run_pr_idx" ON "agent_runs" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "agent_run_agent_idx" ON "agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_run_done_idx" ON "agent_runs" USING btree ("pr_id","status") WHERE "agent_runs"."status" = 'done';
CREATE TABLE "agent_reputation" (
	"agent_did" text PRIMARY KEY NOT NULL,
	"overall_score" numeric(5, 4) DEFAULT '0.5' NOT NULL,
	"success_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"avg_latency_ms" integer,
	"verification_score" numeric(5, 4) DEFAULT '0.5' NOT NULL,
	"page_rank" numeric(10, 8) DEFAULT '0.001' NOT NULL,
	"coalition_score" numeric(5, 4) DEFAULT '0.5' NOT NULL,
	"total_tasks" integer DEFAULT 0 NOT NULL,
	"successful_tasks" integer DEFAULT 0 NOT NULL,
	"failed_tasks" integer DEFAULT 0 NOT NULL,
	"timed_out_tasks" integer DEFAULT 0 NOT NULL,
	"capability_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"endorsements" text[] DEFAULT '{}' NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_stakes" (
	"agent_did" text PRIMARY KEY NOT NULL,
	"staked_amount" numeric(18, 8) DEFAULT '0' NOT NULL,
	"locked_amount" numeric(18, 8) DEFAULT '0' NOT NULL,
	"total_slashed" numeric(18, 8) DEFAULT '0' NOT NULL,
	"last_stake_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endorsements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endorser_did" text NOT NULL,
	"endorsee_did" text NOT NULL,
	"weight" numeric(5, 4) DEFAULT '1' NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_escrow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_did" text NOT NULL,
	"workflow_run_id" uuid,
	"node_name" text,
	"amount" numeric(18, 8) NOT NULL,
	"escrow_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'held' NOT NULL,
	"reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"node_name" text NOT NULL,
	"agent_did" text NOT NULL,
	"bid_amount" numeric(18, 8) NOT NULL,
	"eta_ms" integer,
	"stake_offered" numeric(18, 8) DEFAULT '0' NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"created_by" text,
	"namespace" varchar(50) DEFAULT 'shared' NOT NULL,
	"ttl_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"category" varchar(50),
	"dag" jsonb NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"default_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ledger_escrow" ADD CONSTRAINT "ledger_escrow_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_bids" ADD CONSTRAINT "node_bids_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_memory" ADD CONSTRAINT "workflow_memory_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_reputation_score_idx" ON "agent_reputation" USING btree ("overall_score");--> statement-breakpoint
CREATE INDEX "endorsements_endorser_idx" ON "endorsements" USING btree ("endorser_did");--> statement-breakpoint
CREATE INDEX "endorsements_endorsee_idx" ON "endorsements" USING btree ("endorsee_did");--> statement-breakpoint
CREATE UNIQUE INDEX "endorsements_pair_idx" ON "endorsements" USING btree ("endorser_did","endorsee_did");--> statement-breakpoint
CREATE INDEX "ledger_escrow_account_idx" ON "ledger_escrow" USING btree ("account_did");--> statement-breakpoint
CREATE INDEX "ledger_escrow_workflow_idx" ON "ledger_escrow" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "ledger_escrow_status_idx" ON "ledger_escrow" USING btree ("status");--> statement-breakpoint
CREATE INDEX "node_bids_workflow_node_idx" ON "node_bids" USING btree ("workflow_run_id","node_name");--> statement-breakpoint
CREATE INDEX "node_bids_agent_idx" ON "node_bids" USING btree ("agent_did");--> statement-breakpoint
CREATE INDEX "node_bids_status_idx" ON "node_bids" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_memory_workflow_key_idx" ON "workflow_memory" USING btree ("workflow_run_id","namespace","key");--> statement-breakpoint
CREATE INDEX "workflow_memory_workflow_idx" ON "workflow_memory" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_slug_idx" ON "workflow_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workflow_templates_category_idx" ON "workflow_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "workflow_templates_featured_idx" ON "workflow_templates" USING btree ("is_featured","is_public");
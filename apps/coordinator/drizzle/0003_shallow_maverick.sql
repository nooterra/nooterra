CREATE TABLE "blackboard_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blackboard_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"delta_success" numeric(10, 4),
	"delta_failure" numeric(10, 4),
	"delta_congestion" numeric(5, 4),
	"source_workflow_id" uuid,
	"source_agent_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blackboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" text NOT NULL,
	"capability" text NOT NULL,
	"context_hash" text NOT NULL,
	"success_weight" numeric(10, 4) DEFAULT '0.0' NOT NULL,
	"failure_weight" numeric(10, 4) DEFAULT '0.0' NOT NULL,
	"congestion_score" numeric(5, 4) DEFAULT '0.0' NOT NULL,
	"preferred_agents" text[] DEFAULT '{}',
	"tags" text[] DEFAULT '{}',
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_name" text NOT NULL,
	"capability_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"payer_did" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coordination_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_capability" text NOT NULL,
	"to_capability" text NOT NULL,
	"profile_level" integer DEFAULT 0 NOT NULL,
	"region" text,
	"tenant_id" uuid,
	"call_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" numeric(10, 2),
	"p95_latency_ms" numeric(10, 2),
	"avg_price_ncr" numeric(18, 8),
	"reputation_score" numeric(5, 4) DEFAULT '0.0',
	"congestion_score" numeric(5, 4) DEFAULT '0.0',
	"weight_override" numeric(5, 4),
	"last_used_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fault_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_name" text NOT NULL,
	"fault_type" text NOT NULL,
	"blamed_did" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refund_amount" numeric(18, 8),
	"refunded_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reputation" ADD COLUMN "capability_percentiles" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_reputation" ADD COLUMN "overall_percentile" numeric(5, 4) DEFAULT '0.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "blackboard_events" ADD CONSTRAINT "blackboard_events_blackboard_id_blackboards_id_fk" FOREIGN KEY ("blackboard_id") REFERENCES "public"."blackboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fault_traces" ADD CONSTRAINT "fault_traces_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blackboard_events_bb_idx" ON "blackboard_events" USING btree ("blackboard_id");--> statement-breakpoint
CREATE INDEX "blackboard_events_created_idx" ON "blackboard_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blackboards_key_idx" ON "blackboards" USING btree ("namespace","capability","context_hash");--> statement-breakpoint
CREATE INDEX "blackboards_capability_idx" ON "blackboards" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "blackboards_namespace_idx" ON "blackboards" USING btree ("namespace");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_reservations_workflow_node_idx" ON "budget_reservations" USING btree ("workflow_id","node_name");--> statement-breakpoint
CREATE INDEX "budget_reservations_status_idx" ON "budget_reservations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "coordination_edges_pair_idx" ON "coordination_edges" USING btree ("from_capability","to_capability","profile_level","region","tenant_id");--> statement-breakpoint
CREATE INDEX "coordination_edges_from_idx" ON "coordination_edges" USING btree ("from_capability");--> statement-breakpoint
CREATE INDEX "coordination_edges_to_idx" ON "coordination_edges" USING btree ("to_capability");--> statement-breakpoint
CREATE INDEX "fault_traces_workflow_idx" ON "fault_traces" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "fault_traces_blamed_idx" ON "fault_traces" USING btree ("blamed_did");--> statement-breakpoint
CREATE INDEX "fault_traces_type_idx" ON "fault_traces" USING btree ("fault_type");
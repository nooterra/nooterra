CREATE TABLE "dispatch_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"node_name" text NOT NULL,
	"agent_did" text NOT NULL,
	"payload" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by" text
);
--> statement-breakpoint
CREATE INDEX "dispatch_queue_status_idx" ON "dispatch_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dispatch_queue_created_at_idx" ON "dispatch_queue" USING btree ("created_at");
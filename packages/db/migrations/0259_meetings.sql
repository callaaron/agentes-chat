CREATE TYPE "public"."meeting_status" AS ENUM('queued', 'deliberating', 'converged', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"created_by" text,
	"topic" text NOT NULL,
	"mode" text DEFAULT 'debate' NOT NULL,
	"seats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "meeting_status" DEFAULT 'queued' NOT NULL,
	"engine_meeting_id" text,
	"round" integer DEFAULT 0 NOT NULL,
	"max_rounds" integer,
	"stop_reason" text,
	"minutes" text,
	"decisions" jsonb,
	"actions" jsonb,
	"provenance" jsonb,
	"minutes_artifact_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_org_created" ON "meetings" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "meetings_channel_created" ON "meetings" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "meetings_engine" ON "meetings" USING btree ("engine_meeting_id");
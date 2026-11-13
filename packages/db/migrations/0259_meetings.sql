CREATE TYPE "public"."decision_status" AS ENUM('proposed', 'decided', 'executing', 'verified', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('queued', 'deliberating', 'converged', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."meeting_turn_status" AS ENUM('pending', 'speaking', 'spoken', 'skipped');--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"text" text NOT NULL,
	"conditions" text,
	"dissent" text,
	"qc_passed" boolean,
	"qc_score" integer,
	"status" "decision_status" DEFAULT 'proposed' NOT NULL,
	"owner_id" text,
	"acceptance" jsonb,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"seat_index" integer NOT NULL,
	"seat_name" text NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"message_id" uuid,
	"status" "meeting_turn_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"created_by" text,
	"topic" text NOT NULL,
	"mode" text DEFAULT 'debate' NOT NULL,
	"seats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "meeting_status" DEFAULT 'queued' NOT NULL,
	"director_run_id" uuid,
	"round" integer DEFAULT 0 NOT NULL,
	"max_rounds" integer,
	"stop_reason" text,
	"minutes" text,
	"provenance" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_turns" ADD CONSTRAINT "meeting_turns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_turns" ADD CONSTRAINT "meeting_turns_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_org_created" ON "decisions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_meeting" ON "decisions" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "decisions_status" ON "decisions" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_turns_meeting_seq" ON "meeting_turns" USING btree ("meeting_id","seq");--> statement-breakpoint
CREATE INDEX "meeting_turns_pending" ON "meeting_turns" USING btree ("meeting_id","status");--> statement-breakpoint
CREATE INDEX "meetings_org_created" ON "meetings" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "meetings_channel_created" ON "meetings" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "meetings_status" ON "meetings" USING btree ("org_id","status");
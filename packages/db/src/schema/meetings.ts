import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { channels } from "./chat";
import { organizations } from "./tenancy";

/** How a roundtable is going (ADR 0177). The engine keeps the transcript; this row keeps the delivery. */
export const meetingStatusEnum = pgEnum("meeting_status", [
  "queued",
  "deliberating",
  "converged",
  "failed",
  "canceled",
]);

/** One seat at the table: who speaks, as the engine knows them (a persona id from the engine roster). */
export interface MeetingSeat {
  name: string;
  role?: string;
  personaId?: string;
  /** The agent here that answers for this seat, when it is one of ours. */
  agentId?: string;
}

/** What the meeting decided, as the engine rendered it (never re-derived here). */
export interface MeetingDecision {
  decision: string;
  conditions?: string;
  dissent?: string;
  qcPassed?: boolean;
  qcScore?: number;
}

/** One thing to do after the meeting. doneWhen is the acceptance criterion, not a note. */
export interface MeetingAction {
  text: string;
  owner?: string;
  due?: string;
  doneWhen?: string;
}

/**
 * A roundtable (ADR 0177): the pointer this workspace keeps to a meeting run by the LoomRoom engine,
 * plus everything the channel needs to deliver it. One row per meeting, org-scoped like every
 * tenant-owned table.
 */
export const meetings = pgTable(
  "meetings",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelId: uuid()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /** Who asked for it; null when a routine did (the row stays, the person does not). */
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    topic: text().notNull(),
    /** The engine mode: sequential | free | brainstorm | debate | host_summary. */
    mode: text().notNull().default("debate"),
    seats: jsonb().$type<MeetingSeat[]>().notNull().default([]),
    status: meetingStatusEnum().notNull().default("queued"),
    /** The engine id (mtg_...): the only key its API understands. */
    engineMeetingId: text(),
    round: integer().notNull().default(0),
    maxRounds: integer(),
    /** Why it stopped, in the engine words (converged, max_rounds, user_stop...). */
    stopReason: text(),
    /** The rendered minutes (Markdown), written once, on convergence. */
    minutes: text(),
    decisions: jsonb().$type<MeetingDecision[]>(),
    actions: jsonb().$type<MeetingAction[]>(),
    /** QC, dissent and citation counts: what lets a person trust the page without rereading it. */
    provenance: jsonb().$type<Record<string, unknown>>(),
    /** The Drive artifact the minutes were posted as. */
    minutesArtifactId: uuid(),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meetings_org_created").on(t.orgId, t.createdAt),
    index("meetings_channel_created").on(t.channelId, t.createdAt),
    index("meetings_engine").on(t.engineMeetingId),
  ],
);

import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { channels } from "./chat";
import { organizations } from "./tenancy";

/** How a meeting is going (ADR 0178). */
export const meetingStatusEnum = pgEnum("meeting_status", [
  "queued",
  "deliberating",
  "converged",
  "failed",
  "canceled",
]);

/** Where a decision is in its life: proposed, agreed, being carried out, proven, or undone. */
export const decisionStatusEnum = pgEnum("decision_status", [
  "proposed",
  "decided",
  "executing",
  "verified",
  "reversed",
]);

/** One seat talking: still to speak, speaking now, spoken, or passed. */
export const meetingTurnStatusEnum = pgEnum("meeting_turn_status", [
  "pending",
  "speaking",
  "spoken",
  "skipped",
]);

export interface MeetingSeat {
  name: string;
  role?: string;
  /** The agent that answers for this seat here. */
  agentId?: string;
}

export interface DecisionAcceptance {
  /** What a person can check: "written quote below the old price". */
  criteria: string[];
  /** Where the proof lives once it exists (a file, a link, an issue). */
  evidence?: string[];
}

/**
 * A meeting (ADR 0178): a channel that deliberates. It is a row plus a director run, not a service: the transcript is
 * messages in the channel, and every turn is a run of the agent who holds the seat.
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
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    topic: text().notNull(),
    /** sequential | free | brainstorm | debate | host_summary */
    mode: text().notNull().default("debate"),
    seats: jsonb().$type<MeetingSeat[]>().notNull().default([]),
    status: meetingStatusEnum().notNull().default("queued"),
    /** The background run that takes turns (the director). */
    directorRunId: uuid(),
    round: integer().notNull().default(0),
    maxRounds: integer(),
    /** Why it stopped: converged, max_rounds, chair_stopped, failed. */
    stopReason: text(),
    /** The rendered minutes (Markdown), written when the chair accepts the convergence. */
    minutes: text(),
    /** QC, coverage, dissent counts: what lets a person trust the page. */
    provenance: jsonb().$type<Record<string, unknown>>(),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meetings_org_created").on(t.orgId, t.createdAt),
    index("meetings_channel_created").on(t.channelId, t.createdAt),
    index("meetings_status").on(t.orgId, t.status),
  ],
);

/**
 * The order of the meeting (ADR 0178): which seat speaks when, and the run that said it. The words themselves are
 * messages in the channel (meta.meeting), so the transcript needs no second timeline.
 */
export const meetingTurns = pgTable(
  "meeting_turns",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    round: integer().notNull().default(1),
    seatIndex: integer().notNull(),
    seatName: text().notNull(),
    agentId: uuid(),
    runId: uuid(),
    messageId: uuid(),
    status: meetingTurnStatusEnum().notNull().default("pending"),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("meeting_turns_meeting_seq").on(t.meetingId, t.seq),
    index("meeting_turns_pending").on(t.meetingId, t.status),
  ],
);

/**
 * What the meeting decided (ADR 0178): a first-class object, not a paragraph in the minutes. Its acceptance is what a
 * person checks before it counts, and what the payout model reads later.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => Bun.randomUUIDv7()),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    text: text().notNull(),
    conditions: text(),
    /** The strongest case against it, kept with the decision on purpose. */
    dissent: text(),
    qcPassed: boolean(),
    qcScore: integer(),
    status: decisionStatusEnum().notNull().default("proposed"),
    /** Who answers for it: a person, or an agent when one was named. */
    ownerId: text(),
    acceptance: jsonb().$type<DecisionAcceptance>(),
    verifiedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("decisions_org_created").on(t.orgId, t.createdAt),
    index("decisions_meeting").on(t.meetingId),
    index("decisions_status").on(t.orgId, t.status),
  ],
);

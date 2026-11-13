import { and, asc, desc, eq, schema, type Database } from "@agenteschat/db";
import type { DecisionAcceptance, MeetingSeat } from "./meeting-types";

/** What a person asks a meeting for (ADR 0178). */
export interface CreateMeetingInput {
  orgId: string;
  channelId: string;
  createdBy: string | null;
  topic: string;
  mode?: string;
  seats?: MeetingSeat[];
  maxRounds?: number;
}

/** The row this workspace keeps for a meeting. The words are messages in the channel; this is the meeting itself. */
export async function createMeeting(db: Database, input: CreateMeetingInput) {
  const [row] = await db
    .insert(schema.meetings)
    .values({
      orgId: input.orgId,
      channelId: input.channelId,
      createdBy: input.createdBy,
      topic: input.topic,
      mode: input.mode ?? "debate",
      seats: input.seats ?? [],
      maxRounds: input.maxRounds ?? 6,
    })
    .returning();
  if (!row) throw new Error("meeting insert returned no row");
  return row;
}

export async function listMeetings(db: Database, orgId: string, limit = 20) {
  const capped = Math.min(Math.max(limit, 1), 50);
  return db
    .select()
    .from(schema.meetings)
    .where(eq(schema.meetings.orgId, orgId))
    .orderBy(desc(schema.meetings.createdAt))
    .limit(capped);
}

export async function getMeeting(db: Database, orgId: string, meetingId: string) {
  const [row] = await db
    .select()
    .from(schema.meetings)
    .where(and(eq(schema.meetings.orgId, orgId), eq(schema.meetings.id, meetingId)))
    .limit(1);
  return row ?? null;
}

/** The meeting's turns in order: the agenda as it actually happened. */
export async function listTurns(db: Database, orgId: string, meetingId: string) {
  return db
    .select()
    .from(schema.meetingTurns)
    .where(and(eq(schema.meetingTurns.orgId, orgId), eq(schema.meetingTurns.meetingId, meetingId)))
    .orderBy(asc(schema.meetingTurns.seq));
}

/** Writes the round's plan as pending turns; idempotent per (meeting, seq). */
export async function addTurn(
  db: Database,
  input: {
    orgId: string;
    meetingId: string;
    seq: number;
    round: number;
    seatIndex: number;
    seatName: string;
    agentId?: string | null;
  },
) {
  const [row] = await db
    .insert(schema.meetingTurns)
    .values({
      orgId: input.orgId,
      meetingId: input.meetingId,
      seq: input.seq,
      round: input.round,
      seatIndex: input.seatIndex,
      seatName: input.seatName,
      agentId: input.agentId ?? null,
    })
    .onConflictDoNothing({ target: [schema.meetingTurns.meetingId, schema.meetingTurns.seq] })
    .returning();
  return row ?? null;
}

/** A turn is speaking: the run that holds it. */
export async function startTurn(db: Database, orgId: string, turnId: string, runId?: string | null) {
  await db
    .update(schema.meetingTurns)
    .set({ status: "speaking", ...(runId ? { runId } : {}), startedAt: new Date() })
    .where(and(eq(schema.meetingTurns.orgId, orgId), eq(schema.meetingTurns.id, turnId)));
}

/** A turn was said: the message holds the words. */
export async function finishTurn(db: Database, orgId: string, turnId: string, messageId: string) {
  await db
    .update(schema.meetingTurns)
    .set({ status: "spoken", messageId, endedAt: new Date() })
    .where(and(eq(schema.meetingTurns.orgId, orgId), eq(schema.meetingTurns.id, turnId)));
}

export async function skipTurn(db: Database, orgId: string, turnId: string) {
  await db
    .update(schema.meetingTurns)
    .set({ status: "skipped", endedAt: new Date() })
    .where(and(eq(schema.meetingTurns.orgId, orgId), eq(schema.meetingTurns.id, turnId)));
}

/** Status, round and how it ended. The chair's acceptance is what writes the minutes. */
export async function setMeetingStatus(
  db: Database,
  orgId: string,
  meetingId: string,
  patch: {
    status?: "queued" | "deliberating" | "converged" | "failed" | "canceled";
    round?: number;
    maxRounds?: number;
    stopReason?: string | null;
    minutes?: string;
    provenance?: Record<string, unknown>;
    directorRunId?: string;
  },
) {
  await db
    .update(schema.meetings)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.round !== undefined ? { round: patch.round } : {}),
      ...(patch.maxRounds !== undefined ? { maxRounds: patch.maxRounds } : {}),
      ...(patch.stopReason !== undefined ? { stopReason: patch.stopReason } : {}),
      ...(patch.minutes !== undefined ? { minutes: patch.minutes } : {}),
      ...(patch.provenance !== undefined ? { provenance: patch.provenance } : {}),
      ...(patch.directorRunId !== undefined ? { directorRunId: patch.directorRunId } : {}),
      ...(patch.status === "deliberating" ? { startedAt: new Date() } : {}),
      ...(patch.status === "converged" || patch.status === "failed" ? { endedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.meetings.orgId, orgId), eq(schema.meetings.id, meetingId)));
}

/** A decision the meeting reached: first-class, with what would prove it. */
export async function addDecision(
  db: Database,
  input: {
    orgId: string;
    meetingId: string;
    text: string;
    conditions?: string | null;
    dissent?: string | null;
    qcPassed?: boolean | null;
    qcScore?: number | null;
    ownerId?: string | null;
    acceptance?: DecisionAcceptance | null;
  },
) {
  const [row] = await db
    .insert(schema.decisions)
    .values({
      orgId: input.orgId,
      meetingId: input.meetingId,
      text: input.text,
      conditions: input.conditions ?? null,
      dissent: input.dissent ?? null,
      qcPassed: input.qcPassed ?? null,
      qcScore: input.qcScore ?? null,
      ownerId: input.ownerId ?? null,
      acceptance: input.acceptance ?? null,
      status: "decided",
    })
    .returning();
  if (!row) throw new Error("decision insert returned no row");
  return row;
}

export async function listMeetingDecisions(db: Database, orgId: string, meetingId: string) {
  return db
    .select()
    .from(schema.decisions)
    .where(and(eq(schema.decisions.orgId, orgId), eq(schema.decisions.meetingId, meetingId)))
    .orderBy(asc(schema.decisions.createdAt));
}

/** A person checked the acceptance: it counts as done, with the day it was checked. */
export async function verifyDecision(db: Database, orgId: string, decisionId: string) {
  await db
    .update(schema.decisions)
    .set({ status: "verified", verifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.decisions.orgId, orgId), eq(schema.decisions.id, decisionId)));
}

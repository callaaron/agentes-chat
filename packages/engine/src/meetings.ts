import { and, desc, eq, schema, type Database } from "@agenteschat/db";
import type { MeetingAction, MeetingDecision, MeetingSeat } from "@agenteschat/db";

/** What a person asks a roundtable for (ADR 0177): the topic, who sits, what they bring. */
export interface ConveneInput {
  orgId: string;
  channelId: string;
  createdBy: string | null;
  topic: string;
  mode?: string;
  seats?: MeetingSeat[];
  materials?: { kind: string; title?: string; body: string }[];
}

/** Where a meeting stands, as the engine tells it. */
export interface MeetingProgress {
  status: string;
  round?: number;
  maxRounds?: number;
  stopReason?: string;
}

/** The minutes as the engine renders them: Markdown for people, structure for the channel. */
export interface MeetingMinutes {
  markdown: string;
  decisions?: MeetingDecision[];
  actions?: MeetingAction[];
  provenance?: Record<string, unknown>;
}

/**
 * The LoomRoom engine's HTTP contract (ADR 0177): convene, ask how it is going, take the minutes. The engine owns
 * the transcript and the deliberation; this workspace only points at it. Every call carries the service token.
 */
export interface RoundtableEngine {
  convene(input: {
    topic: string;
    mode?: string;
    seats?: MeetingSeat[];
    materials?: ConveneInput["materials"];
    idempotencyKey?: string;
  }): Promise<{ meetingId: string; status?: string; url?: string }>;
  status(meetingId: string): Promise<MeetingProgress>;
  minutes(meetingId: string): Promise<MeetingMinutes>;
}

const ENGINE_TIMEOUTS = { convene: 10_000, status: 5_000, minutes: 30_000 } as const;

/** A client for the sidecar engine. Nothing is imported from it: it is a service, not a library (ADR 0177). */
export function createRoundtableClient(options: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: Partial<typeof ENGINE_TIMEOUTS>;
}): RoundtableEngine {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = { ...ENGINE_TIMEOUTS, ...(options.timeoutMs ?? {}) };

  async function call<T>(path: string, init: RequestInit, ms: number): Promise<T> {
    const response = await doFetch(base + path, {
      ...init,
      headers: {
        authorization: "Bearer " + options.token,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(ms),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error("roundtable engine " + response.status + ": " + body.slice(0, 300));
    }
    return (await response.json()) as T;
  }

  return {
    convene: (input) =>
      call("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          topic: input.topic,
          mode: input.mode,
          seats: input.seats ?? [],
          materials: input.materials ?? [],
        }),
        headers: input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : undefined,
      }, timeout.convene),
    status: (meetingId) =>
      call("/api/meetings/" + encodeURIComponent(meetingId), { method: "GET" }, timeout.status),
    minutes: (meetingId) =>
      call("/api/meetings/" + encodeURIComponent(meetingId) + "/minutes", { method: "GET" }, timeout.minutes),
  };
}

/** The row this workspace keeps for a meeting, before the engine has one. */
export async function createMeeting(db: Database, input: ConveneInput) {
  const [row] = await db
    .insert(schema.meetings)
    .values({
      orgId: input.orgId,
      channelId: input.channelId,
      createdBy: input.createdBy,
      topic: input.topic,
      mode: input.mode ?? "debate",
      seats: input.seats ?? [],
    })
    .returning();
  return row;
}

/** Newest first, this workspace only. */
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

/** Engine progress back into the row: status, round, stop reason and the engine id once it has one. */
export async function recordProgress(
  db: Database,
  orgId: string,
  meetingId: string,
  progress: MeetingProgress & { engineMeetingId?: string },
) {
  await db
    .update(schema.meetings)
    .set({
      status: progress.status as typeof schema.meetings.$inferSelect.status,
      round: progress.round ?? 0,
      maxRounds: progress.maxRounds ?? null,
      stopReason: progress.stopReason ?? null,
      engineMeetingId: progress.engineMeetingId ?? undefined,
      updatedAt: new Date(),
      ...(progress.status === "deliberating" ? { startedAt: new Date() } : {}),
      ...(progress.status === "converged" || progress.status === "failed" ? { endedAt: new Date() } : {}),
    })
    .where(and(eq(schema.meetings.orgId, orgId), eq(schema.meetings.id, meetingId)));
}

/** On convergence: the minutes and everything a person needs to trust them. */
export async function recordMinutes(db: Database, orgId: string, meetingId: string, minutes: MeetingMinutes) {
  await db
    .update(schema.meetings)
    .set({
      minutes: minutes.markdown,
      decisions: minutes.decisions ?? [],
      actions: minutes.actions ?? [],
      provenance: minutes.provenance ?? {},
      status: "converged",
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.meetings.orgId, orgId), eq(schema.meetings.id, meetingId)));
}

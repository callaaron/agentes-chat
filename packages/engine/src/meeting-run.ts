import type { Database } from "@agenteschat/db";
import { assessConvergence, planTurns, type MeetingMode } from "./director";
import { addTurn, getMeeting, listTurns, setMeetingStatus } from "./meetings";
import type { MeetingSeat } from "./meeting-types";

/**
 * Where the meeting goes next (ADR 0178). The director decides; the caller starts the run, writes the message and
 * comes back. Nothing here talks to a model or a socket, so a whole meeting can be replayed in a test.
 */
export type MeetingStep =
  | { kind: "start_turn"; turnId: string; round: number; seatName: string; agentId: string | null }
  | { kind: "converge"; reason: string }
  | { kind: "wait"; reason: "speaking" | "no_seats" }
  | { kind: "done"; status: string };

const FINISHED = new Set(["converged", "failed", "canceled"]);

export async function planNextStep(
  db: Database,
  input: { orgId: string; meetingId: string },
): Promise<MeetingStep> {
  const meeting = await getMeeting(db, input.orgId, input.meetingId);
  if (!meeting) return { kind: "done", status: "missing" };
  if (FINISHED.has(meeting.status)) return { kind: "done", status: meeting.status };

  const seats = (meeting.seats ?? []) as MeetingSeat[];
  if (!seats.length) return { kind: "wait", reason: "no_seats" };

  const round = Math.max(meeting.round ?? 0, 1);
  let turns = await listTurns(db, input.orgId, input.meetingId);
  const speaking = turns.find((t) => t.status === "speaking");
  if (speaking) return { kind: "wait", reason: "speaking" };

  let roundTurns = turns.filter((t) => t.round === round);
  if (!roundTurns.length) {
    const plan = planTurns(seats, (meeting.mode as MeetingMode) ?? "debate", round);
    const base = turns.length;
    for (let i = 0; i < plan.length; i += 1) {
      const seat = seats[plan[i]!.seatIndex]!;
      await addTurn(db, {
        orgId: input.orgId,
        meetingId: input.meetingId,
        seq: base + i + 1,
        round,
        seatIndex: plan[i]!.seatIndex,
        seatName: seat.name,
        agentId: seat.agentId ?? null,
      });
    }
    if (meeting.status !== "deliberating") {
      await setMeetingStatus(db, input.orgId, input.meetingId, { status: "deliberating", round });
    }
    turns = await listTurns(db, input.orgId, input.meetingId);
    roundTurns = turns.filter((t) => t.round === round);
  }

  const next = roundTurns.find((t) => t.status === "pending");
  if (next) {
    return { kind: "start_turn", turnId: next.id, round, seatName: next.seatName, agentId: next.agentId };
  }

  const heard = roundTurns.filter((t) => t.status === "spoken" || t.status === "skipped").length;
  const coverage = roundTurns.length ? heard / roundTurns.length : 1;
  const verdict = assessConvergence({
    round,
    maxRounds: meeting.maxRounds ?? 6,
    coverage,
    goalMet: coverage >= 1,
  });
  if (verdict.stop) return { kind: "converge", reason: verdict.reason };

  await setMeetingStatus(db, input.orgId, input.meetingId, { round: round + 1 });
  return { kind: "wait", reason: "speaking" };
}

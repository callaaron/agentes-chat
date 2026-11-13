import { eq, schema, type Database } from "@agenteschat/db";
import { planNextStep, type MeetingStep } from "./meeting-run";
import { getMeeting, startTurn } from "./meetings";

/**
 * One step of a meeting (ADR 0178): the director plans, and when a seat has the floor the person who convened
 * hands it over in the channel — a mention, which wakes that agent's run through the path every mention uses. The
 * meeting itself stays a row: no second scheduler, no second queue.
 */
export type AdvanceResult =
  | MeetingStep
  | { kind: "dispatched"; turnId: string; agentId: string; messageId: string };

export async function advanceMeeting(
  deps: { db: Database },
  input: { orgId: string; meetingId: string },
): Promise<AdvanceResult> {
  const step = await planNextStep(deps.db, input);
  if (step.kind !== "start_turn") return step;

  const meeting = await getMeeting(deps.db, input.orgId, input.meetingId);
  if (!meeting) return { kind: "done", status: "missing" };
  if (!meeting.createdBy || !step.agentId) {
    // A meeting a routine convened, or a seat with no agent here: nothing to wake. The turn stays pending for a person.
    return { kind: "wait", reason: "no_seats" };
  }

  const [seat] = await deps.db
    .select({ handle: schema.agents.handle })
    .from(schema.agents)
    .where(eq(schema.agents.id, step.agentId))
    .limit(1);
  if (!seat) return { kind: "wait", reason: "no_seats" };

  // Loaded here, not at the top: messages and dispatch reach back into this package, and the cycle must close after
  // module initialisation (a direct import would read the search builders before they exist).
  const [{ insertMessage }, { startOrJoinRun }] = await Promise.all([
    import("./messages"),
    import("./dispatch"),
  ]);

  const message = await insertMessage(deps.db, {
    orgId: input.orgId,
    channelId: meeting.channelId,
    author: { type: "person", userId: meeting.createdBy },
    body: "@" + seat.handle + " round " + step.round + ": " + meeting.topic,
    meta: {
      meeting: {
        id: meeting.id,
        turn: step.turnId,
        round: step.round,
        seat: step.seatName,
      },
    },
  });

  const run = await startOrJoinRun(deps.db, message, step.agentId, "mention");
  const runId = run && "created" in run ? run.created.id : null;
  await startTurn(deps.db, input.orgId, step.turnId, runId);

  return { kind: "dispatched", turnId: step.turnId, agentId: step.agentId, messageId: message.id };
}

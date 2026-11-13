import { afterEach, expect, test } from "bun:test";
import { eq, schema } from "@agenteschat/db";
import { advanceMeeting } from "../src/meeting-advance";
import { createMeeting } from "../src/meetings";
import { setup, type Fixture } from "./fixtures";

/** Advancing a meeting (ADR 0178): the seat is mentioned in the channel and its run wakes, through the normal path. */

let f: Fixture | undefined;
afterEach(async () => {
  const current = f;
  f = undefined;
  await current?.close();
});

test("the floor is handed to the seat's agent in the channel", async () => {
  f = await setup({});
  const meeting = (await createMeeting(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    createdBy: f.owner.id,
    topic: "Renew the vendor contract?",
    mode: "sequential",
    seats: [{ name: "Dev", agentId: f.agent.id }],
  }))!;

  const result = await advanceMeeting({ db: f.db }, { orgId: f.org.id, meetingId: meeting.id });
  expect(result.kind).toBe("dispatched");
  if (result.kind !== "dispatched") throw new Error("expected a dispatch");

  const [turn] = await f.db
    .select()
    .from(schema.meetingTurns)
    .where(eq(schema.meetingTurns.meetingId, meeting.id));
  expect(turn?.status).toBe("speaking");

  const [message] = await f.db.select().from(schema.messages).where(eq(schema.messages.id, result.messageId));
  expect(message?.body).toContain("Renew the vendor contract?");
  expect((message?.meta as { meeting?: { id?: string } }).meeting?.id).toBe(meeting.id);

  const runs = await f.db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.triggerMessageId, result.messageId));
  expect(runs.length).toBe(1);
  expect(runs[0]?.agentId).toBe(f.agent.id);
});

test("while a seat is speaking, the director waits instead of talking over it", async () => {
  f = await setup({});
  const meeting = (await createMeeting(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    createdBy: f.owner.id,
    topic: "Hire or contract?",
    seats: [{ name: "Dev", agentId: f.agent.id }],
  }))!;
  await advanceMeeting({ db: f.db }, { orgId: f.org.id, meetingId: meeting.id });
  expect(await advanceMeeting({ db: f.db }, { orgId: f.org.id, meetingId: meeting.id })).toEqual({
    kind: "wait",
    reason: "speaking",
  });
});

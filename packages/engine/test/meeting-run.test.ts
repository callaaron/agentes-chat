import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { planNextStep } from "../src/meeting-run";
import { createMeeting, finishTurn } from "../src/meetings";
import { setup, type Fixture } from "./fixtures";

/** The director's advance (ADR 0178): seat by seat, then converge — no model, no socket, replayable. */

let f: Fixture | undefined;
afterEach(async () => {
  const current = f;
  f = undefined;
  await current?.close();
});

async function meetingWith(seats: { name: string }[]) {
  const meeting = await createMeeting(f!.db, {
    orgId: f!.org.id,
    channelId: f!.general.id,
    createdBy: f!.owner.id,
    topic: "Renew the vendor contract?",
    mode: "sequential",
    seats,
    maxRounds: 6,
  });
  return meeting!;
}

test("goes seat by seat, then converges", async () => {
  f = await setup({});
  const meeting = await meetingWith([{ name: "Ana" }, { name: "Beto" }]);

  const first = await planNextStep(f.db, { orgId: f.org.id, meetingId: meeting.id });
  expect(first.kind).toBe("start_turn");
  if (first.kind !== "start_turn") throw new Error("expected a turn");
  expect(first.seatName).toBe("Ana");
  await finishTurn(f.db, f.org.id, first.turnId, randomUUID());

  const second = await planNextStep(f.db, { orgId: f.org.id, meetingId: meeting.id });
  expect(second.kind).toBe("start_turn");
  if (second.kind !== "start_turn") throw new Error("expected a turn");
  expect(second.seatName).toBe("Beto");
  await finishTurn(f.db, f.org.id, second.turnId, randomUUID());

  const third = await planNextStep(f.db, { orgId: f.org.id, meetingId: meeting.id });
  expect(third).toEqual({ kind: "converge", reason: "converged" });
});

test("a meeting with no seats waits instead of converging on nothing", async () => {
  f = await setup({});
  const meeting = await meetingWith([]);
  expect(await planNextStep(f.db, { orgId: f.org.id, meetingId: meeting.id })).toEqual({
    kind: "wait",
    reason: "no_seats",
  });
});

test("a converged meeting is done, not replayed", async () => {
  f = await setup({});
  const meeting = await meetingWith([{ name: "Ana" }]);
  const step = await planNextStep(f.db, { orgId: f.org.id, meetingId: meeting.id });
  if (step.kind !== "start_turn") throw new Error("expected a turn");
  await finishTurn(f.db, f.org.id, step.turnId, randomUUID());
  expect((await planNextStep(f.db, { orgId: f.org.id, meetingId: meeting.id })).kind).toBe("converge");
});

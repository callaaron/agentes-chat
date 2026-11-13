import { afterEach, expect, test } from "bun:test";
import { addDecision, createMeeting, listDecisions, verifyDecision } from "../src/meetings";
import { createMeetingsToolSource, LIST_MEETINGS_TOOL, ROUNDTABLE_MINUTES_TOOL } from "../src/meetings-tools";
import type { ToolContext } from "../src/tools/types";
import { setup, type Fixture } from "./fixtures";

/**
 * Meetings (ADR 0178): a row plus a director run. These exercise the read tools and the decision object without a
 * network — the director's own decisions are pure and tested in director.test.ts.
 */

let f: Fixture | undefined;
afterEach(async () => {
  const current = f;
  f = undefined;
  await current?.close();
});

const source = createMeetingsToolSource();

async function tool(name: string) {
  const found = (await source.tools()).find((t) => t.name === name);
  if (!found) throw new Error("missing tool " + name);
  return found;
}

function ctx(): ToolContext {
  return {
    db: f!.db,
    orgId: f!.org.id,
    channelId: f!.general.id,
    agentId: f!.agent.id,
    runId: "run-meetings-test",
    threadRootId: null,
    triggerMessageId: "msg-meetings-test",
  } as unknown as ToolContext;
}

test("list_meetings is empty in a fresh workspace", async () => {
  f = await setup({ toolSources: [source] });
  const out = await (await tool(LIST_MEETINGS_TOOL)).execute({}, ctx());
  expect(out.isError).toBeFalsy();
  expect(out.content).toContain("No meetings");
});

test("list_meetings shows what was created", async () => {
  f = await setup({ toolSources: [source] });
  await createMeeting(f.db, { orgId: f.org.id, channelId: f.general.id, createdBy: f.owner.id, topic: "Pricing for Q4" });
  const out = await (await tool(LIST_MEETINGS_TOOL)).execute({}, ctx());
  expect(out.content).toContain("Pricing for Q4");
  expect(out.content).toContain("queued");
});

test("a decision keeps its conditions, its dissent and its acceptance", async () => {
  f = await setup({ toolSources: [source] });
  const meeting = await createMeeting(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    createdBy: f.owner.id,
    topic: "Vendor renewal",
  });
  await addDecision(f.db, {
    orgId: f.org.id,
    meetingId: meeting.id,
    text: "Do not renew at the current price",
    conditions: "unless the quote drops 15%",
    dissent: "ops wants continuity",
    qcPassed: true,
    qcScore: 84,
    acceptance: { criteria: ["written quote below the old price"] },
  });
  const out = await (await tool(ROUNDTABLE_MINUTES_TOOL)).execute({ meeting_id: meeting.id }, ctx());
  expect(out.isError).toBeFalsy();
  expect(out.content).toContain("Do not renew at the current price");
  expect(out.content).toContain("unless the quote drops 15%");
  expect(out.content).toContain("against: ops wants continuity");
});

test("a verified decision records the day it was checked", async () => {
  f = await setup({ toolSources: [source] });
  const meeting = await createMeeting(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    createdBy: f.owner.id,
    topic: "Launch date",
  });
  const decision = await addDecision(f.db, { orgId: f.org.id, meetingId: meeting.id, text: "Ship on the 20th" });
  await verifyDecision(f.db, f.org.id, decision.id);
  const [row] = await listDecisions(f.db, f.org.id, meeting.id);
  expect(row.status).toBe("verified");
  expect(row.verifiedAt).not.toBeNull();
});

test("roundtable_minutes refuses an unknown id", async () => {
  f = await setup({ toolSources: [source] });
  const out = await (await tool(ROUNDTABLE_MINUTES_TOOL)).execute(
    { meeting_id: "00000000-0000-7000-8000-000000000000" },
    ctx(),
  );
  expect(out.isError).toBe(true);
});

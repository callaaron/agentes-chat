import { afterEach, expect, test } from "bun:test";
import { createMeeting, recordMinutes } from "../src/meetings";
import { createMeetingsToolSource, LIST_MEETINGS_TOOL, ROUNDTABLE_MINUTES_TOOL } from "../src/meetings-tools";
import type { ToolContext } from "../src/tools/types";
import { setup, type Fixture } from "./fixtures";

/**
 * Roundtables (ADR 0177): the workspace keeps a row per meeting, the engine keeps the transcript. These exercise the
 * two read tools and the row helpers without a network.
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
  expect(out.content).toContain("No roundtables");
});

test("list_meetings shows what was created", async () => {
  f = await setup({ toolSources: [source] });
  await createMeeting(f.db, { orgId: f.org.id, channelId: f.general.id, createdBy: f.owner.id, topic: "Pricing for Q4" });
  const out = await (await tool(LIST_MEETINGS_TOOL)).execute({}, ctx());
  expect(out.content).toContain("Pricing for Q4");
  expect(out.content).toContain("queued");
});

test("roundtable_minutes returns the decision and the acceptance criteria", async () => {
  f = await setup({ toolSources: [source] });
  const row = await createMeeting(f.db, {
    orgId: f.org.id,
    channelId: f.general.id,
    createdBy: f.owner.id,
    topic: "Vendor renewal",
  });
  await recordMinutes(f.db, f.org.id, row.id, {
    markdown: "## Decision\nDo not renew at the current price.",
    decisions: [{ decision: "Do not renew", conditions: "unless price drops 15%", dissent: "ops wants continuity", qcPassed: true }],
    actions: [{ text: "Ask for a 15% cut", owner: "procurement", doneWhen: "written quote below the old price" }],
  });
  const out = await (await tool(ROUNDTABLE_MINUTES_TOOL)).execute({ meeting_id: row.id }, ctx());
  expect(out.isError).toBeFalsy();
  expect(out.content).toContain("Do not renew at the current price");
  expect(out.content).toContain("done when: written quote below the old price");
});

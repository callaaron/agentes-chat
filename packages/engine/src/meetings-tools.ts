import type { ToolDefinition, ToolSource } from "./tools/types";
import { createMeeting, getMeeting, listDecisions, listMeetings } from "./meetings";
import { personBehindCall } from "./requester";

export const MEETINGS_READ_SCOPE = "meetings:read";
export const MEETINGS_WRITE_SCOPE = "meetings:write";
export const LIST_MEETINGS_TOOL = "list_meetings";
export const CONVENE_ROUNDTABLE_TOOL = "convene_roundtable";
export const ROUNDTABLE_MINUTES_TOOL = "roundtable_minutes";

const MODES = ["sequential", "free", "brainstorm", "debate", "host_summary"] as const;

/**
 * The meeting tools (ADR 0178). A meeting is a row plus a director run in this workspace, never a service: these
 * create the row, read where it stands and read what it decided. Convening is sensitive (it spends model calls), so
 * it waits for a person like any other outward action.
 */
export function createMeetingsToolSource(): ToolSource {
  const list: ToolDefinition = {
    name: LIST_MEETINGS_TOOL,
    description:
      "List this workspace's meetings, newest first: topic, status, when and the round. Call it before answering about a meeting held here.",
    scope: MEETINGS_READ_SCOPE,
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
    describe: () => ({ title: "List meetings" }),
    async execute(input, ctx) {
      const limit = typeof input.limit === "number" ? input.limit : 20;
      const rows = await listMeetings(ctx.db, ctx.orgId, limit);
      if (!rows.length) return { content: "No meetings here yet." };
      return {
        content: rows
          .map(
            (row) =>
              "- " +
              row.topic +
              " · " +
              row.status +
              " · " +
              row.createdAt.toISOString().slice(0, 16) +
              (row.round ? " · round " + row.round : ""),
          )
          .join("\n"),
      };
    },
  };

  const minutes: ToolDefinition = {
    name: ROUNDTABLE_MINUTES_TOOL,
    description:
      "Read a meeting's minutes: the decisions it reached, with their conditions, the dissent and what would prove them done. Use it instead of guessing what was decided.",
    scope: MEETINGS_READ_SCOPE,
    inputSchema: {
      type: "object",
      properties: { meeting_id: { type: "string", description: "The meeting id from list_meetings." } },
      required: ["meeting_id"],
      additionalProperties: false,
    },
    describe: () => ({ title: "Meeting minutes" }),
    async execute(input, ctx) {
      const id = typeof input.meeting_id === "string" ? input.meeting_id : "";
      const row = id ? await getMeeting(ctx.db, ctx.orgId, id) : null;
      if (!row) return { content: "No such meeting in this workspace.", isError: true };
      const decisions = await listDecisions(ctx.db, ctx.orgId, row.id);
      if (!row.minutes && !decisions.length) {
        return { content: "This meeting has not converged yet: status " + row.status + "." };
      }
      const lines = decisions.map(
        (d) =>
          "- " +
          d.text +
          (d.conditions ? " · if: " + d.conditions : "") +
          (d.dissent ? " · against: " + d.dissent : "") +
          (d.status ? " · " + d.status : ""),
      );
      return {
        content:
          (row.minutes ? row.minutes + "\n\n" : "") +
          (lines.length ? "Decisions:\n" + lines.join("\n") : "No decision recorded yet."),
      };
    },
  };

  const convene: ToolDefinition = {
    name: CONVENE_ROUNDTABLE_TOOL,
    description:
      "Convene a meeting of experts on one topic: they argue in this channel and converge on a decision with its conditions and the case against it. Costs model calls and can take many minutes.",
    scope: MEETINGS_WRITE_SCOPE,
    sensitive: true,
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", minLength: 4, maxLength: 2000 },
        mode: { type: "string", enum: [...MODES] },
        seats: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: { name: { type: "string" }, role: { type: "string" }, agent_id: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
        max_rounds: { type: "integer", minimum: 1, maximum: 12 },
      },
      required: ["topic"],
      additionalProperties: false,
    },
    describe: (input) => ({ title: "Meeting: " + String(input.topic ?? "").slice(0, 60) }),
    async execute(input, ctx) {
      const person = await personBehindCall(ctx);
      if (!person) {
        return { content: "A meeting spends model calls, so someone has to be behind it: no person is.", isError: true };
      }
      const topic = typeof input.topic === "string" ? input.topic.trim() : "";
      if (topic.length < 4) return { content: "topic is too short to convene anything.", isError: true };
      const seats = Array.isArray(input.seats)
        ? (input.seats as { name: string; role?: string; agent_id?: string }[]).map((s) => ({
            name: s.name,
            role: s.role,
            agentId: s.agent_id,
          }))
        : [];
      const created = await createMeeting(ctx.db, {
        orgId: ctx.orgId,
        channelId: ctx.channelId,
        createdBy: person,
        topic,
        mode: typeof input.mode === "string" ? input.mode : "debate",
        seats,
        maxRounds: typeof input.max_rounds === "number" ? input.max_rounds : undefined,
      });
      return {
        content:
          "Meeting convened: " +
          topic +
          " (id " +
          created.id +
          "). The seats deliberate in this channel; the decision lands here when they converge.",
      };
    },
  };

  return { name: "meetings", tools: async () => [list, minutes, convene] };
}

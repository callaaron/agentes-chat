import type { ToolDefinition, ToolSource } from "./tools/types";
import { createMeeting, getMeeting, listMeetings, recordProgress, type RoundtableEngine } from "./meetings";
import { personBehindCall } from "./requester";

export const MEETINGS_READ_SCOPE = "meetings:read";
export const MEETINGS_WRITE_SCOPE = "meetings:write";
export const LIST_MEETINGS_TOOL = "list_meetings";
export const CONVENE_ROUNDTABLE_TOOL = "convene_roundtable";
export const ROUNDTABLE_MINUTES_TOOL = "roundtable_minutes";

const MODES = ["sequential", "free", "brainstorm", "debate", "host_summary"] as const;

/**
 * The roundtable tools (ADR 0177). LoomRoom stays a service: these only convene it, ask how it is going and take the
 * minutes. Convening is sensitive (a meeting costs model calls), so it waits for a person's approval like any other
 * outward action; the other two only read.
 */
export function createMeetingsToolSource(options: { engine?: RoundtableEngine | null } = {}): ToolSource {
  const list: ToolDefinition = {
    name: LIST_MEETINGS_TOOL,
    description:
      "List this workspace's roundtables, newest first: topic, status, when and how many rounds. Call it before answering about a meeting held here.",
    scope: MEETINGS_READ_SCOPE,
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
    describe: () => ({ title: "List roundtables" }),
    async execute(input, ctx) {
      const limit = typeof input.limit === "number" ? input.limit : 20;
      const rows = await listMeetings(ctx.db, ctx.orgId, limit);
      if (!rows.length) return { content: "No roundtables here yet." };
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
      "Read a roundtable's minutes: the decision, its conditions, the dissent, and the action items with their acceptance criteria. Use it instead of guessing what was decided.",
    scope: MEETINGS_READ_SCOPE,
    inputSchema: {
      type: "object",
      properties: { meeting_id: { type: "string", description: "The meeting id from list_meetings." } },
      required: ["meeting_id"],
      additionalProperties: false,
    },
    describe: () => ({ title: "Roundtable minutes" }),
    async execute(input, ctx) {
      const id = typeof input.meeting_id === "string" ? input.meeting_id : "";
      const row = id ? await getMeeting(ctx.db, ctx.orgId, id) : null;
      if (!row) return { content: "No such meeting in this workspace.", isError: true };
      if (!row.minutes) return { content: "This roundtable has not converged yet: status " + row.status + "." };
      const actions = (row.actions ?? []).map(
        (a) => "- " + a.text + (a.owner ? " · " + a.owner : "") + (a.doneWhen ? " · done when: " + a.doneWhen : ""),
      );
      return { content: row.minutes + (actions.length ? "\n\nAction items:\n" + actions.join("\n") : "") };
    },
  };

  const convene: ToolDefinition | null = options.engine
    ? {
        name: CONVENE_ROUNDTABLE_TOOL,
        description:
          "Convene a roundtable of experts on one topic: they argue, converge and produce minutes with a decision and action items. Costs model calls and can take many minutes; the minutes land in this channel when it ends.",
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
                properties: { name: { type: "string" }, role: { type: "string" } },
                required: ["name"],
                additionalProperties: false,
              },
            },
            materials: {
              type: "array",
              maxItems: 5,
              items: {
                type: "object",
                properties: { title: { type: "string" }, body: { type: "string" } },
                required: ["body"],
                additionalProperties: false,
              },
            },
          },
          required: ["topic"],
          additionalProperties: false,
        },
        describe: (input) => ({ title: "Roundtable: " + String(input.topic ?? "").slice(0, 60) }),
        async execute(input, ctx) {
          const person = await personBehindCall(ctx);
          if (!person) {
            return { content: "A roundtable costs model calls, so someone has to be behind it: no person is.", isError: true };
          }
          const topic = typeof input.topic === "string" ? input.topic.trim() : "";
          if (topic.length < 4) return { content: "topic is too short to convene anything.", isError: true };
          const seats = Array.isArray(input.seats) ? (input.seats as { name: string; role?: string }[]) : [];
          const materials = Array.isArray(input.materials) ? (input.materials as { title?: string; body: string }[]) : [];
          const created = await createMeeting(ctx.db, {
            orgId: ctx.orgId,
            channelId: ctx.channelId,
            createdBy: person,
            topic,
            mode: typeof input.mode === "string" ? input.mode : "debate",
            seats,
          });
          try {
            const convened = await options.engine!.convene({
              topic,
              mode: typeof input.mode === "string" ? input.mode : "debate",
              seats,
              materials: materials.map((m) => ({ kind: "text", title: m.title, body: m.body })),
              idempotencyKey: "meeting:" + ctx.channelId + ":" + created.id,
            });
            await recordProgress(ctx.db, ctx.orgId, created.id, {
              status: "queued",
              engineMeetingId: convened.meetingId,
            });
            return {
              content:
                "Roundtable convened: " + topic + " (meeting " + created.id + "). The experts are deliberating; the minutes will be posted in this channel when it converges.",
            };
          } catch (error) {
            await recordProgress(ctx.db, ctx.orgId, created.id, {
              status: "failed",
              stopReason: String(error).slice(0, 300),
            });
            return { content: "Could not reach the roundtable engine: " + String(error).slice(0, 300), isError: true };
          }
        },
      }
    : null;

  return {
    name: "meetings",
    tools: async () => (convene ? [list, minutes, convene] : [list, minutes]),
  };
}

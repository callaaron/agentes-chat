# 0178. Meetings are runs of this workspace, not a service

- Status: Proposed (supersedes 0177)
- Date: 2026-11-13
- Scope: fork `callaaron/agentes-chat`, branch `feat/loomroom-roundtable`

## Context

ADR 0177 put the deliberation engine in a LoomRoom sidecar and kept a pointer here. It works, and its tests pass, but it
buys a second identity, a second ledger, a second audit trail and a second backup for one feature. Worse, the part that
decides *who speaks next* and *when the meeting is over* — the only part worth owning — stays a black box we call over
HTTP.

Everything a meeting needs already exists here: a channel is the room, an agent is a seat, a run is a speech, the outbox
is the clock, the tool gateway is what a speech may do, and `audit_log` is the record. A meeting is not a service; it is
a **director** that takes turns between runs.

## Decision

1. **A meeting is a row plus a director run.** `meetings` (org, channel, topic, mode, seats, status, round, max_rounds,
   minutes, decisions) has no engine id. Starting one queues a run of a built-in **director** agent (a normal
   `agent_runs` row, background, no channel membership).
2. **A speech is a message.** Each turn writes one message in the meeting's channel with `meta.meeting` =
   `{ meetingId, seat, round, turn }`; `meeting_turns` keeps the order and the run that produced it. The transcript is
   therefore searchable, quotable and visible by the people already in the channel — no second timeline.
3. **The director owns three pure decisions**, each testable offline:
   - `planTurns(seats, mode, round)` — who speaks this round: sequential, free (all who want), brainstorm (randomised
     without repetition), debate (pro/con pairs), host_summary (chair only);
   - `assessConvergence(round, maxRounds, coverage, goalCheck)` — stop or continue, with the reason;
   - `extractDecision(speeches)` — the decision, its conditions and the dissent, or nothing (never invented).
   The director never speaks for an agent: it starts their runs and reads what they said.
4. **A decision is a first-class object.** `decisions` (org, meeting, text, conditions, dissent, qc, status, owner,
   acceptance, verified_at) — proposed, decided, executing, verified, reversed. Its `acceptance` is what a person checks
   before it counts as done; it is the same oracle the payout model needs later.
5. **The chair is the person, not the model.** Convergence is proposed by the director and accepted by the person who
   convened (or by a routine's authority when one did). A meeting may not declare itself conclusive.
6. **LoomRoom becomes reference, not runtime.** Its prompts, QC gates and red-team rules are ported and attributed; no
   code is imported and no process runs beside this one.

## What replaces what

| ADR 0177 | here |
| --- | --- |
| `MEETINGS_ENGINE_URL/TOKEN` | nothing: no service to reach |
| `createRoundtableClient` | `director.ts` (turn planning, convergence, decision extraction) |
| `engineMeetingId` | `director_run_id` |
| `convene_roundtable` calls HTTP | queues a director run and returns at once |

## Consequences

- **One of everything**: identity, budget, approvals, audit and backup stay as they are.
- **Meetings survive a restart** for free: they are rows and runs, not a second process's memory.
- **The protocol is ours**: changing turn order or the QC gate is a normal code change with tests, not a fork of a fork.
- **Cost**: the deliberation logic is reimplemented (about 1,200 lines of TypeScript), and its quality must be proven by
  the same kind of evals LoomRoom used.

## Phases

1. **P0** — schema (meetings, meeting_turns, decisions) + pure director + tests. No run integration yet.
2. **P1** — director run: start a turn, wait for the agent's run, write the message, advance.
3. **P2** — convergence accepted by a person, decision object, tasks from actions.
4. **P3** — the channel entry point ("start a meeting" on a message), the timeline card.

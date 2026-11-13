# 0177. Roundtables: LoomRoom as the meeting engine

- Status: Proposed
- Date: 2026-11-13
- Scope: fork `callaaron/agentes-chat`, branch `feat/loomroom-roundtable`

## Context

agentes.chat gives agents a place to work: channels, runs, a tool gateway, approvals, routines, memory.
What it does not have is **deliberation**: an agenda, speaking rights, an opposing seat, convergence, a QC gate,
and a decision record that a person can sign. Agents compete to answer a message; they do not sit at a table.

LoomRoom (separate repository) is exactly that engine: 5 meeting modes, seat contracts, anti-echo scoring,
termination assessment, cross-family red team with quote backtracking, QC gates, decision pages and minutes.
It is a single Node process with SQLite and a stable HTTP API (`POST /api/meetings`, `GET /api/meetings/:id`,
`GET /api/meetings/:id/minutes`), and its orchestrator is one 366 KB class with 13 importers and a closed set of
SSE events.

## Decision

1. **A meeting is a first-class object here.** New org-scoped table `meetings` (id, org_id, channel_id, topic,
   status, engine_meeting_id, minutes_artifact_id, created_by, created_at, ended_at). Nothing about the engine
   is stored twice: agentes.chat keeps the pointer and the delivery, LoomRoom keeps the transcript.
2. **The engine stays a sidecar.** LoomRoom runs as its own process on loopback with a service token; we do not
   import its code, do not port the orchestrator, and do not touch its SQLite. A port would be a rewrite
   (single-class state machine, SSE contract consumed by its own UI), not a move.
3. **Agents get three tools**, behind the Tool Gateway and therefore behind scopes, run policy and audit:
   - `convene_roundtable(topic, seats[], materials[], mode)` → creates the meeting row, calls the engine, returns id;
   - `roundtable_status(meeting_id)` → queued | deliberating | converged | failed, with round and stops;
   - `roundtable_minutes(meeting_id)` → the rendered minutes plus structured decisions and action items.
   Convening is `external` (a run may not start a paid meeting unattended); status and minutes are `read`.
4. **Delivery is a job, not a request.** A worker polls the engine for unfinished meetings, and on convergence:
   posts the minutes as an artifact in the channel, creates one task per action item, and opens an approval for
   every action whose `doneWhen` requires an outside change. Nothing is executed from the minutes without a person.
5. **Web first, native later.** `/meetings` lists rounds and opens the live room in an iframe pointing at the
   engine until the React surface reaches parity. No second transcript UI is built before that.

## Contract (v1)

Request (agentes.chat → engine):

```json
{ "topic": "...", "mode": "debate", "seats": [{"name":"许衡","role":"tax","personaId":"tax-xu"}],
  "materials": [{"kind":"text","title":"...","body":"..."}], "callbackToken": "..." }
```

Response: `{ "meetingId": "mtg_...", "status": "queued", "url": "https://team.example/meeting/..." }`

Status: `{ "status": "deliberating", "round": 3, "maxRounds": 6, "stopReason": null }`

Minutes: `{ "markdown": "...", "decisions": [...], "actions": [{"text","owner","due","doneWhen"}],
"provenance": {"qcPassed": true, "qcScore": 84, "dissent": "..."} }`

Idempotency: `Idempotency-Key: meeting:<channel_id>:<client_id>;` the engine returns the same id on replay.
Timeouts: convene 10 s; status 5 s; minutes 30 s (minutes are large).

## Why not port it

| Option | Cost | Risk |
| --- | --- | --- |
| Port the orchestrator into `packages/engine` | months; rewrite state machine, SSE, prompts | behaviour drift, two codebases to keep in sync |
| Run LoomRoom as a sidecar (this ADR) | days | one more process, a service token, a network hop |
| Reimplement only "debate mode" natively | weeks | throws away QC, red team, convergence |

## Consequences

- **Licence.** LoomRoom is proprietary today; linking it into an AGPL work makes the combined distribution
  AGPL. If this ships to customers, the roundtable code must be published. This is a business decision, taken
  knowingly here.
- **Ops.** One more systemd unit, one more port on loopback, one more backup (LoomRoom's SQLite).
- **Failure domain.** If the engine is down, convening fails loudly in the channel; existing work is untouched.
- **Security.** The engine is loopback-only and token-gated; its UI is embedded same-origin behind our session,
  never exposed directly.

## Phases

1. **P0** — schema + engine client + `convene_roundtable` tool + tests (no UI).
2. **P1** — worker sync, minutes artifact, tasks, approvals.
3. **P2** — `/meetings` page, live iframe, delivery receipts.
4. **P3** — native room (only if the iframe proves insufficient).

## Open questions

- Do meetings belong to a channel only, or may they be DM-scoped?
- Does a routine's background run get to convene (budget-wise), or only a person's run?
- Where does the decision ledger live long-term — our wiki, or the engine's own decision page?

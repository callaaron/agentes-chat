# Thin fork: meetings are a feature, never a fork of the core

Meetings (and everything they bring: decisions, acceptance, payouts) are added **on top of** agentes.chat.
Upstream keeps moving; every merge must stay a merge, not a rewrite. These rules exist so that
`git merge upstream/main` is something we can do boldly, every month, without reading 400k lines.

## The four rules

1. **New files by default.** A feature lives in its own files. If a change needs an existing file, it is one of the
   seams below, and it is an insertion, never a rewrite.
2. **Seams only.** An upstream file may be touched only where it already expects extensions: the schema export list,
   the engine export list, the tool-source list, the scope/access maps, i18n, the config schema. Nothing else.
3. **Never refactor upstream code to fit ours.** If the shape does not fit, adapt on our side (a wrapper, a new
   module), or send the change upstream first.
4. **Every seam line is marked** with `// fork: meetings` so a merge conflict is one grep away, and the diff stays
   countable: the budget is **≤ 40 inserted lines across upstream files** per feature.

## Seam inventory (meetings, as of ADR 0177/0178)

| Upstream file | Change | Size |
| --- | --- | --- |
| `packages/db/src/schema/index.ts` | `export * from "./meetings";` | 1 line |
| `packages/engine/src/index.ts` | two `export *` lines | 2 lines |
| `packages/engine/src/tools/scopes.ts` | two scopes in `BUILTIN_SCOPES` | ~8 lines |
| `packages/engine/src/access.ts` | two entries in `BUILTIN_TOOLS` | 2 lines |
| `packages/i18n/src/en.ts`, `pt-BR.ts` | three `builtinTools` labels each | ~6 lines each |
| `apps/server/src/engine.ts` | one source in the `sources` array (+ its import) | ~3 lines |
| `packages/config/src/schema.ts` | engine URL/token (only while a sidecar exists) | ~10 lines |

Everything else is new: `packages/db/src/schema/meetings.ts`, `packages/engine/src/meetings*.ts`, the migration,
the tests, the ADRs.

## Where a feature lives

```
packages/db/src/schema/meetings.ts      tables (meetings, meeting_turns, decisions)
packages/db/migrations/0NNN_meetings.sql
packages/engine/src/meetings.ts         rows: create, list, turns, decisions
packages/engine/src/director.ts         pure: planTurns, assessConvergence, extractDecision
packages/engine/src/meetings-tools.ts   what agents may do (list, minutes, convene)
packages/engine/test/meetings*.test.ts  PGlite, no network
docs/adr/0177…, 0178…                   the decisions
```

A new top-level package (`packages/meetings/`) is the next step **only** if the feature grows a server route and a web
page of its own; until then a folder inside `engine` keeps the seams at seven.

## Merge checklist (after every `git merge upstream/main`)

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun test packages/engine/test/meetings.test.ts packages/db/test/schema.test.ts`
4. `bun run check:boundaries` and `bun run check:migrations`
5. `grep -rn "fork: meetings" --include=*.ts | wc -l` — the number must not grow silently
6. Regenerate the migration only if a table changed; committed migrations are immutable upstream too.

## What we do not touch

Messages, runs, the tool gateway, dispatch, approvals, the web shell, the sidebar. Meetings ride them; they do not
change for meetings.

## The test of a healthy fork

> A merge that conflicts in more than one file means a rule was broken.

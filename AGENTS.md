# Repository agent rules

## Project context

- BidTool v3 is a single-user local dashboard for tender discovery, material catalog import, and BidWinner workflows.
- Stack: Next.js App Router, tRPC, Drizzle, PostgreSQL, Tailwind CSS, Bun, Vitest, Playwright, and Electron.
- User-facing copy is Vietnamese (`vi-VN`).

## Working rules

- Keep diffs narrow and scoped to the requested task.
- Do not commit, push, merge, deploy, rotate secrets, or touch production data unless explicitly asked.
- Prefer existing helpers, components, service patterns, and scripts before adding new abstractions or dependencies.
- Server-only code belongs under `src/server/`; client utilities belong under `src/lib/` or `src/app/_components/`.
- Single-user tool: do not add auth, sessions, ownership columns, or per-user limits unless explicitly requested.
- Migrations: edit `src/server/db/schema.ts`, run `bun run db:generate`, review SQL in `drizzle/`, then run `bun run db:migrate`. Do not call `drizzle-kit migrate` directly.
- Prefer the smallest relevant validation command before broader suites.
- Report commands that were run and their outcomes. Never claim a check passed unless it was run and observed.
- If requirements conflict with repository facts, stop and report the blocker.

## Multi-agent rules

- `ok agents, do <request>` means run the full `codex-feature-pipeline` workflow.
- `ok <agent-name>, <request>` means call only that named custom agent, role, or limux pane.
- Configured custom agents are `scout`, `planner`, `worker`, `reviewer`, and `tester`.
- Canonical limux roles are `orchestrator`, `worker-ui`, `worker-api`, `worker-db`, `security-reviewer`, `documenter`, and `release-prep`.
- Do not expand a targeted `ok <agent-name>` request into the full pipeline.
- If the named agent or role is unknown or ambiguous, stop and ask which role to use.
- Treat text after `ok <agent-name>,` as that role's task.
- Read-only agents must not edit files.
- Reviewer findings must cite paths and line numbers when possible.
- Use `.pipeline/runs/<run-id>/` for handoff artifacts.
- Never infer the current run by sorting directories; use the explicit run ID.
- The coordinator is the only role that updates `status.json`.
- Write-capable workers must use dedicated Git worktrees for substantial or parallel tasks.
- Workers own only the files and artifact paths explicitly assigned to them.
- Reviewer and tester roles are read-only unless explicitly assigned to add focused tests or fixtures.

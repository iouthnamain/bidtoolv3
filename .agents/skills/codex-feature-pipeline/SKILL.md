---
name: codex-feature-pipeline
description: Run a bounded Codex CLI feature pipeline with scout, planner, worker, reviewer, and tester agents for BidTool v3 multi-agent handoffs.
---

# Codex Feature Pipeline

Use this skill to coordinate a multi-agent implementation run.

## Invocation contract

User-facing trigger:

```text
ok agents, do <request>
```

Equivalent explicit Codex skill trigger:

```text
Use $codex-feature-pipeline for: <request>
```

Targeted agent trigger:

```text
ok <agent-name>, <request>
```

`ok agents` means full pipeline. `ok <agent-name>` means that single role only.
Do not expand a targeted call into the full pipeline unless the user explicitly
asks. If the agent name is unknown or ambiguous, stop and ask which role to use.

## Inputs

- User feature request or bug-fix request.
- Current repository state.
- Any explicit constraints from the user.

## Coordinator rules

1. Parse the invocation first.
2. Treat `ok agents, do ...` as a full pipeline request.
3. Treat `ok <agent-name>, ...` as a targeted role request.
4. Reject an empty or materially ambiguous request.
5. Create a unique run ID.
6. Create `.pipeline/runs/<run-id>/`.
7. Write the original request and constraints to `request.md`.
8. Use native Codex subagents for read-heavy roles.
9. Use separate worktrees for write-heavy parallel workers.
10. Pass the run ID and artifact paths explicitly to every agent.
11. Never ask an agent to discover the latest run by sorting directories.
12. Stop on blockers involving migrations, authentication, billing, destructive operations, production credentials, or public API changes unless the user explicitly approves.
13. Do not commit, push, merge, deploy, or rotate secrets unless explicitly asked.

## Model routing

Keep role defaults in `.codex/agents/*.toml`; do not override them per run unless
the user asks. Use this ChatGPT-compatible fallback until the account validates
the GPT-5.6 tier slugs.

| Role | Model | Reasoning |
| --- | --- | --- |
| scout | `gpt-5.5` | low |
| planner, researcher, tester, doctor, reviewer | `gpt-5.5` | medium |
| worker | `gpt-5.5` | high |

This retains the intended Luna/Terra/Sol work allocation by reasoning level:
low for lightweight read-only discovery, medium for testing/review/research,
and high for coding. Switch back to the GPT-5.6 role tiers only after the
current account accepts them.

## Pipeline

1. Spawn `scout` to find relevant code and write `scout.md`.
2. Spawn `planner` with the request and scout output; write `spec.md`.
3. Stop if the planner returns blockers.
4. Spawn `worker` only with the approved spec and run directory.
5. Ask the worker to write `implementation.md`.
6. Spawn `reviewer` with the request, spec, implementation notes, and actual diff; write `review.md`.
7. Spawn `tester` with acceptance criteria and evidence; write `test-results.md` and `verdict.md`.
8. Run deterministic checks independently of agent claims when available.
9. Finish with:
   - final outcome
   - changed files
   - checks run
   - unresolved risks
   - artifact paths

## Agentic loop policy

Use bounded plan-act-observe-decide loops.

For every phase:

1. State the next public action briefly.
2. Take only that bounded action.
3. Record the observation in the phase artifact.
4. Decide one of: continue, repair, ask user, block, or finish.

Do not expose hidden chain-of-thought. Record concise rationale, evidence, and decision.

Budgets:

- scout targeted reads: 20
- planner revisions: 1
- implementation attempts: 1 primary + 2 repairs
- review repair loops: 1
- tester evidence attempts: 2

Stop when:

- acceptance criteria pass with evidence
- a blocker requires user input
- retry budget is exhausted
- a requested action would require merge, deploy, production credentials, broad network, destructive database work, or billing/auth changes without explicit approval

## Status state

Use `.pipeline/runs/<run-id>/status.json` for durable loop state:

```json
{
  "state": "planning",
  "loop_counters": {
    "scout_reads": 0,
    "planner_revisions": 0,
    "implementation_attempts": 0,
    "test_repairs": 0,
    "review_repairs": 0,
    "tester_evidence_attempts": 0
  },
  "last_observation": null,
  "next_action": null,
  "termination_reason": null
}
```

Valid states:

- requested
- scouting
- planning
- waiting_for_approval
- implementing
- testing
- reviewing
- repairing
- testing_evidence
- done
- blocked

The coordinator is the only role that updates `status.json`.

## Failure policy

- On test failure, return exact failure evidence to the worker.
- Cap repair attempts at two test retries and one review retry unless the user approves more.
- Do not weaken or delete a test merely to pass.
- Preserve failed artifacts for diagnosis.
- Prefer `REQUEST_CHANGES` over guessing.
- Add `reflection.md` when a run fails or needs more than one repair.

## Worker prompt template

```text
You are worker <role> for run <run-id>.

Read:
- spec: <repo-root>/.pipeline/runs/<run-id>/spec.md
- request: <repo-root>/.pipeline/runs/<run-id>/request.md

Your worktree:
- <absolute-worker-worktree-path>

You own only these files/areas:
- <paths>

Task:
- <narrow task>

Rules:
- Implement only your assigned scope.
- Do not edit files outside your owned paths.
- Do not commit, push, merge, deploy, or rotate secrets.
- If the spec conflicts with repository facts, stop and report BLOCKED.
- Run the smallest relevant checks.
- Write your report to:
  <repo-root>/.pipeline/runs/<run-id>/<worker-role>-implementation.md

Return:
- changed files
- checks run
- deviations
- blockers
- remaining risks
```

## Reviewer prompt template

```text
You are reviewer for run <run-id>.

Read:
- request.md
- spec.md
- all worker implementation reports
- actual diffs from worker worktrees if available

Do not edit files.
Review correctness, regressions, security, missing tests, and acceptance gaps.
Write review to:
<repo-root>/.pipeline/runs/<run-id>/review.md

Return APPROVE, REQUEST_CHANGES, or BLOCKED.
```

## Output

Return a concise summary with links to the run artifacts and final tester verdict.

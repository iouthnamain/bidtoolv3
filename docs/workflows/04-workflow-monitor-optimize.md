# Workflow 04 - Monitor, Optimize and Audit Workflows

## Goal

Give users and operators a clear loop for checking workflow health, fixing noisy rules and auditing automation history.

Target flow:

`workflows -> filter status -> inspect runs -> adjust trigger/action -> rerun -> monitor dashboard`

## Users

- Chuyên viên đấu thầu maintaining personal workflows.
- Operations/admin user monitoring workflow reliability.
- Product/QA validating workflow behavior before pilot.

## Entry Points

- `/workflows` - list workflows and run actions.
- `/insights` - review aggregate workflow success rate.
- `/dashboard` - review recent alerts and active workflow count.

## Inputs

- Existing workflow id.
- Workflow status filter: active, inactive, failed, recently run.
- Run history and log messages.
- User edits to trigger/action settings.

## Status Flow

`active -> running -> success|failed -> needs_review -> updated -> active`

Meaning:

- `active`: workflow is enabled.
- `running`: a run is in progress.
- `success`: latest run completed and action was created.
- `failed`: latest run failed and has log/error context.
- `needs_review`: user or system marks workflow as noisy or unreliable.
- `updated`: trigger/action config was changed.

## Main Steps

1. User opens `/workflows`.
2. User filters by status or scans workflow cards.
3. User opens run history for a workflow.
4. System shows recent run status, message, started time and finished time.
5. User decides one of the following:
   - run now
   - pause workflow
   - edit trigger config
   - edit action config
   - archive/deactivate workflow
6. If edited, system saves a new workflow config snapshot.
7. User runs workflow manually or waits for next scheduled/event trigger.
8. System records the next run and updates success metrics.
9. Dashboard and insights reflect updated workflow status.

## Output

- Updated workflow config.
- New workflow run record.
- Notification when action succeeds.
- Visible success/failure metrics.

## Data To Persist

- Workflow active state.
- Updated trigger/action config.
- Run status, message, start/finish time.
- Optional version/audit metadata:
  - who changed config
  - old config snapshot
  - new config snapshot
  - reason for change

## Acceptance Criteria

- User can see active workflows and recent runs.
- User can manually run an active workflow.
- Inactive workflow cannot be run until reactivated.
- Every run creates a success or failed run log.
- Failed runs expose a human-readable message.
- Dashboard/Insights update workflow success rate from run history.

## Edge Cases

- Workflow is inactive: show clear reason and activation CTA.
- Run fails due to source/API problem: keep workflow active but mark run failed.
- Run creates duplicate notifications: dedupe and log skip reason.
- Config edit breaks validation: block save with field-level error.
- A workflow is noisy: suggest raising match threshold or narrowing saved filter.

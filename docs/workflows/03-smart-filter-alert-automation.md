# Workflow 03 - Smart Filter Alert Automation

## Goal

Let users save a tender-search filter and turn it into an automated alert workflow.

Target flow:

`search -> refine filters -> save smart view -> create workflow -> run trigger -> create notification`

## Users

- Chuyên viên đấu thầu theo dõi cơ hội mới mỗi ngày.
- Quản lý kinh doanh muốn nhận cảnh báo khi có gói phù hợp.
- Operations user chuẩn hóa bộ lọc cho team.

## Entry Points

- `/search` - create and save filter.
- `/workflows` - create, run and manage workflows.
- `/dashboard` - review high-priority alerts and recent workflow runs.

## Inputs

- Keyword.
- Province list.
- Category list.
- Budget range.
- Notification frequency.
- Trigger type:
  - `new_package`
  - `schedule`
- Action type:
  - `in_app`
  - `email` when email delivery is available.

## Status Flow

`filter_draft -> smart_view_saved -> workflow_created -> active -> notification_created`

Meaning:

- `filter_draft`: user is tuning search criteria.
- `smart_view_saved`: filter is saved and reusable.
- `workflow_created`: automation exists but may not be active yet.
- `active`: workflow can run by trigger or manual run.
- `notification_created`: workflow generated an in-app alert or other action.

## Main Steps

1. User opens `/search`.
2. User enters keyword and chooses filters.
3. System updates search results.
4. User saves the filter as a Smart View.
5. User chooses alert frequency or clicks `Tạo workflow`.
6. System creates workflow with:
   - trigger config from saved filter
   - action config from notification settings
   - active/inactive state
7. Trigger runs by schedule, event or manual run.
8. Worker checks whether new packages match the saved filter.
9. If matched, system creates notification and workflow run log.
10. User sees alert on dashboard and notification center.

## Output

- Saved Smart View.
- Workflow record.
- Workflow run record.
- Notification record.

## Data To Persist

- `saved_filters` row with filter criteria.
- `workflows` row with trigger/action config.
- `workflow_runs` row for every run attempt.
- `notifications` row for every generated alert.
- Optional watchlist item if user tracks package/inviter/competitor.

## Acceptance Criteria

- User can save a filter and apply it again in one click.
- User can create a workflow from a Smart View.
- User can activate/deactivate workflow.
- Manual `run now` creates a run log.
- A successful matching run creates an in-app notification.
- Dashboard reflects active workflow count and success rate.

## Edge Cases

- Filter returns too many results: ask user to refine before enabling frequent alerts.
- Workflow action fails: save failed run with error message.
- Same package is found repeatedly: dedupe notification by package id/source URL.
- User deactivates workflow while a run is pending: finish current run but prevent future runs.

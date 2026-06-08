# BidTool Workflow Library

This folder keeps the operating flows for BidTool v3. Each workflow file should
describe the user journey, state changes, handoffs, completion point, and common
exceptions. Keep implementation details out of these files.

## Workflows

1. [Search package -> review -> YCKT Excel export](./01-search-review-yckt-export.md)
2. [Smart filter -> alert workflow automation](./03-smart-filter-alert-automation.md)
3. [Workflow monitoring -> optimize -> audit](./04-workflow-monitor-optimize.md)

## Shared Rules

- Do not auto-select important business decisions for the user.
- Save public or realtime data only after the user chooses, saves, links,
  matches, or exports it.
- Every flow needs a clear resume point after refresh or return navigation.
- Exported files must preserve source evidence, notes, and review context.
- Source failures from BidWinner or external pages must leave a manual recovery
  path.

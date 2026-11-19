# Keep material control as a separate bounded context

Material control will use a dedicated `materialControl` tRPC router, `src/server/services/material-control/` services, and additive tables instead of extending the already broad `material` router or treating `excelWorkspaces` as inventory. The existing `materials` catalog remains shared master data, while project workspaces own requirements, commitments, reservations, movements, and evidence. This keeps catalog enrichment and Excel preparation independent from operational stock accounting.

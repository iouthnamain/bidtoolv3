import { asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import {
  excelWorkspaceItems,
  excelWorkspaces,
  webProductCandidates,
} from "~/server/db/schema";
import {
  hasBlockingExportIssues,
  validateWorkspaceForStandardExport,
} from "~/server/services/excel-workspace-validator";
import {
  buildStandardWorkbookBuffer,
  buildStandardWorkbookFileName,
} from "~/server/services/standard-workbook-export";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = Number(id);
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    return NextResponse.json(
      { error: "Invalid workspace id." },
      { status: 400 },
    );
  }

  const [workspace] = await db
    .select()
    .from(excelWorkspaces)
    .where(eq(excelWorkspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    return NextResponse.json(
      { error: "Workspace not found." },
      { status: 404 },
    );
  }

  const items = await db
    .select()
    .from(excelWorkspaceItems)
    .where(eq(excelWorkspaceItems.workspaceId, workspaceId))
    .orderBy(asc(excelWorkspaceItems.sortOrder));

  const issues = validateWorkspaceForStandardExport({ workspace, items });
  if (hasBlockingExportIssues(issues)) {
    return NextResponse.json({ issues }, { status: 400 });
  }

  const selectedIds = items
    .map((item) => item.selectedCandidateId)
    .filter(
      (candidateId): candidateId is number => typeof candidateId === "number",
    );
  const candidates =
    selectedIds.length > 0
      ? await db
          .select()
          .from(webProductCandidates)
          .where(inArray(webProductCandidates.id, selectedIds))
      : [];

  const buffer = await buildStandardWorkbookBuffer({
    workspace,
    items,
    candidates,
  });
  const fileName = buildStandardWorkbookFileName(workspace);

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}

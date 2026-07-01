import { TRPCError } from "@trpc/server";

import type { parseWorkbookBase64 } from "~/server/services/excel-workbook";

export function selectWorkbookSheet(
  workbook: Awaited<ReturnType<typeof parseWorkbookBase64>>,
  sheetName: string | undefined,
) {
  const requestedSheetName = sheetName?.trim();
  if (!requestedSheetName) {
    return workbook.sheets[0];
  }

  const sheet = workbook.sheets.find((item) => item.name === requestedSheetName);
  if (!sheet) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Không tìm thấy sheet "${requestedSheetName}".`,
    });
  }

  return sheet;
}

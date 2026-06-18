import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { materialCatalogDocuments } from "~/server/db/schema";
import {
  CatalogPdfStorageError,
  readCatalogPdfFile,
} from "~/server/services/catalog-pdf-storage";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth guard (Phase 4). When auth is disabled this is a complete no-op and the
  // route behaves exactly as before. When enabled, any authenticated user may
  // download — catalog PDFs are GLOBAL/shared data, not tenant-scoped.
  if (env.AUTH_ENABLED === "true") {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "ID không hợp lệ." }, { status: 400 });
  }

  const [document] = await db
    .select()
    .from(materialCatalogDocuments)
    .where(
      and(
        eq(materialCatalogDocuments.id, id),
        isNull(materialCatalogDocuments.deletedAt),
      ),
    )
    .limit(1);

  if (!document?.localFilePath) {
    return NextResponse.json(
      { error: "Tài liệu chưa có bản lưu cục bộ." },
      { status: 404 },
    );
  }

  let file: Buffer;
  try {
    file = await readCatalogPdfFile(document.localFilePath);
  } catch (error) {
    const message =
      error instanceof CatalogPdfStorageError
        ? error.message
        : "Không đọc được tệp PDF.";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const fileName = document.fileName ?? "catalog.pdf";
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": document.mimeType ?? "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

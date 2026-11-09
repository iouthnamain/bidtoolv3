import { NextResponse } from "next/server";

import { db } from "~/server/db";
import {
  CatalogPdfStorageError,
  readPublishedCatalogPdf,
} from "~/server/services/catalog-pdf-storage";
import { logApiRoute } from "~/server/lib/trpc-request-log";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  return logApiRoute({
    route: `/api/catalog-pdfs/${rawId}/file`,
    method: "GET",
    handler: async () => handleCatalogPdfFile(request, rawId),
  });
}

async function handleCatalogPdfFile(request: Request, rawId: string) {
  void request;

  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "ID không hợp lệ." }, { status: 400 });
  }

  let published: Awaited<ReturnType<typeof readPublishedCatalogPdf>>;
  try {
    published = await readPublishedCatalogPdf(db, id);
  } catch (error) {
    if (!(error instanceof CatalogPdfStorageError)) throw error;
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (!published) {
    return NextResponse.json(
      { error: "Tài liệu chưa có bản lưu cục bộ." },
      { status: 404 },
    );
  }

  const { document, file } = published;
  const fileName = document.fileName ?? "catalog.pdf";
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": document.mimeType ?? "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

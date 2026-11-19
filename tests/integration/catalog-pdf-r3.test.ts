import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import * as schema from "~/server/db/schema";
import { createDatabaseFixture } from "../fixtures/remediation/database";
import { requireTestDatabase } from "../fixtures/remediation/test-target";

const fetchPublicContent = vi.hoisted(() => vi.fn());
const routeDatabase = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("~/server/db", () => ({
  get db() {
    return routeDatabase.value;
  },
}));
vi.mock("~/server/services/public-content-client", () => ({
  fetchPublicContent,
  PUBLIC_CONTENT_PDF_MAX_BYTES: 50 * 1024 * 1024,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(actual.rm), readFile: vi.fn(actual.readFile) };
});

import { catalogDocumentRouter } from "~/server/api/routers/catalog-document";
import { GET as getCatalogFile } from "~/app/api/catalog-pdfs/[id]/file/route";
import {
  cleanupStaleCatalogPdfVersions,
  publishCatalogPdfFile,
  readCatalogPdfFile,
  saveCatalogPdfFile,
} from "~/server/services/catalog-pdf-storage";

type Database = ReturnType<typeof drizzle<typeof schema>>;
let fixture: Awaited<ReturnType<typeof createDatabaseFixture>>;
let database: Database;
let second: Database;
let root: string;
const pdf = (label: string) => Buffer.from(`%PDF-1.4\nR3 ${label}\n%%EOF`);
const checksum = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

beforeEach(async () => {
  fetchPublicContent.mockReset();
  vi.mocked(rm).mockReset();
  vi.mocked(readFile).mockReset();
  fixture = await createDatabaseFixture();
  await fixture.first`create table ${fixture.first(`${fixture.schema}.material_catalog_documents`)}
    (like public.material_catalog_documents including all)`;
  await fixture.first`set search_path to ${fixture.first(fixture.schema)}, public`;
  await fixture.second`set search_path to ${fixture.second(fixture.schema)}, public`;
  database = drizzle(fixture.first, { schema });
  routeDatabase.value = database;
  second = drizzle(fixture.second, { schema });
  root = await mkdtemp(path.join(tmpdir(), "catalog-r3-test-"));
  vi.stubEnv("BIDTOOL_CATALOG_PDF_DIR", root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { force: true, recursive: true });
  await fixture.cleanup();
});

function caller(db = database) {
  return catalogDocumentRouter.createCaller({
    db,
    headers: new Headers(),
    authEnabled: false,
    user: null,
    session: null,
    tenantId: null,
  });
}

async function seed() {
  const [document] = await database
    .insert(schema.materialCatalogDocuments)
    .values({
      title: "R3 synthetic document",
      sourceUrl: "https://example.com/r3.pdf",
      sourceType: "manual_url",
    })
    .returning();
  if (!document) throw new Error("Fixture insert failed");
  const localFilePath = `${document.id}/old.pdf`;
  await mkdir(path.join(root, String(document.id)));
  await writeFile(path.join(root, localFilePath), pdf("old"));
  await database
    .update(schema.materialCatalogDocuments)
    .set({
      localFilePath,
      fileName: "old.pdf",
      checksum: checksum(pdf("old")),
      fileSize: pdf("old").length,
    })
    .where(eq(schema.materialCatalogDocuments.id, document.id));
  return { ...document, localFilePath };
}

async function current(id: number) {
  const [row] = await database
    .select()
    .from(schema.materialCatalogDocuments)
    .where(eq(schema.materialCatalogDocuments.id, id));
  if (!row?.localFilePath) throw new Error("Missing current PDF");
  const bytes = await readCatalogPdfFile(row.localFilePath);
  expect(checksum(bytes)).toBe(row.checksum);
  expect(bytes.length).toBe(row.fileSize);
  return { row, bytes };
}

async function faultTrigger(body: string) {
  await fixture.first.unsafe(
    `create function ${fixture.schema}.r3_fault() returns trigger language plpgsql as $$ begin ${body} end $$`,
  );
  await fixture.first.unsafe(
    `create trigger r3_fault before update on ${fixture.schema}.material_catalog_documents for each row execute function ${fixture.schema}.r3_fault()`,
  );
}

test("reupload publishes complete unique bytes and preserves the display filename", async () => {
  const doc = await seed();
  const updated = await caller().reuploadPdf({
    id: doc.id,
    fileName: "Báo giá.pdf",
    fileBase64: pdf("new").toString("base64"),
  });
  expect(updated?.fileName).toBe("Báo giá.pdf");
  expect(updated?.sourceType).toBe("uploaded");
  expect((await current(doc.id)).bytes).toEqual(pdf("new"));
  expect(await readdir(path.join(root, String(doc.id)))).toEqual([
    path.basename(updated!.localFilePath!),
  ]);
});

test.each(["reupload", "download"] as const)(
  "%s DB failure preserves current path and bytes, removes abandoned version",
  async (mode) => {
    const doc = await seed();
    await faultTrigger("raise exception 'R3 injected DB failure';");
    fetchPublicContent.mockResolvedValueOnce({ body: pdf("download") });
    const operation =
      mode === "reupload"
        ? caller().reuploadPdf({
            id: doc.id,
            fileName: "old.pdf",
            fileBase64: pdf("new").toString("base64"),
          })
        : caller().downloadToLocal({ id: doc.id });
    await expect(operation).rejects.toThrow(/query|R3 injected/);
    expect((await current(doc.id)).row.localFilePath).toBe(doc.localFilePath);
    expect((await current(doc.id)).bytes).toEqual(pdf("old"));
    expect(await readdir(path.join(root, String(doc.id)))).toEqual(["old.pdf"]);
  },
);

test("downloaded same-name replacement does not overwrite a previous referenced version", async () => {
  const doc = await seed();
  // Another retained row owns these bytes too, so post-commit cleanup must skip it.
  await database.insert(schema.materialCatalogDocuments).values({
    title: "retained reference",
    localFilePath: doc.localFilePath,
    deletedAt: new Date().toISOString(),
  });
  fetchPublicContent.mockResolvedValueOnce({ body: pdf("download") });
  const updated = await caller().downloadToLocal({ id: doc.id });
  expect(updated?.fileName).toBe("old.pdf");
  expect(updated?.localFilePath).not.toBe(doc.localFilePath);
  expect((await current(doc.id)).bytes).toEqual(pdf("download"));
  expect(await readCatalogPdfFile(doc.localFilePath)).toEqual(pdf("old"));
});

test("an update suppressed by a DB trigger is a failure, with the previous file preserved", async () => {
  const doc = await seed();
  await faultTrigger("return null;");
  await expect(
    publishCatalogPdfFile(database, doc.id, "new.pdf", pdf("new"), "reupload"),
  ).rejects.toThrow("Không thể lưu");
  expect((await current(doc.id)).bytes).toEqual(pdf("old"));
  expect(await readdir(path.join(root, String(doc.id)))).toEqual(["old.pdf"]);
});

test("cleanup error cannot reverse committed publication", async () => {
  const doc = await seed();
  vi.mocked(rm).mockRejectedValueOnce(new Error("R3 cleanup EACCES"));
  await expect(
    publishCatalogPdfFile(database, doc.id, "new.pdf", pdf("new"), "reupload"),
  ).resolves.toMatchObject({ checksum: checksum(pdf("new")) });
  expect((await current(doc.id)).bytes).toEqual(pdf("new"));
  expect(await readCatalogPdfFile(doc.localFilePath)).toEqual(pdf("old"));
});

test("GET completes its selected file read before a replacement can unlink it", async () => {
  const doc = await seed();
  const actualFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  let reached!: () => void;
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(readFile).mockImplementationOnce(async (...args) => {
    expect(args[0]).toBe(path.join(root, doc.localFilePath));
    reached();
    await resume;
    return actualFs.readFile(...args);
  });
  const reader = getCatalogFile(
    new Request(`http://localhost/api/catalog-pdfs/${doc.id}/file`),
    {
      params: Promise.resolve({ id: String(doc.id) }),
    },
  );
  const observer = postgres(requireTestDatabase(), { max: 1 });
  let publication: ReturnType<typeof publishCatalogPdfFile> | undefined;
  let completed = false;
  let waitedForReader = false;
  try {
    await reading;
    publication = publishCatalogPdfFile(
      second,
      doc.id,
      "new.pdf",
      pdf("new"),
      "reupload",
    );
    void publication.then(() => {
      completed = true;
    });
    await vi.waitFor(async () => {
      const [locks] = await observer<
        { waiting: number }[]
      >`select count(*)::int as waiting from pg_locks where locktype='advisory' and classid=${0x504446} and objid=${doc.id} and not granted`;
      waitedForReader = (locks?.waiting ?? 0) > 0;
      expect(completed || waitedForReader).toBe(true);
    });
  } finally {
    release();
    await observer.end();
  }
  const response = await reader;
  await publication;
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(pdf("old"));
  expect(waitedForReader).toBe(true);
  expect((await current(doc.id)).bytes).toEqual(pdf("new"));
  const next = await getCatalogFile(
    new Request(`http://localhost/api/catalog-pdfs/${doc.id}/file`),
    {
      params: Promise.resolve({ id: String(doc.id) }),
    },
  );
  expect(next.status).toBe(200);
  expect(Buffer.from(await next.arrayBuffer())).toEqual(pdf("new"));
});

test("row is re-read under lock, preserving a concurrent source-type change", async () => {
  const doc = await seed();
  let started!: () => void;
  const atLock = new Promise<void>((resolve) => {
    started = resolve;
  });
  fixture.first.options.debug = (_connection, query) => {
    if (query.includes("for update")) started();
  };
  let publication!: ReturnType<typeof publishCatalogPdfFile>;
  await second.transaction(async (tx) => {
    await tx
      .select()
      .from(schema.materialCatalogDocuments)
      .where(eq(schema.materialCatalogDocuments.id, doc.id))
      .for("update");
    publication = publishCatalogPdfFile(
      database,
      doc.id,
      "new.pdf",
      pdf("new"),
      "reupload",
    );
    await Promise.race([atLock, publication]);
    await tx
      .update(schema.materialCatalogDocuments)
      .set({ sourceType: "generated" })
      .where(eq(schema.materialCatalogDocuments.id, doc.id));
  });
  expect((await publication)?.sourceType).toBe("generated");
});

test("deletion during staging prevents publication and keeps retained old bytes", async () => {
  const doc = await seed();
  let reached!: () => void;
  const atLock = new Promise<void>((resolve) => {
    reached = resolve;
  });
  // postgres-js debug observes the actual reserved connection used by publication.
  fixture.first.options.debug = (_connection, query) => {
    if (query.includes("for update")) reached();
  };
  let publication!: ReturnType<typeof publishCatalogPdfFile>;
  await second.transaction(async (tx) => {
    await tx
      .select()
      .from(schema.materialCatalogDocuments)
      .where(eq(schema.materialCatalogDocuments.id, doc.id))
      .for("update");
    publication = publishCatalogPdfFile(
      database,
      doc.id,
      "new.pdf",
      pdf("new"),
      "reupload",
    );
    // Attach a handler before the intentional rejection can occur.
    void publication.catch(() => undefined);
    await Promise.race([atLock, publication]);
    await tx
      .update(schema.materialCatalogDocuments)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.materialCatalogDocuments.id, doc.id));
  });
  await expect(publication).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await current(doc.id)).bytes).toEqual(pdf("old"));
  expect(await readdir(path.join(root, String(doc.id)))).toEqual(["old.pdf"]);
});

test("concurrent replacements serialize, leave one complete committed version, and cleanup waits for an active writer", async () => {
  const doc = await seed();
  const cleanupClient = postgres(requireTestDatabase(), {
    max: 1,
    connection: { search_path: `${fixture.schema},public` },
  });
  const cleaner = drizzle(cleanupClient, { schema });
  let reached!: () => void;
  const atLock = new Promise<void>((resolve) => {
    reached = resolve;
  });
  fixture.first.options.debug = (_connection, query) => {
    if (query.includes("for update")) reached();
  };
  let first!: ReturnType<typeof publishCatalogPdfFile>;
  let cleanup!: Promise<void>;
  try {
    await second.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.materialCatalogDocuments)
        .where(eq(schema.materialCatalogDocuments.id, doc.id))
        .for("update");
      first = publishCatalogPdfFile(
        database,
        doc.id,
        "same.pdf",
        pdf("first"),
        "reupload",
      );
      await Promise.race([atLock, first]);
      const staged = (await readdir(path.join(root, String(doc.id)))).find(
        (name) => name.startsWith("version-"),
      );
      if (!staged) throw new Error("No staged file");
      // Even a writer paused beyond the grace period must not lose its file.
      const old = new Date(Date.now() - 48 * 3600_000);
      await utimes(path.join(root, String(doc.id), staged), old, old);
      cleanup = cleanupStaleCatalogPdfVersions(cleaner, doc.id);
      await vi.waitFor(async () => {
        const rows = await tx.execute(
          sql`select count(*)::int as count from pg_locks where locktype='advisory' and classid=${0x504446} and objid=${doc.id} and not granted`,
        );
        expect(rows[0]?.count).toBeGreaterThan(0);
      });
      expect(await readFile(path.join(root, String(doc.id), staged))).toEqual(
        pdf("first"),
      );
    });
    await Promise.all([first, cleanup]);
    const results = await Promise.all([
      publishCatalogPdfFile(
        database,
        doc.id,
        "same.pdf",
        pdf("second"),
        "reupload",
      ),
      publishCatalogPdfFile(
        second,
        doc.id,
        "same.pdf",
        pdf("third"),
        "download",
      ),
    ]);
    expect(new Set(results.map((row) => row?.localFilePath)).size).toBe(2);
    const committed = await current(doc.id);
    expect([checksum(pdf("second")), checksum(pdf("third"))]).toContain(
      committed.row.checksum,
    );
    expect(await readdir(path.join(root, String(doc.id)))).toEqual([
      path.basename(committed.row.localFilePath!),
    ]);
  } finally {
    await cleanupClient.end();
  }
});

test("stale sweep retains fresh, referenced, soft-deleted and legacy files", async () => {
  const doc = await seed();
  const stale = { localFilePath: `${doc.id}/version-${randomUUID()}.pdf` };
  await writeFile(path.join(root, stale.localFilePath), pdf("stale"));
  const fresh = { localFilePath: `${doc.id}/version-${randomUUID()}.pdf` };
  await writeFile(path.join(root, fresh.localFilePath), pdf("fresh"));
  const unattachedInitial = await saveCatalogPdfFile(
    doc.id,
    "initial.pdf",
    pdf("initial"),
  );
  const retained = { localFilePath: `${doc.id}/version-${randomUUID()}.pdf` };
  await writeFile(path.join(root, retained.localFilePath), pdf("retained"));
  await database.insert(schema.materialCatalogDocuments).values({
    title: "soft deleted",
    localFilePath: retained.localFilePath,
    deletedAt: new Date().toISOString(),
  });
  const old = new Date(Date.now() - 48 * 3600_000);
  for (const file of [
    stale.localFilePath,
    retained.localFilePath,
    doc.localFilePath,
    unattachedInitial.localFilePath,
  ])
    await utimes(path.join(root, file), old, old);
  await cleanupStaleCatalogPdfVersions(database, doc.id);
  await expect(readCatalogPdfFile(stale.localFilePath)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readCatalogPdfFile(fresh.localFilePath)).toEqual(pdf("fresh"));
  expect(await readCatalogPdfFile(unattachedInitial.localFilePath)).toEqual(
    pdf("initial"),
  );
  expect(await readCatalogPdfFile(retained.localFilePath)).toEqual(
    pdf("retained"),
  );
  expect((await current(doc.id)).bytes).toEqual(pdf("old"));
});

test.each(["before-transaction", "before-commit", "after-commit"])(
  "process exit %s leaves a complete current version and recoverable orphans",
  async (checkpoint) => {
    const doc = await seed();
    const result = await new Promise<{
      code: number | null;
      signal: string | null;
      output: string;
    }>((resolve, reject) => {
      const child = spawn(
        "bun",
        [
          "--conditions=react-server",
          "tests/fixtures/remediation/pdf-publication-child.ts",
          fixture.schema,
          String(doc.id),
          checkpoint,
        ],
        {
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            BIDTOOL_TEST_DATABASE_URL: requireTestDatabase(),
            BIDTOOL_CATALOG_PDF_DIR: root,
            BIDTOOL_LOG_LEVEL: "error",
            SKIP_ENV_VALIDATION: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        output += data.toString();
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal, output }));
    });
    expect(result, result.output).toMatchObject({
      code: null,
      signal: "SIGKILL",
    });
    expect(result.output).toContain(`R3 checkpoint ${checkpoint}`);
    const committed = await current(doc.id);
    expect(committed.bytes).toEqual(
      pdf(checkpoint === "after-commit" ? "child" : "old"),
    );
    const files = await readdir(path.join(root, String(doc.id)));
    expect(files).toHaveLength(2);
    const old = new Date(Date.now() - 48 * 3600_000);
    for (const name of files)
      await utimes(path.join(root, String(doc.id), name), old, old);
    await cleanupStaleCatalogPdfVersions(database, doc.id);
    expect((await current(doc.id)).bytes).toEqual(committed.bytes);
    if (checkpoint !== "after-commit")
      expect(await readdir(path.join(root, String(doc.id)))).toEqual([
        "old.pdf",
      ]);
  },
  15_000,
);

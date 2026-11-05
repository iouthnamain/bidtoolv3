import ExcelJS from "exceljs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  excelWorkspaceItems,
  excelWorkspaces,
  materialProfileSearchJobs,
  materialProfileSearchRuns,
} from "~/server/db/schema";

import {
  assertExportDirWritable,
  buildOpenFolderCommand,
  buildMaterialProfileOutputPrefix,
  canExportMaterialProfileCleanItems,
  MATERIAL_PROFILE_EXPORT_COLUMNS,
  isMaterialProfileExportRowDeleted,
  lockMaterialProfileReviewDecisionRows,
  MaterialProfileWorkspaceError,
  parseMaterialProfileExportEditState,
  resolveDefaultDownloadsDir,
  resolveMaterialProfileStorageRoot,
  resolveWorkspaceWorkbookBuffer,
  sanitizeMaterialProfilePathSegment,
  sanitizeMaterialProfileWorkbookFileName,
  selectMaterialProfileCleanExportItems,
  shouldBulkApplyMaterialProfileCandidate,
  summarizeMaterialProfileReviewReadiness,
  summarizeMaterialProfileExportEditState,
  uploadMaterialProfileWorkbook,
} from "~/server/services/material-profile-workspaces";

type ReplacementTestState = {
  workspace: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  transactionError?: Error;
  deleteError?: Error;
  beforeTransaction?: () => void;
};

function fakeTableName(table: unknown) {
  return String(
    table && typeof table === "object"
      ? ((table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ?? "")
      : "",
  );
}

function replacementDb(state: ReplacementTestState) {
  const rowsFor = (table: unknown) => {
    switch (fakeTableName(table)) {
      case "excel_workspaces":
        return [state.workspace];
      case "excel_workspace_items":
        return state.items;
      case "material_profile_search_jobs":
        return state.jobs;
      case "material_profile_search_runs":
        return state.runs;
      default:
        return [];
    }
  };

  const select = (projection?: unknown) => {
    let table: unknown;
    const builder = {
      from(value: unknown) {
        table = value;
        return builder;
      },
      where() {
        return builder;
      },
      limit() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      for() {
        return builder;
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        const rows =
          fakeTableName(table) === "excel_workspaces" && projection
            ? []
            : rowsFor(table);
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  };

  const update = (table: unknown) => {
    let values: Record<string, unknown> = {};
    const builder = {
      set(next: Record<string, unknown>) {
        values = next;
        return builder;
      },
      where() {
        return builder;
      },
      returning() {
        const name = fakeTableName(table);
        if (name === "excel_workspaces") {
          state.workspace = { ...state.workspace, ...values };
          return Promise.resolve([state.workspace]);
        }
        if (name === "material_profile_search_jobs") {
          state.jobs = state.jobs.map((job) => ({ ...job, ...values }));
        }
        if (name === "material_profile_search_runs") {
          state.runs = state.runs.map((run) => ({ ...run, ...values }));
        }
        return Promise.resolve([]);
      },
      then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        const name = fakeTableName(table);
        if (name === "material_profile_search_jobs") {
          state.jobs = state.jobs.map((job) => ({ ...job, ...values }));
        }
        if (name === "material_profile_search_runs") {
          state.runs = state.runs.map((run) => ({ ...run, ...values }));
        }
        return Promise.resolve([]).then(resolve, reject);
      },
    };
    return builder;
  };

  const remove = (table: unknown) => ({
    where() {
      if (state.deleteError) {
        return Promise.reject(state.deleteError);
      }
      if (fakeTableName(table) === "excel_workspace_items") {
        state.items = [];
      }
      return Promise.resolve([]);
    },
  });

  const db = {
    select,
    update,
    delete: remove,
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      state.beforeTransaction?.();
      if (state.transactionError) throw state.transactionError;
      const snapshot = {
        workspace: { ...state.workspace },
        items: [...state.items],
        jobs: [...state.jobs],
        runs: [...state.runs],
      };
      try {
        return await callback(db);
      } catch (error) {
        state.workspace = snapshot.workspace;
        state.items = snapshot.items;
        state.jobs = snapshot.jobs;
        state.runs = snapshot.runs;
        throw error;
      }
    },
  };
  return db;
}

async function workbookBytes(name = "Materials") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(["Tên vật tư", "ĐVT", "Thông số kỹ thuật"]);
  sheet.addRow(["Vật tư mới", "cái", "Mô tả mới"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function emptyWorkbookBytes() {
  const workbook = new ExcelJS.Workbook();
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("material profile workspace helpers", () => {
  it("locks the workspace before Step 3 decision rows in stable order", async () => {
    const executed: unknown[] = [];
    const db = {
      execute: async (query: unknown) => {
        executed.push(query);
        return [];
      },
    };

    await lockMaterialProfileReviewDecisionRows(db as never, 12, [9, 3, 7]);

    expect(executed).toHaveLength(2);
    const queryInfo = executed.map((query) => {
      const sqlQuery = query as {
        usedTables?: string[];
        queryChunks?: Array<{ value?: string[]; name?: string }>;
      };
      return {
        tables: sqlQuery.usedTables ?? [],
        columns: (sqlQuery.queryChunks ?? [])
          .map((chunk) => chunk.name)
          .filter((name): name is string => typeof name === "string"),
        text: (sqlQuery.queryChunks ?? [])
          .flatMap((chunk) => chunk.value ?? [])
          .join(""),
      };
    });
    expect(queryInfo[0]?.tables).toEqual(["excel_workspaces"]);
    expect(queryInfo[0]?.text).toContain("for update");
    expect(queryInfo[1]?.tables).toEqual(["excel_workspace_items"]);
    expect(queryInfo[1]?.columns).toContain("workspace_id");
    expect(queryInfo[1]?.text).toContain("order by");
    expect(queryInfo[1]?.text).toContain("for update");
  });

  it("sanitizes path segments without dropping Vietnamese text", () => {
    expect(
      sanitizeMaterialProfilePathSegment("IB2600190527-00", "fallback"),
    ).toBe("IB2600190527-00");
    expect(
      sanitizeMaterialProfilePathSegment("../Hồ sơ: vật tư", "fallback"),
    ).toBe("_Hồ sơ_ vật tư");
    expect(sanitizeMaterialProfilePathSegment("   ", "fallback")).toBe(
      "fallback",
    );
  });

  it("keeps xlsx output names safe", () => {
    expect(sanitizeMaterialProfileWorkbookFileName("bang vat tu.xlsx")).toBe(
      "bang vat tu.xlsx",
    );
    expect(sanitizeMaterialProfileWorkbookFileName("../bad.xlsm")).toBe(
      "bad.xlsm.xlsx",
    );
  });

  it("builds output prefix from Số TBMT and timestamp without enriched text", () => {
    const date = new Date(2026, 5, 23, 10, 30);
    const prefix = buildMaterialProfileOutputPrefix("IB2600190527-00", date);

    expect(prefix).toBe("IB2600190527-00_20260623_1030");
    expect(prefix).not.toContain("enriched");
  });

  it("exports the material fields as appended BidTool columns", () => {
    expect(
      MATERIAL_PROFILE_EXPORT_COLUMNS.map((column) => column.header),
    ).toEqual([
      "BT - Match status",
      "BT - Tên vật tư",
      "BT - Mã VT",
      "BT - ĐVT",
      "BT - Nhóm",
      "BT - Thông số",
      "BT - NCC",
      "BT - Xuất xứ",
      "BT - Đơn giá",
      "BT - Tiền tệ",
      "BT - Nguồn",
      "BT - Catalog files",
    ]);
  });

  it("keeps every current clean-export row even when legacy export inclusion is off", () => {
    const rows = [
      { id: 1, isStale: false, includedInExport: true },
      { id: 2, isStale: false, includedInExport: false },
      { id: 3, isStale: true, includedInExport: true },
      { id: 4, isStale: true, includedInExport: false },
    ];

    expect(selectMaterialProfileCleanExportItems(rows)).toEqual([
      rows[0],
      rows[1],
    ]);
  });

  it("allows clean export when current rows have validation warnings", () => {
    expect(
      canExportMaterialProfileCleanItems([
        { promotable: false, reasons: ["Thiếu dữ liệu"] },
      ]),
    ).toBe(true);
    expect(canExportMaterialProfileCleanItems([])).toBe(false);
  });

  it("builds a platform-specific open-folder command", () => {
    const command = buildOpenFolderCommand("/tmp/bidtool-output");

    expect(command.command.length).toBeGreaterThan(0);
    expect(command.args).toContain("/tmp/bidtool-output");
  });

  it("normalizes export edit state and summarizes workbook edits", () => {
    const state = parseMaterialProfileExportEditState({
      cellEdits: {
        "Sheet 1": {
          "1:2": "Tên mới",
          bad: "ignored",
        },
      },
      deletedRows: {
        "Sheet 1": [3, 3, "4", -1],
      },
      deletedColumns: {
        "Sheet 1": [2, 7],
      },
      updatedAt: "2026-06-23T10:30:00.000Z",
    });

    expect(state.cellEdits["Sheet 1"]).toEqual({ "1:2": "Tên mới" });
    expect(state.deletedRows["Sheet 1"]).toEqual([3, 4]);
    expect(state.deletedColumns["Sheet 1"]).toEqual([2, 7]);
    expect(summarizeMaterialProfileExportEditState(state, "Sheet 1")).toEqual({
      editedCellCount: 1,
      deletedRowCount: 2,
      deletedColumnCount: 2,
      deletedMaterialRowCount: 2,
    });
  });

  it("detects deleted material rows for export/catalog alignment", () => {
    const state = parseMaterialProfileExportEditState({
      deletedRows: {
        Materials: [5],
      },
    });

    expect(isMaterialProfileExportRowDeleted("Materials", 5, state)).toBe(true);
    expect(isMaterialProfileExportRowDeleted("Materials", 6, state)).toBe(
      false,
    );
  });

  it("uses the bulk apply threshold for high-confidence matches", () => {
    expect(shouldBulkApplyMaterialProfileCandidate(0.85)).toBe(true);
    expect(shouldBulkApplyMaterialProfileCandidate(0.849)).toBe(false);
    expect(shouldBulkApplyMaterialProfileCandidate(0.8, 0.8)).toBe(true);
    expect(shouldBulkApplyMaterialProfileCandidate("0.95")).toBe(false);
  });

  it("summarizes review readiness with skipped and unresolved rows", () => {
    const readiness = summarizeMaterialProfileReviewReadiness([
      {
        id: 1,
        originalRowIndex: 2,
        materialId: 10,
        matchStatus: "matched",
        reviewDecisionJson: {},
        enrichedSnapshotJson: {
          status: "auto",
          fillPlan: [{ action: "filled", field: "specText" }],
        },
      },
      {
        id: 2,
        originalRowIndex: 3,
        materialId: null,
        matchStatus: "unmatched",
        reviewDecisionJson: {
          materialId: null,
          acceptedFields: [],
          skipped: true,
        },
        enrichedSnapshotJson: { status: "unmatched" },
      },
      {
        id: 3,
        originalRowIndex: 4,
        materialId: null,
        matchStatus: "unmatched",
        reviewDecisionJson: {},
        enrichedSnapshotJson: { status: "unmatched" },
      },
    ]);

    expect(readiness).toMatchObject({
      totalRows: 3,
      resolvedRows: 2,
      exportableRows: 1,
      skippedRows: 1,
      unresolvedRows: 1,
      canExportWithWarnings: true,
    });
    expect(readiness.warnings[0]).toContain("Còn 1 dòng chưa chọn hoặc bỏ qua");
  });

  it("resolves the default downloads directory from the user home", () => {
    const result = resolveDefaultDownloadsDir();

    expect(result).toBe(path.join(os.homedir(), "Downloads"));
  });

  it("accepts writable export directories and creates missing folders", async () => {
    const tempParent =
      process.platform === "darwin" ? os.homedir() : os.tmpdir();
    const tempRoot = await mkdtemp(path.join(tempParent, "bidtool-export-"));
    const targetDir = path.join(tempRoot, "nested", "export");

    await expect(assertExportDirWritable(targetDir)).resolves.toBe(targetDir);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects empty export paths and file paths", async () => {
    await expect(assertExportDirWritable("   ")).rejects.toBeInstanceOf(
      MaterialProfileWorkspaceError,
    );

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bidtool-export-"));
    const filePath = path.join(tempRoot, "not-a-dir.txt");
    await writeFile(filePath, "x");

    await expect(assertExportDirWritable(filePath)).rejects.toBeInstanceOf(
      MaterialProfileWorkspaceError,
    );

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("rejects forbidden system export paths", async () => {
    if (process.platform === "win32") {
      await expect(assertExportDirWritable("C:\\")).rejects.toBeInstanceOf(
        MaterialProfileWorkspaceError,
      );
      return;
    }

    await expect(assertExportDirWritable("/etc")).rejects.toBeInstanceOf(
      MaterialProfileWorkspaceError,
    );
  });
});

describe("material profile storage root", () => {
  it("prefers configured export dir over serverless default", () => {
    expect(
      resolveMaterialProfileStorageRoot("/custom/material-profiles", {
        serverless: true,
      }),
    ).toBe(path.resolve("/custom/material-profiles"));
  });

  it("uses tmpdir on serverless when unconfigured", () => {
    expect(resolveMaterialProfileStorageRoot(null, { serverless: true })).toBe(
      path.join(os.tmpdir(), "bidtool", "material-profiles"),
    );
  });

  it("uses cwd/data for local dev when unconfigured", () => {
    expect(resolveMaterialProfileStorageRoot(null, { serverless: false })).toBe(
      path.join(process.cwd(), "data", "material-profiles"),
    );
  });
});

describe("resolveWorkspaceWorkbookBuffer", () => {
  it("reads from disk when sourceWorkbookPath exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bidtool-workbook-"));
    const filePath = path.join(tempRoot, "workbook.xlsx");
    const content = Buffer.from("excel-bytes");
    await writeFile(filePath, content);

    await expect(
      resolveWorkspaceWorkbookBuffer({
        sourceWorkbookPath: filePath,
        workbookJson: {
          sourceWorkbookBase64: Buffer.from("fallback").toString("base64"),
        },
      }),
    ).resolves.toEqual(content);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it("falls back to sourceWorkbookBase64 when disk path is missing", async () => {
    const content = Buffer.from("excel-from-db");
    const base64 = content.toString("base64");

    await expect(
      resolveWorkspaceWorkbookBuffer({
        sourceWorkbookPath: "/tmp/does-not-exist/workbook.xlsx",
        workbookJson: { sourceWorkbookBase64: base64 },
      }),
    ).resolves.toEqual(content);
  });

  it("throws BAD_REQUEST when neither disk nor DB blob is available", async () => {
    await expect(
      resolveWorkspaceWorkbookBuffer({
        sourceWorkbookPath: null,
        workbookJson: { sheets: [] },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Chưa upload file Excel cho work này.",
    });
  });
});

describe("uploadMaterialProfileWorkbook replacement", () => {
  function workspaceFixture(sourceWorkbookPath: string | null = null) {
    return {
      id: 7,
      name: "Hồ sơ thử nghiệm",
      noticeNumber: "TB-7",
      status: "imported",
      sourceFileName: "old.xlsx",
      sourceWorkbookPath,
      sourceSheetName: "Materials",
      rowCount: 1,
      columnMappingJson: {},
      workbookJson: {
        sourceWorkbookBase64: Buffer.from("old workbook").toString("base64"),
        sheets: [],
      },
      editStateJson: {},
      exportEditStateJson: {},
      updatedAt: "2026-11-05T00:00:00.000Z",
    };
  }

  it("parses before changing active jobs or rows", async () => {
    const state: ReplacementTestState = {
      workspace: workspaceFixture(),
      items: [{ id: 11, workspaceId: 7 }],
      jobs: [{ id: "job-1", workspaceId: 7, status: "running" }],
      runs: [{ id: 1, workspaceId: 7, status: "running" }],
    };

    await expect(
      uploadMaterialProfileWorkbook(replacementDb(state) as never, {
        workspaceId: 7,
        fileName: "new.xlsx",
        workbookBase64: "%%%not-base64%%%",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(state.jobs[0]?.status).toBe("running");
    expect(state.runs[0]?.status).toBe("running");
    expect(state.items).toHaveLength(1);
  });

  it("keeps the old state when the workbook cannot be parsed or has no sheet", async () => {
    for (const bytes of [
      Buffer.from("not an xlsx"),
      await emptyWorkbookBytes(),
    ]) {
      const state: ReplacementTestState = {
        workspace: workspaceFixture(),
        items: [{ id: 11, workspaceId: 7 }],
        jobs: [{ id: "job-1", workspaceId: 7, status: "running" }],
        runs: [{ id: 1, workspaceId: 7, status: "running" }],
      };

      await expect(
        uploadMaterialProfileWorkbook(replacementDb(state) as never, {
          workspaceId: 7,
          fileName: "new.xlsx",
          workbookBase64: bytes.toString("base64"),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(state.jobs[0]?.status).toBe("running");
      expect(state.runs[0]?.status).toBe("running");
      expect(state.items).toHaveLength(1);
    }
  });

  it("publishes a unique workbook path and atomically clears old rows", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bidtool-workbook-replace-"),
    );
    const oldPath = path.join(root, "old", "old.xlsx");
    await mkdir(path.dirname(oldPath), { recursive: true });
    await writeFile(oldPath, "old bytes");
    vi.stubEnv("BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR", root);
    const bytes = await workbookBytes();
    const state: ReplacementTestState = {
      workspace: workspaceFixture(oldPath),
      items: [{ id: 11, workspaceId: 7 }],
      jobs: [{ id: "job-1", workspaceId: 7, status: "running" }],
      runs: [{ id: 1, workspaceId: 7, status: "running" }],
    };

    const updated = await uploadMaterialProfileWorkbook(
      replacementDb(state) as never,
      {
        workspaceId: 7,
        fileName: "new.xlsx",
        workbookBase64: bytes.toString("base64"),
      },
    );

    const newPath = updated.sourceWorkbookPath;
    expect(newPath).toMatch(/new\.xlsx\.[0-9a-f-]+$/);
    expect(newPath).not.toBe(oldPath);
    await expect(readFile(newPath!)).resolves.toEqual(bytes);
    await expect(readFile(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(state.items).toHaveLength(0);
    expect(state.jobs[0]?.status).toBe("cancelled");
    expect(state.runs[0]?.status).toBe("cancelled");
    expect(
      (updated.workbookJson as { sourceWorkbookBase64: string })
        .sourceWorkbookBase64,
    ).toBe(bytes.toString("base64"));

    await rm(root, { recursive: true, force: true });
  });

  it("keeps the old bytes and removes the staged version on commit failure", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bidtool-workbook-failure-"),
    );
    const oldPath = path.join(root, "old.xlsx");
    await writeFile(oldPath, "old bytes");
    vi.stubEnv("BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR", root);
    const state: ReplacementTestState = {
      workspace: workspaceFixture(oldPath),
      items: [{ id: 11, workspaceId: 7 }],
      jobs: [{ id: "job-1", workspaceId: 7, status: "running" }],
      runs: [],
      transactionError: new Error("commit failed"),
    };

    await expect(
      uploadMaterialProfileWorkbook(replacementDb(state) as never, {
        workspaceId: 7,
        fileName: "new.xlsx",
        workbookBase64: (await workbookBytes()).toString("base64"),
      }),
    ).rejects.toThrow("commit failed");

    await expect(readFile(oldPath)).resolves.toEqual(Buffer.from("old bytes"));
    const sourceDir = path.join(root, "TB-7", "7", "source");
    await expect(readdir(sourceDir)).resolves.toEqual([]);
    expect(state.workspace.sourceWorkbookPath).toBe(oldPath);
    expect(state.items).toHaveLength(1);

    await rm(root, { recursive: true, force: true });
  });

  it("rolls back cancellation and workbook changes when item deletion fails", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bidtool-workbook-delete-failure-"),
    );
    const oldPath = path.join(root, "old.xlsx");
    await writeFile(oldPath, "old bytes");
    vi.stubEnv("BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR", root);
    const state: ReplacementTestState = {
      workspace: workspaceFixture(oldPath),
      items: [{ id: 11, workspaceId: 7 }],
      jobs: [{ id: "job-1", workspaceId: 7, status: "running" }],
      runs: [{ id: 1, workspaceId: 7, status: "running" }],
      deleteError: new Error("item delete failed"),
    };

    await expect(
      uploadMaterialProfileWorkbook(replacementDb(state) as never, {
        workspaceId: 7,
        fileName: "new.xlsx",
        workbookBase64: (await workbookBytes()).toString("base64"),
      }),
    ).rejects.toThrow("item delete failed");

    await expect(readFile(oldPath)).resolves.toEqual(Buffer.from("old bytes"));
    expect(state.workspace.sourceWorkbookPath).toBe(oldPath);
    expect(state.jobs[0]?.status).toBe("running");
    expect(state.runs[0]?.status).toBe("running");
    expect(state.items).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });

  it("uses the database blob when the filesystem cannot stage a path", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bidtool-workbook-readonly-"),
    );
    const blockedRoot = path.join(root, "blocked");
    await writeFile(blockedRoot, "not a directory");
    vi.stubEnv("BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR", blockedRoot);
    const bytes = await workbookBytes();
    const state: ReplacementTestState = {
      workspace: workspaceFixture(),
      items: [],
      jobs: [],
      runs: [],
    };

    const updated = await uploadMaterialProfileWorkbook(
      replacementDb(state) as never,
      {
        workspaceId: 7,
        fileName: "new.xlsx",
        workbookBase64: bytes.toString("base64"),
      },
    );

    expect(updated.sourceWorkbookPath).toBeNull();
    expect(
      (updated.workbookJson as { sourceWorkbookBase64: string })
        .sourceWorkbookBase64,
    ).toBe(bytes.toString("base64"));
    await rm(root, { recursive: true, force: true });
  });

  it("rejects a stale replacement without cancelling the current job", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "bidtool-workbook-race-"),
    );
    vi.stubEnv("BIDTOOL_MATERIAL_PROFILE_EXPORT_DIR", root);
    const state: ReplacementTestState = {
      workspace: workspaceFixture(),
      items: [{ id: 11, workspaceId: 7 }],
      jobs: [{ id: "job-1", workspaceId: 7, status: "running" }],
      runs: [{ id: 1, workspaceId: 7, status: "running" }],
      beforeTransaction: () => {
        state.workspace = {
          ...state.workspace,
          updatedAt: "2026-11-05T00:00:01.000Z",
        };
      },
    };

    await expect(
      uploadMaterialProfileWorkbook(replacementDb(state) as never, {
        workspaceId: 7,
        fileName: "new.xlsx",
        workbookBase64: (await workbookBytes()).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(state.jobs[0]?.status).toBe("running");
    expect(state.runs[0]?.status).toBe("running");
    expect(state.items).toHaveLength(1);
    await rm(root, { recursive: true, force: true });
  });
});

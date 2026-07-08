import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AiSearchStoredResult,
  WebLinkResult,
} from "~/lib/materials/enrich-gap-fill";

type TestRow = Record<string, unknown>;

const dbMock = vi.hoisted(() => {
  type Predicate = {
    column: string;
    op: "eq" | "ne" | "in";
    value: unknown;
  };
  type TestDb = {
    select: typeof select;
    insert: typeof insert;
    update: typeof update;
    transaction: (callback: (tx: TestDb) => Promise<unknown>) => Promise<unknown>;
  };

  const drizzleName = Symbol.for("drizzle:Name");
  const now = "2026-07-02T00:00:00.000Z";
  const columnProps: Record<string, string> = {
    ai_search_status: "aiSearchStatus",
    current_item_id: "currentItemId",
    current_product_name: "currentProductName",
    current_row_index: "currentRowIndex",
    error_message: "errorMessage",
    finished_at: "finishedAt",
    input_snapshot_json: "inputSnapshotJson",
    is_current: "isCurrent",
    item_id: "itemId",
    job_id: "jobId",
    last_progress_at: "lastProgressAt",
    original_row_index: "originalRowIndex",
    queries_json: "queriesJson",
    requested_item_ids: "requestedItemIds",
    sort_order: "sortOrder",
    source_web_run_id: "sourceWebRunId",
    started_at: "startedAt",
    updated_at: "updatedAt",
    warnings_json: "warningsJson",
    web_link_results_json: "webLinkResultsJson",
    web_links_status: "webLinksStatus",
    workspace_id: "workspaceId",
    ai_search_candidates_json: "aiSearchCandidatesJson",
    recommended_candidate_key: "recommendedCandidateKey",
  };

  const state: {
    workspaces: TestRow[];
    items: TestRow[];
    jobs: TestRow[];
    runs: TestRow[];
    nextRunId: number;
  } = {
    workspaces: [],
    items: [],
    jobs: [],
    runs: [],
    nextRunId: 1,
  };

  function tableName(table: unknown) {
    return String(
      table && typeof table === "object"
        ? ((table as Record<symbol, unknown>)[drizzleName] ?? "")
        : "",
    );
  }

  function rowsForTable(name: string) {
    if (name === "excel_workspaces") return state.workspaces;
    if (name === "excel_workspace_items") return state.items;
    if (name === "material_profile_search_jobs") return state.jobs;
    if (name === "material_profile_search_runs") return state.runs;
    return [];
  }

  function chunkText(value: unknown) {
    if (!value || typeof value !== "object" || !("value" in value)) return "";
    const raw = (value as { value: unknown }).value;
    return Array.isArray(raw) ? raw.join("") : "";
  }

  function isColumn(value: unknown): value is { name: string; table: unknown } {
    return (
      !!value &&
      typeof value === "object" &&
      "name" in value &&
      "table" in value &&
      typeof (value as { name: unknown }).name === "string"
    );
  }

  function paramValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(paramValue);
    if (value && typeof value === "object" && "value" in value) {
      return (value as { value: unknown }).value;
    }
    return value;
  }

  function collectPredicates(value: unknown, result: Predicate[] = []) {
    if (!value || typeof value !== "object") return result;
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return result;

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (isColumn(chunk)) {
        const opText = chunkText(chunks[index + 1]);
        if (opText.includes(" in ")) {
          result.push({
            column: chunk.name,
            op: "in",
            value: paramValue(chunks[index + 2]),
          });
        } else if (opText.includes("<>") || opText.includes("!=")) {
          result.push({
            column: chunk.name,
            op: "ne",
            value: paramValue(chunks[index + 2]),
          });
        } else if (opText.includes("=")) {
          result.push({
            column: chunk.name,
            op: "eq",
            value: paramValue(chunks[index + 2]),
          });
        }
      }
      collectPredicates(chunk, result);
    }
    return result;
  }

  function matches(row: TestRow, where: unknown) {
    const predicates = collectPredicates(where);
    return predicates.every((predicate) => {
      const prop = columnProps[predicate.column] ?? predicate.column;
      const rowValue = row[prop];
      if (predicate.op === "in") {
        return Array.isArray(predicate.value)
          ? predicate.value.includes(rowValue)
          : false;
      }
      if (predicate.op === "ne") return rowValue !== predicate.value;
      return rowValue === predicate.value;
    });
  }

  function firstColumn(value: unknown): string | null {
    if (isColumn(value)) return value.name;
    if (!value || typeof value !== "object") return null;
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return null;
    for (const chunk of chunks) {
      const found = firstColumn(chunk);
      if (found) return found;
    }
    return null;
  }

  function allChunkText(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return chunkText(value);
    return chunks.map((chunk) => chunkText(chunk) || allChunkText(chunk)).join("");
  }

  function projectRows(rows: TestRow[], selection: unknown) {
    if (selection && typeof selection === "object" && "count" in selection) {
      return [{ count: rows.length }];
    }
    if (
      selection &&
      typeof selection === "object" &&
      Object.keys(selection).length === 1 &&
      "status" in selection
    ) {
      return rows.map((row) => ({ status: row.status }));
    }
    return rows;
  }

  function withDefaults(name: string, input: TestRow): TestRow {
    if (name === "material_profile_search_jobs") {
      return {
        id: "job-1",
        workspaceId: 1,
        status: "queued",
        mode: "web",
        requestedItemIds: [],
        total: 0,
        processed: 0,
        found: 0,
        partial: 0,
        failed: 0,
        skipped: 0,
        currentItemId: null,
        currentRowIndex: null,
        currentProductName: null,
        message: null,
        error: null,
        startedAt: null,
        finishedAt: null,
        lastProgressAt: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
    }
    if (name === "material_profile_search_runs") {
      return {
        id: state.nextRunId++,
        jobId: "job-1",
        workspaceId: 1,
        itemId: 101,
        originalRowIndex: 4,
        sortOrder: 0,
        mode: "web",
        status: "queued",
        isCurrent: false,
        sourceWebRunId: null,
        inputSnapshotJson: {},
        queriesJson: [],
        webLinksStatus: "idle",
        aiSearchStatus: "idle",
        webLinkResultsJson: [],
        aiSearchCandidatesJson: [],
        recommendedCandidateKey: null,
        warningsJson: [],
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
        ...input,
      };
    }
    return input;
  }

  function select(selection?: unknown) {
    let rows: TestRow[] = [];
    const builder = {
      from(table: unknown) {
        rows = [...rowsForTable(tableName(table))];
        return builder;
      },
      where(where: unknown) {
        rows = rows.filter((row) => matches(row, where));
        return builder;
      },
      orderBy(...orders: unknown[]) {
        const column = firstColumn(orders[0]);
        const prop = column ? (columnProps[column] ?? column) : null;
        const descending = allChunkText(orders[0]).includes("desc");
        if (prop) {
          rows.sort((left, right) => {
            const leftValue = String(left[prop] ?? "");
            const rightValue = String(right[prop] ?? "");
            return descending
              ? rightValue.localeCompare(leftValue)
              : leftValue.localeCompare(rightValue);
          });
        }
        return builder;
      },
      limit(count: number) {
        return Promise.resolve(projectRows(rows.slice(0, count), selection));
      },
      then(resolve: (value: TestRow[]) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(projectRows(rows, selection)).then(resolve, reject);
      },
    };
    return builder;
  }

  function insert(table: unknown) {
    const name = tableName(table);
    return {
      values(value: TestRow | TestRow[]) {
        const inserted = (Array.isArray(value) ? value : [value]).map((row) =>
          withDefaults(name, row),
        );
        rowsForTable(name).push(...inserted);
        return {
          returning: () => Promise.resolve(inserted),
          then(
            resolve: (value: TestRow[]) => unknown,
            reject?: (error: unknown) => unknown,
          ) {
            return Promise.resolve(inserted).then(resolve, reject);
          },
        };
      },
    };
  }

  function update(table: unknown) {
    const rows = rowsForTable(tableName(table));
    let patch: TestRow = {};
    return {
      set(value: TestRow) {
        patch = value;
        return this;
      },
      where(where: unknown) {
        for (const row of rows) {
          if (matches(row, where)) Object.assign(row, patch);
        }
        return Promise.resolve();
      },
    };
  }

  const db: TestDb = {
    select,
    insert,
    update,
    transaction: async (
      callback: (tx: TestDb) => Promise<unknown>,
    ): Promise<unknown> =>
      callback(db),
  };

  function reset() {
    state.workspaces = [{ id: 1 }];
    state.items = [
      {
        id: 101,
        workspaceId: 1,
        originalRowIndex: 4,
        sortOrder: 0,
        productName: "Ống PVC D50",
        specText: "D50",
        unit: "m",
        vendorHint: null,
        originHint: null,
        originalDataJson: {},
      },
    ];
    state.jobs = [];
    state.runs = [];
    state.nextRunId = 1;
  }

  function addCompletedRun(overrides: TestRow = {}) {
    const run = withDefaults("material_profile_search_runs", {
      status: "completed",
      isCurrent: true,
      mode: "ai",
      webLinksStatus: "done",
      aiSearchStatus: "done",
      ...overrides,
    });
    state.runs.push(run);
    return run;
  }

  reset();
  return { db, state, reset, addCompletedRun };
});

vi.mock("~/server/db", () => ({
  db: dbMock.db,
}));

vi.mock("~/server/services/job-scheduler", () => ({
  abortMaterialProfileSearchJob: vi.fn(),
}));

vi.mock("~/server/services/enrich-profile-row-search", () => ({
  searchProfileRowWebLinks: vi.fn(),
  extractProfileRowAiCandidates: vi.fn(),
}));

import {
  extractProfileRowAiCandidates,
  searchProfileRowWebLinks,
} from "~/server/services/enrich-profile-row-search";
import { abortMaterialProfileSearchJob } from "~/server/services/job-scheduler";
import {
  cancelMaterialProfileSearchJob,
  completeMaterialProfileSearchJob,
  listMaterialProfileSearchRuns,
  processMaterialProfileSearchJob,
  setCurrentMaterialProfileSearchRun,
  startMaterialProfileSearchJob,
} from "~/server/services/material-profile-search-jobs";

const webLink: WebLinkResult = {
  title: "Ống PVC D50",
  url: "https://example.com/pvc-d50",
  domain: "example.com",
  snippet: "Ống PVC D50 chính hãng",
  query: "Ống PVC D50",
  rankScore: 0.91,
};

const aiCandidate: AiSearchStoredResult = {
  fields: {
    unit: "m",
    specText: "D50",
  },
  sourceUrls: [webLink.url],
  evidence: [],
  title: webLink.title,
  url: webLink.url,
  snippet: webLink.snippet,
  rankScore: 0.88,
};

async function startAndProcess(mode: "web" | "ai") {
  const job = await startMaterialProfileSearchJob({
    workspaceId: 1,
    itemIds: [101],
    mode,
  });

  await processMaterialProfileSearchJob(job.id);
  await completeMaterialProfileSearchJob(job.id);
  const runs = await listMaterialProfileSearchRuns({
    workspaceId: 1,
    jobId: job.id,
  });

  return { job, runs };
}

describe("material profile search jobs", () => {
  beforeEach(() => {
    dbMock.reset();
    vi.mocked(searchProfileRowWebLinks).mockReset();
    vi.mocked(extractProfileRowAiCandidates).mockReset();
    vi.mocked(abortMaterialProfileSearchJob).mockReset();

    vi.mocked(searchProfileRowWebLinks).mockResolvedValue({
      webLinkResults: [webLink],
      queries: ["Ống PVC D50"],
      warnings: [],
    });
    vi.mocked(extractProfileRowAiCandidates).mockResolvedValue({
      aiSearchCandidates: [aiCandidate],
      recommendedCandidateKey: "ai:0",
      warnings: [],
    });
  });

  it("stores web links only for web jobs", async () => {
    const { runs } = await startAndProcess("web");

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      mode: "web",
      status: "completed",
      isCurrent: true,
      webLinksStatus: "done",
      aiSearchStatus: "idle",
    });
    expect(runs[0]?.webLinkResults).toEqual([webLink]);
    expect(runs[0]?.aiSearchCandidates).toEqual([]);
    expect(extractProfileRowAiCandidates).not.toHaveBeenCalled();
  });

  it("auto-runs web first for AI jobs without current web links", async () => {
    const { runs } = await startAndProcess("ai");

    expect(searchProfileRowWebLinks).toHaveBeenCalledTimes(1);
    expect(extractProfileRowAiCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ống PVC D50" }),
      [webLink],
      undefined,
    );
    expect(runs[0]).toMatchObject({
      mode: "ai",
      status: "completed",
      webLinksStatus: "done",
      aiSearchStatus: "done",
      recommendedCandidateKey: "ai:0",
    });
    expect(runs[0]?.webLinkResults).toEqual([webLink]);
    expect(runs[0]?.aiSearchCandidates).toMatchObject([
      {
        fields: {
          specText: "D50",
          unit: "m",
        },
        sourceUrls: [webLink.url],
        url: webLink.url,
      },
    ]);
  });

  it("keeps web links and marks AI partial when the AI provider fails", async () => {
    vi.mocked(extractProfileRowAiCandidates).mockRejectedValueOnce(
      new Error("Thiếu cấu hình AI."),
    );

    const { runs } = await startAndProcess("ai");

    expect(runs[0]).toMatchObject({
      status: "partial",
      isCurrent: true,
      webLinksStatus: "done",
      aiSearchStatus: "error",
      errorMessage: "Thiếu cấu hình AI.",
    });
    expect(runs[0]?.webLinkResults).toEqual([webLink]);
    expect(runs[0]?.aiSearchCandidates).toEqual([]);
    expect(runs[0]?.warnings).toContain("Thiếu cấu hình AI.");
  });

  it("sanitizes stored AI candidate text before persisting JSON", async () => {
    vi.mocked(extractProfileRowAiCandidates).mockResolvedValueOnce({
      aiSearchCandidates: [
        {
          ...aiCandidate,
          fields: {
            specText: "D50\u0000binary",
            unit: "m",
          },
          snippet: "Thông số\u0000PDF\u0007",
        },
      ],
      recommendedCandidateKey: "ai:0",
      warnings: ["Cảnh báo\u0000ẩn"],
    });

    const { runs } = await startAndProcess("ai");
    const serialized = JSON.stringify(runs[0]?.aiSearchCandidates);

    expect(serialized.includes("\u0000")).toBe(false);
    expect(serialized.includes("\u0007")).toBe(false);
    expect(runs[0]?.aiSearchCandidates[0]?.snippet).toBe("Thông sốPDF ");
    expect(runs[0]?.aiSearchCandidates[0]?.fields.specText).toBe("D50binary");
    expect(runs[0]?.warnings).toEqual(["Cảnh báoẩn"]);
  });

  it("makes a rerun web result current and hides stale AI candidates", async () => {
    const oldRun = dbMock.addCompletedRun({
      id: 50,
      itemId: 101,
      webLinkResultsJson: [{ ...webLink, url: "https://old.example.com" }],
      aiSearchCandidatesJson: [aiCandidate],
      recommendedCandidateKey: "ai:0",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const { runs } = await startAndProcess("web");
    const newRun = runs.find((run) => run.id !== oldRun.id);

    expect(newRun).toMatchObject({
      mode: "web",
      isCurrent: true,
      aiSearchStatus: "idle",
    });
    expect(newRun?.aiSearchCandidates).toEqual([]);
    expect(dbMock.state.runs.find((run) => run.id === oldRun.id)?.isCurrent).toBe(
      false,
    );
  });

  it("can restore an older finished run as current", async () => {
    const oldRun = dbMock.addCompletedRun({
      id: 60,
      itemId: 101,
      webLinkResultsJson: [{ ...webLink, url: "https://old.example.com" }],
      aiSearchCandidatesJson: [aiCandidate],
      recommendedCandidateKey: "ai:0",
    });
    await startAndProcess("web");

    const restored = await setCurrentMaterialProfileSearchRun(Number(oldRun.id));

    expect(restored).toMatchObject({
      id: 60,
      isCurrent: true,
      aiSearchStatus: "done",
    });
    expect(restored.aiSearchCandidates).toMatchObject([
      {
        fields: {
          specText: "D50",
          unit: "m",
        },
        sourceUrls: [webLink.url],
        url: webLink.url,
      },
    ]);
    const currentRuns = dbMock.state.runs.filter((run) => run.isCurrent);
    expect(currentRuns).toHaveLength(1);
    expect(currentRuns[0]?.id).toBe(60);
  });

  it("cancels pending runs without replacing the previous current run", async () => {
    const oldRun = dbMock.addCompletedRun({
      id: 70,
      itemId: 101,
      webLinkResultsJson: [webLink],
      aiSearchCandidatesJson: [aiCandidate],
    });
    const job = await startMaterialProfileSearchJob({
      workspaceId: 1,
      itemIds: [101],
      mode: "ai",
    });

    const cancelled = await cancelMaterialProfileSearchJob(job.id);
    const jobRun = dbMock.state.runs.find((run) => run.jobId === job.id);

    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(jobRun).toMatchObject({
      status: "cancelled",
      isCurrent: false,
      errorMessage: "Đã hủy.",
    });
    expect(dbMock.state.runs.find((run) => run.id === oldRun.id)?.isCurrent).toBe(
      true,
    );
    expect(abortMaterialProfileSearchJob).toHaveBeenCalledWith(job.id);
  });
});

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { type RouterOutputs, api } from "~/trpc/react";

type WorkspaceSummary = RouterOutputs["excelWorkspace"]["listWorkspaces"][number];
type WorkspaceStatus = WorkspaceSummary["status"];
type WorkspaceStatusFilter = "all" | WorkspaceStatus;
type WorkspaceViewFilter = "all" | "active" | "ready_to_export" | "archived";
type WorkspaceSort = "updated_desc" | "progress_desc" | "open_desc" | "name_asc";
type BadgeTone = "neutral" | "success" | "warning" | "critical" | "info";
type StatTone = "neutral" | "warning" | "success" | "info";

const statusLabels: Record<WorkspaceStatus, string> = {
  draft: "Bản nháp",
  imported: "Đã nhập tệp",
  mapped: "Đã ghép cột",
  reviewed: "Đã duyệt dòng",
  matched: "Đã chọn sản phẩm",
  exported: "Đã xuất tệp",
  catalog_generated: "Đã tạo danh mục",
  checked: "Đã kiểm tra",
  approved: "Đã duyệt cuối",
};

const statusTone: Record<WorkspaceStatus, BadgeTone> = {
  draft: "neutral",
  imported: "info",
  mapped: "info",
  reviewed: "warning",
  matched: "success",
  exported: "success",
  catalog_generated: "warning",
  checked: "warning",
  approved: "success",
};

const statusFilterOptions: Array<{
  value: WorkspaceStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "draft", label: statusLabels.draft },
  { value: "imported", label: statusLabels.imported },
  { value: "mapped", label: statusLabels.mapped },
  { value: "reviewed", label: statusLabels.reviewed },
  { value: "matched", label: statusLabels.matched },
  { value: "exported", label: statusLabels.exported },
  { value: "catalog_generated", label: statusLabels.catalog_generated },
  { value: "checked", label: statusLabels.checked },
  { value: "approved", label: statusLabels.approved },
];

const viewLabels: Record<WorkspaceViewFilter, string> = {
  all: "Tất cả",
  active: "Đang xử lý",
  ready_to_export: "Sẵn sàng xuất",
  archived: "Đã khóa",
};

const sortLabels: Record<WorkspaceSort, string> = {
  updated_desc: "Mới cập nhật",
  progress_desc: "Tiến độ cao nhất",
  open_desc: "Còn nhiều dòng mở",
  name_asc: "Tên A-Z",
};

const nextStepLabels: Record<WorkspaceSummary["routeMeta"]["nextStep"], string> = {
  import: "Tải tệp Excel",
  map: "Ghép cột dữ liệu",
  review: "Duyệt và sửa dòng",
  find: "Tìm và chọn sản phẩm",
  export: "Xuất tệp đã bổ sung",
};

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statTileToneClass: Record<StatTone, string> = {
  neutral: "border-slate-200 bg-slate-50",
  warning: "border-amber-200 bg-amber-50",
  success: "border-emerald-200 bg-emerald-50",
  info: "border-sky-200 bg-sky-50",
};

function displayWorkspaceName(name: string) {
  return name === "Product sourcing workspace"
    ? "Không gian tìm nguồn sản phẩm"
    : name;
}

function buildSuggestedWorkspaceName(count: number) {
  return `Không gian tìm nguồn sản phẩm ${String(count).padStart(2, "0")}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Chưa có thời điểm";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Thời điểm không hợp lệ";
  }

  return dateTimeFormatter.format(parsedDate);
}

function isArchivedWorkspace(workspace: WorkspaceSummary) {
  return workspace.status === "exported" || workspace.status === "approved";
}

function isReadyToExport(workspace: WorkspaceSummary) {
  return workspace.routeMeta.nextStep === "export" && !isArchivedWorkspace(workspace);
}

function getCompletionPercent(workspace: WorkspaceSummary) {
  if (workspace.routeMeta.importedItemCount > 0) {
    return Math.round(
      (workspace.routeMeta.matchedItemCount /
        workspace.routeMeta.importedItemCount) *
        100,
    );
  }

  switch (workspace.routeMeta.nextStep) {
    case "import":
      return 0;
    case "map":
      return 24;
    case "review":
      return 48;
    case "find":
      return 72;
    case "export":
      return 100;
  }
}

function getWorkspaceSummary(workspace: WorkspaceSummary) {
  if (workspace.status === "approved") {
    return "Đã duyệt cuối và khóa chỉnh sửa";
  }

  if (workspace.status === "exported") {
    return workspace.exportFileName
      ? `Đã xuất ${workspace.exportFileName}`
      : "Đã xuất tệp bổ sung";
  }

  if (!workspace.sourceFileName) {
    return "Chưa tải workbook nguồn";
  }

  if (workspace.routeMeta.importedItemCount === 0) {
    return "Đã có tệp, đang chờ ghép cột và nhập dòng";
  }

  if (workspace.routeMeta.openItemCount > 0) {
    return `${workspace.routeMeta.openItemCount.toLocaleString(
      "vi-VN",
    )} dòng còn cần chọn nguồn hoặc nhập tay`;
  }

  return "Tất cả dòng đã khớp, có thể xuất tệp";
}

function matchesViewFilter(
  workspace: WorkspaceSummary,
  activeFilter: WorkspaceViewFilter,
) {
  switch (activeFilter) {
    case "all":
      return true;
    case "active":
      return !isArchivedWorkspace(workspace);
    case "ready_to_export":
      return isReadyToExport(workspace);
    case "archived":
      return isArchivedWorkspace(workspace);
  }
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: StatTone;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${statTileToneClass[tone]}`}>
      <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-950">
        {value.toLocaleString("vi-VN")}
      </p>
    </div>
  );
}

export function ExcelWorkspaceListClient() {
  const router = useRouter();
  const [workspaces] = api.excelWorkspace.listWorkspaces.useSuspenseQuery();
  const [name, setName] = useState(() =>
    buildSuggestedWorkspaceName(workspaces.length + 1),
  );
  const [keyword, setKeyword] = useState("");
  const [activeViewFilter, setActiveViewFilter] =
    useState<WorkspaceViewFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<WorkspaceStatusFilter>("all");
  const [sortBy, setSortBy] = useState<WorkspaceSort>("updated_desc");
  const deferredKeyword = useDeferredValue(keyword);
  const utils = api.useUtils();

  const createWorkspace = api.excelWorkspace.createWorkspace.useMutation({
    onSuccess: async (workspace) => {
      setName(buildSuggestedWorkspaceName(workspaces.length + 2));
      await utils.excelWorkspace.listWorkspaces.invalidate();
      router.push(`/excel-workspace/${workspace.id}?step=import`);
    },
  });

  const deleteWorkspace = api.excelWorkspace.deleteWorkspace.useMutation({
    onSuccess: async () => {
      await utils.excelWorkspace.listWorkspaces.invalidate();
    },
  });

  const metrics = useMemo(
    () => ({
      total: workspaces.length,
      active: workspaces.filter((workspace) => !isArchivedWorkspace(workspace))
        .length,
      readyToExport: workspaces.filter(isReadyToExport).length,
      archived: workspaces.filter(isArchivedWorkspace).length,
    }),
    [workspaces],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<WorkspaceStatusFilter, number> = {
      all: workspaces.length,
      draft: 0,
      imported: 0,
      mapped: 0,
      reviewed: 0,
      matched: 0,
      exported: 0,
      catalog_generated: 0,
      checked: 0,
      approved: 0,
    };

    for (const workspace of workspaces) {
      counts[workspace.status] += 1;
    }

    return counts;
  }, [workspaces]);

  const viewCounts = useMemo(
    () => ({
      all: workspaces.length,
      active: workspaces.filter((workspace) =>
        matchesViewFilter(workspace, "active"),
      ).length,
      ready_to_export: workspaces.filter((workspace) =>
        matchesViewFilter(workspace, "ready_to_export"),
      ).length,
      archived: workspaces.filter((workspace) =>
        matchesViewFilter(workspace, "archived"),
      ).length,
    }),
    [workspaces],
  );

  const filteredWorkspaces = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLocaleLowerCase("vi-VN");

    const filtered = workspaces.filter((workspace) => {
      if (!matchesViewFilter(workspace, activeViewFilter)) {
        return false;
      }

      if (statusFilter !== "all" && workspace.status !== statusFilter) {
        return false;
      }

      if (!normalizedKeyword) {
        return true;
      }

      const searchableText = [
        workspace.id,
        displayWorkspaceName(workspace.name),
        statusLabels[workspace.status],
        workspace.sourceFileName,
        workspace.sourceSheetName,
        workspace.exportFileName,
        nextStepLabels[workspace.routeMeta.nextStep],
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("vi-VN");

      return searchableText.includes(normalizedKeyword);
    });

    return filtered.sort((left, right) => {
      if (sortBy === "name_asc") {
        return displayWorkspaceName(left.name).localeCompare(
          displayWorkspaceName(right.name),
          "vi",
        );
      }

      if (sortBy === "progress_desc") {
        return (
          getCompletionPercent(right) - getCompletionPercent(left) ||
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      }

      if (sortBy === "open_desc") {
        return (
          right.routeMeta.openItemCount - left.routeMeta.openItemCount ||
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [activeViewFilter, deferredKeyword, sortBy, statusFilter, workspaces]);

  const createDisabled = !name.trim() || createWorkspace.isPending;

  const handleCreateWorkspace = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    createWorkspace.mutate({ name: trimmedName });
  };

  const handleDeleteWorkspace = (workspace: WorkspaceSummary) => {
    const readableName = displayWorkspaceName(workspace.name);
    const shouldDelete = window.confirm(
      `Xóa "${readableName}" khỏi danh sách? Dữ liệu đã nhập và các lựa chọn khớp sẽ bị mất.`,
    );

    if (!shouldDelete) {
      return;
    }

    deleteWorkspace.mutate({ id: workspace.id });
  };

  return (
    <div className="space-y-3">
      <section className="panel p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <label
              htmlFor="excel-workspace-name"
              className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase"
            >
              Tạo workspace mới
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="excel-workspace-name"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !createDisabled) {
                    handleCreateWorkspace();
                  }
                }}
                placeholder="Tên workspace"
                aria-label="Tên không gian Excel mới"
              />
              <Button
                variant="primary"
                size="md"
                isLoading={createWorkspace.isPending}
                disabled={createDisabled}
                onClick={handleCreateWorkspace}
              >
                {createWorkspace.isPending ? "Đang tạo..." : "Tạo workspace"}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Hệ thống sẽ mở bước nhập tệp ngay sau khi tạo. Pipeline: nhập tệp →
              ghép cột → duyệt dòng → chọn nguồn → xuất tệp.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[28rem]">
            <StatTile label="Tổng" value={metrics.total} tone="neutral" />
            <StatTile
              label="Đang xử lý"
              value={metrics.active}
              tone="warning"
            />
            <StatTile
              label="Sẵn sàng xuất"
              value={metrics.readyToExport}
              tone="success"
            />
            <StatTile label="Đã khóa" value={metrics.archived} tone="info" />
          </div>
        </div>
      </section>

      <section className="panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            placeholder="Tìm theo tên, tệp nguồn, sheet hoặc bước tiếp theo"
            aria-label="Tìm không gian Excel"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            value={statusFilter}
            aria-label="Lọc không gian Excel theo trạng thái"
            onChange={(event) =>
              setStatusFilter(event.target.value as WorkspaceStatusFilter)
            }
          >
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({statusCounts[option.value]})
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            value={sortBy}
            aria-label="Sắp xếp danh sách workspace"
            onChange={(event) => setSortBy(event.target.value as WorkspaceSort)}
          >
            {(Object.keys(sortLabels) as WorkspaceSort[]).map((option) => (
              <option key={option} value={option}>
                {sortLabels[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {(Object.keys(viewLabels) as WorkspaceViewFilter[]).map((filterKey) => (
            <button
              key={filterKey}
              type="button"
              onClick={() => setActiveViewFilter(filterKey)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeViewFilter === filterKey
                  ? "border-sky-700 bg-sky-700 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>{viewLabels[filterKey]}</span>
              <span
                className={`rounded-full px-1 text-[11px] tabular-nums ${
                  activeViewFilter === filterKey
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {viewCounts[filterKey]}
              </span>
            </button>
          ))}
          <span className="ml-auto text-xs text-slate-500 tabular-nums">
            {filteredWorkspaces.length.toLocaleString("vi-VN")} /{" "}
            {metrics.total.toLocaleString("vi-VN")} workspace
          </span>
        </div>
      </section>

      {filteredWorkspaces.length === 0 ? (
        <EmptyState
          title="Không có workspace phù hợp bộ lọc"
          description="Thử đổi trạng thái, xóa từ khóa tìm kiếm, hoặc tạo một workspace mới ở phần trên."
          className="border-slate-300 bg-slate-50/90"
        />
      ) : (
        <ul className="space-y-2">
          {filteredWorkspaces.map((workspace) => {
            const completionPercent = getCompletionPercent(workspace);
            const canDelete =
              workspace.status !== "exported" && workspace.status !== "approved";
            const workspaceHref = `/excel-workspace/${workspace.id}?step=${workspace.routeMeta.nextStep}`;

            return (
              <li
                key={workspace.id}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-sky-300 hover:shadow"
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone[workspace.status]}>
                        {statusLabels[workspace.status]}
                      </Badge>
                      {isReadyToExport(workspace) ? (
                        <Badge tone="success">Có thể xuất</Badge>
                      ) : null}
                      <Link
                        href={workspaceHref}
                        className="text-base font-bold text-slate-950 transition hover:text-sky-700"
                      >
                        {displayWorkspaceName(workspace.name)}
                      </Link>
                      <span className="text-xs text-slate-400 tabular-nums">
                        #{workspace.id}
                      </span>
                    </div>

                    <p className="mt-1 text-sm text-slate-600">
                      {getWorkspaceSummary(workspace)}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>
                        <span className="text-slate-400">Tệp:</span>{" "}
                        <span className="text-slate-700">
                          {workspace.sourceFileName ?? "Chưa tải"}
                        </span>
                      </span>
                      <span>
                        <span className="text-slate-400">Sheet:</span>{" "}
                        <span className="text-slate-700">
                          {workspace.sourceSheetName ?? "Chưa chọn"}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        <span className="text-slate-400">Khớp:</span>{" "}
                        <span className="text-slate-700">
                          {workspace.routeMeta.matchedItemCount.toLocaleString(
                            "vi-VN",
                          )}
                          /
                          {workspace.routeMeta.importedItemCount.toLocaleString(
                            "vi-VN",
                          )}
                        </span>
                      </span>
                      {workspace.routeMeta.openItemCount > 0 ? (
                        <span className="font-semibold text-amber-700 tabular-nums">
                          {workspace.routeMeta.openItemCount.toLocaleString(
                            "vi-VN",
                          )}{" "}
                          dòng mở
                        </span>
                      ) : null}
                      <span>
                        <span className="text-slate-400">Cập nhật:</span>{" "}
                        <span className="text-slate-700">
                          {formatDateTime(workspace.updatedAt)}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                    <div className="w-full sm:w-44">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate text-slate-500">
                          {nextStepLabels[workspace.routeMeta.nextStep]}
                        </span>
                        <span className="ml-2 font-bold tabular-nums text-slate-700">
                          {completionPercent}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-teal-500 via-sky-500 to-cyan-500 transition-[width]"
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex gap-1.5">
                      <Link
                        href={workspaceHref}
                        className="inline-flex items-center justify-center rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                      >
                        Mở workspace
                      </Link>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canDelete || deleteWorkspace.isPending}
                        onClick={() => handleDeleteWorkspace(workspace)}
                        aria-label={`Xóa ${displayWorkspaceName(workspace.name)}`}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

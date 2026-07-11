"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Search } from "lucide-react";

import { Badge, Button, EmptyState, PageSkeleton } from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type BatchData = RouterOutputs["materialProfile"]["getMaterialSaveBatch"];
type BatchRow = BatchData["rows"][number];
type Target = BatchData["targets"][number];

const DIFF_FIELDS = [
  ["name", "Tên vật tư"],
  ["code", "Mã vật tư"],
  ["unit", "ĐVT"],
  ["category", "Nhóm"],
  ["specText", "Thông số"],
  ["manufacturer", "Nhà sản xuất"],
  ["originCountry", "Xuất xứ"],
  ["defaultUnitPrice", "Đơn giá"],
  ["currency", "Tiền tệ"],
  ["sourceUrl", "URL nguồn"],
  ["imageUrl", "Ảnh sản phẩm"],
  ["catalogPdfUrls", "Catalog PDF"],
] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function catalogUrlsFromSnapshot(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const sourceUrl = record(record(entry).document).sourceUrl;
    return typeof sourceUrl === "string" && sourceUrl.trim() ? [sourceUrl] : [];
  });
}

function display(value: unknown) {
  if (Array.isArray(value)) return value.join("\n");
  if (value == null || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("vi-VN");
  if (typeof value === "string" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function actionLabel(action: string) {
  if (action === "create") return "Tạo mới";
  if (action === "update") return "Ghi đè";
  if (action === "link_only") return "Chỉ liên kết";
  if (action === "excluded") return "Đã loại";
  return "Bị chặn";
}

function batchStatusLabel(status: string) {
  if (status === "draft") return "Bản nháp";
  if (status === "queued") return "Đang chờ";
  if (status === "running") return "Đang lưu";
  if (status === "completed") return "Hoàn tất";
  if (status === "partial") return "Một phần";
  if (status === "failed") return "Thất bại";
  if (status === "cancelled") return "Đã hủy";
  if (status === "undone") return "Đã hoàn tác";
  if (status === "expired") return "Hết hạn";
  return status;
}

function targetMethodLabel(method: string | null) {
  if (method === "linked") return "Đã liên kết";
  if (method === "exact_code") return "Trùng mã";
  if (method === "fuzzy") return "Khớp gần đúng";
  if (method === "fuzzy_ambiguous") return "Khớp mơ hồ";
  if (method === "manual") return "Chọn thủ công";
  if (method === "create") return "Tạo mới";
  return "—";
}

function actionTone(
  action: string,
): "success" | "info" | "warning" | "critical" | "neutral" {
  if (action === "create") return "success";
  if (action === "update" || action === "link_only") return "info";
  if (action === "blocked") return "critical";
  if (action === "excluded") return "neutral";
  return "warning";
}

function MaterialTargetPicker({
  row,
  target,
  disabled,
  onChange,
}: {
  row: BatchRow;
  target: Target | null;
  disabled: boolean;
  onChange: (targetMaterialId: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const results = api.material.searchMaterials.useQuery(
    { keyword: query, limit: 8, offset: 0 },
    { enabled: query.trim().length >= 2 },
  );
  return (
    <div className="grid min-w-60 gap-1">
      <p className="text-ink-1 text-xs font-semibold">
        {target ? `${target.code ?? "—"} · ${target.name}` : "Tạo vật tư mới"}
      </p>
      <label className="relative block">
        <span className="sr-only">
          Tìm vật tư đích cho dòng {row.originalRowIndex}
        </span>
        <Search
          className="text-ink-3 pointer-events-none absolute top-2.5 left-2"
          aria-hidden
        />
        <input
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm mã hoặc tên vật tư…"
          className="border-line bg-surface-1 focus-visible:ring-ring min-h-10 w-full rounded border py-1 pr-2 pl-8 text-xs focus-visible:ring-2 focus-visible:outline-none"
        />
      </label>
      {query.trim().length >= 2 ? (
        <div className="border-line bg-surface-1 max-h-44 overflow-auto rounded border p-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="hover:bg-surface-2 focus-visible:ring-ring min-h-10 w-full rounded px-2 text-left text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Tạo vật tư mới
          </button>
          {(results.data ?? []).map((material) => (
            <button
              key={material.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(material.id);
                setQuery("");
              }}
              className="hover:bg-surface-2 focus-visible:ring-ring min-h-10 w-full rounded px-2 text-left text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="font-semibold">{material.code ?? "—"}</span> ·{" "}
              {material.name}
            </button>
          ))}
          {results.isLoading ? (
            <p className="text-ink-3 p-2 text-xs">Đang tìm…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MaterialProfileBulkSavePreview({
  workspaceId,
  batchId,
}: {
  workspaceId: number;
  batchId: string;
}) {
  const toast = useToast();
  const utils = api.useUtils();
  const [filter, setFilter] = useState("all");
  const batchQuery = api.materialProfile.getMaterialSaveBatch.useQuery(
    {
      workspaceId,
      batchId,
    },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.batch.status;
        return status === "queued" || status === "running" ? 1_000 : false;
      },
      refetchOnWindowFocus: true,
    },
  );
  const updateRow =
    api.materialProfile.updateMaterialSavePreviewRow.useMutation({
      onSuccess: (data) =>
        utils.materialProfile.getMaterialSaveBatch.setData(
          { workspaceId, batchId },
          data,
        ),
      onError: (error) =>
        toast.error(error.message || "Không cập nhật được dòng."),
    });
  const commit = api.materialProfile.commitMaterialSaveBatch.useMutation({
    onSuccess: (result) => {
      void batchQuery.refetch();
      void utils.materialProfile.listMaterialSaveBatches.invalidate({
        workspaceId,
      });
      void utils.materialProfile.get.invalidate({ workspaceId });
      void utils.material.searchMaterials.invalidate();
      if (result.status === "completed") {
        toast.success("Đã hoàn tất lưu đợt này vào /materials.");
      } else {
        toast.warning(result.message ?? "Đợt lưu chỉ hoàn tất một phần.");
      }
    },
    onError: (error) =>
      toast.error(error.message || "Không xác nhận lưu được đợt này."),
  });
  const cancel = api.materialProfile.cancelMaterialSaveBatch.useMutation({
    onSuccess: () => void batchQuery.refetch(),
  });
  const undo = api.materialProfile.undoMaterialSaveBatch.useMutation({
    onSuccess: (result) => {
      void batchQuery.refetch();
      toast.success(
        result.conflicts.length
          ? `Hoàn tác một phần: ${result.restored} dòng.`
          : `Đã hoàn tác ${result.restored} dòng.`,
      );
    },
    onError: (error) =>
      toast.error(error.message || "Không hoàn tác được đợt lưu."),
  });

  const data = batchQuery.data;
  const targets = useMemo(
    () => new Map((data?.targets ?? []).map((target) => [target.id, target])),
    [data?.targets],
  );
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((row) =>
        filter === "all" ? true : row.action === filter,
      ),
    [data?.rows, filter],
  );

  if (batchQuery.isLoading) return <PageSkeleton />;
  if (batchQuery.error || !data) {
    return (
      <EmptyState
        title="Không tải được bản xem trước"
        description={batchQuery.error?.message ?? "Đợt lưu không còn tồn tại."}
      />
    );
  }
  const { batch } = data;
  const editable = batch.status === "draft";
  const cancellable = ["draft", "queued", "running"].includes(batch.status);
  const includedRows = data.rows.filter(
    (row) =>
      row.included && ["create", "update", "link_only"].includes(row.action),
  );
  const commitCounts = {
    create: includedRows.filter((row) => row.action === "create").length,
    update: includedRows.filter((row) => row.action === "update").length,
    link: includedRows.filter((row) => row.action === "link_only").length,
  };
  const confirmCommit = () => {
    const accepted = window.confirm(
      `Xác nhận lưu: tạo ${commitCounts.create}, ghi đè ${commitCounts.update}, chỉ liên kết ${commitCounts.link} dòng?`,
    );
    if (accepted) commit.mutate({ workspaceId, batchId });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/material-profiles/${workspaceId}`}
            className="text-brand focus-visible:ring-ring inline-flex min-h-10 items-center gap-1 rounded text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeft aria-hidden /> Quay lại hồ sơ
          </Link>
          <p className="text-ink-2 text-sm">
            Đợt <span className="font-mono">{batch.id}</span> ·{" "}
            {batchStatusLabel(batch.status)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cancellable ? (
            <Button
              variant="warning"
              onClick={() => cancel.mutate({ workspaceId, batchId })}
              isLoading={cancel.isPending}
            >
              {editable ? "Hủy bản xem trước" : "Hủy đợt lưu"}
            </Button>
          ) : null}
          {editable ? (
            <Button
              variant="save"
              onClick={confirmCommit}
              isLoading={commit.isPending}
              disabled={
                commitCounts.create +
                  commitCounts.update +
                  commitCounts.link ===
                0
              }
            >
              <Check aria-hidden /> Xác nhận lưu
            </Button>
          ) : (
            !cancellable &&
            (["completed", "partial"].includes(batch.status) ||
            (batch.status === "cancelled" && batch.processed > 0) ? (
              <Button
                variant="warning"
                onClick={() => undo.mutate({ workspaceId, batchId })}
                isLoading={undo.isPending}
              >
                Hoàn tác đợt lưu
              </Button>
            ) : null)
          )}
        </div>
      </div>

      <section className="panel grid gap-3 p-4" aria-live="polite">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[
            ["Tạo mới", batch.createCount],
            ["Ghi đè", batch.updateCount],
            ["Chỉ liên kết", batch.linkOnlyCount],
            ["Đã loại", batch.excludedCount],
            ["Bị chặn", batch.blockedCount],
            ["Lỗi", batch.failed],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-surface-2 rounded p-2">
              <p className="text-ink-3 text-xs">{label}</p>
              <p className="text-ink-1 text-xl font-bold tabular-nums">
                {Number(value)}
              </p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Lọc dòng xem trước">
          {["all", "create", "update", "link_only", "excluded", "blocked"].map(
            (value) => (
              <Button
                key={value}
                variant={filter === value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {value === "all" ? "Tất cả" : actionLabel(value)}
              </Button>
            ),
          )}
        </div>
      </section>

      <div className="border-line bg-surface-1 overflow-x-auto rounded-[var(--radius-panel)] border">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-surface-3 text-ink-1 text-xs font-semibold tracking-wide uppercase">
            <tr>
              <th className="p-2 text-left">Dùng</th>
              <th className="p-2 text-left">Dòng</th>
              <th className="p-2 text-left">Hành động</th>
              <th className="p-2 text-left">Điểm nguồn / đích</th>
              <th className="p-2 text-left">Vật tư đích</th>
              <th className="p-2 text-left">So sánh từng trường</th>
              <th className="p-2 text-left">Cảnh báo</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((row) => {
              const proposal = record(row.proposedMaterialJson);
              const target =
                row.targetMaterialId == null
                  ? null
                  : (targets.get(row.targetMaterialId) ?? null);
              const committed = Boolean(row.postCommitVersion);
              const beforeMaterial = committed
                ? record(row.preCommitMaterialSnapshotJson)
                : target
                  ? (target as Record<string, unknown>)
                  : {};
              const before: Record<string, unknown> = {
                ...beforeMaterial,
                catalogPdfUrls: committed
                  ? catalogUrlsFromSnapshot(row.preCommitCatalogLinksJson)
                  : (target?.catalogPdfUrls ?? []),
              };
              return (
                <tr key={row.id} className="align-top">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={row.included}
                      disabled={
                        !editable ||
                        row.action === "blocked" ||
                        updateRow.isPending
                      }
                      onChange={(event) =>
                        updateRow.mutate({
                          workspaceId,
                          batchId,
                          rowId: row.id,
                          included: event.target.checked,
                        })
                      }
                      aria-label={`Dùng dòng ${row.originalRowIndex}`}
                    />
                  </td>
                  <td className="p-2">
                    <Link
                      href={`/material-profiles/${workspaceId}?row=${row.originalRowIndex}`}
                      className="text-brand font-semibold hover:underline"
                    >
                      {row.originalRowIndex}
                    </Link>
                  </td>
                  <td className="p-2">
                    <Badge tone={actionTone(row.action)}>
                      {actionLabel(row.action)}
                    </Badge>
                  </td>
                  <td className="p-2 tabular-nums">
                    <p>
                      Nguồn:{" "}
                      {typeof proposal.sourceScore === "number"
                        ? `${Math.round(proposal.sourceScore * 100)}%`
                        : "—"}
                    </p>
                    <p>
                      Đích:{" "}
                      {row.targetScore == null
                        ? "—"
                        : `${Math.round(row.targetScore * 100)}%`}
                    </p>
                    <p className="text-ink-3 text-xs">
                      {targetMethodLabel(row.targetMethod)}
                    </p>
                  </td>
                  <td className="p-2">
                    <MaterialTargetPicker
                      row={row}
                      target={target}
                      disabled={!editable || updateRow.isPending}
                      onChange={(targetMaterialId) =>
                        updateRow.mutate({
                          workspaceId,
                          batchId,
                          rowId: row.id,
                          targetMaterialId,
                        })
                      }
                    />
                  </td>
                  <td className="p-2">
                    <div className="grid gap-1">
                      {DIFF_FIELDS.map(([key, label]) => (
                        <div
                          key={key}
                          className="border-line grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b py-1 text-xs"
                        >
                          <span className="text-ink-3 font-semibold">
                            {label}
                          </span>
                          <span className="text-ink-2 break-all whitespace-pre-wrap">
                            {display(before[key])}
                          </span>
                          <span className="text-good break-all whitespace-pre-wrap">
                            {display(proposal[key])}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="p-2">
                    {row.warningsJson.length ? (
                      row.warningsJson.map((warning) => (
                        <p
                          key={warning}
                          className="text-warning flex gap-1 text-xs"
                        >
                          <AlertTriangle aria-hidden /> {warning}
                        </p>
                      ))
                    ) : (
                      <span className="text-good text-xs">
                        Không có cảnh báo
                      </span>
                    )}
                    {typeof record(row.errorJson).message === "string" ? (
                      <p className="text-critical mt-1 text-xs">
                        {String(record(row.errorJson).message)}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

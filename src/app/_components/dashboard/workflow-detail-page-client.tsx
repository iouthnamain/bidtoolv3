"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Button, EmptyState } from "~/app/_components/ui";
import { normalizeWorkflowFilterConfig } from "~/lib/workflow-config";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkflowDetail = NonNullable<RouterOutputs["workflow"]["getById"]>;
type RunStatus = "success" | "failed" | "running" | null;

function formatDateTime(value: string | null) {
  if (!value) {
    return "Chưa có";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("vi-VN");
}

function parseCsvList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(values: string[]) {
  return values.join(", ");
}

function toRunTone(
  status: RunStatus,
): "success" | "critical" | "warning" | "neutral" {
  if (status === "success") {
    return "success";
  }
  if (status === "failed") {
    return "critical";
  }
  if (status === "running") {
    return "warning";
  }
  return "neutral";
}

export function WorkflowDetailPageClient({
  workflowId,
  initialWorkflow,
}: {
  workflowId: number;
  initialWorkflow: WorkflowDetail;
}) {
  const workflowQuery = api.workflow.getById.useQuery(
    { id: workflowId },
    { initialData: initialWorkflow },
  );
  const runsQuery = api.workflow.getRuns.useQuery({ workflowId });
  const utils = api.useUtils();
  const workflow = workflowQuery.data;
  const initialFilterConfig = normalizeWorkflowFilterConfig(
    initialWorkflow.triggerConfig,
  );

  const [name, setName] = useState(initialWorkflow.name);
  const [triggerType, setTriggerType] = useState(initialWorkflow.triggerType);
  const [isActive, setIsActive] = useState(initialWorkflow.isActive);
  const [keyword, setKeyword] = useState(initialFilterConfig.keyword);
  const [provinces, setProvinces] = useState(
    joinList(initialFilterConfig.provinces),
  );
  const [categories, setCategories] = useState(
    joinList(initialFilterConfig.categories),
  );
  const [budgetMin, setBudgetMin] = useState(
    initialFilterConfig.budgetMin?.toString() ?? "",
  );
  const [budgetMax, setBudgetMax] = useState(
    initialFilterConfig.budgetMax?.toString() ?? "",
  );

  useEffect(() => {
    if (!workflow) {
      return;
    }

    const filterConfig = normalizeWorkflowFilterConfig(workflow.triggerConfig);
    setName(workflow.name);
    setTriggerType(workflow.triggerType);
    setIsActive(workflow.isActive);
    setKeyword(filterConfig.keyword);
    setProvinces(joinList(filterConfig.provinces));
    setCategories(joinList(filterConfig.categories));
    setBudgetMin(filterConfig.budgetMin?.toString() ?? "");
    setBudgetMax(filterConfig.budgetMax?.toString() ?? "");
  }, [workflow]);

  const updateWorkflow = api.workflow.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.getById.invalidate({ id: workflowId }),
        utils.workflow.list.invalidate(),
        utils.insight.getWorkflowHealth.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  const toggleWorkflow = api.workflow.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.getById.invalidate({ id: workflowId }),
        utils.workflow.list.invalidate(),
        utils.insight.getWorkflowHealth.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  const runNow = api.workflow.runNow.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.workflow.getById.invalidate({ id: workflowId }),
        utils.workflow.getRuns.invalidate({ workflowId }),
        utils.workflow.list.invalidate(),
        utils.notification.list.invalidate(),
        utils.insight.getWorkflowHealth.invalidate(),
        utils.insight.getDashboardSummary.invalidate(),
      ]);
    },
  });

  if (!workflow) {
    return (
      <EmptyState
        title="Không tìm thấy workflow"
        description="Workflow này có thể đã bị xoá hoặc không còn khả dụng."
      />
    );
  }

  const latestRun = workflow.latestRun;
  const runHistory = runsQuery.data ?? [];
  const filterConfig = normalizeWorkflowFilterConfig(workflow.triggerConfig);

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href="/workflows"
              className="text-xs font-semibold text-slate-700 hover:underline"
            >
              Quay lại danh sách workflow
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-950">{workflow.name}</h2>
              <Badge tone={workflow.isActive ? "success" : "neutral"}>
                {workflow.isActive ? "Hoạt động" : "Tạm dừng"}
              </Badge>
              <Badge tone={toRunTone(latestRun?.status ?? null)}>
                {latestRun?.status === "success"
                  ? "Lần gần nhất thành công"
                  : latestRun?.status === "failed"
                    ? "Lần gần nhất thất bại"
                    : latestRun?.status === "running"
                      ? "Đang chạy"
                      : "Chưa chạy"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Trigger: {workflow.triggerType} • {workflow.runCount} lần chạy
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              isLoading={toggleWorkflow.isPending}
              onClick={() =>
                toggleWorkflow.mutate({
                  id: workflow.id,
                  isActive: !workflow.isActive,
                })
              }
            >
              {workflow.isActive ? "Tạm dừng ngay" : "Kích hoạt ngay"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={runNow.isPending}
              disabled={!workflow.isActive}
              onClick={() => runNow.mutate({ workflowId })}
            >
              Chạy ngay
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Cấu hình hiện tại
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {workflow.triggerSummary.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600"
                >
                  {item}
                </span>
              ))}
            </div>
            {filterConfig.savedFilterName ? (
              <p className="mt-3 text-xs text-slate-500">
                Tạo từ Smart View: {filterConfig.savedFilterName}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Lần chạy gần nhất
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {formatDateTime(latestRun?.startedAt ?? null)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {latestRun?.message ?? "Workflow chưa có lịch sử chạy."}
            </p>
          </div>
        </div>
      </section>

      <section className="panel p-4">
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-sm font-bold">Chỉnh sửa workflow</h3>
          <p className="mt-1 text-xs text-slate-500">
            Giữ workflow ở dạng form đơn giản: tên, trigger, bộ lọc và trạng
            thái kích hoạt.
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">Tên workflow</span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">Loại trigger</span>
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              value={triggerType}
              onChange={(event) =>
                setTriggerType(event.target.value as typeof triggerType)
              }
            >
              <option value="new_package">Gói thầu mới</option>
              <option value="schedule">Theo lịch</option>
            </select>
          </label>

          <label className="grid gap-1.5 text-sm md:col-span-2">
            <span className="font-medium text-slate-700">Từ khóa</span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="ví dụ: thiết bị mạng, vật tư y tế"
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">
              Tỉnh / thành (phân tách dấu phẩy)
            </span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={provinces}
              onChange={(event) => setProvinces(event.target.value)}
              placeholder="Đà Nẵng, Hà Nội"
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">
              Lĩnh vực (phân tách dấu phẩy)
            </span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={categories}
              onChange={(event) => setCategories(event.target.value)}
              placeholder="Y tế, Công nghệ thông tin"
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">Ngân sách từ</span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={budgetMin}
              onChange={(event) => setBudgetMin(event.target.value)}
              type="number"
              min={0}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-slate-700">Ngân sách đến</span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={budgetMax}
              onChange={(event) => setBudgetMax(event.target.value)}
              type="number"
              min={0}
            />
          </label>

          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            <span className="font-medium text-slate-700">
              Giữ workflow ở trạng thái hoạt động sau khi lưu
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            isLoading={updateWorkflow.isPending}
            onClick={() =>
              updateWorkflow.mutate({
                id: workflow.id,
                name: name.trim(),
                triggerType,
                isActive,
                triggerConfig: {
                  savedFilterId: filterConfig.savedFilterId,
                  savedFilterName: filterConfig.savedFilterName,
                  keyword: keyword.trim(),
                  provinces: parseCsvList(provinces),
                  categories: parseCsvList(categories),
                  budgetMin: budgetMin.trim() ? Number(budgetMin) : null,
                  budgetMax: budgetMax.trim() ? Number(budgetMax) : null,
                  notificationFrequency: filterConfig.notificationFrequency,
                },
              })
            }
          >
            Lưu thay đổi
          </Button>
        </div>
      </section>

      <section className="panel p-4">
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-sm font-bold">Lịch sử chạy</h3>
          <p className="mt-1 text-xs text-slate-500">
            Theo dõi thông điệp, thời gian bắt đầu và kết quả cho từng lần chạy.
          </p>
        </div>

        {runsQuery.isLoading ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            Đang tải lịch sử chạy...
          </div>
        ) : runHistory.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="Chưa có lịch sử chạy"
            description="Bấm Chạy ngay để tạo lần chạy đầu tiên và theo dõi log tại đây."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {runHistory.map((run) => (
              <li
                key={run.id}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toRunTone(run.status)}>{run.status}</Badge>
                    <span className="text-sm font-semibold text-slate-900">
                      {formatDateTime(run.startedAt)}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    Kết thúc: {formatDateTime(run.finishedAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{run.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

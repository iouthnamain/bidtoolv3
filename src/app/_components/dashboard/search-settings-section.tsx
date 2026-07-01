"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Globe2,
  KeyRound,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import {
  Badge,
  Button,
  FilterField,
  SkeletonTable,
} from "~/app/_components/ui";
import { useToast } from "~/app/_components/ui/toast";
import { api, type RouterOutputs } from "~/trpc/react";

type SearchConfig = RouterOutputs["searchConfig"]["getConfig"];
type SearchSettingKey = keyof SearchConfig["settings"];
type SearchSetting = SearchConfig["settings"][SearchSettingKey];
type AuditStatus = "success" | "no_results" | "error" | "skipped";
type AuditFeature =
  | "material_enrichment"
  | "excel_research"
  | "interactive"
  | "profile_search"
  | "test";

type FieldDef = {
  key: SearchSettingKey;
  label: string;
  helper: string;
  placeholder?: string;
  multiline?: boolean;
  unit?: string;
};

const CONNECTION_FIELDS: FieldDef[] = [
  {
    key: "searxngBaseUrl",
    label: "SearXNG base URL",
    helper: "URL nội bộ hoặc public endpoint của SearXNG.",
    placeholder: "http://searxng:8080",
  },
  {
    key: "searxngEngines",
    label: "Engines",
    helper: "Danh sách engine gửi vào SearXNG.",
    placeholder: "google,bing,duckduckgo",
  },
  {
    key: "searxngLanguage",
    label: "Ngôn ngữ",
    helper: "Ngôn ngữ tìm kiếm.",
    placeholder: "vi-VN",
  },
  {
    key: "searxngSafeSearch",
    label: "Safe search",
    helper: "0 = tắt, 1 = vừa, 2 = chặt.",
  },
  {
    key: "searxngTimeRange",
    label: "Khoảng thời gian",
    helper: "day, week, month hoặc year. Đặt lại để bỏ lọc thời gian.",
    placeholder: "month",
  },
  {
    key: "searxngRequestTimeoutMs",
    label: "Timeout",
    helper: "Thời gian chờ mỗi request SearXNG.",
    unit: "ms",
  },
  {
    key: "searxngHtmlFallback",
    label: "Fallback HTML",
    helper: "Thử HTML khi JSON API không có kết quả.",
  },
  {
    key: "searchResultLimitPerQuery",
    label: "Kết quả mỗi query",
    helper: "Giới hạn số link giữ lại từ mỗi truy vấn.",
  },
];

const DOMAIN_FIELDS: FieldDef[] = [
  {
    key: "searchBoostDomains",
    label: "Domain ưu tiên",
    helper: "Những domain nhà sản xuất, đại lý hoặc shop vật tư đáng tin.",
    multiline: true,
  },
  {
    key: "searchPenaltyDomains",
    label: "Domain giảm ưu tiên",
    helper:
      "Marketplace hoặc nguồn nhiều nhiễu. Vẫn giữ nếu không có nguồn tốt hơn.",
    multiline: true,
  },
  {
    key: "searchBlockDomains",
    label: "Domain chặn",
    helper: "Loại bỏ hoàn toàn khỏi kết quả.",
    multiline: true,
  },
  {
    key: "searchEnableSiteVnVariants",
    label: "Query site:.vn",
    helper: "Thêm biến thể truy vấn ưu tiên website Việt Nam.",
  },
  {
    key: "searchEnableNegativeMarketplaceVariants",
    label: "Loại marketplace trong query",
    helper: "Thêm -site cho marketplace ở một số truy vấn kỹ thuật/đại lý.",
  },
  {
    key: "searchMaterialJobMaxQueries",
    label: "Query/job vật tư",
    helper: "Số truy vấn tối đa cho material enrichment job.",
  },
  {
    key: "searchInteractiveMaxQueries",
    label: "Query tương tác",
    helper: "Số truy vấn tối đa cho tìm kiếm thủ công/profile.",
  },
  {
    key: "searchExcelResearchMaxQueries",
    label: "Query Excel research",
    helper: "Số truy vấn tối đa cho mỗi dòng Excel cần nghiên cứu web.",
  },
];

const PERFORMANCE_FIELDS: FieldDef[] = [
  {
    key: "enrichmentWebConcurrency",
    label: "Concurrency web",
    helper: "Số truy vấn web chạy song song.",
  },
  {
    key: "enrichmentSearchCacheTtlMs",
    label: "Cache TTL",
    helper: "Thời gian cache kết quả tìm kiếm cùng query.",
    unit: "ms",
  },
  {
    key: "searchAuditRetentionDays",
    label: "Giữ audit",
    helper: "Số ngày giữ log tìm kiếm.",
    unit: "ngày",
  },
];

function sourceLabel(source: "env" | "database" | "none") {
  if (source === "env") return "Biến môi trường";
  if (source === "database") return "Database";
  return "Mặc định";
}

function sourceTone(source: "env" | "database" | "none") {
  if (source === "env") return "warning" as const;
  if (source === "database") return "success" as const;
  return "neutral" as const;
}

function displayValue(entry: SearchSetting | undefined, unit?: string) {
  const value = entry?.value;
  if (!value) return "Chưa cấu hình";
  return unit ? `${value} ${unit}` : value;
}

function formatListForTextarea(value: string | null | undefined) {
  return (value ?? "").split(",").filter(Boolean).join("\n");
}

export function SearchSettingsSection() {
  const { error, success } = useToast();
  const utils = api.useUtils();
  const [auditStatus, setAuditStatus] = useState<AuditStatus | "all">("all");
  const [auditFeature, setAuditFeature] = useState<AuditFeature | "all">("all");
  const { data: config, isLoading } = api.searchConfig.getConfig.useQuery();
  const { data: summary } = api.searchConfig.getSearchAuditSummary.useQuery();
  const { data: logs, isLoading: logsLoading } =
    api.searchConfig.listSearchAuditLogs.useQuery({
      limit: 25,
      status: auditStatus === "all" ? undefined : auditStatus,
      feature: auditFeature === "all" ? undefined : auditFeature,
    });

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState(
    "Ống nhựa Bình Minh D90 thông số kỹ thuật",
  );

  const allFields = useMemo(
    () => [...CONNECTION_FIELDS, ...DOMAIN_FIELDS, ...PERFORMANCE_FIELDS],
    [],
  );

  useEffect(() => {
    if (!config) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const field of allFields) {
        const value = config.settings[field.key]?.value ?? "";
        next[field.key] ??= field.multiline
          ? formatListForTextarea(value)
          : value;
      }
      return next;
    });
  }, [allFields, config]);

  const invalidate = async () => {
    await Promise.all([
      utils.searchConfig.getConfig.invalidate(),
      utils.searchConfig.getSearchAuditSummary.invalidate(),
      utils.searchConfig.listSearchAuditLogs.invalidate(),
    ]);
  };

  const setMutation = api.searchConfig.setSetting.useMutation({
    onSuccess: async () => {
      await invalidate();
      success("Đã lưu cấu hình tìm kiếm.");
      setActiveKey(null);
    },
    onError: (mutationError) => {
      error(mutationError.message);
      setActiveKey(null);
    },
  });

  const resetMutation = api.searchConfig.resetSetting.useMutation({
    onSuccess: async (nextConfig) => {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const field of allFields) {
          const value = nextConfig.settings[field.key]?.value ?? "";
          next[field.key] = field.multiline
            ? formatListForTextarea(value)
            : value;
        }
        return next;
      });
      await invalidate();
      success("Đã đặt lại mặc định.");
      setActiveKey(null);
    },
    onError: (mutationError) => {
      error(mutationError.message);
      setActiveKey(null);
    },
  });

  const saveKeyMutation = api.searchConfig.setSearxngApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await invalidate();
      success("Đã lưu token SearXNG.");
    },
    onError: (mutationError) => error(mutationError.message),
  });

  const clearKeyMutation = api.searchConfig.clearSearxngApiKey.useMutation({
    onSuccess: async () => {
      setApiKey("");
      await invalidate();
      success("Đã xóa token SearXNG.");
    },
    onError: (mutationError) => error(mutationError.message),
  });

  const testMutation = api.searchConfig.testSearxngSearch.useMutation({
    onSuccess: async () => {
      await invalidate();
      success("Đã chạy thử tìm kiếm.");
    },
    onError: (mutationError) => error(mutationError.message),
  });

  const cleanupMutation = api.searchConfig.cleanupSearchAuditLogs.useMutation({
    onSuccess: async (deleted) => {
      await invalidate();
      success(`Đã xóa ${deleted.toLocaleString("vi-VN")} audit cũ.`);
    },
    onError: (mutationError) => error(mutationError.message),
  });

  const saveField = (field: FieldDef) => {
    const value = (drafts[field.key] ?? "").trim();
    if (!value) {
      error("Nhập giá trị trước khi lưu hoặc dùng Đặt lại.");
      return;
    }
    setActiveKey(field.key);
    setMutation.mutate({ key: field.key, value });
  };

  const resetField = (field: FieldDef) => {
    setActiveKey(field.key);
    resetMutation.mutate({ key: field.key });
  };

  const renderField = (field: FieldDef) => {
    const entry = config?.settings[field.key];
    const canEdit = entry?.canEdit ?? true;
    const busy =
      activeKey === field.key &&
      (setMutation.isPending || resetMutation.isPending);
    const helper = canEdit
      ? field.helper
      : `Giá trị bị khóa bởi ${entry?.envVar ?? "biến môi trường"}.`;

    return (
      <div key={field.key} className="space-y-2">
        <FilterField
          label={field.label}
          htmlFor={`search-setting-${field.key}`}
          helper={helper}
        >
          {entry?.type === "boolean" ? (
            <select
              id={`search-setting-${field.key}`}
              value={drafts[field.key] ?? ""}
              disabled={!canEdit || isLoading}
              onChange={(event) =>
                setDrafts((prev) => ({
                  ...prev,
                  [field.key]: event.target.value,
                }))
              }
              className="h-11 w-full rounded border border-slate-500 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-flat)] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
            >
              <option value="true">Bật</option>
              <option value="false">Tắt</option>
            </select>
          ) : field.multiline ? (
            <textarea
              id={`search-setting-${field.key}`}
              value={drafts[field.key] ?? ""}
              disabled={!canEdit || isLoading}
              rows={5}
              spellCheck={false}
              onChange={(event) =>
                setDrafts((prev) => ({
                  ...prev,
                  [field.key]: event.target.value,
                }))
              }
              className="min-h-32 w-full rounded border border-slate-500 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-[var(--shadow-flat)] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
            />
          ) : (
            <input
              id={`search-setting-${field.key}`}
              type={entry?.type === "number" ? "number" : "text"}
              inputMode={entry?.type === "number" ? "decimal" : undefined}
              min={entry?.min ?? undefined}
              max={entry?.max ?? undefined}
              step={
                entry?.type === "number"
                  ? entry.integer
                    ? 1
                    : "any"
                  : undefined
              }
              spellCheck={false}
              autoComplete="off"
              value={drafts[field.key] ?? ""}
              disabled={!canEdit || isLoading}
              placeholder={field.placeholder ?? entry?.defaultValue ?? ""}
              onChange={(event) =>
                setDrafts((prev) => ({
                  ...prev,
                  [field.key]: event.target.value,
                }))
              }
              className="h-11 w-full rounded border border-slate-500 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-flat)] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
            />
          )}
        </FilterField>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => saveField(field)}
            disabled={!canEdit || isLoading}
            isLoading={busy && setMutation.isPending}
          >
            Lưu
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => resetField(field)}
            disabled={!canEdit || isLoading || entry?.source !== "database"}
            isLoading={busy && resetMutation.isPending}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
          >
            Đặt lại
          </Button>
          {entry ? (
            <Badge tone={sourceTone(entry.source)}>
              {sourceLabel(entry.source)}
            </Badge>
          ) : null}
          <span className="text-xs break-all text-slate-600">
            {displayValue(entry, field.unit)}
          </span>
        </div>
      </div>
    );
  };

  const apiKeyConfig = config?.searxngApiKey;

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <SettingsSectionHeader
          eyebrow="SearXNG"
          title="Kết nối tìm kiếm web"
          description="Cấu hình endpoint SearXNG, token reverse proxy và tham số truy vấn dùng cho nghiên cứu vật tư."
          icon={Search}
          iconClassName="bg-blue-600 text-white"
          badge={{
            label: apiKeyConfig?.configured ? "Có token" : "Không token",
            tone: apiKeyConfig?.configured ? "success" : "neutral",
          }}
        />
        <div className="grid gap-5 p-2 lg:grid-cols-2">
          <div className="space-y-5">{CONNECTION_FIELDS.map(renderField)}</div>
          <div className="space-y-5">
            <FilterField
              label="Bearer token"
              htmlFor="searxng-api-key"
              helper={
                apiKeyConfig?.canEdit === false
                  ? "Token bị khóa bởi SEARXNG_API_KEY."
                  : apiKeyConfig?.keySuffix
                    ? `Token hiện tại kết thúc bằng ...${apiKeyConfig.keySuffix}.`
                    : "Token chỉ lưu server, không gửi lại trình duyệt."
              }
            >
              <input
                id="searxng-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                disabled={apiKeyConfig?.canEdit === false || isLoading}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={apiKeyConfig?.configured ? "••••••••" : "token"}
                className="h-11 w-full rounded border border-slate-500 bg-white px-3 font-mono text-sm text-slate-900 shadow-[var(--shadow-flat)] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
              />
            </FilterField>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  const trimmed = apiKey.trim();
                  if (!trimmed) {
                    error("Nhập token trước khi lưu.");
                    return;
                  }
                  saveKeyMutation.mutate({ apiKey: trimmed });
                }}
                disabled={apiKeyConfig?.canEdit === false || isLoading}
                isLoading={saveKeyMutation.isPending}
                leftIcon={<KeyRound className="h-3.5 w-3.5" />}
              >
                Lưu token
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => clearKeyMutation.mutate()}
                disabled={
                  apiKeyConfig?.canEdit === false ||
                  isLoading ||
                  !apiKeyConfig?.configured
                }
                isLoading={clearKeyMutation.isPending}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Xóa token
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SettingsSectionHeader
          eyebrow="Chất lượng VN"
          title="Domain và query"
          description="Điều chỉnh domain ưu tiên, domain giảm ưu tiên và số query cho từng luồng nghiên cứu."
          icon={Globe2}
          iconClassName="bg-emerald-100 text-emerald-700"
        />
        <div className="grid gap-5 p-2 lg:grid-cols-2">
          {DOMAIN_FIELDS.map(renderField)}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SettingsSectionHeader
          eyebrow="Hiệu năng"
          title="Concurrency, cache và audit"
          description="Giới hạn tải lên SearXNG và thời gian giữ audit log."
          icon={SlidersHorizontal}
          iconClassName="bg-amber-100 text-amber-800"
        />
        <div className="grid gap-5 p-2 lg:grid-cols-3">
          {PERFORMANCE_FIELDS.map(renderField)}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SettingsSectionHeader
          eyebrow="Kiểm thử"
          title="Thử tìm kiếm"
          description="Chạy một truy vấn thật qua SearXNG và xem ranking reasons."
          icon={Zap}
          iconClassName="bg-violet-100 text-violet-700"
        />
        <div className="space-y-4 p-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={testQuery}
              onChange={(event) => setTestQuery(event.target.value)}
              className="h-11 flex-1 rounded border border-slate-500 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-flat)] focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:outline-none"
            />
            <Button
              type="button"
              onClick={() =>
                testMutation.mutate({ query: testQuery, limit: 5 })
              }
              isLoading={testMutation.isPending}
              leftIcon={<Search className="h-3.5 w-3.5" />}
            >
              Thử tìm kiếm
            </Button>
          </div>
          {testMutation.data ? (
            <div className="rounded border border-slate-400 bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone={testMutation.data.ok ? "success" : "warning"}>
                  {testMutation.data.status}
                </Badge>
                <span className="text-sm text-slate-600">
                  {testMutation.data.durationMs.toLocaleString("vi-VN")} ms
                </span>
                <span className="text-sm text-slate-600">
                  engines: {testMutation.data.effectiveConfig.engines.join(",")}
                </span>
              </div>
              {testMutation.data.warnings.length > 0 ? (
                <p className="mb-3 text-sm text-amber-800">
                  {testMutation.data.warnings.join(" | ")}
                </p>
              ) : null}
              <div className="space-y-2">
                {testMutation.data.results.map((result) => (
                  <div
                    key={result.url}
                    className="rounded border border-slate-300 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-bold text-blue-700 hover:underline"
                      >
                        {result.title}
                      </a>
                      <Badge tone="info">{result.rankScore.toFixed(2)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {result.domain}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                      {result.snippet}
                    </p>
                    <p className="mt-2 text-xs text-slate-600">
                      {result.rankReasons.join(", ") || "no_reason"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <SettingsSectionHeader
          eyebrow="Audit"
          title="Audit gần đây"
          description="Theo dõi truy vấn, lỗi, thời gian và domain trả về."
          icon={Database}
          iconClassName="bg-slate-950 text-white"
          action={
            <Button
              type="button"
              variant="ghost"
              onClick={() => cleanupMutation.mutate()}
              isLoading={cleanupMutation.isPending}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Dọn log cũ
            </Button>
          }
        />
        <div className="space-y-4 p-2">
          <div className="grid gap-2 sm:grid-cols-6">
            {[
              ["24h", summary?.total24h ?? 0],
              ["OK", summary?.success24h ?? 0],
              ["Không có", summary?.noResults24h ?? 0],
              ["Lỗi", summary?.errors24h ?? 0],
              ["Median ms", summary?.medianDurationMs24h ?? 0],
              ["Avg ms", summary?.avgDurationMs24h ?? 0],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded border border-slate-400 bg-white p-3"
              >
                <p className="text-xs font-semibold text-slate-600">{label}</p>
                <p className="mt-1 text-lg font-bold text-slate-950 tabular-nums">
                  {Number(value).toLocaleString("vi-VN")}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterField label="Trạng thái">
              <select
                className="rounded border border-slate-400 bg-white px-3 py-2 text-sm"
                value={auditStatus}
                onChange={(event) =>
                  setAuditStatus(event.target.value as AuditStatus | "all")
                }
              >
                <option value="all">Tất cả</option>
                <option value="success">success</option>
                <option value="no_results">no_results</option>
                <option value="error">error</option>
                <option value="skipped">skipped</option>
              </select>
            </FilterField>
            <FilterField label="Luồng">
              <select
                className="rounded border border-slate-400 bg-white px-3 py-2 text-sm"
                value={auditFeature}
                onChange={(event) =>
                  setAuditFeature(event.target.value as AuditFeature | "all")
                }
              >
                <option value="all">Tất cả</option>
                <option value="material_enrichment">material_enrichment</option>
                <option value="excel_research">excel_research</option>
                <option value="interactive">interactive</option>
                <option value="profile_search">profile_search</option>
                <option value="test">test</option>
              </select>
            </FilterField>
          </div>
          {logsLoading ? (
            <SkeletonTable rows={5} cols={5} />
          ) : (
            <div className="overflow-x-auto rounded border border-slate-400">
              <table className="min-w-full divide-y divide-slate-300 text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Thời gian
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Luồng
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Query
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Trạng thái
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase">
                      Kết quả
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {(logs ?? []).map((logRow) => (
                    <tr key={logRow.id}>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {new Date(logRow.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {logRow.feature}
                      </td>
                      <td className="max-w-sm px-3 py-2 text-slate-900">
                        <span className="line-clamp-2">{logRow.query}</span>
                        {logRow.warningText || logRow.errorText ? (
                          <span className="mt-1 block text-xs text-amber-800">
                            {logRow.errorText || logRow.warningText}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            logRow.status === "success"
                              ? "success"
                              : logRow.status === "error"
                                ? "critical"
                                : "warning"
                          }
                        >
                          {logRow.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {logRow.resultCount.toLocaleString("vi-VN")} link /{" "}
                        {logRow.durationMs.toLocaleString("vi-VN")} ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

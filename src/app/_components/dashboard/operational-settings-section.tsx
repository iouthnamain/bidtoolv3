"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { RotateCcw } from "lucide-react";

import { SettingsSectionHeader } from "~/app/_components/dashboard/settings-section-header";
import { Badge, Button } from "~/app/_components/ui";
import { FilterField } from "~/app/_components/ui/filter-field";
import { useToast } from "~/app/_components/ui/toast";
import { api } from "~/trpc/react";

// Keys mirror OperationalSettingKey on the server.
export type OperationalSettingKey =
  | "bidwinnerBaseUrl"
  | "bidwinnerTimeoutMs"
  | "enableDemoSeed"
  | "scrapeMaxConcurrentJobs"
  | "scrapeMaxConcurrentPages"
  | "importMaxConcurrentJobs"
  | "enrichmentMaxConcurrentJobs"
  | "scrapeJobTtlDays"
  | "aiMatchAutoThreshold"
  | "aiMatchCandidateThreshold"
  | "excelResearchMaxConcurrentJobs"
  | "excelResearchBatchSize"
  | "excelResearchJobTtlDays"
  | "searxngBaseUrl"
  | "excelResearchDir"
  | "materialProfileExportDir";

export type OperationalFieldDef = {
  key: OperationalSettingKey;
  label: string;
  /** Extra explanatory text shown under the field when editable. */
  helper: string;
  placeholder?: string;
  /** Short unit suffix shown in the status table (e.g. "ms", "ngày"). */
  unit?: string;
};

function sourceLabel(source: "env" | "database" | "none") {
  switch (source) {
    case "env":
      return "Biến môi trường";
    case "database":
      return "Lưu trong database";
    case "none":
      return "Mặc định hệ thống";
  }
}

function sourceTone(source: "env" | "database" | "none") {
  switch (source) {
    case "env":
      return "warning" as const;
    case "database":
      return "success" as const;
    case "none":
      return "neutral" as const;
  }
}

function displayValue(value: string | null) {
  if (value === null || value === "") {
    return "Chưa cấu hình";
  }
  return value;
}

export function OperationalSettingsSection({
  id,
  eyebrow,
  title,
  description,
  icon,
  iconClassName,
  fields,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName?: string;
  fields: OperationalFieldDef[];
}) {
  const { error, success } = useToast();
  const utils = api.useUtils();
  const { data: config, isLoading } = api.appConfig.getConfig.useQuery();

  // Local draft values keyed by setting key.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<OperationalSettingKey | null>(
    null,
  );

  // Seed drafts from server config whenever it loads/changes.
  useEffect(() => {
    if (!config) {
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const entry = config[field.key];
        next[field.key] ??= entry?.value ?? "";
      }
      return next;
    });
  }, [config, fields]);

  const setMutation = api.appConfig.setSetting.useMutation({
    onSuccess: async () => {
      await utils.appConfig.getConfig.invalidate();
      success("Đã lưu cấu hình.");
      setActiveKey(null);
    },
    onError: (mutationError) => {
      error(mutationError.message);
      setActiveKey(null);
    },
  });

  const resetMutation = api.appConfig.resetSetting.useMutation({
    onSuccess: async (data) => {
      // Refresh local drafts from the freshly reset server values.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const field of fields) {
          next[field.key] = data[field.key]?.value ?? "";
        }
        return next;
      });
      await utils.appConfig.getConfig.invalidate();
      success("Đã đặt lại giá trị mặc định.");
      setActiveKey(null);
    },
    onError: (mutationError) => {
      error(mutationError.message);
      setActiveKey(null);
    },
  });

  const handleSave = (field: OperationalFieldDef) => {
    const value = (drafts[field.key] ?? "").trim();
    if (!value) {
      error("Nhập giá trị trước khi lưu.");
      return;
    }
    setActiveKey(field.key);
    setMutation.mutate({ key: field.key, value });
  };

  const handleReset = (field: OperationalFieldDef) => {
    setActiveKey(field.key);
    resetMutation.mutate({ key: field.key });
  };

  return (
    <section id={id} className="panel scroll-mt-6 overflow-hidden">
      <SettingsSectionHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        icon={icon}
        iconClassName={iconClassName}
      />

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          {fields.map((field) => {
            const entry = config?.[field.key];
            const canEdit = entry?.canEdit ?? true;
            const isBoolean = entry?.type === "boolean";
            const busy =
              activeKey === field.key &&
              (setMutation.isPending || resetMutation.isPending);

            const helperText = canEdit
              ? entry?.source === "none"
                ? `${field.helper} Đang dùng giá trị mặc định.`
                : field.helper
              : `Giá trị này đang bị khóa bởi ${entry?.envVar ?? ""}.`;

            return (
              <div key={field.key} className="space-y-2">
                <FilterField
                  label={field.label}
                  htmlFor={`setting-${field.key}`}
                  helper={helperText}
                >
                  {isBoolean ? (
                    <select
                      id={`setting-${field.key}`}
                      value={drafts[field.key] ?? ""}
                      disabled={!canEdit || isLoading}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [field.key]: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="true">Bật (true)</option>
                      <option value="false">Tắt (false)</option>
                    </select>
                  ) : (
                    <input
                      id={`setting-${field.key}`}
                      type={entry?.type === "number" ? "number" : "text"}
                      inputMode={
                        entry?.type === "number" ? "decimal" : undefined
                      }
                      min={entry?.min ?? undefined}
                      max={entry?.max ?? undefined}
                      step={
                        entry?.type === "number"
                          ? entry?.integer
                            ? 1
                            : "any"
                          : undefined
                      }
                      spellCheck={false}
                      autoComplete="off"
                      value={drafts[field.key] ?? ""}
                      disabled={!canEdit || isLoading}
                      onChange={(event) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={
                        field.placeholder ?? entry?.defaultValue ?? ""
                      }
                      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors duration-150 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  )}
                </FilterField>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => handleSave(field)}
                    disabled={!canEdit || isLoading}
                    isLoading={busy && setMutation.isPending}
                  >
                    Lưu
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleReset(field)}
                    disabled={
                      !canEdit || isLoading || entry?.source !== "database"
                    }
                    isLoading={busy && resetMutation.isPending}
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                  >
                    Đặt lại mặc định
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
          <p className="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
            Trạng thái
          </p>
          <dl className="mt-4 space-y-4 text-sm">
            {fields.map((field) => {
              const entry = config?.[field.key];
              return (
                <div key={field.key}>
                  <dt className="text-slate-400">{field.label}</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="font-semibold break-all">
                      {displayValue(entry?.value ?? null)}
                      {entry?.value && field.unit ? ` ${field.unit}` : ""}
                    </span>
                    {entry ? (
                      <Badge tone={sourceTone(entry.source)}>
                        {sourceLabel(entry.source)}
                      </Badge>
                    ) : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </aside>
      </div>
    </section>
  );
}

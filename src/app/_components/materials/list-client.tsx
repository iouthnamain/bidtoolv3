"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

const emptyForm = {
  code: "",
  name: "",
  unit: "",
  category: "",
  defaultDepreciation: "1",
  defaultReusePct: "0",
};

export function MaterialsListClient() {
  const [keyword, setKeyword] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [csv, setCsv] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const utils = api.useUtils();
  const { data: materials = [], isLoading } =
    api.material.searchMaterials.useQuery({
      keyword,
      limit: 50,
      offset: 0,
    });

  const createMaterial = api.material.createMaterial.useMutation({
    onSuccess: async () => {
      setForm(emptyForm);
      await utils.material.searchMaterials.invalidate();
    },
  });
  const deleteMaterial = api.material.deleteMaterial.useMutation({
    onSuccess: async () => {
      await utils.material.searchMaterials.invalidate();
    },
  });
  const importCsv = api.material.importMaterialsCsv.useMutation({
    onSuccess: async (result) => {
      setImportMessage(
        `Đã import ${result.inserted}, bỏ qua ${result.skipped}, lỗi ${result.errors.length}.`,
      );
      setCsv("");
      await utils.material.searchMaterials.invalidate();
    },
  });

  const submit = () => {
    createMaterial.mutate({
      code: form.code || undefined,
      name: form.name,
      unit: form.unit,
      category: form.category || undefined,
      defaultDepreciation: Number(form.defaultDepreciation || 1),
      defaultReusePct: Number.parseInt(form.defaultReusePct || "0", 10),
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold">Thêm vật tư</h2>
            <p className="mt-1 text-xs text-slate-500">
              Tạo nhanh master để dùng trong bước Search.
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Mã vật tư (tuỳ chọn)"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Tên qui cách vật tư"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="ĐVT"
              value={form.unit}
              onChange={(event) =>
                setForm({ ...form, unit: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nhóm vật tư"
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Khấu hao"
              type="number"
              min={0}
              step={0.1}
              value={form.defaultDepreciation}
              onChange={(event) =>
                setForm({ ...form, defaultDepreciation: event.target.value })
              }
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="% sử dụng lại"
              type="number"
              min={0}
              max={100}
              value={form.defaultReusePct}
              onChange={(event) =>
                setForm({ ...form, defaultReusePct: event.target.value })
              }
            />
          </div>
          <button
            type="button"
            className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            disabled={!form.name || !form.unit || createMaterial.isPending}
            onClick={submit}
          >
            {createMaterial.isPending ? "Đang lưu..." : "Lưu vật tư"}
          </button>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-bold">Import CSV</h3>
          <p className="mt-1 text-xs text-slate-500">
            Header:
            code,name,unit,category,default_depreciation,default_reuse_pct
          </p>
          <textarea
            className="mt-2 h-32 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            placeholder="Dán CSV tại đây"
          />
          <button
            type="button"
            className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50"
            disabled={!csv.trim() || importCsv.isPending}
            onClick={() => importCsv.mutate({ csv })}
          >
            Import CSV
          </button>
          {importMessage ? (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {importMessage}
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-sm font-bold">Material master</h2>
            <p className="mt-1 text-xs text-slate-500">
              {isLoading ? "Đang tải..." : `${materials.length} vật tư`}
            </p>
          </div>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-72"
            placeholder="Tìm vật tư"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-100 text-left text-xs tracking-wide text-slate-600 uppercase">
              <tr>
                <th className="px-3 py-2">Tên</th>
                <th className="px-3 py-2">ĐVT</th>
                <th className="px-3 py-2">Nhóm</th>
                <th className="px-3 py-2">Mặc định</th>
                <th className="px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {materials.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-[360px] px-3 py-2 font-medium [overflow-wrap:anywhere]">
                    {item.name}
                    {item.code ? (
                      <span className="ml-2 text-xs text-slate-400">
                        {item.code}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{item.unit}</td>
                  <td className="px-3 py-2">{item.category ?? "-"}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    KH {item.defaultDepreciation} • reuse {item.defaultReusePct}
                    %
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="rounded border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      disabled={deleteMaterial.isPending}
                      onClick={() => deleteMaterial.mutate({ id: item.id })}
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
              {materials.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-sm text-slate-500"
                  >
                    Chưa có vật tư.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

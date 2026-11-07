"use client";

import Link from "next/link";

import { api } from "~/trpc/react";

export function MaterialControlProjectsClient() {
  const projects = api.materialControl.listProjects.useQuery({ limit: 200 });
  if (projects.isLoading)
    return (
      <div className="panel p-6 text-sm text-slate-600">Đang tải dự án…</div>
    );
  if (projects.isError)
    return (
      <div className="panel border-rose-300 p-6 text-sm text-rose-800">
        Không tải được danh sách dự án.
      </div>
    );
  const rows = projects.data ?? [];
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">
            Workspace dự án
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Mỗi dự án có kế hoạch, nhu cầu và tài liệu riêng.
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
          {rows.length} dự án
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-sm text-slate-600">
          Chưa có dự án vật tư. API tạo dự án đã sẵn sàng cho form tiếp theo.
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {rows.map((project) => (
            <Link
              key={project.id}
              href={`/material-control/projects/${project.id}`}
              className="block p-4 transition hover:bg-slate-50"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-950">{project.name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {project.code ?? "Chưa có mã"}
                  </p>
                </div>
                <span className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700">
                  {project.status}
                </span>
              </div>
              {project.description ? (
                <p className="mt-2 text-sm text-slate-700">
                  {project.description}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

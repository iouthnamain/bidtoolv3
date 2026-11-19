"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

export function MaterialControlProjectCreateClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const create = api.materialControl.createProject.useMutation({
    onSuccess: (project) => {
      void utils.materialControl.listProjects.invalidate(undefined, {
        predicate: ({ queryKey: [, options] }) => {
          const status = options?.input?.status;
          return status === undefined || status === project.status;
        },
      });
      void utils.materialControl.dashboardSummary.invalidate(undefined, {
        predicate: ({ queryKey: [, options] }) => {
          const projectId = options?.input?.projectId;
          return projectId === undefined || projectId === project.id;
        },
      });
      router.push(`/material-control/projects/${project.id}`);
    },
  });
  return (
    <form
      className="panel max-w-2xl space-y-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ name, code: code || null, description });
      }}
    >
      <div>
        <label
          htmlFor="project-name"
          className="text-sm font-bold text-slate-800"
        >
          Tên dự án
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="mt-1 min-h-11 w-full rounded border border-slate-500 px-3 py-2"
        />
      </div>
      <div>
        <label
          htmlFor="project-code"
          className="text-sm font-bold text-slate-800"
        >
          Mã dự án (tuỳ chọn)
        </label>
        <input
          id="project-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="mt-1 min-h-11 w-full rounded border border-slate-500 px-3 py-2"
        />
      </div>
      <div>
        <label
          htmlFor="project-description"
          className="text-sm font-bold text-slate-800"
        >
          Mô tả
        </label>
        <textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="mt-1 w-full rounded border border-slate-500 px-3 py-2"
        />
      </div>
      {create.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {create.error.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {create.isPending ? "Đang tạo…" : "Tạo workspace"}
      </button>
    </form>
  );
}

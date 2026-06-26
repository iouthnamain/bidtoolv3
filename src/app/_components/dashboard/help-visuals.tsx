"use client";

import {
  flowNodes,
  importPipeline,
  localCommands,
  localStackLayers,
  sourceMatrixRows,
  troubleshootingCards,
  type HelpVisual,
} from "~/app/_lib/help-content";

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={`${part}-${index}`}
            className="rounded border border-slate-400 bg-white px-1.5 py-0.5 text-[0.92em] font-semibold text-slate-800"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function FlowMap() {
  return (
    <div className="rounded border border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-3">
      <div className="grid gap-2 md:grid-cols-5">
        {flowNodes.map((node, index) => (
          <div key={node.step} className="relative">
            {index > 0 ? (
              <div
                aria-hidden
                className="absolute top-5 -left-3 hidden h-px w-6 bg-cyan-300 md:block"
              />
            ) : null}
            <div className="h-full rounded border border-cyan-200 bg-white/85 p-3 shadow-sm">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan-900 text-xs font-bold text-white">
                {node.step}
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-950">
                {node.label}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {node.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalStackVisual() {
  return (
    <div className="mt-4 rounded border border-slate-400 bg-slate-50 p-3">
      <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
        Sơ đồ chạy local
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        {localStackLayers.map((layer) => (
          <div
            key={layer.step}
            className="rounded border border-slate-400 bg-white p-3"
          >
            <span className="inline-flex rounded-full bg-slate-900 px-2 py-1 text-xs font-bold tracking-wide text-white">
              {layer.step}
            </span>
            <h3 className="mt-2 text-sm font-bold text-slate-950">
              {layer.label}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {layer.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceMatrixVisual() {
  return (
    <div className="mt-4 overflow-hidden rounded border border-slate-400">
      <div className="bg-slate-900 px-3 py-2 text-xs font-bold tracking-wide text-white uppercase">
        Ma trận độ chính xác nguồn BidWinner
      </div>
      <div className="overflow-x-auto bg-white">
        <table className="w-full min-w-[34rem] text-left text-sm break-words">
          <thead className="bg-slate-50 text-xs text-slate-700 uppercase">
            <tr>
              <th className="px-3 py-2 font-bold">Mode</th>
              <th className="px-3 py-2 font-bold">Từ nguồn public</th>
              <th className="px-3 py-2 font-bold">Tinh lọc trong app</th>
              <th className="px-3 py-2 font-bold">Cách dùng đúng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sourceMatrixRows.map((row) => (
              <tr key={row.mode}>
                <th className="w-36 px-3 py-3 text-sm font-bold whitespace-nowrap text-slate-950">
                  {row.mode}
                </th>
                <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                  {row.exact}
                </td>
                <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                  {row.local}
                </td>
                <td className="px-3 py-3 text-xs leading-5 text-slate-600">
                  {row.watch}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportPipelineVisual() {
  return (
    <div className="mt-4 rounded border border-emerald-100 bg-emerald-50/60 p-3">
      <p className="text-xs font-bold tracking-wide text-emerald-800 uppercase">
        Pipeline import
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {importPipeline.map((step, index) => (
          <div
            key={step.step}
            className="rounded border border-emerald-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-sm font-bold text-slate-950">
                {step.step}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-2 text-sm font-bold text-slate-900">
              {step.label}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              <InlineText text={step.body} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocalCommandsVisual() {
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      {localCommands.map((item) => (
        <div
          key={item.command}
          className="rounded border border-slate-400 bg-slate-50 p-3"
        >
          <code className="rounded border border-slate-400 bg-white px-2 py-1 text-xs font-bold text-slate-900">
            {item.command}
          </code>
          <p className="mt-2 text-xs font-bold text-slate-700 uppercase">
            Khi dùng
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            <InlineText text={item.when} />
          </p>
          <p className="mt-2 text-xs font-bold text-slate-700 uppercase">
            Kết quả
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-700">
            <InlineText text={item.result} />
          </p>
        </div>
      ))}
    </div>
  );
}

function TroubleshootingVisual() {
  return (
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      {troubleshootingCards.map((card) => (
        <div
          key={card.symptom}
          className="rounded border border-amber-200 bg-amber-50/60 p-3"
        >
          <h3 className="text-sm font-bold text-slate-950">{card.symptom}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
            {card.checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <p className="mt-3 rounded bg-white px-3 py-2 text-xs leading-5 text-slate-700">
            <span className="font-bold text-amber-800">Cách xử lý: </span>
            <InlineText text={card.action} />
          </p>
        </div>
      ))}
    </div>
  );
}

export function SectionVisual({ visual }: { visual?: HelpVisual }) {
  switch (visual) {
    case "local-stack":
      return <LocalStackVisual />;
    case "source-matrix":
      return <SourceMatrixVisual />;
    case "import-pipeline":
      return <ImportPipelineVisual />;
    case "local-commands":
      return <LocalCommandsVisual />;
    case "troubleshooting":
      return <TroubleshootingVisual />;
    default:
      return null;
  }
}

export function HelpInlineText({ text }: { text: string }) {
  return <InlineText text={text} />;
}

"use client";

import {
  memo,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { type api } from "~/trpc/react";

import {
  budgetHeaderForEntity,
  deadlineHeaderForEntity,
  deadlineTextForItem,
  fieldTextForItem,
  formatCurrency,
  formatDate,
  idHeaderForEntity,
  ownerTextForItem,
  titleHeaderForEntity,
} from "./search-format";
import {
  primaryLinkForItem,
  primaryLinkOpensExternally,
  ResultActions,
} from "./result-actions";
import { selectedKey, type SearchItem } from "./search-types";

type AddWatchlist = ReturnType<typeof api.watchlist.addItem.useMutation>;

function PrimaryResultLink({
  item,
  className,
  children,
}: {
  item: SearchItem;
  className: string;
  children: ReactNode;
}) {
  const href = primaryLinkForItem(item);
  const opensExternally = primaryLinkOpensExternally(item);
  const content = (
    <>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      {opensExternally ? (
        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : null}
    </>
  );

  if (opensExternally) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title="Mở trên BidWinner"
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

const ResultCard = memo(function ResultCard({
  item,
  isChecked,
  onToggle,
  addWatchlist,
}: {
  item: SearchItem;
  isChecked: boolean;
  onToggle: (item: SearchItem, checked: boolean) => void;
  addWatchlist: AddWatchlist;
}) {
  return (
    <article className="rounded border border-slate-500 bg-white shadow-[var(--shadow-flat)] p-3 shadow-sm">
      <div className="flex items-start gap-1">
        <input
          type="checkbox"
          className="mt-1"
          checked={isChecked}
          onChange={(event) => onToggle(item, event.target.checked)}
          aria-label={`Chọn ${item.externalId}`}
        />
        <div className="min-w-0 flex-1">
          <PrimaryResultLink
            item={item}
            className="inline-flex max-w-full items-start gap-1 text-sm leading-5 font-semibold text-slate-950 transition-colors duration-0 hover:text-blue-700 hover:underline"
          >
            {item.title}
          </PrimaryResultLink>
          <PrimaryResultLink
            item={item}
            className="mt-1 inline-flex max-w-full items-start gap-1 text-xs text-slate-700 transition-colors duration-0 hover:text-blue-700 hover:underline"
          >
            {item.externalId} • {item.province}
          </PrimaryResultLink>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-600">Đơn vị</dt>
          <dd className="mt-0.5 line-clamp-2 font-medium text-slate-700">
            {ownerTextForItem(item)}
          </dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-600">Lĩnh vực</dt>
          <dd className="mt-0.5 line-clamp-2 font-medium text-slate-700">
            {fieldTextForItem(item)}
          </dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-600">Ngân sách</dt>
          <dd className="mt-0.5 font-mono font-semibold text-slate-800">
            {formatCurrency(item.budget)}
          </dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-600">Ngày đăng</dt>
          <dd className="mt-0.5 font-medium text-slate-700">
            {formatDate(item.publishedAt)}
          </dd>
        </div>
        <div className="rounded bg-slate-50 px-2 py-1.5">
          <dt className="text-slate-600">
            {deadlineHeaderForEntity(item.entityType)}
          </dt>
          <dd className="mt-0.5 font-medium text-slate-700">
            {deadlineTextForItem(item)}
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        <ResultActions item={item} addWatchlist={addWatchlist} />
      </div>
    </article>
  );
});

const ResultRow = memo(function ResultRow({
  item,
  isChecked,
  onToggle,
  addWatchlist,
}: {
  item: SearchItem;
  isChecked: boolean;
  onToggle: (item: SearchItem, checked: boolean) => void;
  addWatchlist: AddWatchlist;
}) {
  return (
    <tr className="align-top transition-colors duration-0 hover:bg-slate-100/80">
      <td className="px-3 py-3">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(event) => onToggle(item, event.target.checked)}
          aria-label={`Chọn ${item.externalId}`}
        />
      </td>
      <td className="px-3 py-3">
        <PrimaryResultLink
          item={item}
          className="inline-flex max-w-full items-start gap-1 text-sm leading-5 font-medium text-[#0091ff] hover:underline"
        >
          {item.externalId}
        </PrimaryResultLink>
      </td>
      <td className="px-3 py-3">
        <div>
          <PrimaryResultLink
            item={item}
            className="inline-flex max-w-full items-start gap-1 font-semibold text-slate-900 transition-colors duration-0 hover:text-blue-700 hover:underline"
          >
            {item.title}
          </PrimaryResultLink>
          {item.entityType === "package" ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {item.category}
              </span>
              <span
                className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700"
                title={`Match score ${item.matchScore}%`}
              >
                Match {item.matchScore}%
              </span>
            </p>
          ) : null}
          {item.entityType === "plan" ? (
            <p className="mt-1 text-xs text-slate-700">{item.planName}</p>
          ) : null}
          {item.entityType === "project" && item.relatedPlans.length > 0 ? (
            <div className="mt-1 space-y-1">
              <p className="text-xs text-slate-700">
                KHLCNT liên quan: {item.relatedPlanCount}
              </p>
              <div className="flex flex-wrap gap-1">
                {item.relatedPlans.slice(0, 2).map((plan) => (
                  <a
                    key={plan.externalId}
                    href={plan.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100"
                  >
                    {plan.title}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-slate-700">{item.province}</td>
      <td className="px-3 py-3 text-xs text-slate-700">
        {ownerTextForItem(item)}
      </td>
      <td className="px-3 py-3 text-xs text-slate-700">
        {deadlineTextForItem(item)}
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs font-semibold text-slate-800">
        {formatCurrency(item.budget)}
      </td>
      <td className="px-3 py-3 text-xs text-slate-700">
        {formatDate(item.publishedAt)}
      </td>
      <td className="px-3 py-3">
        <ResultActions item={item} addWatchlist={addWatchlist} compact />
      </td>
    </tr>
  );
});

export function ResultsTable(props: {
  items: SearchItem[];
  selectedKeys: Set<string>;
  setSelectedKeys: Dispatch<SetStateAction<Set<string>>>;
  addWatchlist: AddWatchlist;
}) {
  const allSelected =
    props.items.length > 0 &&
    props.items.every((item) => props.selectedKeys.has(selectedKey(item)));

  const toggleAll = (checked: boolean) => {
    props.setSelectedKeys(
      checked
        ? new Set(props.items.map((item) => selectedKey(item)))
        : new Set<string>(),
    );
  };

  const toggleOne = (item: SearchItem, checked: boolean) => {
    props.setSelectedKeys((previous) => {
      const next = new Set(previous);
      const key = selectedKey(item);

      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  };

  if (props.items.length === 0) {
    return null;
  }

  const entityType = props.items[0]?.entityType ?? "package";

  return (
    <div className="space-y-3">
      <div className="space-y-2 md:hidden">
        {props.items.map((item) => (
          <ResultCard
            key={selectedKey(item)}
            item={item}
            isChecked={props.selectedKeys.has(selectedKey(item))}
            onToggle={toggleOne}
            addWatchlist={props.addWatchlist}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded border border-slate-400 md:block">
        <table className="w-full min-w-[920px] table-fixed divide-y divide-slate-200 bg-white text-sm break-words">
          <thead className="bg-white text-left text-[13px] font-semibold text-slate-700">
            <tr>
              <th className="w-10 px-3 py-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                  aria-label="Chọn tất cả"
                />
              </th>
              <th className="w-28 px-3 py-4">{idHeaderForEntity(entityType)}</th>
              <th className="px-3 py-4">{titleHeaderForEntity(entityType)}</th>
              <th className="w-36 px-3 py-4">Địa điểm thực hiện</th>
              <th className="w-44 px-3 py-4">Bên mời thầu/Chủ đầu tư</th>
              <th className="w-28 px-3 py-4">
                {deadlineHeaderForEntity(entityType)}
              </th>
              <th className="w-32 px-3 py-4 text-right">
                {budgetHeaderForEntity(entityType)}
              </th>
              <th className="w-24 px-3 py-4">Đăng tải</th>
              <th className="w-28 px-3 py-4">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {props.items.map((item) => (
              <ResultRow
                key={selectedKey(item)}
                item={item}
                isChecked={props.selectedKeys.has(selectedKey(item))}
                onToggle={toggleOne}
                addWatchlist={props.addWatchlist}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

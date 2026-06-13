"use client";

import { usePathname } from "next/navigation";

import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";
import { searchSectionNavItems } from "~/app/_components/dashboard/page-nav-presets";
import {
  SEARCH_MODE_LABELS,
  SEARCH_MODE_DESCRIPTIONS,
  type SearchMode,
} from "~/lib/search-modes";
import { readSearchModeFromPathname } from "~/lib/search-routes";

const DEFAULT_META = {
  title: "Tìm kiếm public từ BidWinner",
  description:
    "Một trung tâm tìm kiếm cho gói thầu, theo địa phương, ngành nghề & địa phương, KHLCNT và dự án đầu tư phát triển",
};

export function SearchLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const mode = readSearchModeFromPathname(pathname);
  const meta = mode
    ? {
        title: `Tìm kiếm: ${SEARCH_MODE_LABELS[mode]}`,
        description: SEARCH_MODE_DESCRIPTIONS[mode],
      }
    : DEFAULT_META;

  return (
    <DashboardShell
      title={meta.title}
      description={meta.description}
      sectionNavItems={searchSectionNavItems}
      sectionNavTitle="Luồng tìm kiếm"
    >
      {children}
    </DashboardShell>
  );
}

export function getSearchModeFromPage(fixedMode: SearchMode) {
  return fixedMode;
}

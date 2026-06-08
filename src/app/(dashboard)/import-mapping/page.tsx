import { createPageMetadata } from "~/app/_lib/seo";
import { DashboardShell } from "~/app/_components/dashboard/dashboard-shell";

export const dynamic = "force-dynamic";

export const metadata = createPageMetadata({
  title: "Import & Mapping",
  description:
    "Không gian chuẩn bị luồng nhập dữ liệu và mapping catalog vật tư từ Excel hoặc CSV.",
  path: "/import-mapping",
  keywords: ["import Excel", "mapping dữ liệu", "catalog vật tư"],
});

export default function ImportMappingPage() {
  return (
    <DashboardShell
      title="Import & Mapping"
      description="Không gian trống cho luồng nhập dữ liệu và mapping."
    >
      {null}
    </DashboardShell>
  );
}

import { HelpLayoutClient } from "~/app/_components/dashboard/help-layout-client";

export const dynamic = "force-dynamic";

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <HelpLayoutClient>{children}</HelpLayoutClient>;
}

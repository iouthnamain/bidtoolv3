import { SavedItemsLayoutClient } from "~/app/_components/dashboard/saved-items-layout-client";

export default function SavedItemsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SavedItemsLayoutClient>{children}</SavedItemsLayoutClient>;
}

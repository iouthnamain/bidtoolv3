import { MaterialDetailLayoutClient } from "~/app/_components/materials/material-detail-layout-client";

export default function MaterialDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MaterialDetailLayoutClient>{children}</MaterialDetailLayoutClient>;
}

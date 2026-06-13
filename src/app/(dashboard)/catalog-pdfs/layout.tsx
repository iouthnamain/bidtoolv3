import { CatalogPdfsLayoutClient } from "~/app/_components/materials/catalog-pdfs-layout-client";

export default function CatalogPdfsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CatalogPdfsLayoutClient>{children}</CatalogPdfsLayoutClient>;
}

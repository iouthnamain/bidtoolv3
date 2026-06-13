import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createPageMetadata } from "~/app/_lib/seo";
import { getHelpSection } from "~/app/_lib/help-content";
import { HelpSectionArticle } from "~/app/_components/dashboard/help-section-article";

type HelpSlugPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: HelpSlugPageProps): Promise<Metadata> {
  const { slug } = await params;
  const section = getHelpSection(slug);

  if (!section) {
    return createPageMetadata({
      title: "Không tìm thấy trợ giúp",
      description: "Chủ đề trợ giúp không tồn tại.",
      path: `/help/${slug}`,
    });
  }

  return createPageMetadata({
    title: section.title,
    description: section.intro,
    path: `/help/${slug}`,
    keywords: ["hướng dẫn BidTool", section.eyebrow, section.title],
  });
}

export default async function HelpSlugPage({ params }: HelpSlugPageProps) {
  const { slug } = await params;
  const section = getHelpSection(slug);

  if (!section) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Link
        href="/help"
        className="inline-flex min-h-10 items-center text-xs font-semibold text-slate-700 transition-colors duration-150 hover:text-slate-950 hover:underline focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        ← Quay lại mục lục trợ giúp
      </Link>
      <HelpSectionArticle section={section} />
    </div>
  );
}

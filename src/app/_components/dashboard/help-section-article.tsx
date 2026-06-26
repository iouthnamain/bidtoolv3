import Image from "next/image";
import Link from "next/link";

import { type Section } from "~/app/_lib/help-content";
import {
  HelpInlineText,
  SectionVisual,
} from "~/app/_components/dashboard/help-visuals";

export function HelpSectionArticle({ section }: { section: Section }) {
  return (
    <article className="panel overflow-hidden">
      <div className="grid gap-0 xl:grid-cols-[1fr_420px]">
        <div className="min-w-0 p-4">
          <p className="section-title">{section.eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">
            {section.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            <HelpInlineText text={section.intro} />
          </p>

          <SectionVisual visual={section.visual} />

          {section.steps && section.steps.length > 0 ? (
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
              {section.steps.map((step) => (
                <li key={step}>
                  <HelpInlineText text={step} />
                </li>
              ))}
            </ol>
          ) : null}

          {section.notes && section.notes.length > 0 ? (
            <div className="mt-4 rounded border border-slate-400 bg-slate-50 px-3 py-3">
              <p className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                Lưu ý
              </p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-6 text-slate-600">
                {section.notes.map((note) => (
                  <li key={note}>
                    <HelpInlineText text={note} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {section.links && section.links.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {section.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex items-center rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-0 hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {link.label} →
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {section.image ? (
          <figure className="border-t border-slate-400 bg-slate-50 p-3 xl:border-t-0 xl:border-l">
            <div className="overflow-hidden rounded border border-slate-400 bg-white shadow-sm">
              <Image
                src={section.image.src}
                alt={section.image.alt}
                width={1440}
                height={900}
                className="h-auto w-full"
                sizes="(min-width: 1280px) 420px, 100vw"
              />
            </div>
            <figcaption className="mt-2 text-xs leading-5 text-slate-700">
              {section.image.caption}
            </figcaption>
          </figure>
        ) : null}
      </div>
    </article>
  );
}

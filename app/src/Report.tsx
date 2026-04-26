import { useEffect, useMemo } from "react";
import { marked } from "marked";

import techSpecSrc from "../../report/tech-spec.md?raw";
import digitalExhibitSrc from "../../report/digital-exhibit.md?raw";

export type ReportSlug = "tech-spec" | "digital-exhibit";

export const REPORTS: Record<ReportSlug, { title: string; src: string }> = {
  "tech-spec": { title: "Technical Specification", src: techSpecSrc },
  "digital-exhibit": { title: "Digital Exhibit", src: digitalExhibitSrc },
};

export const REPORT_ORDER: ReportSlug[] = ["tech-spec", "digital-exhibit"];

marked.setOptions({ gfm: true, breaks: false });

function externalizeLinks(html: string): string {
  return html.replace(
    /<a href="(https?:\/\/[^"]+)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
}

export function Report({ slug }: { slug: ReportSlug }) {
  const entry = REPORTS[slug];

  useEffect(() => {
    document.body.classList.add("report-mode");
    document.title = `${entry.title} — Tall Grass`;
    return () => {
      document.body.classList.remove("report-mode");
      document.title = "Tall Grass (Hidden From View)";
    };
  }, [entry.title]);

  const html = useMemo(
    () => externalizeLinks(marked.parse(entry.src) as string),
    [entry.src],
  );

  return (
    <>
      <header className="site-head">
        <h1><a href="/">Tall Grass</a></h1>
        <nav className="site-nav">
          <div className="site-nav-links">
            {REPORT_ORDER.map((s) => (
              <a
                key={s}
                href={`/report/${s}`}
                className={s === slug ? "sel" : ""}
              >
                {REPORTS[s].title}
              </a>
            ))}
          </div>
        </nav>
      </header>
      <main className="report">
        <article
          className="report-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
    </>
  );
}

export function reportSlugFromPath(path: string): ReportSlug | null {
  const m = path.match(/^\/report\/([a-z-]+)\/?$/);
  if (!m) return null;
  const slug = m[1];
  return slug in REPORTS ? (slug as ReportSlug) : null;
}

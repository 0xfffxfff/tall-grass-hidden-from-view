// Prerender the public report pages into static HTML. Runs after `vite build`.
// Reuses the CSS bundle Vite emits so the prerendered docs are visually
// identical to the React route. Output: dist/report/<slug>/index.html, served
// directly by Netlify with no JS needed to render.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const reportDir = resolve(repoRoot, "report");
const distDir = resolve(__dirname, "../dist");

const REPORTS = [
  { slug: "tech-spec", title: "Technical Specification", file: "tech-spec.md" },
  { slug: "digital-exhibit", title: "Digital Exhibit", file: "digital-exhibit.md" },
];

marked.setOptions({ gfm: true, breaks: false });

function externalizeLinks(html) {
  return html.replace(
    /<a href="(https?:\/\/[^"]+)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
}

function extractCssHref(indexHtml) {
  // Vite emits <link rel="stylesheet" crossorigin href="/assets/index-XXXX.css">
  const m = indexHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/);
  if (!m) throw new Error("Could not find CSS bundle in dist/index.html");
  return m[1];
}

function renderPage({ slug, title, html, cssHref }) {
  const navLinks = REPORTS.map((r) => {
    const cls = r.slug === slug ? ' class="sel"' : "";
    return `<a href="/report/${r.slug}"${cls}>${escapeHtml(r.title)}</a>`;
  }).join("\n        ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Tall Grass (Hidden From View)</title>
<meta name="description" content="${escapeHtml(title)} — Tall Grass (Hidden From View), 0xfff, for the Pixel Prize / JUST Open Source Stiftung.">
<link rel="stylesheet" href="${cssHref}">
</head>
<body class="report-mode">
<header class="site-head">
  <h1><a href="/">Tall Grass</a></h1>
  <nav class="site-nav">
    <div class="site-nav-links">
      ${navLinks}
    </div>
  </nav>
</header>
<main class="report">
  <article class="report-body">
${html}
  </article>
</main>
</body>
</html>
`;
}

function main() {
  const indexHtml = readFileSync(resolve(distDir, "index.html"), "utf8");
  const cssHref = extractCssHref(indexHtml);

  for (const r of REPORTS) {
    const md = readFileSync(resolve(reportDir, r.file), "utf8");
    const html = externalizeLinks(marked.parse(md));
    const page = renderPage({ slug: r.slug, title: r.title, html, cssHref });
    const outDir = resolve(distDir, "report", r.slug);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "index.html"), page, "utf8");
    console.log(`prerendered: dist/report/${r.slug}/index.html`);
  }
}

main();

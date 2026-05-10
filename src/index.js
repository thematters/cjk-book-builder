/**
 * @file index.js
 * @thematters/cjk-book-builder — main API
 *
 * 把任意 HTML 內容變成中文書版心的 PDF (paged.js A5/B5/...) + EPUB 3 (W3C valid)。
 *
 * 用法：
 *   import { createBook } from "@thematters/cjk-book-builder";
 *   import pdfCss from "@thematters/cjk-book-builder/styles/pdf.css?inline";
 *   import epubCss from "@thematters/cjk-book-builder/styles/epub.css?inline";
 *
 *   const book = createBook({
 *     metadata: { title: "我的小書", author: "@me" },
 *     chapters: [
 *       { kind: "cover",   id: "cover", title: "封面", content: "<h1>...</h1>" },
 *       { kind: "divider", id: "ch1-d", title: "第一章", content: "<h2>...</h2>" },
 *       { kind: "article", id: "ch1-a", title: "...", content: "<p>...</p>" },
 *     ],
 *     pdfCss, epubCss,
 *   });
 *
 *   await book.renderPdf({ container: document.getElementById("preview") });
 *   book.printPdf();
 *
 *   const blob = await book.buildEpub();
 *   download(blob, "我的小書.epub");
 */

import { renderPdfPreview, printPdf } from "./pdf.js";
import { buildEpub, triggerDownload } from "./epub.js";

/**
 * @typedef {Object} BookChapter
 * @property {"cover" | "stats" | "toc" | "divider" | "article" | "closing"} kind
 *   章節類型 — 影響 CSS class (cjk-book-page--<kind>)
 * @property {string} id 唯一 id (英數)
 * @property {string} title TOC 顯示文字
 * @property {string} content 章節主體 HTML (PDF) 或 XHTML body content (EPUB)
 *   — 注意 PDF 的 figure 圖會被 sanitize 掉 (paged.js bug)，EPUB 會保留
 */

/**
 * @typedef {Object} BookMetadata
 * @property {string} title
 * @property {string} author
 * @property {string} [language="zh-Hant"]
 * @property {string} [publisher]
 * @property {string} [identifier]
 */

/**
 * @typedef {Object} CreateBookOptions
 * @property {BookMetadata} metadata
 * @property {BookChapter[]} chapters
 * @property {string} [pdfCss] PDF 渲染用的 @page + 中文書 typography CSS
 * @property {string} [epubCss] EPUB 章節用的中文書 typography CSS
 */

/**
 * @typedef {Object} Book
 * @property {(opts: { container: HTMLElement, onProgress?: (d:number, t:number) => void }) => Promise<{ pages: number }>} renderPdf
 * @property {() => void} printPdf
 * @property {(opts?: { onImageProgress?: (d:number, t:number) => void }) => Promise<Blob>} buildEpub
 * @property {(blob: Blob, filename?: string) => void} download
 * @property {() => string} buildPdfHtml 內部組好的 PDF 用 HTML 字串 (debugging 用)
 * @property {() => Array<{ id: string, href: string, title: string, content: string }>} buildEpubChapters EPUB chapter struct 預覽
 */

const PAGE_KIND_TO_CLASS = {
  cover: "cjk-book-page--cover",
  stats: "cjk-book-page--stats",
  toc: "cjk-book-page--toc",
  divider: "cjk-book-page--divider",
  article: "cjk-book-page--article",
  closing: "cjk-book-page--closing",
};

/**
 * 建一本「書」物件 — 同一份 chapters 可以同時 render PDF + 打包 EPUB。
 * @param {CreateBookOptions} opts
 * @returns {Book}
 */
export const createBook = (opts) => {
  if (!opts?.metadata?.title) throw new Error("createBook: metadata.title required");
  if (!opts?.chapters?.length) throw new Error("createBook: chapters required");

  const { metadata, chapters, pdfCss, epubCss } = opts;

  // For PDF: each chapter wrapped in <article class="cjk-book-page cjk-book-page--<kind>">
  const buildPdfHtml = () =>
    chapters
      .map((c) => {
        const cls = `cjk-book-page ${PAGE_KIND_TO_CLASS[c.kind] || "cjk-book-page--article"}`;
        return `<article class="${cls}" data-id="${c.id}">\n${c.content}\n</article>`;
      })
      .join("\n");

  // For EPUB: each chapter wrapped in <section class="cjk-book-section cjk-book-section--<kind>">
  // and converted to full XHTML doc inside buildEpub
  const buildEpubChapters = () =>
    chapters.map((c) => ({
      id: c.id,
      href: `${c.id}.xhtml`,
      title: c.title,
      content: epubXhtml(
        `<section class="cjk-book-section cjk-book-section--${c.kind}">\n${c.content}\n</section>`,
        c.title,
        metadata.language || "zh-Hant",
        !!epubCss
      ),
    }));

  return {
    buildPdfHtml,
    buildEpubChapters,
    async renderPdf({ container, onProgress } = {}) {
      const html = buildPdfHtml();
      return await renderPdfPreview(html, {
        container,
        css: pdfCss,
        // 我們的 sanitizer 也會幫忙把這些 class 一併 strip 掉
        extraSanitizeSelectors: [
          ".cjk-book-decoration",
          ".cjk-book-scribble",
        ],
        onProgress,
      });
    },
    printPdf,
    async buildEpub(buildOpts = {}) {
      return await buildEpub({
        metadata,
        chapters: buildEpubChapters(),
        css: epubCss,
        onImageProgress: buildOpts.onImageProgress,
        transformImageUrl: buildOpts.transformImageUrl,
      });
    },
    download(blob, filename) {
      triggerDownload(blob, filename || `${metadata.title}.epub`);
    },
  };
};

// XHTML wrap helper — duplicated tiny version to avoid circular import
const epubXhtml = (body, title, language, withCss) => {
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c])
    );
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE html>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(language)}">\n` +
    `<head>\n` +
    `  <meta charset="UTF-8"/>\n` +
    `  <title>${esc(title || "")}</title>\n` +
    (withCss ? `  <link rel="stylesheet" type="text/css" href="styles/book.css"/>\n` : "") +
    `</head>\n` +
    `<body>\n${body}\n</body>\n</html>\n`
  );
};

// Re-export sub-modules for direct use
export { mdToHtml } from "./markdown.js";
export {
  escapeHtml,
  escapeXml,
  stripInlineHtml,
  extractFigures,
} from "./sanitize.js";
export {
  ensurePagedJs,
  sanitizeForPagedJs,
  renderPdfPreview,
  stampPageNumbers,
  centerDividerPages,
  printPdf,
} from "./pdf.js";
export {
  ensureJSZip,
  transformCloudflareImage,
  embedRemoteImages,
  buildEpub,
  xhtmlWrap,
  triggerDownload,
} from "./epub.js";

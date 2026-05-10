/**
 * @file markdown.js
 * Matters / 一般 markdown + raw HTML 混合 → 乾淨 HTML / XHTML。
 *
 * 為什麼自己寫 (而非用 marked / markdown-it)：
 *   1. 我們只支援書本場景需要的 markdown 子集：段落 / h3 / 圖片 / 引言
 *   2. 要同時處理 Matters editor 的 raw HTML (<figure class="image">)
 *   3. 要切兩種 mode：
 *        - PDF: paged.js v0.4.x 對 abspos <img> 跟 SVG 不穩，要 strip
 *        - EPUB: figure 圖留著，閱讀器渲染得好
 *   4. 不引入 200KB+ markdown lib，省 bundle size
 */

import { escapeHtml, escapeXml, stripInlineHtml, extractFigures } from "./sanitize.js";

/**
 * @typedef {Object} MdToHtmlOptions
 * @property {"html" | "xhtml"} [output="html"] 輸出格式 — XHTML 給 EPUB 用 (self-closing tags)
 * @property {boolean} [includeFigures=true] 是否保留圖片 figure (PDF mode 應設 false)
 * @property {(s: string) => string} [escape] escape 函式 (預設依 output 自動選)
 */

/**
 * Matters markdown / HTML 混合 → 乾淨 HTML / XHTML 字串
 * @param {string} md 原始 markdown
 * @param {MdToHtmlOptions} [opts]
 * @returns {string}
 */
export const mdToHtml = (md, opts = {}) => {
  if (!md) return "";
  const output = opts.output ?? "html";
  const includeFigures = opts.includeFigures ?? true;
  const esc = opts.escape ?? (output === "xhtml" ? escapeXml : escapeHtml);
  const selfClose = output === "xhtml" ? "/" : "";

  const { text, figures } = extractFigures(md);

  const blocks = text
    .replace(/__CJK_FIG__(\d+)__/g, "\n\n__CJK_FIG__$1__\n\n")
    .split(/\n\s*\n+/);

  return blocks
    .map((blk) => {
      const t = blk.trim();
      if (!t) return "";

      // 圖片 placeholder
      const figMatch = t.match(/^__CJK_FIG__(\d+)__$/);
      if (figMatch) {
        if (!includeFigures) return "";
        const f = figures[Number(figMatch[1])];
        if (!f) return "";
        const cap = f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : "";
        return `<figure class="cjk-book-fig"><img src="${esc(f.src)}" alt="${esc(f.alt)}"${selfClose ? " " + selfClose : ""}>${cap}</figure>`;
      }

      // Heading (# / ## / ### → 統一 h3)
      const h = t.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        const txt = esc(stripInlineHtml(h[2]).replace(/[*_`]/g, "").trim());
        if (!txt) return "";
        return `<h3>${txt}</h3>`;
      }

      // Image-only markdown block
      const img = t.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (img) {
        if (!includeFigures) return "";
        return `<figure class="cjk-book-fig"><img src="${esc(img[2])}" alt="${esc(img[1])}"${selfClose ? " " + selfClose : ""}></figure>`;
      }

      // Block quote
      if (t.startsWith("> ")) {
        const q = esc(
          stripInlineHtml(t.slice(2))
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/[*_`]/g, "")
            .trim()
        );
        if (!q) return "";
        return output === "xhtml"
          ? `<blockquote><p>${q}</p></blockquote>`
          : `<blockquote>${q}</blockquote>`;
      }

      // Paragraph
      const cleaned = stripInlineHtml(t)
        .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim();
      if (!cleaned) return "";
      const escaped = esc(cleaned).replace(/\n+/g, `<br${selfClose ? "/" : ""}>`);
      return `<p>${escaped}</p>`;
    })
    .filter(Boolean)
    .join("\n");
};

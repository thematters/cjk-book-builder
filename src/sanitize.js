/**
 * @file sanitize.js
 * 把 Matters / 一般富文本編輯器 的混合 HTML / markdown 收乾淨。
 *
 * 為什麼要做這些事：
 *   - Matters editor 偶爾在段落間留 U+0001 / 其他 ASCII 控制字元，
 *     EPUB 的 XHTML parser 嚴格、會整本 fail
 *   - <br class="smart">、<span>、<a> 等 inline tag 在書本場景沒意義，
 *     而且 <a> 失去網頁互動後變干擾
 *   - 殘留未識別 tag (<div> 字串等) 不應該直接秀給讀者
 */

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const escapeXml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c])
  );

/**
 * 拔掉所有 inline HTML tag + ASCII 控制字元，留純文字。
 * @param {string} s
 * @returns {string}
 */
const stripInlineHtml = (s) =>
  String(s)
    // 拔掉 XML 不允許的 ASCII control chars (U+0001-08, 0B-0C, 0E-1F)。
    // Matters editor 會在 figure 後留 U+0001，會讓 EPUB XHTML parser fail
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    // <br class="smart"> / <br/> / <br> → 統一 \n
    .replace(/<br\s*[^>]*>/gi, "\n")
    // 其他 inline tag 拔掉，保留純文字
    .replace(/<\/?(?:span|em|strong|b|i|u|a|code|small|sub|sup|mark|ins|del|s)[^>]*>/gi, "")
    // 殘留未識別 tag 拔掉
    .replace(/<\/?[a-z][^>]*>/gi, "");

/**
 * 從原始 HTML / markdown 抽出 <figure class="image"> 物件，留下 placeholder 字串。
 * @param {string} raw
 * @returns {{ text: string, figures: Array<{src: string, alt: string, caption: string}> }}
 */
const extractFigures = (raw) => {
  const figures = [];
  const text = String(raw).replace(
    /<figure[^>]*class="[^"]*\bimage\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/gi,
    (_m, inner) => {
      const imgMatch = inner.match(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
      if (!imgMatch) return "";
      const altMatch = inner.match(/<img[^>]*\balt=["']([^"']*)["']/i);
      const capMatch = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      const idx = figures.length;
      figures.push({
        src: imgMatch[1],
        alt: altMatch ? altMatch[1] : "",
        caption: capMatch ? capMatch[1].replace(/<[^>]+>/g, "").trim() : "",
      });
      return `__CJK_FIG__${idx}__`;
    }
  );
  return { text, figures };
};

export { escapeHtml, escapeXml, stripInlineHtml, extractFigures };

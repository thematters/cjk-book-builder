/**
 * @file pdf.js
 * 用 paged.js 把 HTML 內容預覽 + 列印成 A5 (或其他規格) 中文書 PDF。
 *
 * 為什麼用 paged.js：
 *   原生 CSS @page / page-break 規則只有列印時才生效，預覽看到的永遠是
 *   一張長條紙。paged.js (https://pagedjs.org) 是 W3C CSS Paged Media spec
 *   的 polyfill，預先把長 HTML 切成一張張 .pagedjs_page (固定頁面大小)，
 *   讓使用者在按下載前就能看到實際印出來的樣子。
 *
 * 8 個踩雷必看 docs/pdf-pitfalls.md，這個 module 的怪異設定都是修這些雷。
 */

const PAGEDJS_CDN = "https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js";

let _pagedJsPromise = null;

/**
 * Lazy-load paged.js polyfill。一定要在載入前關 auto，否則會自動把整個
 * <body> 拿去分頁、把整個網站搞掛。
 * @returns {Promise<void>}
 */
export const ensurePagedJs = () => {
  if (typeof window !== "undefined" && window.PagedPolyfill) return Promise.resolve();
  if (_pagedJsPromise) return _pagedJsPromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("ensurePagedJs() must run in browser"));
  }
  window.PagedConfig = window.PagedConfig || {};
  window.PagedConfig.auto = false;
  _pagedJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PAGEDJS_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("paged.js CDN load failed: " + PAGEDJS_CDN));
    document.head.appendChild(s);
  });
  return _pagedJsPromise;
};

/**
 * 把 HTML 經過 DOMParser 過濾掉 paged.js 不能消化的東西：
 *   - <img>, <svg>, <picture>: paged.js 對 abspos / 外連 SVG 有
 *     "item doesn't belong to list" bug
 *   - 自訂 class scribble / divider-art / ...: 同樣可能有 abspos 子節點
 * @param {string} html
 * @param {string[]} [extraSelectors] 額外要 strip 的 selectors
 * @returns {string}
 */
export const sanitizeForPagedJs = (html, extraSelectors = []) => {
  if (typeof DOMParser === "undefined") {
    throw new Error("sanitizeForPagedJs() must run in browser");
  }
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  const sel = ["img", "svg", "picture", ...extraSelectors].join(", ");
  root.querySelectorAll(sel).forEach((el) => el.remove());
  return root.innerHTML;
};

/**
 * @typedef {Object} RenderPdfOptions
 * @property {HTMLElement} container 渲染目標 (內部會被清空)
 * @property {string} [css] 額外 @page / 中文書 typography CSS 字串
 * @property {string[]} [extraSanitizeSelectors] 要從 HTML 移除的額外 selector
 * @property {(done: number, total: number) => void} [onProgress] paged.js 排版進度
 * @property {string} [dividerSelector] divider 頁的 CSS selector (預設 ".cjk-book-page--divider")
 * @property {string} [pageNumberClass] 頁碼 div 的 class name (預設 "cjk-book-page-number")
 * @property {boolean} [skipFirstPageNumber=true] 第一頁 (封面) 是否跳過頁碼
 */

/**
 * 把 HTML 用 paged.js 渲染成 .pagedjs_page 容器。
 * 渲染完之後可以 call window.print() 出 PDF。
 *
 * @param {string} html book 內容 HTML (要包含 <article class="cjk-book-page"...>)
 * @param {RenderPdfOptions} opts
 * @returns {Promise<{ pages: number }>}
 */
export const renderPdfPreview = async (html, opts) => {
  const {
    container,
    css,
    extraSanitizeSelectors,
    dividerSelector = ".cjk-book-page--divider",
    pageNumberClass = "cjk-book-page-number",
    skipFirstPageNumber = true,
  } = opts;
  if (!container) throw new Error("renderPdfPreview: container required");

  await ensurePagedJs();
  const cleaned = sanitizeForPagedJs(html, extraSanitizeSelectors);

  const wrapper = document.createElement("div");
  wrapper.className = "cjk-book-source";
  wrapper.innerHTML = cleaned;

  container.innerHTML = "";

  // 把 css 透過 data: URL 傳給 paged.js，這是唯一可靠的方法讓 paged.js
  // 看到 @page rules (它不會自掃 document.styleSheets)
  const stylesheets = css
    ? [`data:text/css;charset=utf-8,${encodeURIComponent(css)}`]
    : [];

  await window.PagedPolyfill.preview(wrapper, stylesheets, container);

  // 後處理：頁碼 + divider 上下置中（selector 可被 caller 覆寫）
  stampPageNumbers(container, { className: pageNumberClass, skipFirst: skipFirstPageNumber });
  centerDividerPages(container, { selector: dividerSelector });

  container.scrollTop = 0;
  return { pages: container.querySelectorAll(".pagedjs_page").length };
};

/**
 * paged.js v0.4.x 不能用 @bottom-center counter(page) (會炸 item doesn't
 * belong to list)，所以頁碼用 DOM 後處理：每張 .pagedjs_page 加一個 abspos
 * div 在底部置中，封面 (page 1) 不放
 *
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @param {string} [opts.className="cjk-book-page-number"] 頁碼 div 的 class
 * @param {boolean} [opts.skipFirst=true] 第一頁 (封面) 是否跳過
 */
export const stampPageNumbers = (container, opts = {}) => {
  const className = opts.className || "cjk-book-page-number";
  const skipFirst = opts.skipFirst ?? true;
  const pages = container.querySelectorAll(".pagedjs_page");
  pages.forEach((p, i) => {
    if (skipFirst && i === 0) return;
    if (p.querySelector(`.${className}`)) return; // 已加過
    const num = document.createElement("div");
    num.className = className;
    num.textContent = String(i + 1);
    num.setAttribute("aria-hidden", "true");
    const pagebox = p.querySelector(".pagedjs_pagebox") || p;
    if (getComputedStyle(pagebox).position === "static") {
      pagebox.style.position = "relative";
    }
    pagebox.appendChild(num);
  });
};

/**
 * paged.js 用 CSS multi-column 把內容塞進 .pagedjs_page_content，並在中間
 * 自動加 anonymous div(display: block)，flex 鏈完全斷掉、CSS 怎麼加都不能
 * 讓 divider 上下置中。改 post-process。
 *
 * @param {HTMLElement} container
 * @param {Object} [opts]
 * @param {string} [opts.selector=".cjk-book-page--divider"] divider chapter selector
 */
export const centerDividerPages = (container, opts = {}) => {
  const selector = opts.selector || ".cjk-book-page--divider";
  container.querySelectorAll(".pagedjs_page").forEach((p) => {
    const divider = p.querySelector(selector);
    if (!divider) return;
    const pageContent = p.querySelector(".pagedjs_page_content");
    if (!pageContent) return;
    const totalH = pageContent.getBoundingClientRect().height;
    const contentH = divider.getBoundingClientRect().height;
    if (contentH >= totalH) return;
    const padding = Math.max(0, (totalH - contentH) / 2);
    divider.style.paddingTop = `${padding}px`;
  });
};

/**
 * 觸發瀏覽器列印對話框 (Save as PDF / 印表機)。
 *
 * 一定要 sync call (放在 click handler 第一個語句)，被 rAF / setTimeout 包
 * 起來會被 popup blocker 視為非使用者觸發、靜默吞掉。
 */
export const printPdf = () => {
  window.print();
};

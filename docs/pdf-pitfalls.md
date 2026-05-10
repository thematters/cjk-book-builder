# paged.js 踩雷筆記

把 seven-day-book-landing 接 paged.js 的過程實戰整理。  
全部都是真的炸過、用 playwright + W3C 工具驗證後的修正。

paged.js 版本 v0.4.3。如果你用更新的版本，先確認以下問題還在不在。

---

## 1. paged.js 不會自掃 `document.styleSheets` 的 `@page` rule

**症狀：** 預覽 page 大小是 8.5×11 in (US Letter)，不管你 CSS 寫多大都沒用。

**原因：** paged.js 只讀 `PagedPolyfill.preview(content, [stylesheets], target)` 第二參數明確傳的 stylesheet。

**正解：**

```js
const css = `@page { size: A5; margin: 18mm 16mm 22mm }`;
const cssUrl = `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;
await window.PagedPolyfill.preview(content, [cssUrl], target);
```

---

## 2. 必須關掉 `PagedConfig.auto` 否則會把整個 `<body>` 拿去分頁

**症狀：** 載 paged.js 後整個網站樣式爛掉，所有元素被切成多頁。

**原因：** paged.js 預設 auto run on document load，把 `<body>` 整個丟進 chunker。

**正解：** 載 polyfill **前** 設好：

```js
window.PagedConfig = window.PagedConfig || {};
window.PagedConfig.auto = false;
// 然後才載 paged.polyfill.js
```

---

## 3. `position: absolute` 子節點觸發 "item doesn't belong to list"

**症狀：** paged.js silently 中止分頁，整本書只渲染前一兩頁。Console 沒有 error，但 `target.querySelectorAll(".pagedjs_page").length` 比預期少很多。

**原因：** paged.js 的 chunker 走 DOM 樹時，如果碰到 `position: absolute` 的 `<img>` / SVG / 自訂 div，會在內部 doubly-linked-list 上 throw "item doesn't belong to list"。

**正解：** 在傳給 paged.js **之前**，用 `DOMParser` 物理移除這些元素 (CSS `display: none` 不夠，paged.js 還是會 walk 隱藏節點)：

```js
const sanitize = (html) => {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.body.querySelectorAll("img, svg, picture, .my-decoration").forEach((el) => el.remove());
  return doc.body.firstElementChild.innerHTML;
};
```

---

## 4. `@bottom-center { content: counter(page) }` 一律炸

**症狀：** 任何 `@page { @bottom-center { ... } }` rule 都會 throw "item doesn't belong to list"，即使 content 只是空白 `" "`。

**正解：** 完全不用 `@page` margin box。paged.js 跑完後 JS post-process 注入頁碼：

```js
const stampPageNumbers = (container) => {
  container.querySelectorAll(".pagedjs_page").forEach((p, i) => {
    if (i === 0) return; // 封面跳過
    const num = document.createElement("div");
    num.className = "page-number";
    num.textContent = String(i + 1);
    const pagebox = p.querySelector(".pagedjs_pagebox") || p;
    if (getComputedStyle(pagebox).position === "static") pagebox.style.position = "relative";
    pagebox.appendChild(num);
  });
};
```

CSS：`.page-number { position: absolute; bottom: 8mm; left: 0; right: 0; text-align: center; }`

---

## 5. `text-align: justify` 在被 split 的元素上自動套 `text-align-last: justify`

**症狀：** 中文段落最後一行字距被拉到滿行寬，每個字之間出現超寬 gap。看起來超醜。

**原因：** paged.js 內建一條 CSS `[data-align-last-split-element='justify'] { text-align-last: justify }`，並在 chunker 把跨頁元素標 `data-align-last-split-element="justify"`。中文沒有自然 word break，被 justify 後字距分散。

**正解：** 中文書統一用 `text-align: left`，傳統中文書本來就左對齊：

```css
.book-article-body, .book-article-body p {
  text-align: left !important;
  text-align-last: auto !important;
  letter-spacing: normal !important;
}
```

---

## 6. paged.js 用 CSS multi-column → flex chain 被 anonymous div 切斷

**症狀：** 想用 `display: flex; justify-content: center` 讓 divider 內容上下置中，CSS 怎麼寫都沒用，內容永遠靠頂。

**原因：** paged.js 在 `.pagedjs_page_content` 套 `column-width: <page-width>` (CSS multi-column)，並在你的 chapter 跟 page-content 之間自動插入一個 anonymous `<div>` (display: block)。flex 鏈被中斷。

**正解：** JS post-process 量出剩餘空間，動態加 `padding-top` 把內容推到中間：

```js
const centerDividerPages = (container) => {
  container.querySelectorAll(".pagedjs_page").forEach((p) => {
    const divider = p.querySelector(".cjk-book-page--divider");
    if (!divider) return;
    const pageContent = p.querySelector(".pagedjs_page_content");
    const totalH = pageContent.getBoundingClientRect().height;
    const contentH = divider.getBoundingClientRect().height;
    if (contentH < totalH) {
      divider.style.paddingTop = `${(totalH - contentH) / 2}px`;
    }
  });
};
```

---

## 7. `padding` 短手 `!important` 會吃掉 inline `padding-top` JS 動態值

**症狀：** 上一條的 JS 寫 `divider.style.paddingTop = "262px"`，但 computed style 顯示 `padding-top: 0px`。

**原因：** 你在某條 CSS 裡寫了 `.book-page { padding: 0 !important }` (短手)。`!important` 會蓋過 inline 非 important 樣式 — 即使 CSS 短手也是。

**正解：** 拆成個別 padding-* 屬性，不要用短手：

```css
.book-page {
  padding-right: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0 !important;
  /* 不寫 padding-top，留給 JS 動態加 */
}
```

---

## 8. 列印時 @page margin — 雙重需求衝突

**症狀 A：** 列印 PDF 第 5 頁起右側內容被裁。  
**症狀 B：** 修了 A 之後，長文章末尾整段消失。  
**症狀 C：** 修了 B 之後 (用 @media print { @page margin: 0 })，預覽 + 列印兩邊都變成「內文邊到邊、無邊距」。

**原因：** paged.js 跟瀏覽器列印引擎都讀 `@page` margin，但需求矛盾：
- paged.js 要 margin 來算 `.pagedjs_page_content` 內容區
- 印表機看到 margin 會在 paged.js 已經是完整 A5 的頁上再加邊界

直接寫 `@media print { @page { margin: 0 } }` 在同一份 stylesheet 也不行
（見 pitfall #10）— paged.js 會把它當特殊規則拿來用，預覽也變 margin: 0。

**正解：** 兩條 @page rule 分到兩份 stylesheet：

```js
// data: URL stylesheet 給 paged.js (只放預設 @page)
await window.PagedPolyfill.preview(content, [
  `data:text/css,@page { size: A5 portrait; margin: 18mm 16mm 22mm; }`
], target);

// document <style> 給印表機 (paged.js 不掃 document.styleSheets)
const printStyle = document.createElement("style");
printStyle.textContent = `@media print { @page { size: A5 portrait; margin: 0; } }`;
document.head.appendChild(printStyle);
```

`@thematters/cjk-book-builder` 的 `styles/pdf.css` 已經幫你處理好預設那條，
但 caller 還是要自己加印表機那條到自家 CSS / `<style>`。詳見 #10。

---

## 9. (bonus) Markdown 裡的 ASCII 控制字元 (U+0001) 害 EPUB 整本 fail

雖然這條是 EPUB 才炸 (PDF 沒事)，但 source 修一次兩邊都受惠。Matters editor 偶爾在 figure 後留 U+0001 控制字元，XHTML parser 嚴格、整本書 invalid。

```js
// 在 stripInlineHtml 第一條 regex 加：
.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
```

---

## 工具

- 驗證 EPUB：[W3C epubcheck](https://github.com/w3c/epubcheck) (Java JAR)
  ```sh
  java -jar epubcheck-5.2.1/epubcheck.jar your-book.epub
  ```
- 驗證 PDF 內容完整：用 Python `pypdf` extract 文字 vs source markdown 字數比對
- Playwright 自動測：模擬使用者打開 modal、點下載、檢查 DOM 與輸出

---

## 10. (v0.1.2) `@media print { @page { margin: 0 } }` 寫在 paged.js stylesheet 會壞掉預覽

**症狀：** 想用「預設 @page margin: 18mm + @media print @page margin: 0」雙重宣告區分 paged.js 排版邊距 vs 列印頁面邊距。但發現預覽的 `.pagedjs_page_content` 變成 148mm（整張 A5 寬），列印出來內文邊到邊沒邊距。

**原因：** paged.js 解析時把 `@media print` 內的 @page 視為「更特殊規則」應用到預覽，所以預覽用的 margin 也變 0。

**正解：** 把兩條 @page rule 分到兩個 stylesheet：
- `PagedPolyfill.preview(_, [stylesheets], _)` 第二參數的 data: URL CSS：**只放預設** `@page { margin: 18mm 16mm 22mm }`
- 印表機用的 `@media print { @page { margin: 0 } }` 寫到 document 的 bundled CSS / `<link>` / `<style>` — paged.js 不掃 `document.styleSheets`，所以它看不到，但印表機引擎會看到

對應到 `@thematters/cjk-book-builder` API：

```js
import pdfCss from "@thematters/cjk-book-builder/styles/pdf.css?raw";

// 給 paged.js
await book.renderPdf({ container, css: pdfCss });

// 給印表機 — 加在 document 任何 <style> / 你的全站 CSS 都行
const printStyle = document.createElement("style");
printStyle.textContent = `@media print { @page { size: A5 portrait; margin: 0 } }`;
document.head.appendChild(printStyle);
```

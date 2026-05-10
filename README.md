# `@thematters/cjk-book-builder`

把任意 HTML 內容變成中文書版心的「書」。同時支援：

- **PDF**（A5 中文書版心，paged.js 預覽 + 瀏覽器列印）
- **EPUB 3**（W3C epubcheck 0 error，Apple Books / Kobo / Calibre / Readmoo 通用）

純 client-side，不需要後端。從 [matters/freewriting](https://freewriting.matters.town) 「製作我的七日書小書」實戰抽出來的。

## 為什麼不用 X？

| 工具 | 為什麼這個包不一樣 |
|---|---|
| paged.js 直接用 | 中文 typography + 8 個 v0.4.x bug 已經修好（見 [docs/pdf-pitfalls.md](docs/pdf-pitfalls.md)） |
| epub.js | 那是讀 EPUB 的，不是寫 EPUB 的 |
| Pandoc | 要後端，無法 client-side |
| html2pdf / jsPDF | 對中文字體跟分頁支援差，沒有真正的中文書版心 |
| 自己寫 | 你會踩到我們踩過的 8 + 8 個 paged.js / EPUB 雷 |

## Quick start

```sh
npm install @thematters/cjk-book-builder
```

```js
import { createBook } from "@thematters/cjk-book-builder";
import pdfCss from "@thematters/cjk-book-builder/styles/pdf.css?inline";
import epubCss from "@thematters/cjk-book-builder/styles/epub.css?inline";

const book = createBook({
  metadata: {
    title: "示範小書",
    author: "@demo",
    publisher: "Matters",
  },
  pdfCss,
  epubCss,
  chapters: [
    { kind: "cover",   id: "cover",  title: "封面", content: "<h1>示範小書</h1>" },
    { kind: "divider", id: "ch1-d",  title: "第一章", content: "<h2>外婆的廚房</h2>" },
    { kind: "article", id: "ch1-a1", title: "外婆的廚房",
      content: "<p>回家那天我推開門就聞到了那個味道。</p>" },
  ],
});

// PDF: 預覽 + 列印
await book.renderPdf({ container: document.getElementById("preview") });
document.getElementById("print").onclick = () => book.printPdf();

// EPUB: 直接打包成 .epub blob
const blob = await book.buildEpub({
  onImageProgress: (done, total) => console.log(`下載圖 ${done}/${total}`),
});
book.download(blob, "示範小書.epub");
```

## 章節類型 (`kind`)

| kind | 用途 | 樣式 |
|---|---|---|
| `cover` | 封面 | 上下置中、不放頁碼 |
| `stats` | 統計頁 (例：「共 24 期、3,200+ 篇」) | 上下置中 |
| `toc` | 目錄 | 預設 grid 佈局，長標題自動換行 |
| `divider` | 章節分隔頁 | 上下置中、強制換頁 |
| `article` | 內文 | 段首縮排 2em、line-height 1.85、可跨頁 |
| `closing` | 封底 | 上下置中、不放頁碼 |

每個 kind 對應一個 CSS class `.cjk-book-page--<kind>` (PDF) 或 `.cjk-book-section--<kind>` (EPUB)，可以自己覆寫樣式。

## Markdown 輔助

如果你的章節 content 是 Matters / 一般 markdown，可以用內建轉換：

```js
import { mdToHtml } from "@thematters/cjk-book-builder";

const html = mdToHtml(rawMarkdown, { output: "html" });   // 給 PDF
const xhtml = mdToHtml(rawMarkdown, { output: "xhtml" }); // 給 EPUB
```

支援的 markdown 子集：段落、`#`/`##`/`###`、`> 引言`、`![alt](src)` 圖片、`<figure class="image">` (Matters editor)。同時自動 strip ASCII 控制字元（避免 EPUB XHTML parser 整本 fail）。

## 完整 API

```ts
createBook({
  metadata: { title, author, language?, publisher?, identifier? },
  chapters: BookChapter[],
  pdfCss?: string,
  epubCss?: string,
}): Book

interface Book {
  renderPdf({ container, onProgress? }): Promise<{ pages: number }>;
  printPdf(): void;                                  // 觸發列印對話框
  buildEpub({ onImageProgress?, transformImageUrl? }): Promise<Blob>;
  download(blob, filename?): void;
  buildPdfHtml(): string;                            // debugging
  buildEpubChapters(): Array<{ id, href, title, content }>;
}
```

低階 helper（如果你想自己組合）：

```js
import {
  // markdown
  mdToHtml,
  // sanitize
  escapeHtml, escapeXml, stripInlineHtml, extractFigures,
  // PDF
  ensurePagedJs, sanitizeForPagedJs, renderPdfPreview,
  stampPageNumbers, centerDividerPages, printPdf,
  // EPUB
  ensureJSZip, transformCloudflareImage, embedRemoteImages,
  buildEpub, xhtmlWrap, triggerDownload,
} from "@thematters/cjk-book-builder";
```

## 樣式

引入 `styles/pdf.css` + `styles/epub.css` 字串給 `createBook`。它們符合中文書版心慣例（[詳見 docs/chinese-typography.md](docs/chinese-typography.md)）：

- A5 (148×210mm)，天頭 18mm / 訂口切口 16mm / 地腳 22mm
- 內文 11pt，line-height 1.85
- 段首縮排 2em，章節後第一段不縮排
- 標題 `break-after: avoid`、圖片 / 引言 `break-inside: avoid`
- `text-align: left`（不是 justify — 中文 + justify 會把字距拉爆）

要客製：直接 fork CSS 或自己寫一份傳進去。

## 踩雷筆記（重要）

如果你想在現有專案手動接 paged.js / EPUB，**先讀**：

- [PDF / paged.js 8 個雷](docs/pdf-pitfalls.md)
- [EPUB 3 spec 8 個雷](docs/epub-pitfalls.md)
- [中文書版心慣例](docs/chinese-typography.md)

每一條都是真的炸過、用 W3C epubcheck 5.2.1 + Playwright 驗證後的修正。

## Demo

`examples/basic.html` — 開瀏覽器直接看，三章書同時出 PDF 預覽 + EPUB 下載。

```sh
git clone https://github.com/thematters/cjk-book-builder.git
cd cjk-book-builder
python3 -m http.server 8000
# 開 http://localhost:8000/examples/basic.html
```

## 相依

| 套件 | 用途 | 載入方式 |
|---|---|---|
| [paged.js](https://pagedjs.org) v0.4.3 | PDF 預覽分頁 | CDN lazy-load (~180KB)，按下「預覽 PDF」才載 |
| [JSZip](https://stuk.github.io/jszip/) v3.10 | EPUB zip 打包 | CDN lazy-load (~30KB)，按「下載 EPUB」才載 |

兩個都不會 block 你的網站初始載入，使用者沒按按鈕就不會下載。

## License

MIT © 2026 Matters Lab

## 貢獻

歡迎 issue / PR。已知方向：
- [ ] 更多開本 preset (32K / B5 / 16K)
- [ ] 自訂頁碼樣式 (羅馬字、章節重新計數)
- [ ] EPUB 封面圖支援
- [ ] EPUB footnote 支援
- [ ] 客製化字體 subset 工具

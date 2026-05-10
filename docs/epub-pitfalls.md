# EPUB 3 踩雷筆記

`@thematters/cjk-book-builder` 走 W3C epubcheck **0 error / 0 warning** 的方法。

---

## 1. `mimetype` 必須是 zip 第一個檔 + uncompressed (STORED)

**原因：** EPUB spec 為了讓 reader 不解壓也能秒判 mime，要求 `mimetype` 必須是 zip 檔內第一條目，且 compression method = STORED (不壓縮)。

**正解：**

```js
zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
// 之後再 zip.file(...) 任何其他檔
```

---

## 2. 外連圖片 (`<img src="https://...">`) 一定要塞進 zip

**症狀：** epubcheck 報 74 errors:
- `OPF-014 ×30`: 「remote-resources」屬性需要在 OPF 檔案中宣告
- `RSC-006 ×44`: Remote resource reference is not allowed in this context

**正解：** 抓下來塞進 zip：

```js
const res = await fetch(url);
const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
const blob = await res.blob();
zip.file(`OEBPS/images/img-${i}.${ext}`, blob);
// 然後改 xhtml 內 <img src="..."> 為相對路徑 "images/img-N.ext"
// 並在 OPF manifest 加 <item id="img-N" href="images/img-N.ext" media-type="image/jpeg"/>
```

如果某張圖 fetch 失敗、決定保留外連，那個 chapter 的 manifest item 必須加 `properties="remote-resources"`：

```xml
<item id="ch01" href="ch01.xhtml" media-type="application/xhtml+xml" properties="remote-resources"/>
```

---

## 3. Cloudflare Images 變體 transform — 控制檔案大小

**症狀：** 如果用 `/public` 變體，每張圖原始大小 100-300KB。30 張 = 整本 EPUB 50 MB+，使用者下載很久。

**正解：** Cloudflare Images flexible variant — 把 URL 最後一段換成 `width=900,quality=85`：

```js
const transform = (url) => {
  if (!/imagedelivery\.net\//.test(url)) return url;
  return url.replace(/\/[^\/?#]+([?#]|$)/, "/width=900,quality=85$1");
};
```

A5 / 6" Kindle 螢幕 retina 也用不到 900px，省一半以上頻寬。

注意：是 `width=` 全字，不是 `w=`。`w=` 會被當 named variant 找不到、回 fallback 原圖。

---

## 4. `<dc:identifier>` 必須是 stable URN

EPUB 3.3 spec 不規定 identifier 格式，但 reader 用它判同一本書。建議：

```xml
<dc:identifier id="bookid">urn:uuid:550e8400-e29b-41d4-a716-446655440000</dc:identifier>
```

JS：

```js
const bookId = "urn:uuid:" + crypto.randomUUID();
```

---

## 5. `<meta property="dcterms:modified">` 是 EPUB 3 必填

```xml
<meta property="dcterms:modified">2026-05-10T14:00:00Z</meta>
```

格式：ISO 8601 不含 millisecond。

```js
const isoDate = new Date().toISOString().split(".")[0] + "Z";
```

---

## 6. EPUB 3 用 `toc.xhtml`，但仍建議附 `toc.ncx` 給舊 reader

EPUB 2 reader (老 Kindle 的轉檔工具) 還在用 `toc.ncx`。EPUB 3 spec 允許同時放 — Manifest 都列出來：

```xml
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
```

`<spine toc="ncx">` (`toc=` 屬性指向 NCX 的 id)。

---

## 7. 所有 .xhtml 必須是 valid XML — 容易踩 ASCII 控制字元

XHTML parser 嚴格，任何 U+0001-08 / U+0B-0C / U+0E-1F 的字元都會讓整個 chapter parse fail。Matters editor 偶爾在 figure 後留 U+0001。

**正解：** sanitize 階段 strip：

```js
text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
```

---

## 8. `<br>` 必須 self-close 為 `<br/>` (XHTML)

HTML5 允許 `<br>`，XHTML 必須 `<br/>`。同樣的還有 `<img>` → `<img/>`、`<hr>` → `<hr/>`。

我們的 mdToHtml 提供 `output: "xhtml"` 模式自動處理。

---

## 工具

驗證 EPUB 是否合 W3C spec：

```sh
# 下載 epubcheck JAR
curl -LO https://github.com/w3c/epubcheck/releases/download/v5.2.1/epubcheck-5.2.1.zip
unzip epubcheck-5.2.1.zip
java -jar epubcheck-5.2.1/epubcheck.jar your-book.epub
```

預期輸出（cjk-book-builder 出來的 EPUB）：
```
以EPUB 3.3 版本規則進行驗證。
沒偵測到任何錯誤以及警告訊息。
訊息: 0 個致命錯誤 / 0 個錯誤 / 0 個警告訊息 / 0 個參考提示
```

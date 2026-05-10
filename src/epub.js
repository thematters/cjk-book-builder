/**
 * @file epub.js
 * 用 JSZip 在瀏覽器產 W3C EPUB 3.3 valid 電子書。
 *
 * 為什麼 client-side：
 *   1. 不需要後端，使用者按下載即時打包
 *   2. 圖片可以從 client 看到的 CORS-friendly URL fetch (Cloudflare Images)
 *   3. 只需要 ~30KB JSZip CDN
 *
 * EPUB 3 spec 重點：
 *   - mimetype 必須是 zip 第一個檔 + uncompressed
 *   - META-INF/container.xml 指向 OEBPS/content.opf
 *   - content.opf 含 dc:metadata + manifest + spine
 *   - EPUB 3 nav 用 toc.xhtml (epub:type="toc")，加 toc.ncx 給舊 reader
 *   - 外連 img 必須塞進 zip OR 該 xhtml manifest 加 properties="remote-resources"
 */

import { escapeXml } from "./sanitize.js";

const JSZIP_CDN = "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js";

let _jsZipPromise = null;

/**
 * Lazy-load JSZip CDN。
 * @returns {Promise<void>}
 */
export const ensureJSZip = () => {
  if (typeof window !== "undefined" && window.JSZip) return Promise.resolve();
  if (_jsZipPromise) return _jsZipPromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("ensureJSZip() must run in browser"));
  }
  _jsZipPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = JSZIP_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("JSZip CDN load failed: " + JSZIP_CDN));
    document.head.appendChild(s);
  });
  return _jsZipPromise;
};

/**
 * 把 imagedelivery.net (Cloudflare Images) URL 轉成 ~900px 寬 + 85% 品質
 * 變體，避免下載原圖讓 EPUB 變幾十 MB。其他 CDN 不轉。
 * @param {string} url
 * @returns {string}
 */
export const transformCloudflareImage = (url) => {
  if (!/imagedelivery\.net\//.test(url)) return url;
  return url.replace(/\/[^\/?#]+([?#]|$)/, "/width=900,quality=85$1");
};

/**
 * 並行 fetch 所有遠端圖塞進 zip + 回傳 url→本地路徑 map
 * @param {Array<{ content: string }>} chapters
 * @param {*} zip JSZip instance
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {(url: string) => string} [transformUrl]
 * @returns {Promise<Map<string, { path: string, mediaType: string }>>}
 */
export const embedRemoteImages = async (chapters, zip, onProgress, transformUrl = transformCloudflareImage) => {
  const allUrls = new Set();
  const urlPattern = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/g;
  for (const c of chapters) {
    let m;
    const re = new RegExp(urlPattern.source, "g");
    while ((m = re.exec(c.content)) !== null) allUrls.add(m[1]);
  }
  const urls = [...allUrls];
  const total = urls.length;
  const urlToInfo = new Map();
  if (total === 0) return urlToInfo;

  let done = 0;
  const BATCH = 6;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (url) => {
        try {
          const fetchUrl = transformUrl(url);
          const res = await fetch(fetchUrl);
          if (!res.ok) throw new Error("HTTP " + res.status);
          const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
          const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
          const ext = extMap[ct] || "jpg";
          const blob = await res.blob();
          const localIdx = urlToInfo.size;
          const path = `images/img-${String(localIdx).padStart(3, "0")}.${ext}`;
          urlToInfo.set(url, { path, mediaType: ct, blob });
        } catch (e) {
          // fetch failed → 留遠端 URL，那個 chapter 會被標 properties="remote-resources"
          // eslint-disable-next-line no-console
          console.warn("[cjk-book-builder] image fetch failed", url, e.message);
        } finally {
          done++;
          onProgress?.(done, total);
        }
      })
    );
  }

  for (const info of urlToInfo.values()) {
    zip.file(`OEBPS/${info.path}`, info.blob);
  }
  return urlToInfo;
};

/**
 * @typedef {Object} EpubChapter
 * @property {string} id 唯一 id (manifest item id, NCX navPoint id)
 * @property {string} href 檔名 (相對於 OEBPS/，例如 "ch01-art01.xhtml")
 * @property {string} title TOC 顯示
 * @property {string} content 完整 XHTML 字串
 */

/**
 * @typedef {Object} EpubMetadata
 * @property {string} title 書名
 * @property {string} author 作者
 * @property {string} [language="zh-Hant"] 語言代碼
 * @property {string} [publisher] 出版社
 * @property {string} [identifier] 自訂 unique identifier (預設用 random uuid)
 */

/**
 * @typedef {Object} BuildEpubOptions
 * @property {EpubMetadata} metadata
 * @property {EpubChapter[]} chapters
 * @property {string} [css] 內文 stylesheet (寫入 styles/book.css)
 * @property {(done: number, total: number) => void} [onImageProgress]
 * @property {(url: string) => string} [transformImageUrl]
 */

/**
 * 包一本完整 EPUB 3.3 valid 電子書，回傳 .epub Blob。
 * @param {BuildEpubOptions} opts
 * @returns {Promise<Blob>}
 */
export const buildEpub = async (opts) => {
  const { metadata, chapters, css, onImageProgress, transformImageUrl } = opts;
  if (!metadata?.title) throw new Error("buildEpub: metadata.title required");
  if (!chapters?.length) throw new Error("buildEpub: chapters required");

  await ensureJSZip();
  const zip = new window.JSZip();

  const isoDate = new Date().toISOString().split(".")[0] + "Z";
  const bookId =
    metadata.identifier ||
    "urn:uuid:" +
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now() + "-" + Math.random().toString(36).slice(2));
  const language = metadata.language || "zh-Hant";

  // 1. mimetype 必須第一 + uncompressed
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. META-INF
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
      `  <rootfiles>\n` +
      `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
      `  </rootfiles>\n` +
      `</container>\n`
  );

  // 3. styles
  if (css) zip.file("OEBPS/styles/book.css", css);

  // 4. embed remote images + rewrite chapter content
  const chaptersCopy = chapters.map((c) => ({ ...c }));
  const urlToInfo = await embedRemoteImages(chaptersCopy, zip, onImageProgress, transformImageUrl);

  for (const c of chaptersCopy) {
    let hasRemote = false;
    c.content = c.content.replace(
      /(<img[^>]+src=["'])(https?:\/\/[^"']+)(["'])/g,
      (full, before, url, after) => {
        const local = urlToInfo.get(url);
        if (local) return `${before}${local.path}${after}`;
        hasRemote = true;
        return full;
      }
    );
    c.hasRemote = hasRemote;
    zip.file(`OEBPS/${c.href}`, c.content);
  }

  // 5. toc.xhtml (EPUB 3 nav)
  const navList = chaptersCopy
    .map((c) => `      <li><a href="${escapeXml(c.href)}">${escapeXml(c.title)}</a></li>`)
    .join("\n");
  zip.file(
    "OEBPS/toc.xhtml",
    xhtmlWrap(
      `<nav epub:type="toc" id="toc">\n  <h1>目錄</h1>\n  <ol>\n${navList}\n  </ol>\n</nav>`,
      "目錄",
      language,
      !!css
    )
  );

  // 6. toc.ncx (legacy, 給舊 reader)
  const navPoints = chaptersCopy
    .map(
      (c, i) =>
        `  <navPoint id="np-${c.id}" playOrder="${i + 1}">\n` +
        `    <navLabel><text>${escapeXml(c.title)}</text></navLabel>\n` +
        `    <content src="${escapeXml(c.href)}"/>\n` +
        `  </navPoint>`
    )
    .join("\n");
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">\n` +
      `  <head>\n` +
      `    <meta name="dtb:uid" content="${bookId}"/>\n` +
      `    <meta name="dtb:depth" content="1"/>\n` +
      `    <meta name="dtb:totalPageCount" content="0"/>\n` +
      `    <meta name="dtb:maxPageNumber" content="0"/>\n` +
      `  </head>\n` +
      `  <docTitle><text>${escapeXml(metadata.title)}</text></docTitle>\n` +
      `  <docAuthor><text>${escapeXml(metadata.author)}</text></docAuthor>\n` +
      `  <navMap>\n${navPoints}\n  </navMap>\n` +
      `</ncx>\n`
  );

  // 7. content.opf
  const chapterItems = chaptersCopy
    .map((c) => {
      const props = c.hasRemote ? ` properties="remote-resources"` : "";
      return `    <item id="${c.id}" href="${escapeXml(c.href)}" media-type="application/xhtml+xml"${props}/>`;
    })
    .join("\n");
  let imgIdx = 0;
  const imageItems = [...urlToInfo.values()]
    .map((info) => {
      const id = `img-${String(imgIdx++).padStart(3, "0")}`;
      return `    <item id="${id}" href="${escapeXml(info.path)}" media-type="${info.mediaType}"/>`;
    })
    .join("\n");
  const spineItems = chaptersCopy.map((c) => `    <itemref idref="${c.id}"/>`).join("\n");

  const publisherMeta = metadata.publisher
    ? `\n    <dc:publisher>${escapeXml(metadata.publisher)}</dc:publisher>`
    : "";

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid">\n` +
      `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
      `    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>\n` +
      `    <dc:title>${escapeXml(metadata.title)}</dc:title>\n` +
      `    <dc:creator>${escapeXml(metadata.author)}</dc:creator>\n` +
      `    <dc:language>${escapeXml(language)}</dc:language>` +
      publisherMeta +
      `\n    <meta property="dcterms:modified">${isoDate}</meta>\n` +
      `  </metadata>\n` +
      `  <manifest>\n` +
      `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n` +
      `    <item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n` +
      (css ? `    <item id="css" href="styles/book.css" media-type="text/css"/>\n` : "") +
      `${chapterItems}\n` +
      (imageItems ? imageItems + "\n" : "") +
      `  </manifest>\n` +
      `  <spine toc="ncx">\n` +
      `    <itemref idref="nav"/>\n` +
      `${spineItems}\n` +
      `  </spine>\n` +
      `</package>\n`
  );

  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
};

/**
 * 包一個 chapter 內容成完整 XHTML doc 字串
 * @param {string} body
 * @param {string} title
 * @param {string} [language="zh-Hant"]
 * @param {boolean} [withCss=true]
 * @returns {string}
 */
export const xhtmlWrap = (body, title, language = "zh-Hant", withCss = true) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<!DOCTYPE html>\n` +
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}">\n` +
  `<head>\n` +
  `  <meta charset="UTF-8"/>\n` +
  `  <title>${escapeXml(title || "")}</title>\n` +
  (withCss ? `  <link rel="stylesheet" type="text/css" href="styles/book.css"/>\n` : "") +
  `</head>\n` +
  `<body>\n${body}\n</body>\n</html>\n`;

/**
 * 觸發瀏覽器下載 Blob 為檔案
 * @param {Blob} blob
 * @param {string} filename
 */
export const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

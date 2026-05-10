# 中文書版心慣例

`@thematters/cjk-book-builder` 內建的 stylesheet 依據台灣 / 中文出版業常見規範。

## 開本尺寸

| 名稱 | 尺寸 (mm) | 用途 |
|---|---|---|
| **A5** | 148 × 210 | 散文集、輕小說、雜誌書（預設） |
| 25K | 148 × 210 | 跟 A5 同 |
| 32K | 130 × 190 | 文庫本、口袋書 |
| B5 | 176 × 250 | 教科書、文集 |
| 16K | 188 × 257 | 大本書、藝術書 |

預設 stylesheet 用 A5。要換規格改 `@page size`：

```css
@page { size: 130mm 190mm; } /* 32K */
@page { size: B5 portrait; }
```

## 版心邊距

中文書通常比西文書留更多天頭地腳，給讀者「呼吸」空間：

| 邊距 | 規格 | 說明 |
|---|---|---|
| 天頭 (top) | 18mm | 上方留白，習慣放小章節名 |
| 訂口 (inner) | 18-20mm | 釘書邊，要寬一點避免文字被釘住 |
| 切口 (outer) | 14-16mm | 翻頁邊 |
| 地腳 (bottom) | 22mm | 留頁碼空間 |

預設 stylesheet 用 18mm / 16mm / 22mm 對稱版心 (現代散文集常見)。

## 內文字級

| 場景 | 字級 | 行高 |
|---|---|---|
| **內文** | 11pt | 1.85 |
| 標題 h2 | 16pt | 1.4 |
| 章節 h1 | 22pt | 1.2 |
| 引言 blockquote | 11pt | 1.85 (縮排兩字) |
| 圖說 figcaption | 9pt | 1.5 |
| 頁碼 | 9pt | 0.16em letter-spacing |

行高 1.85 是針對 jf-jinxuan / Noto Serif TC 等常用字體實測，確保中英混排時 baseline 不擠。

## 段落格式

中文書段落格式四個關鍵：

1. **段首縮排兩個字**：`text-indent: 2em`
2. **章節後第一段不縮排**：`h2 + p, h3 + p { text-indent: 0 }`
3. **不要 justify**：中文沒有 word break，justify 會把字距拉成超寬間隔
4. **段落間距 0.5 行**：`margin: 0 0 0.5em`

```css
p {
  margin: 0 0 0.5em;
  text-indent: 2em;
  text-align: left;     /* 不是 justify！ */
  font-size: 11pt;
  line-height: 1.85;
}
```

## 字體建議

依 fallback 順序 (從最理想到備選)：

```css
font-family:
  "PingFang TC",         /* macOS / iOS 內建 */
  "Noto Serif TC",       /* Google Fonts，跨平台 */
  "Source Han Serif TC", /* Adobe 思源宋 */
  serif;                 /* 系統 fallback */
```

如果想用商用字體 (jf-jinxuanlatte, 文鼎晶熹明朝 等)，記得先做 subset 減小檔案。

## 標點懸掛 (hanging punctuation)

CSS 4 的 `hanging-punctuation` 可以讓引號、句號懸掛在版心外，視覺更乾淨。但目前主流瀏覽器支援度不足 (Safari only at 2026/05)，跨平台還不能依賴。

## 換頁規則

| 元素 | 規則 | 說明 |
|---|---|---|
| h1, h2, h3 | `break-after: avoid` | 標題不能在頁尾 |
| figure | `break-inside: avoid` | 圖片不要被切兩半 |
| blockquote | `break-inside: avoid` | 引言保持完整 |
| 章節 (cover/divider/closing) | `break-after: page` | 強制換頁 |

## 參考

- [中文排版需求 (W3C clreq)](https://www.w3.org/TR/clreq/)
- [台灣出版業設計規範](https://www.taipeibookfair.org.tw/)
- 思源宋體設計報告 (Source Han Serif design report)

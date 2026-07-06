# 🎬 Video to PPT 簡報自動擷取工具 (v1.01)

本工具是一套高效率的簡報擷取系統，支援影片本機快速解碼、換頁偵測、畫廊打勾篩選與多格式（PDF、ZIP、HTML、JSON）打包導出。我們提供兩種平台版本，以適應不同的託管需求。

---

## 🔒 版權宣告與版權標記 (Copyright & Watermark)
*   **版權所有**：Copyright © 2026 Falo x Force Cheng. All rights reserved.
*   **軟體版本**：v1.01 (2026/7/6)
*   **授權標記**：`Falo x Force Cheng 2026/7/6 v1.01`
*   **SEO、備註與浮水印寫入**：
    *   **SEO Meta 標記**：所有導出的 HTML 檔案與主網頁的 `<head>` 中皆已寫入 `author`、`copyright` 與 `description`。
    *   **代碼備註 (Remarks)**：`index.html`、`index.css` 與 `index.js` 檔案頂部均有版權備註。
    *   **隱藏浮水印 (Watermark)**：所有網頁底部與導出的 HTML 報告均內嵌了隱藏的 `<div style="display: none;" data-watermark="...">` 版權特徵，並在瀏覽器開發者主控台（Console）初始化時輸出彩色的版權宣告資訊。

---

## 💡 專案核心精神 (Project Credo)
1.  **📌 知識管理 (KM) 與經驗傳承**：
    本專案旨在高效率捕捉專家分享、教學影片中的精華簡報畫面，將其結構化儲存為輕量化的知識檔案，建立個人與組織的知識記憶庫。
2.  **⚡ 零運行成本運算 (No Token Cost)**：
    執行過程完全依靠 OpenCV（Python 版）與瀏覽器 Canvas（網頁版）的本機端電腦視覺演算法（包含 MAE 影格變異追蹤、dHash 去重與邊緣對比分析），**運算完全在本地端完成，不耗費任何 AI API Token 費用**。
3.  **🤝 人機協調驗證 (Human-in-the-Loop)**：
    利用演算法進行大批量快速自動化影格過濾，再透過「雙向滑塊對比」畫廊交由人類做出最終的勾選確認，達到最精確的人機協作實踐。

---

## 🧬 技術工作流程 (Workflow Overview)
本系統演算法原理基於車流量與「變動監控」技術（類似於高速公路變動監控演算法），利用空間域算法與數學矩陣去精確推算「靜止」與「跳頁」的分界點，排除影片中的動態干擾畫面。

```
[影片載入] ──> [畫面變化偵測 (MAE 計算)] ──> [換頁推測] ──> [相似度分析 (dHash)] ──> [模糊檢測] ──> [重複頁排除] ──> [產生候選投影片畫廊]
```

---

## 📦 平台版本部署說明 (Two Platforms)

本專案已打包為兩個平台的獨立安裝包，其細節與部署方式如下：

### 📁 1. GitHub Pages 靜態版 (純本機解碼版)
*   **特點**：不需要伺服器後端，100% 在使用者瀏覽器內進行運算，隱私安全性高、速度極快，託管完全免費。
*   **適用路徑**：`falo-taiwan-video-to-ppt/`
*   **包含檔案**：
    *   `index.html` (主網頁)
    *   `index.css` (樣式表)
    *   `index.js` (前台掃描與跨網域代理)
    *   `chrome-extension.zip` (專屬 Chrome 擷取外掛)
*   **部署步驟**：
    1. 將此目錄下的所有檔案上傳至您的 GitHub 儲存庫（例如 `video-to-ppt`）。
    2. 進入該儲存庫的 **Settings** -> **Pages**。
    3. 在 **Build and deployment** 下方的 Branch 選擇 `main`，路徑選擇 `/ (root)`，點擊 **Save**。
    4. 大約 1 分鐘後，即可在 `https://<您的帳號>.github.io/video-to-ppt/` 上線使用！
*   **YouTube 跨域代理支援**：由於 GitHub Pages 是靜態主機，當使用者在此網域下解析 YouTube 影片網址時，本機 JavaScript 會自動將請求代理重導向至部署於 Cloudflare 的 Workers 後端進行影音串流轉發，免去跨域 (CORS) 阻擋。

---

### 📁 2. Cloudflare Workers 雲端版 (伺服器代理 + 靜態託管版)
*   **特點**：結合了 R2 雲端儲存與 R2 Ranged 下載代理，並可直接託管靜態前端資源。
*   **適用路徑**：`cloudflare-version/`
*   **包含檔案**：
    *   `wrangler.toml` (Cloudflare 部署設定設定檔)
    *   `package.json` (依賴套件檔)
    *   `src/index.js` (Cloudflare Worker API/Proxy 後端程式)
    *   `public/` (前端靜態資源，內含 `index.html`, `index.css`, `index.js`, `chrome-extension.zip` 等)
*   **部署步驟**：
    1. 確認本機已安裝 [Node.js](https://nodejs.org/)。
    2. 在該目錄下打開終端機，執行登入命令：
       ```bash
       npx wrangler login
       ```
    3. 執行部署命令：
       ```bash
       npx wrangler deploy
       ```
    4. 部署成功後，Wrangler 會輸出您的專屬專案網址（例如 `https://video-to-ppt-serverless.<您的子網域>.workers.dev`），即可在線上提供服務。

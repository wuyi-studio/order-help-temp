# 梧藝 WUYI 下單小幫手 Chrome 擴充功能 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為「梧藝 WUYI」打造專用的 Chrome 擴充功能，在 LINE 官方客服聊天室（`chat.line.biz`）一鍵自動抓取客製化蛋糕與花束訂單資訊、合成取貨確認小卡、格式化輸出 Apple 備忘錄排程文字與金額明細，並同步至 Google 試算表。

**Architecture:** 採用 Manifest V3 架構。Content Script 注入 LINE 後台建立側邊欄與可拖曳浮動視窗；Service Worker 跨域獲取圖片 Data URL 解決 Canvas CORS 污染；前端 HTML5 Canvas 本地渲染高解析度小卡並直接寫入系統剪貼簿；透過 Google Apps Script Webhook 依 20 項標準欄位自動歸檔試算表並防重複。

**Tech Stack:** JavaScript (ES6+), Chrome Extension Manifest V3, HTML5 Canvas 2D API, Google Apps Script, Node.js (用於單元測試與驗證).

**Spec:** [`docs/superpowers/specs/2026-11-08-wuyi-order-chrome-extension-design.md`](file:///Users/Leon/Desktop/01_WUYI%20%E6%A2%A7%E8%97%9D%E7%87%9F%E9%81%8B%E7%B3%BB%E7%B5%B1/WUYI%20%E4%B8%8B%E5%96%AE%E5%B0%8F%E5%B9%AB%E6%89%8BCHROME%E6%8F%92%E4%BB%B6/docs/superpowers/specs/2026-11-08-wuyi-order-chrome-extension-design.md)

## Global Constraints

- 擴充功能必須符合 Chrome Extension Manifest V3 規範。
- 不修改 LINE 官方帳號伺服器資料或直接呼叫私有 LINE API，所有互動均透過前端 DOM 與剪貼簿。
- 取貨確認小卡圖片**嚴禁包含任何金額明細**。
- 加購項目在小卡上必須以紫色膠囊背景高亮顯示（`#F3E8FF` / `#7E22CE`）。
- Apple 備忘錄複製文字必須原汁原味保留原始換行與文字排版，不擅自更改結構。
- Google 試算表欄位必須完全對齊既有 20 項標準核帳欄位，並支援重複同步覆蓋（Upsert）。

## Review Focus

1. **跨域圖片導致 Canvas 污染**：直接將 LINE CDN（`*.line-scdn.net`）圖片繪製到 Canvas 會使 `canvas.toBlob` 拋出安全性例外。必須由 Service Worker 抓取二進位資料並轉為 Base64 Data URL 後再繪製。
2. **LINE 後台聊天室文字非標準換行**：對話中的題字可能包含空行、多個換行或特殊符號，正則剖析必須保護題字區塊，不截斷亦不把題字誤判為價格行。
3. **缺少加購截圖時的版面適應**：若客製蛋糕未加購蠟燭（無加購圖），小卡上方應平滑退回單一蛋糕款式圖排版，不可留白或產生壞圖。
4. **Google 試算表重複送單**：客服因修改重複點擊同步按鈕時，GAS 端必須比對「取貨日＋顧客姓名＋聯絡電話」，執行更新而非重複插入。
5. **浮動視窗拖曳越界**：在小螢幕或拖曳超出瀏覽器可視區域時，視窗必須有邊界保護（bounding clamp），確保關閉與切換按鈕始終可點擊。

---

### Task 1: 專案基礎骨架與 Manifest V3 配置

**Files:**
- Create: `manifest.json`
- Create: `src/background/service-worker.js`
- Create: `src/assets/icons/icon16.png`, `icon48.png`, `icon128.png`
- Test: `tests/test-manifest.js`

**Interfaces:**
- Produces: Service Worker 訊息監聽器 `chrome.runtime.onMessage`，接收 `{ action: "fetchImageAsDataUrl", url: string }`，回傳 `{ success: boolean, dataUrl: string }`。

- [ ] **Step 1: 撰寫 Manifest 規範與 Service Worker 驗證測試**
  撰寫 `tests/test-manifest.js` 驗證 `manifest.json` 包含所需權限（`activeTab`, `storage`, `clipboardWrite`）及 host_permissions（`https://chat.line.biz/*`, `https://*.line-scdn.net/*`, `https://*.line.me/*`）。
- [ ] **Step 2: 執行測試確認失敗**
  Run: `node tests/test-manifest.js`
  Expected: FAIL with "Cannot find module '../manifest.json'".
- [ ] **Step 3: 建立 Manifest V3 與圖示資源**
  建立 `manifest.json` 與尺寸為 16/48/128 的擴充功能圖示。
- [ ] **Step 4: 實作 `service-worker.js` 跨域圖片轉 Data URL 邏輯**
  在 `src/background/service-worker.js` 處理 `fetchImageAsDataUrl`，使用 `fetch()` 取得 Blob 並轉換為 Data URL 回傳前端。
- [ ] **Step 5: 執行測試確認通過**
  Run: `node tests/test-manifest.js`
  Expected: PASS.
- [ ] **Step 6: Commit**
  `git add manifest.json src/background tests/ && git commit -m "feat: setup manifest v3 and service worker"`

---

### Task 2: 訂單資訊與金額明細智能解析引擎 (Extractor Engine)

**Files:**
- Create: `src/content/extractor.js`
- Test: `tests/test-extractor.js`

**Interfaces:**
- Produces:
  `Extractor.parseOrderText(text: string) -> OrderState`
  `Extractor.parsePricingText(text: string) -> PricingState`
  `Extractor.formatRawOrder(orderState: OrderState) -> string`

- [ ] **Step 1: 撰寫解析引擎的單元測試**
  在 `tests/test-extractor.js` 測試：
  1. 純蛋糕訂單文字解析（圖款、題字多行、尺寸、口味、加購、取貨日、時、地、姓名電話）。
  2. 純花束訂單解析（預算、色系、提袋、備註）。
  3. 花束＋蛋糕組合訂單解析（兩區塊完整分離）。
  4. 金額明細解析（從「蛋糕$...」到「總共$...」）。
  5. 逆向格式化輸出 Apple 備忘錄原始文字（保證格式完全不變）。
- [ ] **Step 2: 執行測試確認失敗**
  Run: `node tests/test-extractor.js`
  Expected: FAIL with "Extractor is not defined".
- [ ] **Step 3: 實作 `extractor.js`**
  引入保護關鍵字、題字連續多行保護狀態機、加購識別正則，以及金額加總段落擷取演算法。
- [ ] **Step 4: 執行測試確認通過**
  Run: `node tests/test-extractor.js`
  Expected: PASS (所有範例文字均精準剖析為結構化物件並可還原)。
- [ ] **Step 5: Commit**
  `git add src/content/extractor.js tests/test-extractor.js && git commit -m "feat: implement order and pricing extractor engine"`

---

### Task 3: HTML5 Canvas 取貨確認小卡渲染引擎 (Card Renderer)

**Files:**
- Create: `src/content/card-renderer.js`
- Test: `tests/test-card-renderer.js`

**Interfaces:**
- Consumes: `OrderState` (from `extractor.js`)
- Produces:
  `CardRenderer.renderCard(orderState: OrderState, options: RenderOptions) -> Promise<HTMLCanvasElement>`
  `CardRenderer.copyCardToClipboard(canvas: HTMLCanvasElement) -> Promise<boolean>`
  `CardRenderer.downloadCard(canvas: HTMLCanvasElement, filename: string) -> void`

- [ ] **Step 1: 撰寫 Canvas 渲染邏輯測試**
  在 `tests/test-card-renderer.js` 測試三種情境（純蛋糕雙圖、純蛋糕單圖、花束蛋糕組合）下各座標、自動斷行高度計算及小卡標籤渲染，並驗證產出結果不含任何價格字樣。
- [ ] **Step 2: 執行測試確認失敗**
  Run: `node tests/test-card-renderer.js`
  Expected: FAIL with "CardRenderer is not defined".
- [ ] **Step 3: 實作 `card-renderer.js`**
  使用 Canvas 2D API 實作：
  - 雙圖並排與單圖自適應網格。
  - 梧藝品牌徽章與標題渲染。
  - 紫色加購膠囊標記繪製。
  - 文字自動斷行計算。
  - `toBlob` 轉 PNG 與 `navigator.clipboard.write` 複製到剪貼簿功能。
- [ ] **Step 4: 執行測試確認通過**
  Run: `node tests/test-card-renderer.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/content/card-renderer.js tests/test-card-renderer.js && git commit -m "feat: implement html5 canvas card renderer"`

---

### Task 4: 側邊欄與自由浮窗雙模式 UI 整合 (Content Script)

**Files:**
- Create: `src/content/content.js`
- Create: `src/content/content.css`
- Test: `tests/test-ui-dom.js`

**Interfaces:**
- Consumes: `Extractor`, `CardRenderer`
- Produces: 注入 `chat.line.biz` 的主介面，包含右側把手、抽屜/浮窗切換、拖曳控制、即時欄位雙向綁定與五大快捷按鈕。

- [ ] **Step 1: 撰寫 UI 結構與事件綁定測試**
  在 `tests/test-ui-dom.js` 驗證：
  1. DOM 節點渲染（側邊欄容器、把手、拖曳條、按鈕列）。
  2. 模式切換邏輯（`isFloating` 狀態切換與 CSS class 變化）。
  3. 視窗拖曳座標限制（不超出 viewport）。
  4. 一鍵複製完整文字、單獨複製金額、複製小卡圖片之事件處理。
- [ ] **Step 2: 執行測試確認失敗**
  Run: `node tests/test-ui-dom.js`
  Expected: FAIL with "UI component not mounted".
- [ ] **Step 3: 實作 `content.js` 與 `content.css`**
  - 建置側邊欄 UI 抽屜與懸浮按鈕。
  - 實作滑鼠拖曳（Mousedown / Mousemove / Mouseup）與螢幕邊界保護。
  - 綁定 LINE 對話泡泡搜尋與抓取動作（`[⚡]` 及 `[🔄]`）。
  - 綁定剪貼簿寫入與 Toast 提示動畫（如「已複製小卡圖片！」、「已複製備忘錄格式！」）。
- [ ] **Step 4: 執行測試確認通過**
  Run: `node tests/test-ui-dom.js`
  Expected: PASS.
- [ ] **Step 5: Commit**
  `git add src/content/content.js src/content/content.css tests/test-ui-dom.js && git commit -m "feat: implement extension drawer and floating window ui"`

---

### Task 5: Google 試算表 Webhook 與設定頁面

**Files:**
- Create: `google-apps-script/Code.gs`
- Create: `src/options/options.html`
- Create: `src/options/options.js`
- Create: `src/options/options.css`
- Test: `tests/test-gas-mapping.js`

**Interfaces:**
- Produces:
  `Code.gs`: 處理 POST 請求，對應 20 項標準核帳欄位並以年月份建立 Sheet，執行 Upsert。
  `options.js`: 儲存與讀取 `googleSheetsWebhookUrl` 至 `chrome.storage.sync`。

- [ ] **Step 1: 撰寫 20 項標準欄位映射與 Upsert 測試**
  在 `tests/test-gas-mapping.js` 驗證前端送出的 payload 能精確轉換為 20 欄標準格式（包含星期自動推算、商品類別自動判定、加購布林值轉換）。
- [ ] **Step 2: 執行測試確認失敗**
  Run: `node tests/test-gas-mapping.js`
  Expected: FAIL.
- [ ] **Step 3: 撰寫 `Code.gs` 試算表端服務腳本**
  提供完整的 Google Apps Script 腳本，具備自動建表、欄位對齊、以「取貨日+姓名+電話」去重更新或新增。
- [ ] **Step 4: 實作擴充功能設定頁面 `options.html` / `options.js`**
  讓使用者可隨時輸入或變更 Google Apps Script 網址與門市預設資訊。
- [ ] **Step 5: 執行測試確認通過**
  Run: `node tests/test-gas-mapping.js`
  Expected: PASS.
- [ ] **Step 6: Commit**
  `git add google-apps-script/ src/options/ tests/test-gas-mapping.js && git commit -m "feat: implement google sheets integration and options page"`

---

### Task 6: 整合測試、打包與安裝指引文件

**Files:**
- Create: `README.md`
- Create: `scripts/package.js` (一鍵打包 zip)
- Test: `tests/test-full-flow.js`

- [ ] **Step 1: 撰寫端到端全流程驗證測試**
  驗證：從對話模擬文字 -> 抓取 -> 結構化狀態 -> 生成小卡 Blob -> 備忘錄純文字 -> 試算表 Payload 完整無斷裂。
- [ ] **Step 2: 執行全流程測試**
  Run: `node tests/test-full-flow.js`
  Expected: PASS (所有流程與格式驗證通過)。
- [ ] **Step 3: 建立一鍵打包腳本與擴充功能說明書**
  撰寫 `README.md`，提供客服人員在 Chrome 安裝擴充功能（開啟開發者模式 -> 載入未封裝項目）的清晰圖文指引。
- [ ] **Step 4: Commit**
  `git add README.md scripts/ tests/ && git commit -m "docs: add setup guide and end-to-end verification"`

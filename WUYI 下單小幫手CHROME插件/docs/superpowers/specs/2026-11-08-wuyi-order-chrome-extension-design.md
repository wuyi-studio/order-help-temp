# 梧藝 WUYI 下單小幫手 Chrome 擴充功能 設計規格書

## 1. 緣起與目標 (Intent & Why)
梧藝（WUYI）客服團隊在 LINE 官方帳號後台（`chat.line.biz`）處理訂單時，需頻繁進行以下重複性作業：
1. 從顧客對話中找出訂單規格（蛋糕、花束、題字、加購項目、取貨時間、姓名電話）。
2. 核算金額明細並傳送給客人確認。
3. 將未變更的訂單文字貼至 Apple 備忘錄，進行每日製作排程。
4. 製作／發送「取貨確認小卡」（供顧客於取貨當日出示核對）。
5. 登記到 Google 試算表（依年/月/日分類）。

本專案旨在打造一款專用的 **Chrome 擴充功能（Chrome Extension, Manifest V3）**，在 LINE 官方客服聊天室右側內嵌側邊欄／浮窗，一鍵自動抓取對話中的訂單文字與照片、提供結構化與全文彈性編輯、一鍵複製多種格式，並在瀏覽器本地即時合成高解析度「取貨確認小卡」圖片直接複製到剪貼簿。

---

## 2. 目標與非目標 (Goals, Non-goals, Anti-goals)

### Goals
- 深度整合 LINE 官方帳號後台（`chat.line.biz`），支援主動手動點擊觸發擷取當前聊天室內容。
- 支援「純蛋糕」、「純花束」、「花束＋蛋糕」三種訂單結構。
- 提供雙模式介面：一鍵切換「右側收合式側欄 (Sidebar)」與「自由拖曳浮動小視窗 (Floating Window)」。
- 提供一鍵抓取按鈕 `[⚡ 一鍵抓取當前 LINE 對話]` 及小圖示重新整理按鈕 `[🔄]`。
- 具備雙層資料狀態管理：提供結構化欄位編輯與全文 Textarea 預覽，即時同步更新取貨小卡與備忘錄文字。
- 支援五種一鍵快速輸出動作：
  1. `[📋 複製完整訂單文字 (貼備忘錄)]`（完全保留原始格式，直出貼至 Apple 備忘錄）。
  2. `[💵 單獨複製金額明細]`（僅複製「蛋糕$...」到「總共$...」段落）。
  3. `[🖼️ 複製取貨確認小卡]`（本地 HTML5 Canvas 高清渲染，不含金額，支援雙圖與花束規格，直接以 PNG Blob 寫入剪貼簿，客服可直接在聊天室 `Ctrl+V`/`Cmd+V` 貼上）。
  4. `[💾 下載小卡圖片]`。
  5. `[📊 同步至 Google 試算表]`（透過 Google Apps Script Web App Webhook，以 年/月/日 分類登記，支援依取貨日+姓名+電話 Upsert 防重複）。

### Non-goals
- 不修改 LINE 官方帳號伺服器端資料或直接發送 LINE API 訊息（所有操作均在客服前端以輔助複製/貼上完成，完全合法、安全且防封號）。
- 不依賴需要後端付費伺服器的圖片渲染服務（所有圖片均在瀏覽器前端 Canvas 本地合成）。

### Anti-goals
- 嚴禁卡頓客服瀏覽器，DOM 監聽必須輕量化，不搞自動全域監聽干擾客服打字。
- 避免複雜的 Google Cloud OAuth 驗證門檻，改用零配置難度的 Google Apps Script Webhook 網址機制。

---

## 3. 架構方案評估 (Approaches)

- **方案 A（已選定）：Content Script 頁面內嵌抽屜／浮窗 ＋ 本地 Canvas 圖片生成 ＋ Apps Script 輕量 Webhook**
  - **優點**：與客服工作流零切換，按鍵反應即時；Canvas 本地渲染毫秒級完成並直接存入剪貼簿；外掛結構清晰，安裝即可使用。
  - **缺點**：若 LINE 官方後台大改 DOM 結構需適度更新選擇器（透過智能 Regex 與語意匹配減少依賴）。
- **方案 B（捨棄）：Chrome 原生 SidePanel API ＋ 後端圖片渲染伺服器**
  - **捨棄原因**：Chrome 原生 SidePanel 無法自由切換成拖曳式浮動視窗；後端渲染圖片增加部署與伺服器維護成本，速度不如前端 Canvas 即時。

---

## 4. 詳細系統規格與流程 (Detailed Specification)

### 4.1 擴充功能目錄架構 (Manifest V3)
```text
wuyi-order-helper/
├── manifest.json              # Manifest V3 定義，權限包括 activeTab, storage, clipboardWrite, host_permissions
├── src/
│   ├── background/
│   │   └── service-worker.js  # 輔助背景腳本（支援跨域抓取圖片 Blob 避免 Canvas Taint）
│   ├── content/
│   │   ├── content.js         # 注入 chat.line.biz 的主腳本（UI 與事件監聽）
│   │   ├── content.css        # 側邊欄與浮動面板樣式
│   │   ├── extractor.js       # 訂單文字與金額解析邏輯（基於梧藝標準正則規則庫）
│   │   └── card-renderer.js   # HTML5 Canvas 取貨小卡渲染引擎
│   ├── popup/
│   │   ├── popup.html         # 備用工具視窗
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   │   ├── options.html       # 設定頁面（Google Sheets Webhook URL、預設門市資訊等）
│   │   └── options.js
│   └── assets/
│       ├── icons/             # 擴充功能圖示 (16, 48, 128)
│       └── logo.png
└── google-apps-script/
    └── Code.gs                # 供使用者一鍵部署至 Google 試算表的腳本範本
```

### 4.2 智能解析引擎 (Extractor Logic)
1. **觸發方式**：點擊 `[⚡ 一鍵抓取當前 LINE 對話]` 或 `[🔄]`。手動點擊觸發，不搞自動暗中擷取，避免覆蓋客服正在修改的內容。
2. **訊息獲取**：
   - 抓取當前選中聊天室中的所有聊天氣泡（Chat Bubbles）。
   - 由最新至歷史訊息逆向檢索：
     - **訂單文字區塊**：尋找包含關鍵字（如 `圖款`、`蛋糕尺寸`、`取貨日期`、`訂購人`、`精緻包裝花束` 等）的訊息。
     - **金額明細區塊**：尋找包含 `蛋糕$`、`加購`、`總共$`、`幫您加總` 等結構的訊息，擷取自金額起點至「總共$...」結尾。
     - **圖片抓取**：由對話中依順序取得圖片 URL，透過 Service Worker 轉為 Data URL 避免 Canvas CORS Taint。預設第一張分配為蛋糕圖，若有第二張分配為加購蠟燭圖，若有花束訂單則依順序智能分配。
3. **雙層狀態模型 (State Architecture)**：
   - 核心狀態維持結構化物件：
     - `orderType`: `'cake'` | `'flower'` | `'combined'`
     - `flower`: `{ budget, color, paper, note, image }`
     - `cake`: `{ style, inscription, size, flavor, addon, cakeImage, addonImage }`
     - `pickup`: `{ date, time, location }`
     - `customer`: `{ lineName, name, phone }`
     - `pricing`: `{ breakdownText, total }`
     - `rawText`: 依上述結構合成的完整 Apple 備忘錄原始排版文字。
   - 介面提供獨立欄位編輯，任何欄位異動會即時更新 `rawText` 與 Canvas 預覽；客服亦可直接修改 `rawText`，確保最高彈性。

### 4.3 介面設計與雙模式切換
- **右側浮動把手**：在 `chat.line.biz` 右側常駐一個精美的半透明小圓角標籤（🍰 梧藝下單），點擊即平滑滑出。
- **模式切換**：
  - `[⧉ 切換浮窗]`：固定在右側的側邊欄（380px）轉為可在視窗任意拖曳、調整位置的浮動對話盒。
  - `[⇥ 切換側欄]`：浮窗瞬間貼回右側抽屜。
- **表單元件配置**：
  - 上方：`[ ⚡ 一鍵抓取當前 LINE 對話 ] [ 🔄 ]`
  - 圖片管理卡槽（含預覽縮圖、更換、清除、本地上傳按鈕）：
    - 蛋糕款式圖
    - 加購蠟燭截圖
    - 花束參考圖（若為花束或組合單時展開）
  - 規格編輯欄位（摺疊/展開切換，支援細部調整）
  - 原始備忘錄文字預覽（Textarea）
  - 金額明細預覽（Textarea）
  - 底部五大操作按鈕

### 4.4 取貨確認小卡渲染引擎 (Card Renderer)
- 使用前端純 HTML5 Canvas 2D Context 進行 2x Retina 超高清渲染。
- **三種排版型態**：
  1. **純蛋糕訂單**：寬 760px，頂部「蛋糕款式圖」與「加購蠟燭圖」並排；下方接題字、尺寸口味、紫色膠囊加購標籤、取貨時間地點、訂購人聯絡資訊。
  2. **純花束訂單**：寬 760px，頂部「花束參考圖」；右側放預算、色系、提袋、備註；下方放取貨資訊與訂購人聯絡資訊。
  3. **花束 ＋ 蛋糕組合訂單**：寬 760px，上方區塊 1 為花束圖與花束規格，下方區塊 2 為蛋糕款式圖（及加購圖）與蛋糕完整規格。
- **重要原則**：小卡上**完全不包含金額明細**。
- **剪貼簿寫入**：利用 `canvas.toBlob` 取得 PNG，透過 `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])` 寫入系統剪貼簿。

### 4.5 輸出與 Google 試算表（GAS）整合
- 對接梧藝既有記帳系統之 20 項標準欄位結構：
  `取貨日期, 星期, 顧客姓名, 聯絡電話, LINE名稱, 商品類別, 蛋糕規格, 花束規格, 訂單總額, 蛋糕口味說明, 蛋糕題字/插牌內容, 慶祝歲數, 加購保冰袋, 加購餐具, 加購蠟燭, 加購插牌, 花束色系, 取件時間, 取件地點/配送, 原始備忘錄檔案`
- **防重複 (Upsert 機制)**：
  - Google Apps Script 收到 Webhook POST 時，自動鎖定當前年月份工作表（如 `2026-11`）。
  - 比對第 1 欄（取貨日期）＋第 3 欄（顧客姓名）＋第 4 欄（聯絡電話）。
  - 若已存在則更新該行數值，若不存在則依照日期順序新增一列，杜絕重複點擊造成的記帳混亂。

---

## 5. 實作者指引 (Left to the Builder)
- LINE 官方後台 DOM 選擇器適應（使用兼具 class、屬性及文字特徵的 robust selector）。
- 浮動視窗在不同解析度螢幕下的邊界限制防溢出。
- Canvas 文字自動斷行（Auto-wrap）計算引擎。

# 🍰 梧藝 WUYI 下單小幫手 Chrome 擴充功能

專為「梧藝 WUYI」官方 LINE 客服團隊（`chat.line.biz`）量身打造的下單輔助 Chrome 插件。
一鍵自動擷取對話規格、生成無金額取貨確認小卡、保留原始排版複製到 Apple 備忘錄，並無縫同步至 Google 試算表（依年/月/日分類）。

---

## 🌟 主要功能特點

1. **⚡ 一鍵自動抓取 LINE 對話**
   - 點擊 `[⚡ 一鍵抓取當前 LINE 對話]` 或 `[🔄]`，自動辨識當前客人的訂單內容（蛋糕款式、題字、尺寸口味、加購、取貨日/時/地、聯絡人）與金額明細（蛋糕$...到總共$...）。
   - 自動將對話中的蛋糕款式圖與加購蠟燭截圖帶入預覽槽。
2. **🖼️ 一鍵複製「取貨確認小卡」圖檔 (可直接貼 LINE)**
   - 前端 HTML5 Canvas 超高清渲染（寬 760px，支援純蛋糕雙圖、純花束、花束+蛋糕三種排版）。
   - **完全不含金額**（供顧客於取貨當天出示核對）。
   - 加購商品以精緻**淺紫色螢光標記**（`#F3E8FF` / `#7E22CE`），避免現場漏拿配件。
   - 直接複製為 PNG 圖檔至系統剪貼簿，客服在 LINE 對話輸入框按 `Ctrl+V`（Mac: `Cmd+V`）即可直接傳送！
3. **📋 一鍵複製 Apple 備忘錄格式**
   - 原汁原味保留原始對話排版與換行結構，方便排程貼至每日製作備忘錄。
4. **💵 單獨複製金額明細**
   - 單獨複製加總項目（例如：`蛋糕$790 \n 2人餐具$15 \n 蠟燭x2$90 \n 總共$895`），方便客服發送給客人再次核對款項。
5. **📊 同步至 Google 試算表 (依年月分類 + 防重複 Upsert)**
   - 對接梧藝既有 20 項標準核帳欄位（取貨日期、星期、姓名、電話、商品規格、加購配件布林值等）。
   - 自動以年份月份建立工作表（例如 `2026-11`）。
   - 若修改同一張單重複點擊，自動比對（取貨日＋姓名＋電話）覆寫更新，不產生多餘重複行。
6. **⧉ 雙模式自由切換**
   - 點擊按鈕可在**「右側收合抽屜」**與**「自由拖曳浮動視窗」**之間隨意切換。

---

## 🚀 Chrome 安裝使用教學（30 秒快速上手）

### 步驟 1：開啟 Chrome 擴充功能管理頁
在 Google Chrome 瀏覽器網址列輸入並前往：
```text
chrome://extensions
```

### 步驟 2：開啟「開發者模式」
在頁面右上角找到 **「開發者模式 (Developer mode)」** 開關，將其**打開**。

### 步驟 3：載入擴充功能
1. 點擊左上角 **「載入未封裝項目 (Load unpacked)」** 按鈕。
2. 選擇此資料夾：
   ```text
   /Users/Leon/Desktop/01_WUYI 梧藝營運系統/WUYI 下單小幫手CHROME插件
   ```
3. 看到清單中出現 **「梧藝 WUYI 下單小幫手」** 即安裝完成！

---

## 📊 Google 試算表 Webhook 串接設定（選用）

若需要一鍵同步訂單至 Google 試算表：
1. 打開您的 Google 試算表，點擊上方選單 **「擴充功能」 ➔ 「Apps Script」**。
2. 將本專案中 `google-apps-script/Code.gs` 的完整程式碼複製並貼上取代原本內容。
3. 點擊右上角 **「部署」 ➔ 「新增部署」**：
   - 種類：**網頁應用程式 (Web App)**
   - 執行身分：**我**
   - 誰可以存取：**所有人 (Anyone)**
4. 部署後複製產生的 **網頁應用程式網址**。
5. 在 Chrome 擴充功能圖示按右鍵 ➔ 選擇 **「選項 (Options)」** ➔ 貼上網址並點擊「儲存設定」即可！

---

## 🛠️ 目錄結構

```text
├── manifest.json              # Chrome Manifest V3 配置
├── dist/
│   └── wuyi-order-helper.zip  # 一鍵封裝發布包
├── google-apps-script/
│   └── Code.gs                # 試算表 20 欄接收與防重複腳本
├── src/
│   ├── assets/icons/          # 擴充功能圖示 (16x16, 48x48, 128x128)
│   ├── background/
│   │   └── service-worker.js  # 跨域圖片轉換 Data URL
│   ├── content/
│   │   ├── content.js         # LINE 後台注入主程式 (側欄/浮窗/操作控制)
│   │   ├── content.css        # 介面樣式
│   │   ├── extractor.js       # 訂單文字與金額解析引擎
│   │   └── card-renderer.js   # HTML5 Canvas 取貨小卡渲染引擎
│   └── options/               # Webhook 設定頁面
└── tests/                     # 完整的 6 大自動化單元與整合測試
```

---

## 🧪 執行測試驗證

本專案具備完整的自動化單元測試：
```bash
node tests/test-manifest.js       # 驗證 Manifest V3 與權限
node tests/test-extractor.js      # 驗證訂單文字與金額解析
node tests/test-card-renderer.js   # 驗證 Canvas 小卡排版 (零金額政策)
node tests/test-ui-dom.js         # 驗證 UI DOM 結構與按鈕綁定
node tests/test-gas-mapping.js    # 驗證 20 欄標準試算表映射
node tests/test-full-flow.js      # 驗證全流程端到端整合
```

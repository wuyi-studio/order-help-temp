/**
 * 梧藝 WUYI 下單小幫手 - Background Service Worker
 * 主要功能：跨域獲取 LINE 圖片並轉為 Data URL，避免 Canvas 污染 (CORS Taint)
 */

const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyWmZqHYc1THus_JRa54ZDsU3rRck4r4snh_7B3mzjjKXrNLIUTWmibCQQloiSXefL_kQ/exec';

// 安裝或更新時自動初始化預設 Google 試算表 Webhook 網址
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    if (chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['googleSheetsWebhookUrl'], (res) => {
        // 若使用者未設定或網址為舊版，自動同步為最新 Webhook 網址
        if (!res || !res.googleSheetsWebhookUrl) {
          chrome.storage.sync.set({ googleSheetsWebhookUrl: DEFAULT_WEBHOOK_URL });
        }
      });
    }
  });
}

let detachedWindowId = null;

// 高速記憶體快取：杜絕重複網路抓取與 Base64 轉換耗時
const imageCache = new Map();
const MAX_IMAGE_CACHE = 100;

async function fetchImageAsDataUrl(url) {
  if (!url) {
    return { success: false, error: 'Empty URL' };
  }
  // 若本身即為 Data URL，0ms 直接返回
  if (url.startsWith('data:')) {
    return { success: true, dataUrl: url };
  }
  // 若已在快取中，0ms 極速返回
  if (imageCache.has(url)) {
    return { success: true, dataUrl: imageCache.get(url) };
  }

  try {
    let response = null;
    const isLineInternal = url.includes('.line.biz');

    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: isLineInternal ? 'include' : 'omit'
      });
    } catch (e1) {
      // 容錯切換重試 (關閉 credentials 避免跨網域拒絕)
      try {
        response = await fetch(url, {
          method: 'GET',
          credentials: 'omit'
        });
      } catch (e2) {
        throw new Error(e1.message || e2.message || 'Network fetch failed');
      }
    }

    if (!response || !response.ok) {
      const retry = await fetch(url, { method: 'GET', credentials: 'omit' });
      if (!retry.ok) {
        throw new Error(`HTTP ${retry.status}: ${retry.statusText}`);
      }
      response = retry;
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Convert ArrayBuffer to binary string in chunks to avoid stack overflow
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }

    const base64 = (typeof btoa !== 'undefined')
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');

    const resultDataUrl = `data:${contentType};base64,${base64}`;

    // 存入記憶體快取 (LRU 淘汰)
    if (imageCache.size >= MAX_IMAGE_CACHE) {
      const oldestKey = imageCache.keys().next().value;
      imageCache.delete(oldestKey);
    }
    imageCache.set(url, resultDataUrl);

    return {
      success: true,
      dataUrl: resultDataUrl
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Failed to fetch image'
    };
  }
}

// 試算表 CSV 快取 (15 秒內重複查詢直接命中，減少等待)
let cachedCsvText = '';
let cachedCsvTime = 0;

// 直接由 Google 試算表 CSV 解析顧客歷史/舊訂單 (雙重備援，免依賴 Apps Script 部署版本)
async function fetchCustomerOrdersDirectFromSheet(customerName, phone) {
  try {
    const sheetId = '1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
    let text = '';
    const now = Date.now();
    if (cachedCsvText && (now - cachedCsvTime) < 15000) {
      text = cachedCsvText;
    } else {
      const resp = await fetch(csvUrl);
      if (!resp.ok) return [];
      text = await resp.text();
      cachedCsvText = text;
      cachedCsvTime = now;
    }
    const lines = text.split('\n').map(l => {
      return l.replace(/^"|"$/g, '').split(/","|",\s*"/).map(s => s.trim());
    });

    const target = (customerName || '').replace(/[\s(（]*改期[)）]*/g, '').trim();
    const targetPhone = (phone || '').replace(/[^\d]/g, '');
    const foundOrders = [];
    let currentDateTag = '';
    let currentDateFull = '';

    for (let i = 0; i < lines.length; i++) {
      const row = lines[i];
      const rowStr = row.join(' ');

      const mHeaderDate = rowStr.match(/(?:20\d{2})[-/\.](\d{1,2})[-/\.](\d{1,2})/);
      if (mHeaderDate) {
        currentDateTag = mHeaderDate[1].padStart(2, '0') + mHeaderDate[2].padStart(2, '0');
        currentDateFull = `2026-${mHeaderDate[1].padStart(2, '0')}-${mHeaderDate[2].padStart(2, '0')}`;
      }

      const matchName = target && rowStr.includes(target);
      const matchPhone = targetPhone && targetPhone.length >= 7 && rowStr.includes(targetPhone);

      if (matchName || matchPhone) {
        let dTag = currentDateTag;
        let dFull = currentDateFull;

        const mRowDate = rowStr.match(/(?:20\d{2})[-/\.](\d{1,2})[-/\.](\d{1,2})/);
        if (mRowDate) {
          dTag = mRowDate[1].padStart(2, '0') + mRowDate[2].padStart(2, '0');
          dFull = `2026-${mRowDate[1].padStart(2, '0')}-${mRowDate[2].padStart(2, '0')}`;
        } else {
          const mShort = rowStr.match(/(\d{1,2})[月/.-](\d{1,2})/);
          if (mShort) {
            dTag = mShort[1].padStart(2, '0') + mShort[2].padStart(2, '0');
            dFull = `2026-${dTag.slice(0, 2)}-${dTag.slice(2, 4)}`;
          }
        }

        const summaryParts = row.filter(c => c && !c.includes(target) && !c.includes('2026') && !c.includes('今日取件') && c !== '未定');
        const summary = summaryParts.join(' ') || '蛋糕訂單';

        foundOrders.push({
          sheet: '試算表訂單',
          row: i + 1,
          date: dFull || (dTag ? `2026-${dTag.slice(0, 2)}-${dTag.slice(2, 4)}` : '2026-11-11'),
          dateTag: dTag || '1111',
          time: row.find(c => /點|:\d{2}|未定/.test(c)) || '',
          customerName: target,
          summary: summary
        });
      }
    }
    return foundOrders;
  } catch (e) {
    console.warn('fetchCustomerOrdersDirectFromSheet error:', e);
    return [];
  }
}

function handleMessage(message, sender, sendResponse) {
  if (message && (message.action === 'fetchImageAsDataUrl' || message.action === 'fetchImageBlob')) {
    if (!message.url) {
      sendResponse({ success: false, error: 'Missing image URL' });
      return false;
    }

    fetchImageAsDataUrl(message.url)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // Keep channel open for async sendResponse
  }

  // 下載小卡圖檔並跳出「另存新檔」詢問下載路徑
  if (message && message.action === 'downloadCardWithSaveAs') {
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: message.dataUrl,
        filename: message.filename || '梧藝取貨確認小卡.png',
        saveAs: true // 詢問使用者要下載到哪裡
      }, (downloadId) => {
        sendResponse({ success: !!downloadId });
      });
      return true;
    }
  }

  // 移出為獨立小視窗 (單一實例且永遠置頂：若已開啟則聚焦既有視窗，不重複多開)
  if (message && message.action === 'openDetachedWindow') {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.windows) {
      const popupUrl = chrome.runtime.getURL('src/popup/popup.html');
      chrome.tabs.query({ url: popupUrl }, (tabs) => {
        if (tabs && tabs.length > 0) {
          // 已存在獨立小視窗：直接將既有視窗移至最前並聚焦
          const existingTab = tabs[0];
          detachedWindowId = existingTab.windowId;
          chrome.windows.update(existingTab.windowId, { focused: true }, (win) => {
            chrome.tabs.update(existingTab.id, { active: true });
            sendResponse({ success: true, windowId: existingTab.windowId, reused: true });
          });
        } else {
          // 尚未開啟：建立新的獨立小視窗 (預設適合 MacBook 13吋舒適尺寸 460x760)
          chrome.windows.create({
            url: popupUrl,
            type: 'popup',
            width: 460,
            height: 760,
            focused: true
          }, (win) => {
            if (win && win.id) {
              detachedWindowId = win.id;
            }
            sendResponse({ success: true, windowId: win ? win.id : null, created: true });
          });
        }
      });
      return true;
    }
  }

  // 調整獨立視窗大小 (適合 27吋、MacBook 13吋、iPad 11吋)
  if (message && message.action === 'resizeDetachedWindow') {
    const { width, height } = message;
    if (typeof chrome !== 'undefined' && chrome.windows) {
      const winId = message.windowId || detachedWindowId;
      if (winId) {
        chrome.windows.update(winId, { width: parseInt(width, 10), height: parseInt(height, 10) }, (win) => {
          sendResponse({ success: !!win });
        });
        return true;
      }
    }
    sendResponse({ success: false });
    return false;
  }

  // 重新將獨立視窗置頂
  if (message && message.action === 'refocusDetachedWindow') {
    if (typeof chrome !== 'undefined' && chrome.windows && detachedWindowId) {
      chrome.windows.update(detachedWindowId, { focused: true }, () => {
        sendResponse({ success: true });
      });
      return true;
    }
  }

// 帶有逾時防護之網路請求工具 (防止 Google Webhook 響應過久導致 Service Worker 連線中斷)
function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

// 同步至 Google 試算表 (透過 Background Service Worker 突破 CSP 與 CORS 限制)
  if (message && message.action === 'syncToGoogleSheets') {
    const targetUrl = message.url || DEFAULT_WEBHOOK_URL;
    const { payload } = message;

    fetchWithTimeout(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload || {})
    }, 60000)
      .then(async (res) => {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          sendResponse({ success: true, data: json });
        } catch (e) {
          if (text.includes('accounts.google.com') || text.includes('Google Drive – Access Denied') || text.includes('<html')) {
            sendResponse({
              success: false,
              error: 'Google Apps Script 權限未設為「所有人 (Anyone)」，請至 Apps Script 部署設定中修改存取權限。'
            });
          } else {
            sendResponse({ success: true, raw: text });
          }
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.name === 'AbortError' ? '連線逾時 (請檢查 Apps Script)' : (err.message || '連線失敗') });
      });

    return true; // Keep message channel open for async response
  }

  // 通用 Google Apps Script Webhook 轉發 (支援 queryCustomerOldOrders, deleteOldOrder, filterSheetByDate 等)
  if (message && message.action === 'callGoogleWebhook') {
    const targetUrl = message.url || DEFAULT_WEBHOOK_URL;
    const payload = message.payload || {};

    // 專屬支援：若為查詢舊預約紀錄 (改期作業)，具備「雲端 Webhook + 試算表即時 CSV」雙重讀取保障
    if (payload.action === 'queryCustomerOldOrders' || payload.action === 'queryCustomerOrders') {
      fetchWithTimeout(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }, 8000)
        .then(async (res) => {
          const text = await res.text();
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}

          // 若 Webhook 有回傳有效的 orders 陣列且非空
          if (json && json.status === 'success' && Array.isArray(json.orders) && json.orders.length > 0) {
            sendResponse({ success: true, data: json });
            return;
          }

          // 備援機制：若 Webhook 未回傳或尚未部署最新 Apps Script，直接讀取 Google 試算表 CSV 獲取即時資料
          const directOrders = await fetchCustomerOrdersDirectFromSheet(payload.customerName, payload.customerPhone);
          sendResponse({
            success: true,
            data: {
              status: 'success',
              action: 'queriedOldOrders',
              customerName: payload.customerName,
              orders: directOrders || [],
              source: 'direct_sheet'
            }
          });
        })
        .catch(async () => {
          // 若網路連線 Webhook 失敗或逾時，直接以試算表 CSV 作為備援
          const directOrders = await fetchCustomerOrdersDirectFromSheet(payload.customerName, payload.customerPhone);
          sendResponse({
            success: true,
            data: {
              status: 'success',
              action: 'queriedOldOrders',
              customerName: payload.customerName,
              orders: directOrders || [],
              source: 'direct_sheet'
            }
          });
        });

      return true;
    }

    fetchWithTimeout(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload)
    }, 60000)
      .then(async (res) => {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          if (json && json.status === 'success') {
            sendResponse({ success: true, data: json });
          } else {
            sendResponse({ success: false, error: json.message || '作業失敗', data: json });
          }
        } catch (e) {
          if (text.includes('accounts.google.com') || text.includes('Google Drive – Access Denied') || text.includes('<html')) {
            sendResponse({
              success: false,
              error: 'Google Apps Script 權限未設為「所有人 (Anyone)」，請至 Apps Script 部署設定中修改存取權限。'
            });
          } else {
            sendResponse({ success: false, error: '伺服器回應格式錯誤: ' + text.slice(0, 100) });
          }
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.name === 'AbortError' ? '連線逾時' : (err.message || '連線失敗') });
      });

    return true; // Keep message channel open for async response
  }

  // 上傳小卡圖檔至 Google Drive (供 Google 行事曆新增說明直接顯示圖片)
  if (message && message.action === 'uploadToGoogleDrive') {
    const targetUrl = message.url || DEFAULT_WEBHOOK_URL;
    const { payload } = message;

    fetchWithTimeout(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload || {})
    }, 60000)
      .then(async (res) => {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          if (json && json.status === 'success') {
            sendResponse({ success: true, data: json });
          } else {
            sendResponse({ success: false, error: json.message || '上傳失敗' });
          }
        } catch (e) {
          if (text.includes('accounts.google.com') || text.includes('Google Drive – Access Denied') || text.includes('<html')) {
            sendResponse({
              success: false,
              error: 'Google Apps Script 權限未設為「所有人 (Anyone)」，請至 Apps Script 部署設定中修改存取權限。'
            });
          } else {
            sendResponse({ success: false, error: '伺服器回應格式錯誤: ' + text.slice(0, 100) });
          }
        }
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.name === 'AbortError' ? '雲端上傳逾時' : (err.message || '連線失敗') });
      });

    return true; // Keep message channel open for async response
  }

  return false;
}

// Register message listener in Chrome Extension environment
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handleMessage);
}

// 監聽獨立視窗關閉與置頂維持
if (typeof chrome !== 'undefined' && chrome.windows) {
  if (chrome.windows.onRemoved) {
    chrome.windows.onRemoved.addListener((winId) => {
      if (winId === detachedWindowId) {
        detachedWindowId = null;
      }
    });
  }
}

// 點擊擴充功能圖示 (Action) 快速鍵處理
if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || !tab.id) return;

    const url = tab.url || '';
    if (url.includes('chat.line.biz') || url.includes('manager.line.biz')) {
      // 在 LINE 後台：切換下單小幫手面板
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
      } catch (e) {
        // 若該分頁是在安裝外掛前就已打開，動態注入腳本
        try {
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['src/content/content.css']
          });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'src/content/extractor.js',
              'src/content/card-renderer.js',
              'src/content/content.js'
            ]
          });
        } catch (err) {
          console.warn('Script injection error:', err);
        }
      }
    } else {
      // 若不在 LINE 後台：直接替使用者開新分頁前往 LINE 客服聊天室
      chrome.tabs.create({ url: 'https://chat.line.biz/' });
    }
  });
}

// Export for unit tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchImageAsDataUrl,
    handleMessage
  };
}

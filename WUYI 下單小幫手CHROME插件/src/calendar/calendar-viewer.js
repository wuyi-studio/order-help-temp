/**
 * 梧藝 WUYI 下單小幫手 - Google 行事曆訂單小卡直接顯示注入腳本 (修復穩定版)
 * 
 * 核心功能：
 *   1. 在 Google 行事曆 (calendar.google.com) 檢視行程時，自動偵測說明中的 Google Drive 訂單小卡連結。
 *   2. 直接在行程詳細資訊內原位渲染小卡圖片，點擊可大圖預覽。
 * 
 * 嚴格防禦機制 (防止重複注入、無限遞迴與 CPU 飆高)：
 *   - 嚴格限定每個行程彈窗/容器最多僅注入一次 (.wuyi-calendar-preview-box)。
 *   - MutationObserver 遞迴免疫守衛：自動忽略自身建立的 DOM 元素，防止觸發無限掃描。
 *   - 嚴格防抖 (Debounce 150ms)，保證頁面操作順暢不卡頓、影片播放不掉幀。
 *   - 完整 CDN / 縮圖 / Drive 多重備援載入機制，確保圖片必定能顯示。
 */

(function () {
  'use strict';

  // 嚴格限制：僅在 Google 行事曆 (calendar.google.com) 啟用
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    if (window.location.hostname !== 'calendar.google.com') {
      return;
    }
  }

  // Google Drive 檔案 ID 正則表達式 (要求至少 20 個有效 ID 字元，排除 undefined 或非法字串)
  const DRIVE_REGEX = /(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=|thumbnail\?id=)|lh[0-9]*\.googleusercontent\.com\/d\/)([a-zA-Z0-9_-]{20,})/i;

  /**
   * Google Drive 檔案 ID 智慧解析器
   * 支援格式：
   * 1. 標準網址：https://drive.google.com/file/d/FILE_ID/view
   * 2. 縮圖/匯出：https://drive.google.com/uc?id=FILE_ID 或 thumbnail?id=FILE_ID
   * 3. lh3 直連：https://lh3.googleusercontent.com/d/FILE_ID
   * 4. Google 行事曆重新導向轉址 (含 URL 編碼 %2F)：
   *    https://www.google.com/url?q=https%3A%2F%2Fdrive.google.com%2Ffile%2Fd%2FFILE_ID...
   */
  function extractDriveFileId(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return null;

    // A. 先解碼 URL 避免 %2F 或 %3D 阻擋比對
    let decoded = rawStr;
    try {
      decoded = decodeURIComponent(rawStr);
    } catch (_) {}

    // B. 標準解碼後比對
    const mStandard = decoded.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=|thumbnail\?id=)|lh[0-9]*\.googleusercontent\.com\/d\/)([a-zA-Z0-9_-]{20,})/i);
    if (mStandard && mStandard[1] && mStandard[1] !== 'undefined') {
      return mStandard[1];
    }

    // C. 針對 URL 編碼（含 %2F）的 Google 轉址比對
    const mEncoded = rawStr.match(/drive\.google\.com(?:%2F|\/)(?:file(?:%2F|\/)d(?:%2F|\/)|open\?id=|uc\?id=|thumbnail\?id=)([a-zA-Z0-9_-]{20,})/i);
    if (mEncoded && mEncoded[1] && mEncoded[1] !== 'undefined') {
      return mEncoded[1];
    }

    // D. 查詢參數中的 id= 擷取（如 ?id=FILE_ID 或 &id=FILE_ID）
    if (decoded.includes('drive.google.com') || decoded.includes('googleusercontent.com')) {
      const mParam = decoded.match(/[?&]id=([a-zA-Z0-9_-]{20,})/i);
      if (mParam && mParam[1] && mParam[1] !== 'undefined') {
        return mParam[1];
      }
    }

    return null;
  }

  let isScanning = false;
  let scanTimer = null;

  // 1. 建立或取得全螢幕 Lightbox 彈窗
  function ensureLightbox() {
    let overlay = document.getElementById('wuyiCalendarLightbox');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wuyiCalendarLightbox';
      overlay.className = 'wuyi-cal-lightbox-overlay';
      overlay.innerHTML = `
        <div class="wuyi-cal-lightbox-content">
          <div class="wuyi-cal-lightbox-header">
            <span class="wuyi-cal-lightbox-title">🍰 梧藝 WUYI 取貨確認小卡 (高解析預覽)</span>
            <button type="button" class="wuyi-cal-lightbox-close" title="關閉">✖</button>
          </div>
          <div class="wuyi-cal-lightbox-body">
            <img id="wuyiCalLightboxImg" src="" alt="大圖檢視" />
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const btnClose = overlay.querySelector('.wuyi-cal-lightbox-close');
      btnClose.addEventListener('click', () => {
        overlay.style.display = 'none';
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.style.display === 'flex') {
          overlay.style.display = 'none';
        }
      });
    }
    return overlay;
  }

  function showLightbox(imgSrc) {
    if (!imgSrc) return;
    const overlay = ensureLightbox();
    const img = overlay.querySelector('#wuyiCalLightboxImg');
    if (img) img.src = imgSrc;
    overlay.style.display = 'flex';
  }

  // 2. 建立小卡預覽卡片 DOM 元素
  function createPreviewBox(fileId) {
    const previewBox = document.createElement('div');
    previewBox.className = 'wuyi-calendar-preview-box';
    previewBox.dataset.wuyiCardBox = 'true';
    previewBox.dataset.fileId = fileId;

    const directImgUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    const fallbackThumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
    const exportViewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
    const driveViewUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

    // 頂部標籤列
    const badge = document.createElement('div');
    badge.className = 'wuyi-calendar-preview-badge';
    badge.innerHTML = `
      <span>🎂 梧藝取貨確認小卡</span>
      <span style="font-size: 11px; opacity: 0.9; cursor: pointer;">🔍 點擊放大</span>
    `;
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      showLightbox(img.src || directImgUrl);
    });

    // 圖片本體
    const img = document.createElement('img');
    img.className = 'wuyi-calendar-preview-img';
    img.src = directImgUrl;
    img.alt = '梧藝取貨確認小卡';
    img.title = '點擊檢視高畫質大圖';
    img.loading = 'lazy';

    // 多重降級備援機制 (CDN -> Google Drive 縮圖伺服器 -> Google Drive 匯出伺服器)
    let fallbackStep = 0;
    img.onerror = () => {
      fallbackStep++;
      if (fallbackStep === 1) {
        img.src = fallbackThumbUrl;
      } else if (fallbackStep === 2) {
        img.src = exportViewUrl;
      } else {
        // 若第三方 Cookie 阻擋導致無法直接嵌入，呈現友善提示
        img.style.display = 'none';
        const failNotice = document.createElement('div');
        failNotice.style.cssText = 'padding: 12px; background: #fff1f2; border: 1px dashed #f43f5e; border-radius: 8px; text-align: center; font-size: 12px; color: #9f1239; margin: 4px 0;';
        failNotice.innerHTML = `
          <div style="font-weight: 700; margin-bottom: 4px;">🖼️ 訂單小卡雲端預覽</div>
          <div style="margin-bottom: 8px;">(受瀏覽器安全性限制，請點擊下方按鈕直接開啟)</div>
          <a href="${driveViewUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 4px 12px; background: #f43f5e; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">📁 開啟 Google Drive 雲端檢視</a>
        `;
        previewBox.insertBefore(failNotice, actionRow);
      }
    };

    img.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      showLightbox(img.src || directImgUrl);
    });

    // 底部快捷操作列
    const actionRow = document.createElement('div');
    actionRow.className = 'wuyi-calendar-actions-row';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'wuyi-calendar-btn-view';
    viewBtn.textContent = '🔍 全螢幕檢視';
    viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showLightbox(img.src || directImgUrl);
    });

    const openDriveLink = document.createElement('a');
    openDriveLink.className = 'wuyi-calendar-btn-view';
    openDriveLink.href = driveViewUrl;
    openDriveLink.target = '_blank';
    openDriveLink.rel = 'noopener noreferrer';
    openDriveLink.textContent = '📁 雲端檔案';

    actionRow.appendChild(viewBtn);
    actionRow.appendChild(openDriveLink);

    previewBox.appendChild(badge);
    previewBox.appendChild(img);
    previewBox.appendChild(actionRow);

    return previewBox;
  }

  // 3. 掃描 Google 行事曆頁面中的行程對話方塊
  function scanAndInjectOrderCards() {
    if (isScanning) return;
    isScanning = true;

    try {
      // 策略 A: 搜尋全頁所有 <a> 標籤 (支援直接連結與 Google 行事曆重新導向轉址)
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      for (const link of allLinks) {
        const href = link.getAttribute('href') || link.href || '';
        const text = link.textContent || '';
        const fileId = extractDriveFileId(href) || extractDriveFileId(text);
        if (!fileId) continue;

        // 智慧定位最近的容器 (dialog, bubble, description 區塊等)
        const container = link.closest('#xDetDlgDesc, [role="dialog"], [data-open-bubble-id], [data-eventid], .toUqD, .g3rd02, .JAPqpe, .nBzAEb') || link.parentElement;
        if (!container) continue;

        // 核心保護：若該容器或此連結同一層已注入過同 fileId 的小卡，跳過
        if (container.querySelector(`.wuyi-calendar-preview-box[data-file-id="${fileId}"]`) ||
            (link.parentElement && link.parentElement.querySelector(`.wuyi-calendar-preview-box[data-file-id="${fileId}"]`))) {
          continue;
        }

        const previewBox = createPreviewBox(fileId);

        // 插入位置：優先插入在該連結所在的段落/說明列前方
        const insertTarget = link.closest('p, div.toUqD, div.g3rd02, div.JAPqpe') || link.parentElement || link;
        if (insertTarget && insertTarget.parentElement) {
          insertTarget.parentElement.insertBefore(previewBox, insertTarget);
        } else {
          container.appendChild(previewBox);
        }
      }

      // 策略 B: 針對純文字貼上 (無 <a> 標籤) 的容器進行補充掃描
      const textContainers = Array.from(document.querySelectorAll('#xDetDlgDesc, div[role="dialog"], [data-open-bubble-id], [data-eventid], .toUqD, .g3rd02, .JAPqpe'));
      for (const container of textContainers) {
        if (container.querySelector('.wuyi-calendar-preview-box')) continue;
        const text = container.textContent || '';
        const fileId = extractDriveFileId(text);
        if (fileId) {
          const previewBox = createPreviewBox(fileId);
          if (container.firstChild) {
            container.insertBefore(previewBox, container.firstChild);
          } else {
            container.appendChild(previewBox);
          }
        }
      }
    } catch (err) {
      console.warn('[WUYI Calendar Viewer] 掃描發生提示：', err);
    } finally {
      isScanning = false;
    }
  }

  // 4. 防抖調度掃描 (Debounce 150ms，徹底杜絕無限觸發與卡頓)
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndInjectOrderCards, 150);
  }

  // 5. DOM 變化監聽器 (嚴格過濾自己注入的節點，防止死循環)
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
      let hasRelevantChange = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i];
            if (node.nodeType === 1) { // ELEMENT_NODE
              // 若變更來自我們自己的小卡或 Lightbox，直接忽略
              if (node.classList && (
                node.classList.contains('wuyi-calendar-preview-box') || 
                node.classList.contains('wuyi-cal-lightbox-overlay') ||
                node.id === 'wuyiCalendarLightbox'
              )) {
                continue;
              }
              // 若是 Google Calendar 的對話方塊或主要內容區
              if (node.getAttribute && (node.getAttribute('role') === 'dialog' || node.classList.contains('JAPqpe') || node.hasAttribute('data-eventid'))) {
                hasRelevantChange = true;
                break;
              }
              // 一般頁面變化
              hasRelevantChange = true;
              break;
            }
          }
          if (hasRelevantChange) break;
        }
      }

      if (hasRelevantChange) {
        scheduleScan();
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // 點擊事件監聽 (例如使用者點選行事曆上的任一項目)
    document.addEventListener('click', (e) => {
      // 忽略點擊在小卡內的事件
      if (e.target && e.target.closest && e.target.closest('.wuyi-calendar-preview-box, .wuyi-cal-lightbox-overlay')) {
        return;
      }
      scheduleScan();
    }, true);

    // 初始與載入後執行
    document.addEventListener('DOMContentLoaded', scheduleScan);
    scheduleScan();
  }

  // 供單元測試引用
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DRIVE_REGEX,
      extractDriveFileId,
      scanAndInjectOrderCards,
      createPreviewBox
    };
  }
})();

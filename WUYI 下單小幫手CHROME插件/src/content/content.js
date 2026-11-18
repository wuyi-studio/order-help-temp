/**
 * 梧藝 WUYI 下單小幫手 - Content Script 主程式
 * 注入至 chat.line.biz 頁面
 */

(function () {
  // 嚴格限制：僅在 LINE 官方帳號相關網頁 (chat.line.biz / manager.line.biz) 啟用
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname || '';
    if (!host.endsWith('line.biz')) {
      return;
    }
  }

  if (document.getElementById('wuyi-helper-root')) {
    return; // 避免重複注入
  }

  const Ext = window.Extractor || globalThis.Extractor || (typeof Extractor !== 'undefined' ? Extractor : null);
  const Renderer = window.CardRenderer || globalThis.CardRenderer || (typeof CardRenderer !== 'undefined' ? CardRenderer : null);

  // 核心狀態 (預設關閉，顯示右側「🍰 梧藝下單」懸浮把手，避免遮擋聊天室)
  const state = {
    isOpen: false,
    isFloating: false,
    orderState: Ext ? Ext._createEmptyOrderState() : {
      orderType: 'cake',
      flower: { budget: '', color: '', paper: '', note: '' },
      cake: { style: '圖款', inscriptionLabel: '題字', inscription: '', size: '', flavor: '', addon: '' },
      pickup: { date: '', time: '', location: '台南市中西區友愛街93號' },
      customer: { lineName: '', name: '', phone: '' },
      rawText: ''
    },
    pricingState: { breakdownText: '', total: 0 },
    images: {
      flower: [null, null],
      cake: [null, null, null],
      addon: [null]
    },
    pos: { x: 20, y: 80 }
  };

  // 1. 建立 UI 根節點 (掛載於 document.body，確保固定於畫面右側懸浮與最左側展開)
  const root = document.createElement('div');
  root.id = 'wuyi-helper-root';

  function mountRoot() {
    if (!document.body) return;
    if (!root.isConnected || root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
  }

  if (document.body) {
    mountRoot();
  } else {
    document.addEventListener('DOMContentLoaded', mountRoot, { once: true });
  }

  // 2. 渲染 UI HTML (懸浮鈕在右邊，跳出面板在畫面最左側且自動將網頁往右推)
  root.innerHTML = `
    <!-- 右側懸浮把手 (按住可上下拖曳移動位置) -->
    <div class="wuyi-handle-pill" id="wuyiHandle" title="點擊開啟/收合，按住可上下拖曳移動位置">
      🍰 梧藝下單
    </div>

    <!-- 主面板 -->
    <div class="wuyi-helper-panel wuyi-panel wuyi-sidebar" id="wuyiPanel">
      <!-- 頂部標題與控制 -->
      <div class="wuyi-header" id="wuyiHeader">
        <div class="wuyi-title-row">
          <span class="wuyi-brand-badge">WUYI</span>
          <span class="wuyi-title">下單小幫手</span>
        </div>
        <div class="wuyi-header-actions">
          <button class="wuyi-icon-btn" id="btnPopoutWindow" title="移出為獨立小視窗 (可任意拖至其他螢幕或桌面)">↗ 獨立視窗</button>
          <button class="wuyi-icon-btn" id="btnToggleMode" title="切換側欄/浮窗">⧉ 浮窗</button>
          <button class="wuyi-icon-btn" id="btnClose" title="收合面板">✖</button>
        </div>
      </div>

      <!-- 滾動內容 -->
      <div class="wuyi-body">
        <!-- 視窗大小切換按鈕列 (適合 27吋、MacBook 13吋、iPad 11吋、6吋手機) -->
        <div class="wuyi-window-size-bar">
          <span class="wuyi-size-label">📐 尺寸：</span>
          <div class="wuyi-size-group">
            <button type="button" class="wuyi-size-pill" data-size="phone6" title="適合 6吋手機螢幕 (340 x 580)">📱 6吋</button>
            <button type="button" class="wuyi-size-pill" data-size="ipad" title="適合 iPad 11吋 (390 x 680)">📱 11吋</button>
            <button type="button" class="wuyi-size-pill active" data-size="macbook" title="適合 MacBook 13吋 (460 x 760)">💻 13吋</button>
            <button type="button" class="wuyi-size-pill" data-size="desktop" title="適合 27吋大螢幕 (560 x 880)">🖥️ 27吋</button>
          </div>
        </div>

        <!-- 抓取動作列 -->
        <div class="wuyi-scrape-bar">
          <button class="wuyi-btn-primary" id="btnScrapeChat" title="抓取最新符合訂購資訊的對話">
            ⚡ 一鍵抓取訂單
          </button>
          <div class="wuyi-scrape-nav">
            <button type="button" class="wuyi-nav-btn" id="btnPrevOrder" title="上一則符合對話 (較早)" disabled>▲</button>
            <span class="wuyi-nav-counter" id="navCounter" title="目前選中 / 搜尋到的總數">-/-</span>
            <button type="button" class="wuyi-nav-btn" id="btnNextOrder" title="下一則符合對話 (較新)" disabled>▼</button>
          </div>
          <button class="wuyi-btn-refresh" id="btnRefresh" title="重新整理抓取">
            🔄
          </button>
        </div>

        <!-- 圖片與訂單內容管理區 (支援 1️⃣2️⃣3️⃣4️⃣ 多組花單與多組蛋糕動態新增) -->
        <div class="wuyi-images-vertical" id="wuyiImagesVertical">
          <!-- 💐 花單容器 -->
          <div id="wuyiFlowerGroupsContainer">
            <div class="wuyi-order-group-card" data-group-type="flower" data-group-index="0" id="flowerGroup_0">
              <div class="wuyi-img-section-slot">
                <div class="wuyi-slot-header">
                  <span class="wuyi-slot-title">💐花束(截圖)</span>
                  <div class="wuyi-slot-actions">
                    <button type="button" class="wuyi-btn-add-slot" data-group="flower" title="多加一個花束截圖空格">新增</button>
                    <button type="button" class="wuyi-btn-clear-slot" data-group="flower" id="btnClearFlower">清除</button>
                  </div>
                </div>
                <div class="wuyi-boxes-row" id="rowFlower">
                  <div class="wuyi-box-dropzone" id="boxFlower0" title="可拖曳圖片至此，或點擊選取檔案">
                    <div class="wuyi-box-placeholder">+ 圖1</div>
                  </div>
                  <div class="wuyi-box-dropzone" id="boxFlower1" title="可拖曳圖片至此，或點擊選取檔案">
                    <div class="wuyi-box-placeholder">+ 圖2</div>
                  </div>
                </div>
              </div>

              <!-- 1️⃣ 花束訂單內容 -->
              <div class="wuyi-form-group" style="margin-top: -4px;">
                <div class="wuyi-label-row">
                  <span class="wuyi-label wuyi-item-label" id="labelFlower_0">📝 1️⃣ 花束訂單內容：</span>
                  <button type="button" class="wuyi-btn-inline-copy btn-copy-item-direct" data-type="flower" data-index="0" id="btnCopyFlowerDirect">📋 複製花束</button>
                </div>
                <textarea class="wuyi-textarea txt-order-item" data-type="flower" data-index="0" id="txtFlowerOrder" rows="4" placeholder="若無花束訂單請填寫「無」..."></textarea>
              </div>
            </div>
          </div>

          <!-- 新增花單按鈕 -->
          <div class="wuyi-add-group-action-row">
            <button type="button" class="wuyi-btn-add-group wuyi-btn-add-flower" id="btnAddFlowerGroup" title="新增一組花束截圖與花束訂單內容">
              ➕ 新增花單
            </button>
          </div>

          <!-- 🎂 蛋糕容器 -->
          <div id="wuyiCakeGroupsContainer">
            <div class="wuyi-order-group-card" data-group-type="cake" data-group-index="0" id="cakeGroup_0">
              <div class="wuyi-img-section-slot">
                <div class="wuyi-slot-header">
                  <span class="wuyi-slot-title">🎂蛋糕(截圖)</span>
                  <div class="wuyi-slot-actions">
                    <button type="button" class="wuyi-btn-add-slot" data-group="cake" title="多加一個蛋糕款式截圖空格">新增</button>
                    <button type="button" class="wuyi-btn-clear-slot" data-group="cake" id="btnClearCake">清除</button>
                  </div>
                </div>
                <div class="wuyi-boxes-row" id="rowCake">
                  <div class="wuyi-box-dropzone" id="boxCake0" title="可拖曳圖片至此，或點擊選取檔案">
                    <div class="wuyi-box-placeholder">+ 款式1</div>
                  </div>
                  <div class="wuyi-box-dropzone" id="boxCake1" title="可拖曳圖片至此，或點擊選取檔案">
                    <div class="wuyi-box-placeholder">+ 款式2</div>
                  </div>
                  <div class="wuyi-box-dropzone" id="boxCake2" title="可拖曳圖片至此，或點擊選取檔案">
                    <div class="wuyi-box-placeholder">+ 款式3</div>
                  </div>
                </div>
              </div>

              <!-- 3. 🕯️蠟燭(截圖) -->
              <div class="wuyi-img-section-slot">
                <div class="wuyi-slot-header">
                  <span class="wuyi-slot-title">🕯️蠟燭(截圖)</span>
                  <div class="wuyi-slot-actions">
                    <button type="button" class="wuyi-btn-add-slot" data-group="addon" title="多加一個蠟燭配件截圖空格">新增</button>
                    <button type="button" class="wuyi-btn-clear-slot" data-group="addon" id="btnClearAddon">清除</button>
                  </div>
                </div>
                <div class="wuyi-boxes-row" id="rowAddon">
                  <div class="wuyi-box-dropzone" id="boxAddon0" title="可拖曳圖片至此，或點擊選取檔案">
                    <div class="wuyi-box-placeholder">+ 蠟燭圖</div>
                  </div>
                </div>
              </div>

              <!-- 2️⃣ 蛋糕訂單內容 -->
              <div class="wuyi-form-group" style="margin-top: -4px;">
                <div class="wuyi-label-row">
                  <span class="wuyi-label wuyi-item-label" id="labelCake_0">📝 2️⃣ 蛋糕訂單內容：</span>
                  <div class="wuyi-btn-inline-group">
                    <button type="button" class="wuyi-btn-inline-copy btn-copy-item-direct" data-type="cake" data-index="0" id="btnCopyCakeDirect" title="複製純訂單內容">📋 複製訂單</button>
                    <button type="button" class="wuyi-btn-inline-copy wuyi-btn-copy-pricing" id="btnCopyOrderWithPricing" title="複製訂單文字與金額明細">📋 訂單+金額</button>
                  </div>
                </div>
                <textarea class="wuyi-textarea txt-order-item" data-type="cake" data-index="0" id="txtCakeOrder" rows="7" placeholder="點擊一鍵抓取自動帶入蛋糕與取貨資訊，無蛋糕則填寫「無」..."></textarea>
              </div>
            </div>
          </div>

          <!-- 新增蛋糕按鈕 -->
          <div class="wuyi-add-group-action-row">
            <button type="button" class="wuyi-btn-add-group wuyi-btn-add-cake" id="btnAddCakeGroup" title="新增一組蛋糕截圖、蠟燭截圖與蛋糕訂單內容">
              ➕ 新增蛋糕
            </button>
          </div>
        </div>

        <!-- 取貨標籤日期 (自動讀取並正規化為 1102 格式) -->
        <div class="wuyi-date-tag-row">
          <span class="wuyi-tag-title">🏷️ 標籤日期：</span>
          <input type="text" class="wuyi-input-date-tag" id="inputDateTag" placeholder="例：1102" maxlength="10">
          <button type="button" class="wuyi-btn-add-line-tag" id="btnAddLineTag" title="直接在 LINE 右側客戶資料新增此日期標籤">
            ＋ 新增標籤
          </button>
          <button type="button" class="wuyi-btn-view-sheet-date" id="btnViewSheetDate" title="開啟 Google 試算表只檢視此固定日期的全部訂單">
            🔍 試算表只看此日
          </button>
        </div>

        <!-- 金額明細預覽與編輯 -->
        <div class="wuyi-form-group">
          <div class="wuyi-label-row">
            <span class="wuyi-label">💰 金額明細：</span>
            <button type="button" class="wuyi-btn-inline-copy" id="btnCopyPricingDirect">📋 複製金額</button>
          </div>
          <textarea class="wuyi-textarea" id="txtPricing" rows="4" placeholder="蛋糕$...\n加購$...\n總共$..."></textarea>
        </div>
      </div>

      <!-- 底部快捷動作按鈕 -->
      <div class="wuyi-footer">
        <!-- 核心輸出：小卡圖片 (不含金額) ＆ 🎂💐 快速訊息發送鈕 -->
        <div class="wuyi-card-copy-row">
          <button class="wuyi-btn-action wuyi-btn-card-copy" id="btnCopyCard" title="一鍵複製取貨確認小卡：直接貼小卡至 LINE 給客人確認，並同步上傳至 Google Drive 雲端與寫入 Google 試算表">
            🖼️ 一鍵複製取貨確認小卡 (貼 LINE ＋ 雲端 ＋ 試算表)
          </button>
          <button type="button" class="wuyi-btn-quick-msg" id="btnQuickMsgCake" title="按 1 下：複製蛋糕確認訊息至剪貼簿&#10;連按 3 下：編輯自訂訊息內容">
            🎂
          </button>
          <button type="button" class="wuyi-btn-quick-msg" id="btnQuickMsgFlower" title="按 1 下：複製花束確認訊息至剪貼簿&#10;連按 3 下：編輯自訂訊息內容">
            💐
          </button>
        </div>

        <div class="wuyi-action-grid">
          <button class="wuyi-btn-action" id="btnCopyOrder">
            📋 複製備忘錄格式 (含照片與可編輯文字)
          </button>
          <button class="wuyi-btn-action wuyi-btn-add-note" id="btnAddLineNote" title="自動將訂單內容寫入 LINE 右側記事本">
            📝 ＋ 新增記事本
          </button>
        </div>
      </div>

      <!-- Toast 提示 -->
      <div class="wuyi-toast" id="wuyiToast">已複製！</div>

      <!-- 隱藏的檔案選擇 input -->
      <input type="file" id="wuyiHiddenFileInputContent" accept="image/*" style="display:none">
    </div>
  `;

  // 取得 DOM 元素
  const handlePill = root.querySelector('#wuyiHandle');
  const panel = root.querySelector('#wuyiPanel');
  const header = root.querySelector('#wuyiHeader');
  const btnPopoutWindow = root.querySelector('#btnPopoutWindow');
  const btnToggleMode = root.querySelector('#btnToggleMode');
  const btnClose = root.querySelector('#btnClose');
  const btnScrapeChat = root.querySelector('#btnScrapeChat');
  const btnPrevOrder = root.querySelector('#btnPrevOrder');
  const navCounter = root.querySelector('#navCounter');
  const btnNextOrder = root.querySelector('#btnNextOrder');
  const btnRefresh = root.querySelector('#btnRefresh');

  const btnClearFlower = root.querySelector('#btnClearFlower');
  const btnClearCake = root.querySelector('#btnClearCake');
  const btnClearAddon = root.querySelector('#btnClearAddon');

  const btnAddFlowerGroup = root.querySelector('#btnAddFlowerGroup');
  const btnAddCakeGroup = root.querySelector('#btnAddCakeGroup');
  const flowerGroupsContainer = root.querySelector('#wuyiFlowerGroupsContainer');
  const cakeGroupsContainer = root.querySelector('#wuyiCakeGroupsContainer');

  const inputDateTag = root.querySelector('#inputDateTag');
  const btnAddLineTag = root.querySelector('#btnAddLineTag');
  const btnCopyFlowerDirect = root.querySelector('#btnCopyFlowerDirect');
  const btnCopyCakeDirect = root.querySelector('#btnCopyCakeDirect');
  const btnCopyOrderWithPricing = root.querySelector('#btnCopyOrderWithPricing');
  const btnCopyPricingDirect = root.querySelector('#btnCopyPricingDirect');
  const txtFlowerOrder = root.querySelector('#txtFlowerOrder');
  const txtCakeOrder = root.querySelector('#txtCakeOrder');
  const txtPricing = root.querySelector('#txtPricing');

  const btnCopyCard = root.querySelector('#btnCopyCard');
  const btnCopyOrder = root.querySelector('#btnCopyOrder');
  const btnAddLineNote = root.querySelector('#btnAddLineNote');
  const toast = root.querySelector('#wuyiToast');

  // 3. UI 互動事件綁定

  // 支援右側懸浮把手上下拖曳移動 (記住使用者自訂垂直位置)
  let isHandleDragging = false;
  let handleStartY = 0;
  let handleStartTop = 0;
  let handleHasDragged = false;
  let handleJustDragged = false;

  function applyHandleTop(topPx) {
    const pillHeight = handlePill.offsetHeight || 42;
    const minY = 10;
    const maxY = Math.max(minY, (window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 800) - pillHeight - 10);
    const clamped = Math.max(minY, Math.min(maxY, topPx));
    handlePill.style.setProperty('top', clamped + 'px', 'important');
    handlePill.style.setProperty('transform', 'none', 'important');
  }

  function loadSavedHandlePosition() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['wuyiHandleTop'], (res) => {
        if (res && typeof res.wuyiHandleTop === 'number') {
          applyHandleTop(res.wuyiHandleTop);
        }
      });
    } else if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('wuyiHandleTop');
      if (saved) {
        applyHandleTop(parseFloat(saved));
      }
    }
  }

  handlePill.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    isHandleDragging = true;
    handleHasDragged = false;
    handleStartY = e.clientY;
    handleStartTop = handlePill.getBoundingClientRect().top;
    try {
      handlePill.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  handlePill.addEventListener('pointermove', (e) => {
    if (!isHandleDragging) return;
    const deltaY = e.clientY - handleStartY;
    if (!handleHasDragged && Math.abs(deltaY) > 3) {
      handleHasDragged = true;
      handlePill.classList.add('wuyi-handle-pill-dragging');
    }
    if (handleHasDragged) {
      applyHandleTop(handleStartTop + deltaY);
      e.preventDefault();
    }
  });

  const onHandlePointerUp = (e) => {
    if (!isHandleDragging) return;
    isHandleDragging = false;
    handlePill.classList.remove('wuyi-handle-pill-dragging');
    try {
      handlePill.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (handleHasDragged) {
      handleJustDragged = true;
      const currentTop = handlePill.getBoundingClientRect().top;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ wuyiHandleTop: currentTop });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem('wuyiHandleTop', currentTop);
      }
      setTimeout(() => {
        handleJustDragged = false;
      }, 150);
    }
  };

  handlePill.addEventListener('pointerup', onHandlePointerUp);
  handlePill.addEventListener('pointercancel', onHandlePointerUp);

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      const currentTop = handlePill.getBoundingClientRect().top;
      applyHandleTop(currentTop);
    });
  }

  loadSavedHandlePosition();

  // 紀錄目前開啟的永遠置頂獨立視窗 (Document Picture-in-Picture)
  let activePipWindow = null;

  // 展開/收合
  handlePill.addEventListener('click', () => {
    if (handleJustDragged) return;
    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.focus();
      showToast('📌 獨立置頂視窗已開啟並聚焦！');
      return;
    }
    state.isOpen = !state.isOpen;
    updatePanelVisibility();
  });

  btnClose.addEventListener('click', () => {
    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.close();
      return;
    }
    state.isOpen = false;
    updatePanelVisibility();
  });

  function updatePanelVisibility() {
    if (activePipWindow && !activePipWindow.closed) {
      panel.classList.remove('wuyi-closed');
      handlePill.style.display = 'flex';
      handlePill.textContent = '🍰 梧藝下單';
      handlePill.title = '點擊開啟梧藝下單小幫手';
      handlePill.classList.remove('wuyi-handle-pill-active');
      if (document.body) document.body.classList.remove('wuyi-sidebar-open');
      return;
    }
    // 懸浮把手始終保持在右側顯示，永遠不會消失
    handlePill.style.display = 'flex';
    if (state.isOpen) {
      panel.classList.remove('wuyi-closed');
      handlePill.textContent = '◀ 收合';
      handlePill.title = '點擊收合梧藝下單小幫手';
      handlePill.classList.add('wuyi-handle-pill-active');
      if (document.body) {
        if (!state.isFloating) {
          document.body.classList.add('wuyi-sidebar-open');
        } else {
          document.body.classList.remove('wuyi-sidebar-open');
        }
      }
    } else {
      panel.classList.add('wuyi-closed');
      handlePill.textContent = '🍰 梧藝下單';
      handlePill.title = '點擊開啟梧藝下單小幫手';
      handlePill.classList.remove('wuyi-handle-pill-active');
      if (document.body) document.body.classList.remove('wuyi-sidebar-open');
    }
  }

  // 套用初始狀態
  updatePanelVisibility();

  // 監聽來自擴充功能圖示快速鍵
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'togglePanel') {
        if (activePipWindow && !activePipWindow.closed) {
          activePipWindow.focus();
          sendResponse({ success: true, isOpen: true, pip: true });
          return;
        }
        state.isOpen = !state.isOpen;
        updatePanelVisibility();
        sendResponse({ success: true, isOpen: state.isOpen });
      } else if (msg && msg.action === 'addLineOfficialTag') {
        addLineOfficialTag(msg.tag).then(res => {
          showToast(res.message);
          sendResponse(res);
        });
        return true;
      } else if (msg && msg.action === 'addLineOfficialNote') {
        addLineOfficialNote(msg.text).then(res => {
          showToast(res.message);
          sendResponse(res);
        });
        return true;
      } else if (msg && msg.action === 'sendLineChatMessage') {
        pasteTextToLineChatInput(msg.text, msg.autoSend !== false).then(res => {
          showToast(res.message);
          sendResponse(res);
        });
        return true;
      } else if (msg && msg.action === 'pasteLineCardImage') {
        copyCardImageAndPaste().then(() => {
          sendResponse({ success: true });
        });
        return true;
      } else if (msg && msg.action === 'getCurrentOrderHelperState') {
        sendResponse({
          success: true,
          state: {
            orderState: state.orderState,
            pricingState: state.pricingState,
            images: state.images,
            flowerText: getFlowerOrderText(),
            cakeText: getCakeOrderText(),
            pricingText: (txtPricing ? txtPricing.value : ''),
            dateTag: (inputDateTag ? inputDateTag.value : '')
          }
        });
        return true;
      }
    });
  }

  // 移出為永遠置頂獨立視窗 (使用 Chrome Document Picture-in-Picture 原生 OS 級別永遠置頂，並將原網頁面板縮為浮動按鈕)
  btnPopoutWindow.addEventListener('click', async () => {
    // 若已在永遠置頂獨立視窗內點擊，則收回回側欄
    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.close();
      return;
    }

    // 優先使用 Chrome 原生 Document Picture-in-Picture (保證 100% 系統級永遠置頂 Always-On-Top，預設適合 MacBook 13吋舒適尺寸)
    if (typeof window.documentPictureInPicture !== 'undefined' && typeof window.documentPictureInPicture.requestWindow === 'function') {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: 460,
          height: 760
        });
        activePipWindow = pipWin;
        pipWin.document.title = '梧藝 WUYI 下單小幫手 (📌 永遠置頂)';

        // 載入插件樣式表與全視窗排版
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          const link = pipWin.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = chrome.runtime.getURL('src/content/content.css');
          pipWin.document.head.appendChild(link);
        }
        const pipStyle = pipWin.document.createElement('style');
        pipStyle.textContent = `
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            overflow: hidden !important;
            background: #fffdfa !important;
          }
          #wuyiPanel {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
            border-radius: 0 !important;
            transform: none !important;
            display: flex !important;
            box-shadow: none !important;
            border: 2px solid #fda4af !important;
            background: #fffdfa !important;
          }
        `;
        pipWin.document.head.appendChild(pipStyle);

        // 將面板與 Toast 移入永遠置頂視窗，原網頁縮為浮動按鈕
        state.isOpen = false;
        updatePanelVisibility();
        pipWin.document.body.appendChild(panel);
        pipWin.document.body.appendChild(toast);
        panel.classList.remove('wuyi-closed');
        btnPopoutWindow.textContent = '📌 置頂中 (收回)';
        btnToggleMode.style.display = 'none';

        showToast('📌 已開啟縮小 50% 永遠置頂獨立視窗！');

        // 當置頂視窗關閉時，自動將面板歸還回原網頁
        pipWin.addEventListener('pagehide', () => {
          activePipWindow = null;
          root.appendChild(panel);
          root.appendChild(toast);
          btnPopoutWindow.textContent = '↗ 獨立視窗';
          btnToggleMode.style.display = '';
          state.isOpen = false;
          updatePanelVisibility();
        });
        return;
      } catch (err) {
        console.warn('Document Picture-in-Picture fallback to chrome.windows:', err);
      }
    }

    // 備援方案：使用 Chrome 獨立彈出視窗
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'openDetachedWindow' });
      // 原本小幫手視窗變成浮動按鈕 (收合面板，保留懸浮把手/按鈕)
      state.isOpen = false;
      updatePanelVisibility();
      showToast('🚀 已開啟獨立視窗！原本視窗已縮為浮動按鈕');
    }
  });

  // 模式切換：側欄 vs 浮動視窗
  btnToggleMode.addEventListener('click', toggleFloating);

  function toggleFloating() {
    state.isFloating = !state.isFloating;
    if (state.isFloating) {
      panel.classList.remove('wuyi-sidebar');
      panel.classList.add('wuyi-floating');
      btnToggleMode.textContent = '⇥ 側欄';
      if (document.body) document.body.classList.remove('wuyi-sidebar-open');
      applyFloatingPos();
    } else {
      panel.classList.remove('wuyi-floating');
      panel.classList.add('wuyi-sidebar');
      panel.style.left = '0px';
      panel.style.right = 'auto';
      panel.style.top = '';
      btnToggleMode.textContent = '⧉ 浮窗';
      if (document.body && state.isOpen) {
        document.body.classList.add('wuyi-sidebar-open');
      }
    }
  }

  // 自由浮動位置 (解除邊界限制)
  function applyFloatingPos() {
    if (!state.isFloating) return;
    panel.style.left = state.pos.x + 'px';
    panel.style.top = state.pos.y + 'px';
  }

  // 浮窗拖曳邏輯
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  header.addEventListener('mousedown', (e) => {
    if (!state.isFloating || e.target.tagName === 'BUTTON') return;
    isDragging = true;
    dragOffset.x = e.clientX - panel.offsetLeft;
    dragOffset.y = e.clientY - panel.offsetTop;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    state.pos.x = e.clientX - dragOffset.x;
    state.pos.y = e.clientY - dragOffset.y;
    applyFloatingPos();
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  // 4. 動態圖框事件綁定與管理 (支援點擊「新增」增加空格、點擊空白框選檔、拖曳換位、單圖刪除)
  const GROUP_LABELS = {
    flower: '花束',
    cake: '蛋糕',
    addon: '蠟燭'
  };

  function getGroupLabel(group) {
    if (!group) return '截圖';
    if (group.startsWith('flower')) return '花束';
    if (group.startsWith('cake')) return '蛋糕';
    if (group.startsWith('addon')) return '蠟燭';
    return GROUP_LABELS[group] || '截圖';
  }

  const hiddenFileInputContent = root.querySelector('#wuyiHiddenFileInputContent');
  let currentUploadTarget = null; // { group, index }
  let currentDraggingBox = null; // { group, index }

  function renderGroupBoxes(group) {
    const rowId = group.startsWith('row') ? group : ('row' + group.charAt(0).toUpperCase() + group.slice(1));
    const row = panel.querySelector('#' + rowId) || root.querySelector('#' + rowId);
    if (!row) return;

    row.innerHTML = '';
    const list = state.images[group] || [];

    list.forEach((dataUrl, idx) => {
      const box = document.createElement('div');
      box.className = 'wuyi-box-dropzone' + (dataUrl ? ' wuyi-has-image' : '');
      box.id = 'box_' + group + '_' + idx;
      box.dataset.group = group;
      box.dataset.index = idx;

      let placeholderText = '';
      if (group.startsWith('flower')) placeholderText = '+ 圖' + (idx + 1);
      else if (group.startsWith('cake')) placeholderText = '+ 款式' + (idx + 1);
      else if (group.startsWith('addon')) placeholderText = idx === 0 ? '+ 蠟燭圖' : '+ 蠟燭' + (idx + 1);

      if (dataUrl) {
        box.setAttribute('draggable', 'true');
        const hasPrev = idx > 0;
        const hasNext = idx < list.length - 1;

        box.innerHTML = `
          <img src="${dataUrl}" class="wuyi-box-thumb" alt="預覽圖" draggable="false">
          <div class="wuyi-box-overlay">
            <div class="wuyi-box-actions-left">
              ${hasPrev ? '<button type="button" class="wuyi-box-btn-shift" data-dir="prev" title="移至上一個圖框">◀</button>' : ''}
              ${hasNext ? '<button type="button" class="wuyi-box-btn-shift" data-dir="next" title="移至下一個圖框">▶</button>' : ''}
              <span class="wuyi-box-move-hint" title="按住可拖曳移動">按住移動 ✥</span>
            </div>
            <button type="button" class="wuyi-box-btn-del" title="清除此圖">✕</button>
          </div>
        `;

        box.querySelectorAll('.wuyi-box-btn-shift').forEach(b => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const dir = b.dataset.dir;
            const targetIdx = dir === 'prev' ? idx - 1 : idx + 1;
            if (targetIdx >= 0 && targetIdx < list.length) {
              const temp = list[idx];
              list[idx] = list[targetIdx];
              list[targetIdx] = temp;
              renderGroupBoxes(group);
            }
          });
        });

        const btnDel = box.querySelector('.wuyi-box-btn-del');
        if (btnDel) {
          btnDel.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            list[idx] = null;
            renderGroupBoxes(group);
            showToast('已清除 ' + getGroupLabel(group) + ' 截圖');
          });
        }
      } else {
        box.innerHTML = '<div class="wuyi-box-placeholder">' + placeholderText + '</div>';
        box.addEventListener('click', () => {
          currentUploadTarget = { group, index: idx };
          if (hiddenFileInputContent) {
            hiddenFileInputContent.value = '';
            hiddenFileInputContent.click();
          }
        });
      }

      setupBoxDragAndDrop(box, group, idx);
      row.appendChild(box);
    });
  }

  function setupBoxDragAndDrop(box, group, idx) {
    box.addEventListener('dragstart', (e) => {
      if (!state.images[group][idx]) {
        e.preventDefault();
        return;
      }
      currentDraggingBox = { group, index: idx };
      box.classList.add('wuyi-dragging');
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', group + ':' + idx);
    });

    box.addEventListener('dragend', () => {
      box.classList.remove('wuyi-dragging');
      setTimeout(() => { currentDraggingBox = null; }, 150);
      panel.querySelectorAll('.wuyi-box-dropzone').forEach(b => b.classList.remove('wuyi-drag-over'));
    });

    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      box.classList.add('wuyi-drag-over');
    });

    box.addEventListener('dragleave', (e) => {
      e.preventDefault();
      box.classList.remove('wuyi-drag-over');
    });

    box.addEventListener('drop', async (e) => {
      e.preventDefault();
      box.classList.remove('wuyi-drag-over');

      // 1. 內部圖框互換
      if (currentDraggingBox) {
        const fromGroup = currentDraggingBox.group;
        const fromIdx = currentDraggingBox.index;
        currentDraggingBox = null;
        if (fromGroup === group && fromIdx === idx) return;

        const fromVal = state.images[fromGroup][fromIdx];
        const toVal = state.images[group][idx];
        state.images[group][idx] = fromVal;
        state.images[fromGroup][fromIdx] = toVal || null;

        renderGroupBoxes(fromGroup);
        if (fromGroup !== group) renderGroupBoxes(group);
        showToast('已調整截圖位置');
        return;
      }

      // 2. 本地圖片檔案拖曳
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const f = e.dataTransfer.files[0];
        if (f.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            state.images[group][idx] = evt.target.result;
            renderGroupBoxes(group);
            showToast('✅ ' + getGroupLabel(group) + ' 截圖已加入！');
          };
          reader.readAsDataURL(f);
          return;
        }
      }

      // 3. 網頁或 LINE 對話圖片拖曳
      let url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (!url) {
        const html = e.dataTransfer.getData('text/html');
        if (html) {
          const m = html.match(/src=["']([^"']+)["']/i);
          if (m) url = m[1];
        }
      }

      if (url && (url.startsWith('http') || url.startsWith('data:'))) {
        showToast('⏳ 正在載入圖片...');
        const res = await fetchImageViaServiceWorker(url);
        const finalUrl = res && res.dataUrl ? res.dataUrl : url;
        state.images[group][idx] = finalUrl;
        renderGroupBoxes(group);
        showToast('✅ ' + getGroupLabel(group) + ' 截圖已加入！');
      }
    });
  }

  // 初始渲染三個分類圖框
  renderGroupBoxes('flower');
  renderGroupBoxes('cake');
  renderGroupBoxes('addon');

  // 透過事件代理處理所有截圖格「新增」與「清除」按鈕 (全面支援主組與動態新增的花單/蛋糕組)
  panel.addEventListener('click', (e) => {
    const addSlotBtn = e.target.closest('.wuyi-btn-add-slot');
    if (addSlotBtn) {
      e.stopPropagation();
      const group = addSlotBtn.getAttribute('data-group');
      if (!group) return;
      if (!state.images[group]) state.images[group] = [];
      state.images[group].push(null);
      renderGroupBoxes(group);
      showToast('➕ 已為【' + getGroupLabel(group) + '】多加一個截圖空格！');
      return;
    }

    const clearSlotBtn = e.target.closest('.wuyi-btn-clear-slot');
    if (clearSlotBtn) {
      e.stopPropagation();
      const group = clearSlotBtn.getAttribute('data-group');
      if (!group || !state.images[group]) return;
      state.images[group] = state.images[group].map(() => null);
      renderGroupBoxes(group);
      showToast('已清除 ' + getGroupLabel(group) + ' 截圖');
      return;
    }
  });

  if (hiddenFileInputContent) {
    hiddenFileInputContent.addEventListener('change', () => {
      if (!hiddenFileInputContent.files || hiddenFileInputContent.files.length === 0) return;
      const file = hiddenFileInputContent.files[0];
      if (!file.type.startsWith('image/')) {
        showToast('⚠️ 請選擇圖片檔案');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        if (currentUploadTarget) {
          const { group, index } = currentUploadTarget;
          state.images[group][index] = dataUrl;
          renderGroupBoxes(group);
          showToast('✅ 已新增【' + getGroupLabel(group) + '】圖片！');
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // 視窗尺寸切換 (適合 27吋、MacBook 13吋、iPad 11吋、6吋手機)
  const WINDOW_SIZES = {
    phone6: { width: 340, height: 580, label: '6吋手機' },
    ipad: { width: 390, height: 680, label: 'iPad 11吋' },
    macbook: { width: 460, height: 760, label: 'MacBook 13吋' },
    desktop: { width: 560, height: 880, label: '27吋大螢幕' }
  };

  function setWindowSize(sizeKey) {
    const target = WINDOW_SIZES[sizeKey];
    if (!target) return;

    panel.querySelectorAll('.wuyi-size-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-size') === sizeKey);
    });

    try {
      localStorage.setItem('wuyi_window_size', sizeKey);
    } catch (e) {}

    if (activePipWindow && !activePipWindow.closed) {
      activePipWindow.resizeTo(target.width, target.height);
    } else if (state.isFloating) {
      panel.style.width = target.width + 'px';
    }
    showToast('📐 已設定為 ' + target.label + ' 視窗尺寸 (' + target.width + 'x' + target.height + ')');
  }

  panel.querySelectorAll('.wuyi-size-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const sizeKey = btn.getAttribute('data-size');
      setWindowSize(sizeKey);
    });
  });

  // 5. 搜尋 LINE 聊天室符合格式之對話框與上一筆/下一筆切換導覽
  let orderCandidates = [];
  let currentCandidateIndex = -1;

  function isValidChatImage(src) {
    if (!src || typeof src !== 'string') return false;
    if (src.startsWith('data:image/svg')) return false;
    const lower = src.toLowerCase();
    if (lower.includes('avatar') || lower.includes('profile') || lower.includes('emoji') || lower.includes('icon') || lower.includes('sticker')) {
      return false;
    }
    return true;
  }

  // 檢驗是否屬於聊天室「對話訊息泡泡」（嚴禁抓取右側記事本、顧客面板、彈窗等非聊天區域）
  function isInsideChatDialogue(el) {
    if (!el) return false;

    // 1. 嚴格排除小幫手自身面板
    if (el.closest('#wuyi-order-helper-root, #wuyi-helper-root')) {
      return false;
    }

    // 2. 嚴格排除彈出視窗（如新增記事本彈窗、任何 Modal/Dialog）
    if (el.closest('[role="dialog"], [class*="modal" i], [class*="dialog" i], .modal, .dialog')) {
      return false;
    }

    // 3. 嚴格排除右側「記事本」與顧客資訊抽屜 (Drawer / Aside / User Profile / Notes / Memo / Tabs)
    if (el.closest('aside, [class*="drawer" i], [class*="sidebar-right" i], [class*="user-info" i], [class*="customer-profile" i], [class*="note" i], [class*="memo" i], [id*="note" i], [id*="memo" i], [class*="right" i], [role="tabpanel"], [class*="tabpanel" i]')) {
      return false;
    }

    // 4. 嚴格排除左側聊天室列表 (chat list / room list)
    if (el.closest('[class*="chat-list" i], [class*="chatList"], [class*="room-list" i], nav')) {
      return false;
    }

    // 5. 幾何位置檢驗：確保元素必定落在中間對話串區域（嚴禁落在右側記事本欄位）
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;

      // 若元素在可視區域最右側 380px 以內，直接視為右側記事本/面板排除
      if (window.innerWidth > 800 && rect.left > window.innerWidth - 380) {
        return false;
      }

      // 若有找到對話輸入框 (textarea)，所有聊天泡泡水平位置必定與輸入框對齊
      const chatInput = document.querySelector('textarea:not(#txtFlowerOrder):not(#txtCakeOrder):not(#txtPricing)');
      if (chatInput) {
        const inputRect = chatInput.getBoundingClientRect();
        // 如果元素水平位置在對話輸入框的右側（即右側記事本欄位），絕對不是聊天對話！
        if (rect.left > inputRect.right + 20) {
          return false;
        }
        // 如果元素水平位置在對話輸入框的左側（即左側聊天清單），絕對不是聊天對話！
        if (rect.right < inputRect.left - 20) {
          return false;
        }
      }
    } catch (e) {}

    // 6. 排除含有「記事本」等關鍵字或記事特徵的容器
    const raw = (el.innerText || el.textContent || '').trim();
    if (raw.includes('記錄與用戶之間的互動') || raw.includes('交接備註') || /^(記事本|記事)\s*\d*\/?\d*/.test(raw)) {
      return false;
    }
    if (el.closest('[aria-label*="記事本"], [title*="記事本"], [aria-label*="note" i]')) {
      return false;
    }

    return true;
  }

  function findOrderCandidateBubbles() {
    const selectors = [
      '[data-testid*="message"]',
      '[class*="bubble"]',
      '[class*="Bubble"]',
      '[class*="message-body"]',
      '[class*="message-text"]',
      '[class*="message"]',
      '[class*="Message"]',
      '[class*="chat-item"]',
      'li',
      'p',
      'div'
    ];

    const elements = Array.from(document.querySelectorAll(selectors.join(', ')));
    const matched = [];

    for (const el of elements) {
      if (!isInsideChatDialogue(el)) continue;

      const text = (el.innerText || '').trim();
      if (!text) continue;

      // 嚴格判定：必須同時具備以下 6 項訂單核心資訊才能選入
      const hasPickupDate = /(?:取貨|自取)?日期\s*[：:]/.test(text) || /取貨日期|自取日期/.test(text);
      const hasPickupTime = /(?:取貨|自取)?時間\s*[：:]/.test(text) || /取貨時間|自取時間/.test(text);
      const hasPickupLocation = /(?:自取|取貨)(?:地點|門市)\s*[：:]/.test(text) || /自取地點|取貨地點/.test(text);
      const hasLineName = /(?:訂購人(?:的)?\s*)?(?:LINE|line)\s*名稱/i.test(text);
      const hasCustomerName = /訂購人姓名|訂購人\s*姓名/.test(text) || (/(?:訂購人)?姓名\s*[：:]/.test(text) && !/LINE\s*名稱/i.test(text));
      const hasCustomerPhone = /訂購人電話|訂購人\s*電話/.test(text) || /(?:訂購人|聯絡)?電話\s*[：:]/.test(text);

      const isOrderValid = Boolean(hasPickupDate && hasPickupTime && hasPickupLocation && hasLineName && hasCustomerName && hasCustomerPhone);

      if (isOrderValid) {
        matched.push({ el, text });
      }
    }

    // 剔除包含其他候選者的超大外層容器（例如包了幾十條訊息的聊天列表外框）
    const filtered = matched.filter(item => {
      const containsChildOrder = matched.some(other => {
        return other.el !== item.el &&
               item.el.contains(other.el) &&
               (/LINE/i.test(other.text) || /取貨/.test(other.text) || /蛋糕/.test(other.text) || other.text.length > 40);
      });
      if (containsChildOrder) return false;

      // 剔除過小且只有單行標題的孤立標籤
      const hasContent = /LINE|取貨|自取|蛋糕|口味|尺寸|題字|訂購人|加購|預算|花束/i.test(item.text);
      if (!hasContent && item.text.length < 20) {
        return false;
      }

      return true;
    });

    // 去除重複對話框
    const unique = [];
    const seenTexts = new Set();
    for (const item of filtered) {
      const key = item.text.replace(/\s+/g, ' ').substring(0, 100);
      if (!seenTexts.has(key)) {
        seenTexts.add(key);
        unique.push(item);
      }
    }

    // 依據在網頁中的 DOM 順序排序（由舊至新）
    unique.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return unique;
  }

  function updateNavUI() {
    const total = orderCandidates.length;
    if (total === 0) {
      navCounter.textContent = '-/-';
      btnPrevOrder.disabled = true;
      btnNextOrder.disabled = true;
      return;
    }

    const currentNum = currentCandidateIndex + 1;
    navCounter.textContent = `${currentNum}/${total}`;
    btnPrevOrder.disabled = currentCandidateIndex <= 0;
    btnNextOrder.disabled = currentCandidateIndex >= total - 1;
  }

  async function applyOrderCandidate(index) {
    if (index < 0 || index >= orderCandidates.length) return;
    currentCandidateIndex = index;
    updateNavUI();

    const candidate = orderCandidates[index];
    const text = candidate.text;

    // 1. 依需求分成 1️⃣花束 與 2️⃣蛋糕 兩大部分填入對應文字框 (無該項目則填寫「無」)
    const cleanText = Ext.cleanOrderTextWithoutPricing(text);
    const split = Ext.splitOrderText(cleanText);
    if (txtFlowerOrder) txtFlowerOrder.value = split.flowerText;
    if (txtCakeOrder) txtCakeOrder.value = split.cakeText;

    state.orderState = Ext.parseOrderText(cleanText);
    if (inputDateTag) {
      inputDateTag.value = state.orderState.pickup.dateTag || (Ext && Ext.formatWuyiDate(state.orderState.pickup.date)) || state.orderState.pickup.date || '';
    }

    // 2. 滾動至該對話框並框線高亮
    try {
      candidate.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      candidate.el.style.outline = '3px solid #0284c7';
      candidate.el.style.borderRadius = '8px';
      setTimeout(() => {
        if (candidate.el) candidate.el.style.outline = '';
      }, 2000);
    } catch (e) {}

    // 3. 尋找金額明細：優先提取「訂購人電話」下方的內容
    let foundPricingText = Ext.extractPricingFromOrderText(text);
    if (!foundPricingText) {
      if (Ext.isPricingFormat(text)) {
        foundPricingText = text;
      } else {
        const allDivs = Array.from(document.querySelectorAll('.chat-content, .message-content, [data-testid*="message"], div, p'));
        for (let i = allDivs.length - 1; i >= 0; i--) {
          if (!isInsideChatDialogue(allDivs[i])) continue;
          const t = (allDivs[i].innerText || '').trim();
          if (Ext.isPricingFormat(t)) {
            foundPricingText = t;
            break;
          }
        }
      }
    }
    if (foundPricingText) {
      state.pricingState = Ext.parsePricingText(foundPricingText);
      txtPricing.value = state.pricingState.breakdownText || foundPricingText;
    } else {
      txtPricing.value = '';
    }

    // 4. 尋找與該對話相關的圖片
    const candidateImages = [];
    candidate.el.querySelectorAll('img').forEach(img => {
      if (isValidChatImage(img.src) && !candidateImages.includes(img.src)) {
        candidateImages.push(img.src);
      }
    });

    const parentContainer = candidate.el.parentElement;
    if (parentContainer) {
      parentContainer.querySelectorAll('img').forEach(img => {
        if (isValidChatImage(img.src) && !candidateImages.includes(img.src)) {
          candidateImages.push(img.src);
        }
      });
    }

    if (candidateImages.length > 0) {
      // 全並行平行抓取對話中的全部圖片 (大幅縮減一鍵抓取等待時間)
      const fetchedResults = await Promise.all(
        candidateImages.map(url => fetchImageViaServiceWorker(url))
      );
      const dataUrls = fetchedResults.map(r => (r && r.success && r.dataUrl) ? r.dataUrl : null);

      const hasFlower = split.flowerText && split.flowerText !== '無';
      const hasCake = split.cakeText && split.cakeText !== '無';

      if (hasFlower && !hasCake) {
        // 純花束訂單
        dataUrls.forEach((dUrl, idx) => {
          if (!dUrl) return;
          if (idx < state.images.flower.length) {
            state.images.flower[idx] = dUrl;
          } else {
            state.images.flower.push(dUrl);
          }
        });
        renderGroupBoxes('flower');
      } else if (hasFlower && hasCake) {
        // 花束 + 蛋糕混和訂單：依序填入花束、蛋糕、蠟燭配件
        if (dataUrls[0]) {
          state.images.flower[0] = dataUrls[0];
          renderGroupBoxes('flower');
        }
        if (dataUrls[1]) {
          state.images.cake[0] = dataUrls[1];
          renderGroupBoxes('cake');
        }
        if (dataUrls[2]) {
          state.images.addon[0] = dataUrls[2];
          renderGroupBoxes('addon');
        }
        if (dataUrls.length > 3) {
          for (let idx = 3; idx < dataUrls.length; idx++) {
            if (dataUrls[idx]) state.images.cake.push(dataUrls[idx]);
          }
          renderGroupBoxes('cake');
        }
      } else {
        // 純蛋糕/配件
        for (let idx = 0; idx < Math.min(3, dataUrls.length); idx++) {
          const dUrl = dataUrls[idx];
          if (!dUrl) continue;
          if (idx < state.images.cake.length) {
            state.images.cake[idx] = dUrl;
          } else {
            state.images.cake.push(dUrl);
          }
        }
        renderGroupBoxes('cake');

        if (dataUrls.length > 3) {
          for (let idx = 3; idx < dataUrls.length; idx++) {
            const dUrl = dataUrls[idx];
            if (!dUrl) continue;
            const addonIdx = idx - 3;
            if (addonIdx < state.images.addon.length) {
              state.images.addon[addonIdx] = dUrl;
            } else {
              state.images.addon.push(dUrl);
            }
          }
          renderGroupBoxes('addon');
        }
      }
    }

    state.isModifiedSinceLoad = false;
    showToast(`📋 已載入第 ${currentCandidateIndex + 1}/${orderCandidates.length} 則訂單對話`);
  }

  btnScrapeChat.addEventListener('click', async () => {
    showToast('🔍 正在搜尋對話框訂單...');
    orderCandidates = findOrderCandidateBubbles();
    if (orderCandidates.length === 0) {
      currentCandidateIndex = -1;
      updateNavUI();
      showToast('⚠️ 未在對話框中找到包含【訂購人 LINE 名稱】或訂單格式的訊息');
      return;
    }
    // 預設選取最新一筆 (最後一筆)
    await applyOrderCandidate(orderCandidates.length - 1);
  });

  btnPrevOrder.addEventListener('click', () => {
    if (currentCandidateIndex > 0) {
      applyOrderCandidate(currentCandidateIndex - 1);
    }
  });

  btnNextOrder.addEventListener('click', () => {
    if (currentCandidateIndex < orderCandidates.length - 1) {
      applyOrderCandidate(currentCandidateIndex + 1);
    }
  });

  btnRefresh.addEventListener('click', () => {
    btnScrapeChat.click();
  });

  // 跨域取得圖片轉換
  function fetchImageViaServiceWorker(url) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url }, (res) => {
          if (res && res.success) {
            resolve(res);
          } else {
            resolve({ success: false, dataUrl: url });
          }
        });
      } else {
        resolve({ success: false, dataUrl: url });
      }
    });
  }

  // 6. 文字與標籤編輯雙向同步 (確保修改能即時連動小卡與備忘錄)
  if (inputDateTag) {
    inputDateTag.addEventListener('input', () => {
      const val = inputDateTag.value.trim();
      state.orderState.pickup.dateTag = val;
      // 維持完整訂單內容原始文字，不自動覆寫 txtRawOrder
    });
  }

  // 點擊「＋ 新增標籤」直接在 LINE 官方帳號右側顧客資料新增此日期標籤 (例如 1102)
  if (btnAddLineTag) {
    btnAddLineTag.addEventListener('click', async () => {
      const rawDate = (inputDateTag ? inputDateTag.value : state.orderState.pickup.date) || '';
      if (!rawDate.trim()) {
        showToast('⚠️ 請先輸入或抓取取貨日期');
        return;
      }
      const tag = Ext.formatWuyiDate(rawDate) || rawDate.trim();
      if (inputDateTag) inputDateTag.value = tag;
      state.orderState.pickup.dateTag = tag;
      // 點擊新增標籤不覆寫完整訂單內容，維持顧客原始格式 (如 11/1 (日)、11/1‼️)

      // 同時複製至剪貼簿
      await copyTextToClipboard(tag);

      // 自動在 LINE 頁面尋找「＋ 新增標籤」並輸入送出
      const res = await addLineOfficialTag(tag);
      showToast(res.message);
    });
  }

  // 通用可見性與真實點擊輔助函式 (相容 position: fixed 彈窗、SVG 圖示與各類框架)
  function isVisibleOnScreen(el) {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root') || el.closest('#wuyi-helper-root')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {}
    return el.offsetParent !== null;
  }

  function triggerRealClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
    try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    ['pointerdown', 'mouseenter', 'mouseover', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtName => {
      try { el.dispatchEvent(new MouseEvent(evtName, opts)); } catch (e) {}
    });
    if (typeof el.click === 'function') {
      try { el.click(); } catch (e) {}
    }
  }

  // 檢查右側顧客資訊面板中是否已存在日期標籤 (例如 4 碼數字 1010、1102 等)
  function findExistingDateTagInCustomerProfile() {
    const profileContainers = Array.from(document.querySelectorAll('aside, [class*="drawer"], [class*="sidebar-right"], [class*="user-info"], [class*="customer"], [class*="profile"], [class*="client"]'))
      .filter(isVisibleOnScreen);

    const searchRoots = profileContainers.length > 0 ? profileContainers : [document.body];
    for (const rootEl of searchRoots) {
      const tagEls = Array.from(rootEl.querySelectorAll('span, button, a, div, li, [class*="tag"], [class*="Tag"]')).filter(el => {
        if (!isVisibleOnScreen(el)) return false;
        if (el.closest('#wuyi-helper-root, #wuyi-order-helper-root')) return false;
        if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message"], [data-testid*="message"]')) return false;
        if (el.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav')) return false;
        if (el.children.length > 2) return false;
        const txt = (el.textContent || '').trim();
        return /^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(txt) || /^\d{4}$/.test(txt);
      });

      if (tagEls.length > 0) {
        return tagEls[0].textContent.trim();
      }
    }
    return null;
  }

  // 自動化操作 LINE 官方帳號右側顧客資料面板之「＋ 新增標籤」
  async function addLineOfficialTag(tag) {
    if (!tag) return { success: false, message: '⚠️ 請先輸入取貨日期標籤' };

    // 依需求允許新增多個日期標籤 (如第二個、第三個日期)

    const findTagInput = (beforeInputs) => {
      const allInputs = Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
        .filter(inp => {
          if (!isVisibleOnScreen(inp)) return false;
          const type = (inp.getAttribute('type') || 'text').toLowerCase();
          if (['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(type)) return false;
          return true;
        });

      // 1. 最優先：點擊「＋ 新增標籤」後畫面上新出現的 input
      const newlyAppeared = allInputs.find(inp => !beforeInputs.has(inp));
      if (newlyAppeared) return newlyAppeared;

      // 2. 次優先：目前獲得焦點的 input (排除左側聊天室列表搜尋框)
      if (document.activeElement && allInputs.includes(document.activeElement)) {
        const inLeftList = document.activeElement.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
        if (!inLeftList) return document.activeElement;
      }

      // 3. 第三優先：placeholder 含「標籤/tag」或位於彈窗/下拉選單/右側顧客欄內的 input
      return allInputs.find(inp => {
        const inLeftList = inp.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
        if (inLeftList) return false;
        const ph = (inp.placeholder || inp.getAttribute('aria-label') || '').toLowerCase();
        if (ph.includes('標籤') || ph.includes('tag')) return true;
        return Boolean(inp.closest('[role="dialog"], [class*="modal"], [class*="popover"], [class*="dropdown"], [class*="tag"], aside, [class*="drawer"], [class*="profile"]'));
      }) || null;
    };

    // 記錄點擊前畫面上已存在的 input
    const beforeInputs = new Set(
      Array.from(document.querySelectorAll('input, [contenteditable="true"]')).filter(isVisibleOnScreen)
    );

    // 1. 尋找 LINE 右側顧客資訊面板中的「＋ 新增標籤」按鈕
    const all = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
      if (el.closest('#wuyi-helper-root')) return false;
      const raw = (el.textContent || '').trim();
      const t = raw.replace(/[\s\u200B\uFEFF]+/g, '');
      return t === '新增標籤' || t === '+新增標籤' || t === '＋新增標籤' || raw === '+ 新增標籤' || raw === '＋ 新增標籤';
    });

    let addTagBtn = null;
    let deepest = null;

    if (all.length > 0) {
      // 優先選取最小節點與可點擊容器 (button, a, role=button)
      all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      deepest = all[0];
      addTagBtn = deepest.closest('button, a, [role="button"]') || deepest;

      // 2. 觸發原生滑鼠點擊事件開啟標籤輸入框/選單
      triggerRealClick(addTagBtn);
      if (addTagBtn !== deepest) {
        triggerRealClick(deepest);
      }
    }

    // 3. 等待標籤輸入框或下拉選單出現 (最多 1.8 秒)
    let input = null;
    for (let i = 0; i < 18; i++) {
      await new Promise(r => setTimeout(r, 100));
      input = findTagInput(beforeInputs);
      if (input) break;

      // 若 300ms 尚未出現，嘗試點擊父容器 (支援將 @click 綁在父層 div 的元件)
      if (i === 2 && deepest && deepest.parentElement && !deepest.parentElement.closest('#wuyi-helper-root')) {
        triggerRealClick(deepest.parentElement);
      }
    }

    if (!input && all.length === 0) {
      return {
        success: false,
        message: `🏷️ 已複製標籤「${tag}」至剪貼簿！(未偵測到 LINE「＋ 新增標籤」按鈕)`
      };
    }

    // 4. 若找到標籤輸入框，使用 native setter + execCommand 填入 4 碼標籤 (確保 Vue/React 狀態更新)
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, tag);
      } else {
        input.value = tag;
      }

      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, tag);
      } catch (e) {}

      if (input.value !== tag) {
        if (nativeSetter) {
          nativeSetter.call(input, tag);
        } else {
          input.value = tag;
        }
      }

      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tag }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: tag.slice(-1), bubbles: true }));
    }

    // 等待 250ms 讓下拉選單過濾出該標籤或「＋ 新增標籤」選項
    await new Promise(r => setTimeout(r, 250));

    // 5. 檢查下拉選單中的標籤選項 (嚴格限制小型葉節點，絕不誤點外層大 div 容器！)
    const optionCandidates = Array.from(document.querySelectorAll('li, label, button, a, span, [role="option"], [role="menuitem"], [class*="item"], [class*="tag"]'))
      .filter(el => {
        if (!isVisibleOnScreen(el)) return false;
        if (el === addTagBtn || el === deepest || el === input) return false;
        if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"]')) return false;
        if (el.querySelectorAll('*').length > 6) return false;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 35) return false;
        return t === tag ||
               t === `+${tag}` || t === `＋${tag}` || t === `+ ${tag}` || t === `＋ ${tag}` ||
               (t.includes(tag) && (t.includes('新增') || t.includes('建立') || t.includes('「') || t.includes('+') || t.includes('＋')));
      });

    if (optionCandidates.length > 0) {
      optionCandidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      const bestOpt = optionCandidates[0];
      const optTarget = bestOpt.closest('li, label, button, a, [role="option"], [role="menuitem"]') || bestOpt;
      const checkbox = optTarget.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        triggerRealClick(checkbox);
      } else {
        triggerRealClick(optTarget);
      }
    }

    // 模擬在輸入框按下 Enter 鍵
    if (input) {
      ['keydown', 'keypress', 'keyup'].forEach(type => {
        input.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        }));
      });
    }

    // 6. 等待 200ms 後檢查是否有「儲存 / 確定 / 完成 / 新增」確認按鈕
    await new Promise(r => setTimeout(r, 200));
    const confirmBtns = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(el => {
        if (!isVisibleOnScreen(el)) return false;
        if (el === addTagBtn || el === deepest || el.disabled) return false;
        if (el.querySelectorAll('*').length > 4) return false;
        const t = (el.textContent || '').trim();
        return t === '儲存' || t === '確定' || t === '完成' || t === '新增';
      });
    if (confirmBtns.length > 0) {
      triggerRealClick(confirmBtns[confirmBtns.length - 1]);
    }

    if (!input && optionCandidates.length === 0) {
      return {
        success: true,
        message: `🏷️ 已點擊 LINE「＋ 新增標籤」！標籤「${tag}」已複製，可直接貼上儲存`
      };
    }

    return {
      success: true,
      message: `🏷️ 已成功為此客戶新增 LINE 標籤：${tag}！`
    };
  }

  const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  function updateGroupNumbering() {
    let seq = 0;
    const fCards = (panel || root).querySelectorAll('[data-group-type="flower"]');
    fCards.forEach(c => {
      const lbl = c.querySelector('.wuyi-item-label');
      if (lbl) {
        const num = NUM_EMOJIS[seq] || `${seq + 1}️⃣`;
        lbl.textContent = `📝 ${num} 花束訂單內容：`;
      }
      seq++;
    });

    const cCards = (panel || root).querySelectorAll('[data-group-type="cake"]');
    cCards.forEach(c => {
      const lbl = c.querySelector('.wuyi-item-label');
      if (lbl) {
        const num = NUM_EMOJIS[seq] || `${seq + 1}️⃣`;
        lbl.textContent = `📝 ${num} 蛋糕訂單內容：`;
      }
      seq++;
    });
  }

  function getGroupImages(type, index) {
    const key = index === 0 ? type : `${type}_${index}`;
    const list = state.images[key] || (index === 0 ? state.images[type] : []);
    return (list || []).filter(Boolean);
  }

  function getAllOrderItems() {
    const items = [];
    let seq = 0;

    // 花單組別
    const fCards = (panel || root).querySelectorAll('[data-group-type="flower"]');
    fCards.forEach((c) => {
      const gIdx = parseInt(c.dataset.groupIndex || '0', 10);
      const ta = c.querySelector('textarea');
      const text = (ta ? ta.value : '').trim();
      const imgs = getGroupImages('flower', gIdx);
      const hasContent = Boolean(text && text !== '無') || imgs.length > 0;
      if (hasContent || fCards.length === 1) {
        if (hasContent) {
          items.push({
            type: 'flower',
            index: seq++,
            groupIndex: gIdx,
            text: text || '無',
            images: imgs
          });
        }
      }
    });

    // 蛋糕組別
    const cCards = (panel || root).querySelectorAll('[data-group-type="cake"]');
    cCards.forEach((c) => {
      const gIdx = parseInt(c.dataset.groupIndex || '0', 10);
      const ta = c.querySelector('textarea');
      const text = (ta ? ta.value : '').trim();
      const cImgs = getGroupImages('cake', gIdx);
      const aImgs = getGroupImages('addon', gIdx);
      const hasContent = Boolean(text && text !== '無') || cImgs.length > 0 || aImgs.length > 0;
      if (hasContent || cCards.length === 1) {
        if (hasContent) {
          items.push({
            type: 'cake',
            index: seq++,
            groupIndex: gIdx,
            text: text || '無',
            images: cImgs,
            addonImages: aImgs
          });
        }
      }
    });

    // 容錯備援：若皆未選取但首筆有內容
    if (items.length === 0) {
      const fText = getFlowerOrderText();
      const cText = getCakeOrderText();
      let s = 0;
      if (fText && fText !== '無') {
        items.push({ type: 'flower', index: s++, groupIndex: 0, text: fText, images: getGroupImages('flower', 0) });
      }
      if (cText && cText !== '無') {
        items.push({ type: 'cake', index: s++, groupIndex: 0, text: cText, images: getGroupImages('cake', 0), addonImages: getGroupImages('addon', 0) });
      }
    }

    // 確保由 0 起算且依序標上 1️⃣, 2️⃣, 3️⃣, 4️⃣...
    items.forEach((it, i) => {
      it.index = i;
      it.numEmoji = NUM_EMOJIS[i] || `${i + 1}️⃣`;
    });

    return items;
  }

  function formatItemTextWithNumber(text, index, type) {
    let clean = (text || '').trim();
    if (!clean || clean === '無') return '';
    const numEmoji = NUM_EMOJIS[index] || `${index + 1}️⃣`;

    clean = clean.replace(/^[1-9🔟]️⃣\s*/, '').trim();

    if (type === 'flower') {
      if (!/^(💐|精緻包裝花束|花束)/.test(clean)) {
        return `${numEmoji} 💐精緻包裝花束💐\n${clean}`;
      } else {
        return `${numEmoji} ${clean}`;
      }
    } else {
      if (!/^(🎂|客製化蛋糕|蛋糕|圖款)/.test(clean)) {
        return `${numEmoji} 🎂客製化蛋糕🎂\n${clean}`;
      } else {
        return `${numEmoji} ${clean}`;
      }
    }
  }

  function getFlowerOrderText() {
    return (txtFlowerOrder ? txtFlowerOrder.value : '').trim();
  }

  function getCakeOrderText() {
    return (txtCakeOrder ? txtCakeOrder.value : '').trim();
  }

  function getCombinedOrderText() {
    const items = getAllOrderItems();
    if (items.length === 0) {
      const f = getFlowerOrderText();
      const c = getCakeOrderText();
      const parts = [];
      if (f && f !== '無') parts.push(formatItemTextWithNumber(f, 0, 'flower'));
      if (c && c !== '無') parts.push(formatItemTextWithNumber(c, parts.length, 'cake'));
      return parts.join('\n\n');
    }

    return items.map((it) => {
      return formatItemTextWithNumber(it.text, it.index, it.type);
    }).filter(Boolean).join('\n\n');
  }

  function onOrderInputChanged() {
    state.isModifiedSinceLoad = true;
    const combined = getCombinedOrderText();
    state.orderState = Ext.parseOrderText(combined);
    if (inputDateTag && (state.orderState.pickup.dateTag || state.orderState.pickup.date)) {
      inputDateTag.value = state.orderState.pickup.dateTag || (Ext && Ext.formatWuyiDate(state.orderState.pickup.date)) || state.orderState.pickup.date;
    }
  }

  if (txtFlowerOrder) txtFlowerOrder.addEventListener('input', onOrderInputChanged);
  if (txtCakeOrder) txtCakeOrder.addEventListener('input', onOrderInputChanged);
  if (inputDateTag) inputDateTag.addEventListener('input', () => { state.isModifiedSinceLoad = true; });

  txtPricing.addEventListener('input', () => {
    state.isModifiedSinceLoad = true;
    state.pricingState = Ext.parsePricingText(txtPricing.value);
  });

  // 動態新增花單與蛋糕組別
  let flowerGroupCount = 0;
  let cakeGroupCount = 0;

  function addFlowerGroup() {
    flowerGroupCount++;
    const gIdx = flowerGroupCount;
    const groupKey = `flower_${gIdx}`;
    state.images[groupKey] = [null, null];

    const card = document.createElement('div');
    card.className = 'wuyi-order-group-card wuyi-added-group';
    card.dataset.groupType = 'flower';
    card.dataset.groupIndex = String(gIdx);
    card.id = `flowerGroup_${gIdx}`;

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-weight: bold; font-size: 13px; color: #db2777;">💐 花單組別</span>
        <button type="button" class="wuyi-btn-remove-group" title="刪除此花單組別">✕ 刪除</button>
      </div>
      <div class="wuyi-img-section-slot">
        <div class="wuyi-slot-header">
          <span class="wuyi-slot-title">💐花束(截圖)</span>
          <div class="wuyi-slot-actions">
            <button type="button" class="wuyi-btn-add-slot" data-group="${groupKey}" title="多加一個花束截圖空格">新增</button>
            <button type="button" class="wuyi-btn-clear-slot" data-group="${groupKey}">清除</button>
          </div>
        </div>
        <div class="wuyi-boxes-row" id="rowFlower_${gIdx}"></div>
      </div>
      <div class="wuyi-form-group" style="margin-top: -4px;">
        <div class="wuyi-label-row">
          <span class="wuyi-label wuyi-item-label" id="labelFlower_${gIdx}">📝 花束訂單內容：</span>
          <button type="button" class="wuyi-btn-inline-copy btn-copy-item-direct" data-type="flower" data-index="${gIdx}">📋 複製花束</button>
        </div>
        <textarea class="wuyi-textarea txt-order-item" data-type="flower" data-index="${gIdx}" rows="4" placeholder="填寫此花束訂單內容..."></textarea>
      </div>
    `;

    // 刪除按鈕
    card.querySelector('.wuyi-btn-remove-group').addEventListener('click', () => {
      card.remove();
      delete state.images[groupKey];
      updateGroupNumbering();
      onOrderInputChanged();
      showToast('🗑️ 已刪除花單組別');
    });

    // 複製按鈕
    card.querySelector('.btn-copy-item-direct').addEventListener('click', () => {
      const ta = card.querySelector('textarea');
      const text = ta ? ta.value.trim() : '';
      if (!text) return showToast('⚠️ 目前沒有花束文字');
      copyTextToClipboard(text);
      showToast('📋 已複製花束訂單內容！');
    });

    // 輸入監聽
    card.querySelector('textarea').addEventListener('input', onOrderInputChanged);

    const container = (panel || root).querySelector('#wuyiFlowerGroupsContainer');
    if (container) {
      container.appendChild(card);
    }
    renderGroupBoxes(groupKey);
    updateGroupNumbering();
    showToast('➕ 已新增一組花單！');
  }

  function addCakeGroup() {
    cakeGroupCount++;
    const gIdx = cakeGroupCount;
    const cakeKey = `cake_${gIdx}`;
    const addonKey = `addon_${gIdx}`;
    state.images[cakeKey] = [null, null, null];
    state.images[addonKey] = [null];

    const card = document.createElement('div');
    card.className = 'wuyi-order-group-card wuyi-added-group';
    card.dataset.groupType = 'cake';
    card.dataset.groupIndex = String(gIdx);
    card.id = `cakeGroup_${gIdx}`;

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-weight: bold; font-size: 13px; color: #ea580c;">🎂 蛋糕組別</span>
        <button type="button" class="wuyi-btn-remove-group" title="刪除此蛋糕組別">✕ 刪除</button>
      </div>
      <div class="wuyi-img-section-slot">
        <div class="wuyi-slot-header">
          <span class="wuyi-slot-title">🎂蛋糕(截圖)</span>
          <div class="wuyi-slot-actions">
            <button type="button" class="wuyi-btn-add-slot" data-group="${cakeKey}" title="多加一個蛋糕款式截圖空格">新增</button>
            <button type="button" class="wuyi-btn-clear-slot" data-group="${cakeKey}">清除</button>
          </div>
        </div>
        <div class="wuyi-boxes-row" id="rowCake_${gIdx}"></div>
      </div>
      <div class="wuyi-img-section-slot">
        <div class="wuyi-slot-header">
          <span class="wuyi-slot-title">🕯️蠟燭(截圖)</span>
          <div class="wuyi-slot-actions">
            <button type="button" class="wuyi-btn-add-slot" data-group="${addonKey}" title="多加一個蠟燭配件截圖空格">新增</button>
            <button type="button" class="wuyi-btn-clear-slot" data-group="${addonKey}">清除</button>
          </div>
        </div>
        <div class="wuyi-boxes-row" id="rowAddon_${gIdx}"></div>
      </div>
      <div class="wuyi-form-group" style="margin-top: -4px;">
        <div class="wuyi-label-row">
          <span class="wuyi-label wuyi-item-label" id="labelCake_${gIdx}">📝 蛋糕訂單內容：</span>
          <button type="button" class="wuyi-btn-inline-copy btn-copy-item-direct" data-type="cake" data-index="${gIdx}">📋 複製訂單</button>
        </div>
        <textarea class="wuyi-textarea txt-order-item" data-type="cake" data-index="${gIdx}" rows="6" placeholder="填寫此蛋糕訂單內容..."></textarea>
      </div>
    `;

    // 刪除按鈕
    card.querySelector('.wuyi-btn-remove-group').addEventListener('click', () => {
      card.remove();
      delete state.images[cakeKey];
      delete state.images[addonKey];
      updateGroupNumbering();
      onOrderInputChanged();
      showToast('🗑️ 已刪除蛋糕組別');
    });

    // 複製按鈕
    card.querySelector('.btn-copy-item-direct').addEventListener('click', () => {
      const ta = card.querySelector('textarea');
      const text = ta ? ta.value.trim() : '';
      if (!text) return showToast('⚠️ 目前沒有訂單文字');
      copyTextToClipboard(text);
      showToast('📋 已複製訂單內容！');
    });

    // 輸入監聽
    card.querySelector('textarea').addEventListener('input', onOrderInputChanged);

    const container = (panel || root).querySelector('#wuyiCakeGroupsContainer');
    if (container) {
      container.appendChild(card);
    }
    renderGroupBoxes(cakeKey);
    renderGroupBoxes(addonKey);
    updateGroupNumbering();
    showToast('➕ 已新增一組蛋糕！');
  }

  if (btnAddFlowerGroup) {
    btnAddFlowerGroup.addEventListener('click', addFlowerGroup);
  }
  if (btnAddCakeGroup) {
    btnAddCakeGroup.addEventListener('click', addCakeGroup);
  }

  // 7. 快捷按鈕事件

  // 花束與蛋糕個別複製按鈕
  if (btnCopyFlowerDirect) {
    btnCopyFlowerDirect.addEventListener('click', () => {
      const text = getFlowerOrderText();
      if (!text) return showToast('⚠️ 目前沒有花束文字');
      copyTextToClipboard(text);
      showToast('📋 已複製花束訂單內容！');
    });
  }

  if (btnCopyCakeDirect) {
    btnCopyCakeDirect.addEventListener('click', () => {
      const text = getCakeOrderText();
      if (!text) return showToast('⚠️ 目前沒有訂單文字');
      copyTextToClipboard(text);
      showToast('📋 已複製訂單內容！');
    });
  }

  if (btnCopyOrderWithPricing) {
    btnCopyOrderWithPricing.addEventListener('click', () => {
      const cakeText = getCakeOrderText();
      const pricingText = (txtPricing ? txtPricing.value : '').trim();
      if (!cakeText && !pricingText) return showToast('⚠️ 目前沒有訂單內容與金額');
      let combined = cakeText;
      if (pricingText) {
        combined = combined ? (combined + '\n\n' + pricingText) : pricingText;
      }
      copyTextToClipboard(combined);
      showToast('📋 已複製訂單與金額明細！');
    });
  }

  // 金額明細旁邊的直接複製按鈕
  if (btnCopyPricingDirect) {
    btnCopyPricingDirect.addEventListener('click', () => {
      const textToCopy = txtPricing.value.trim();
      if (!textToCopy) return showToast('⚠️ 目前沒有金額明細');
      copyTextToClipboard(textToCopy);
      showToast('📋 已複製金額明細！');
    });
  }

  // 安全取得各類截圖陣列，防止 state.images 或內部陣列未定義時引發 TypeError
  function getSafeImages() {
    const imgs = state.images || {};
    return {
      flower: Array.isArray(imgs.flower) ? imgs.flower.filter(Boolean) : [],
      cake: Array.isArray(imgs.cake) ? imgs.cake.filter(Boolean) : [],
      addon: Array.isArray(imgs.addon) ? imgs.addon.filter(Boolean) : (imgs.addon ? [imgs.addon] : []),
      primaryAddon: Array.isArray(imgs.addon) ? (imgs.addon.filter(Boolean)[0] || null) : (imgs.addon || null)
    };
  }

  // 複製備忘錄格式 (富文字 HTML：圖片加可編輯文字，格式完全等同「一鍵複製確認小卡」)
  btnCopyOrder.addEventListener('click', copyRichNotesFormat);
  async function copyRichNotesFormat() {
    const allItems = getAllOrderItems();
    if (allItems.length === 0) {
      showToast('⚠️ 目前沒有訂單內容可複製');
      return;
    }

    showToast('⏳ 正在生成備忘錄格式...');

    const safeImgs = getSafeImages();
    // 全平行轉換各組別 DataUrl 加速
    const richItems = await Promise.all(allItems.map(async (it) => {
      const imgs = await Renderer.ensureDataUrls(it.images || []);
      const addons = await Renderer.ensureDataUrls(it.addonImages || []);
      return {
        type: it.type,
        text: it.text,
        images: imgs,
        addonImages: addons
      };
    }));

    const [flowerImgs, cakeImgs, addonImgs] = await Promise.all([
      Renderer.ensureDataUrls(safeImgs.flower),
      Renderer.ensureDataUrls(safeImgs.cake),
      Renderer.ensureDataUrls(safeImgs.addon)
    ]);

    const pricingText = (txtPricing ? txtPricing.value : '').trim();
    const { html, plainText } = Renderer.buildRichNotesHtml({
      items: richItems,
      flowerText: getFlowerOrderText(),
      cakeText: getCakeOrderText(),
      pricingText,
      flowerImages: flowerImgs,
      cakeImages: cakeImgs,
      addonImages: addonImgs
    });

    const activeWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    if (activeWin && activeWin.focus) {
      try { activeWin.focus(); } catch (_) {}
    }

    const nav = (activeWin && activeWin.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    if (nav && nav.clipboard && nav.clipboard.write) {
      try {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        await nav.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob
          })
        ]);
        showToast('📋 已複製備忘錄格式 (含照片與可編輯文字，格式同一鍵複製確認小卡)！');
        return;
      } catch (err) {
        console.warn('ClipboardItem HTML copy failed:', err);
      }
    }

    // 回退機制：使用 oncopy 事件寫入富文字至 NSPasteboard
    try {
      const onCopy = (e) => {
        e.clipboardData.setData('text/html', html);
        e.clipboardData.setData('text/plain', plainText);
        e.preventDefault();
      };
      document.addEventListener('copy', onCopy, { once: true });
      if (document.execCommand('copy')) {
        showToast('📋 已複製備忘錄格式 (含照片與可編輯文字，格式同一鍵複製確認小卡)！');
        return;
      }
    } catch (_) {}

    await copyTextToClipboard(plainText);
    showToast('📋 已複製備忘錄純文字格式！');
  }

  // 尋找「新增記事本」彈窗內的 textarea (精準鎖定 placeholder 包含「相關資訊」或彈窗標題為「新增記事本」)
  function findNoteModalTextarea() {
    const allTextareas = Array.from(document.querySelectorAll('textarea')).filter(isVisibleOnScreen);
    if (allTextareas.length === 0) return null;

    // 1. 優先精準匹配 LINE 官方截圖中的 placeholder: 「您可於此新增用戶的相關資訊，且記事本中的資訊不會向對方公開。」
    const exactMatch = allTextareas.find(t => {
      const ph = t.placeholder || '';
      return ph.includes('相關資訊') || ph.includes('不會向對方公開') || ph.includes('記事本中的資訊') || ph.includes('記事本');
    });
    if (exactMatch) return exactMatch;

    // 2. 檢查其父容器是否為標題為「新增記事本」或含「0/300」字數計數器的彈出視窗
    const modalWithTitle = allTextareas.find(t => {
      let p = t.parentElement;
      for (let depth = 0; depth < 6 && p && p !== document.body; depth++) {
        const txt = p.textContent || '';
        if (txt.includes('新增記事本') || /\d+\s*\/\s*300/.test(txt)) return true;
        p = p.parentElement;
      }
      return false;
    });
    if (modalWithTitle) return modalWithTitle;

    // 3. 檢查位於 dialog 或 modal 內的 textarea (嚴格排除中間聊天室底部的訊息輸入框，絕不誤傳 allTextareas[0]！)
    const inDialog = allTextareas.find(t => {
      if (t.closest('[class*="chat-room"], [class*="chat-footer"], [class*="message-input"], [class*="editor"]')) {
        return false;
      }
      return Boolean(t.closest('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'));
    });
    return inDialog || null;
  }

  // 尋找 LINE 右側記事本標題區塊 (記事本 0/1000) 旁的綠色「＋」按鈕
  function findLineAddNotePlusButton() {
    const noteTitleEls = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return (t === '記事本' || /^記事本\s*\d+\s*\/\s*\d+/.test(t)) && !t.includes('記錄與用戶') && !t.includes('負責人員') && t.length <= 30;
    });

    // 由最深層的「記事本」標題節點往外找
    noteTitleEls.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

    // 判斷是否為下方灰色提示框「ⓘ 記錄與用戶之間的互動」內的元素（嚴格排除！）
    const isInGrayInfoBox = (el) => {
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('info')) return true;
      let p = el;
      for (let d = 0; d < 3 && p && p !== document.body; d++) {
        const pt = (p.textContent || '').trim();
        if (pt.includes('記錄與用戶') || pt.includes('不會看見記事本')) {
          if (!pt.includes('記事本 0/') && !/記事本\s*\d+\s*\/\s*\d+/.test(pt)) {
            return true;
          }
        }
        p = p.parentElement;
      }
      return false;
    };

    // 判斷是否與「記事本 0/1000」在同一水平標題列上
    const isOnSameHeaderLine = (el, labelRect) => {
      if (!labelRect || labelRect.height === 0 || labelRect.width === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) return true;
      const labelCy = labelRect.top + labelRect.height / 2;
      const elCy = r.top + r.height / 2;
      return Math.abs(elCy - labelCy) <= 45 && r.left >= labelRect.left - 5;
    };

    for (const labelEl of noteTitleEls) {
      const labelRect = labelEl.getBoundingClientRect();
      let headerRow = labelEl;

      // 向上查找記事本標題列 (最多 5 層，且絕不跨越到上方的「負責人員」或「新增標籤」區塊)
      for (let depth = 0; depth < 5 && headerRow && headerRow !== document.body; depth++) {
        const rowText = headerRow.textContent || '';
        if (rowText.includes('負責人員') || rowText.includes('新增標籤')) {
          break;
        }

        // 策略 A：標題列內的 button / a / [role="button"] (不含「記事本」文字本身與灰色提示框)
        const explicitBtns = Array.from(headerRow.querySelectorAll('button, a, [role="button"]')).filter(b => {
          if (!isVisibleOnScreen(b) || isInGrayInfoBox(b)) return false;
          const bt = (b.textContent || '').trim();
          return !bt.includes('記事本') && !bt.includes('記錄與用戶') && isOnSameHeaderLine(b, labelRect);
        });
        if (explicitBtns.length > 0) {
          return explicitBtns[0];
        }

        // 策略 B：標題列內的 + 號圖示 (svg, i, span, div)
        const iconCandidates = Array.from(headerRow.querySelectorAll('svg, i, span, div')).filter(b => {
          if (!isVisibleOnScreen(b) || isInGrayInfoBox(b)) return false;
          if (b === labelEl || b.contains(labelEl)) return false;
          const bt = (b.textContent || '').trim();
          if (bt.includes('記事本') || bt.includes('記錄與用戶') || /^\d+\s*\/\s*\d+$/.test(bt)) return false;
          if (!isOnSameHeaderLine(b, labelRect)) return false;

          const cls = (b.className || '').toString().toLowerCase();
          const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
          const tag = b.tagName.toLowerCase();

          if (bt === '+' || bt === '＋') return true;
          if (cls.includes('plus') || cls.includes('add') || aria.includes('新增') || aria.includes('add')) return true;
          if ((tag === 'svg' || tag === 'i') && b.getBoundingClientRect().height <= 40) {
            return true;
          }
          return false;
        });

        if (iconCandidates.length > 0) {
          const icon = iconCandidates[0];
          return icon.closest('button, a, [role="button"]') || icon.parentElement || icon;
        }

        headerRow = headerRow.parentElement;
      }

      // 策略 C：若「記事本 0/1000」標題列為左右並排 flex 橫列，取標題列右側子元素
      let flexRow = labelEl.parentElement;
      for (let d = 0; d < 3 && flexRow && flexRow !== document.body; d++) {
        const rt = flexRow.textContent || '';
        if (rt.includes('負責人員') || rt.includes('新增標籤') || rt.includes('記錄與用戶')) break;
        if (flexRow.children && flexRow.children.length >= 2) {
          const lastChild = flexRow.lastElementChild;
          const lastText = (lastChild.textContent || '').trim();
          if (
            lastChild !== labelEl &&
            !lastChild.contains(labelEl) &&
            !lastText.includes('記事本') &&
            !/^\d+\s*\/\s*\d+$/.test(lastText) &&
            isOnSameHeaderLine(lastChild, labelRect)
          ) {
            return lastChild.querySelector('button, a, [role="button"]') || lastChild;
          }
        }
        flexRow = flexRow.parentElement;
      }
    }

    return null;
  }

  // 自動化操作 LINE 官方帳號右側顧客資料面板之「新增記事本」彈窗
  async function addLineOfficialNote(noteText) {
    if (!noteText) return { success: false, message: '⚠️ 無訂單內容可新增' };

    // 限制最多 300 字 (LINE 記事本上限為 300 字)
    let safeText = noteText.trim();
    if (safeText.length > 298) {
      safeText = safeText.substring(0, 298);
    }

    // 1. 檢查是否已經打開「新增記事本」彈窗
    let modalTextarea = findNoteModalTextarea();

    // 2. 若尚未開啟彈窗，尋找 LINE 右側記事本旁的「＋」按鈕並點擊開啟彈窗
    if (!modalTextarea) {
      const plusBtn = findLineAddNotePlusButton();
      if (plusBtn) {
        triggerRealClick(plusBtn);
        const innerIcon = plusBtn.querySelector('button, a, i, svg, span');
        if (innerIcon && innerIcon !== plusBtn) {
          triggerRealClick(innerIcon);
        }
      }

      // 等待「新增記事本」彈窗與 textarea 出現 (最多等待 2.2 秒)
      for (let i = 0; i < 22; i++) {
        await new Promise(r => setTimeout(r, 100));
        modalTextarea = findNoteModalTextarea();
        if (modalTextarea) break;

        // 若 300ms 尚未出現，再嘗試點擊 plusBtn 的父容器
        if (i === 2 && plusBtn && plusBtn.parentElement && !plusBtn.parentElement.closest('#wuyi-helper-root')) {
          triggerRealClick(plusBtn.parentElement);
        }
      }
    }

    // 3. 填入內容至「新增記事本」文字框 (使用 native setter 與 execCommand，確保 React/Vue 狀態同步與字數 0/300 更新)
    if (modalTextarea) {
      modalTextarea.focus();
      if (typeof modalTextarea.select === 'function') modalTextarea.select();

      let execSuccess = false;
      try {
        execSuccess = document.execCommand('insertText', false, safeText);
      } catch (e) {}

      if (!execSuccess || modalTextarea.value !== safeText) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(modalTextarea, safeText);
        } else {
          modalTextarea.value = safeText;
        }
      }

      modalTextarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeText }));
      modalTextarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      modalTextarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      modalTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: safeText.slice(-1), bubbles: true }));

      // 自動聚焦彈窗內的「儲存」按鈕
      const modal = modalTextarea.closest('[role="dialog"], .modal, [class*="modal"]') || modalTextarea.parentElement;
      if (modal) {
        const saveBtns = Array.from(modal.querySelectorAll('button, a, [role="button"]')).filter(b => {
          const bt = (b.textContent || '').trim();
          return bt === '儲存' || bt === '確定' || bt === '完成';
        });
        if (saveBtns.length > 0) {
          saveBtns[0].focus();
        }
      }

      return {
        success: true,
        message: '📝 已自動開啟並將內容填入「＋ 新增記事本」！請確認後點擊儲存'
      };
    } else {
      return {
        success: false,
        message: '📋 內容已複製至剪貼簿！(未偵測到記事本彈窗，請點選 LINE 記事本 ＋ 貼上)'
      };
    }
  }

  // 點擊「📝 ＋ 新增記事本」直接將訂單內容（含取貨日期）複製並填入 LINE 記事本
  if (btnAddLineNote) {
    btnAddLineNote.addEventListener('click', async () => {
      let textToCopy = getCombinedOrderText();
      if (!textToCopy && state.orderState && state.orderState.pickup && state.orderState.pickup.date) {
        textToCopy = Ext.formatRawOrder(state.orderState);
      }
      if (!textToCopy && inputDateTag && inputDateTag.value.trim()) {
        textToCopy = `取貨日期：${Ext.formatWuyiDate(inputDateTag.value.trim())}`;
      }
      const pricingText = (txtPricing ? txtPricing.value : '').trim();
      if (pricingText) {
        textToCopy = textToCopy ? (textToCopy + '\n\n' + pricingText) : pricingText;
      }
      if (!textToCopy) {
        showToast('⚠️ 目前沒有訂單或日期內容可新增');
        return;
      }
      await copyTextToClipboard(textToCopy);

      const res = await addLineOfficialNote(textToCopy);
      showToast(res.message);
    });
  }

  // 將時間格式化為 12 小時制 (如 15:00 -> 3點, 15:30 -> 3點半, 11:00 -> 11點, 保留現有 3點 / 3點半)
  function format12HourTime(rawTime) {
    if (!rawTime || typeof rawTime !== 'string') return '';
    const s = rawTime.trim();
    if (!s) return '';

    // 1. 標準冒號格式：15:00, 15:30, 03:00, 3:30, 15：00
    const mColon = s.match(/(?:(?:上午|下午|早上|中午|晚上)\s*)?(\d{1,2})[:：](\d{2})/);
    if (mColon) {
      let hh = parseInt(mColon[1], 10);
      const mm = mColon[2];
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      if (mm === '00') return `${hh}點`;
      if (mm === '30') return `${hh}點半`;
      return `${hh}點${mm}`;
    }

    // 2. 點/點半格式：3點, 15點, 3點半, 15點半, 下午3點, 3點30分
    const mDian = s.match(/(?:(?:上午|下午|早上|中午|晚上)\s*)?(\d{1,2})\s*點(?:\s*(半|30(?:分)?|00(?:分)?|\d{1,2}(?:分)?))?/);
    if (mDian) {
      let hh = parseInt(mDian[1], 10);
      const minPart = mDian[2] || '';
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      if (!minPart || minPart.startsWith('00')) return `${hh}點`;
      if (minPart === '半' || minPart.startsWith('30')) return `${hh}點半`;
      return `${hh}點${minPart.replace(/分$/, '')}`;
    }

    // 3. 純數字格式："15" -> "3點", "3" -> "3點"
    const mPure = s.match(/^(\d{1,2})$/);
    if (mPure) {
      let hh = parseInt(mPure[1], 10);
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      return `${hh}點`;
    }

    return s;
  }

  // 小卡檔名格式：1108 取貨時間12小時制 Melody.png (例如：1108 3點 Melody.png 或 1108 3點半 Melody.png)
  function buildCardFilename(dateTag, rawTime, lineName) {
    const time12 = format12HourTime(rawTime);
    const cleanDate = (dateTag || '').trim().replace(/[\/\\:*?"<>|]/g, '-');
    const cleanTime = (time12 || '').trim().replace(/[\/\\:*?"<>|]/g, '');
    const cleanName = (lineName || '客戶').trim().replace(/[\/\\:*?"<>|]/g, '_');

    const parts = [cleanDate, cleanTime, cleanName].filter(Boolean);
    return parts.join(' ') + '.png';
  }

  // 尋找 LINE 官方帳號聊天室右下角綠色「傳送」發送按鈕
  function findLineSendButton() {
    const isExcluded = (el) => el.closest('#wuyi-helper-root, #wuyi-order-helper-root');

    // 優先尋找文字包含「傳送」或「Send」的按鈕 (精準避開右側倒三角下拉箭頭)
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a, div[class*="btn"], div[class*="button"]')).filter(el => {
      if (isExcluded(el)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0) return false;
      const txt = (el.innerText || el.textContent || '').trim();
      return txt.includes('傳送') || txt.includes('Send') || /send|submit/i.test(el.className || '');
    });

    if (buttons.length > 0) {
      buttons.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      // 優先尋找純文字剛好為「傳送」或開頭為「傳送」的按鈕核心
      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || '').trim();
        if (txt === '傳送' || txt === 'Send' || txt.startsWith('傳送')) {
          // 若內部有子 button，取最核心的按鈕
          const childBtn = btn.querySelector('button, [role="button"]');
          return childBtn || btn;
        }
      }
      return buttons[0];
    }

    return null;
  }

  // 在主頁面環境 (Main World) 執行程式碼，以具備 Vue.js / Nuxt 內部實例與原生事件發送權限
  function runInPageContext(codeString) {
    try {
      const script = document.createElement('script');
      script.textContent = `(function() {
        try {
          ${codeString}
        } catch(e) {
          console.warn('runInPageContext error:', e);
        }
      })();`;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.warn('Failed to inject script to page context:', e);
    }
  }

  // 取得 LINE 官方帳號聊天室輸入框 (對話框)
  function findLineChatInput() {
    const isExcluded = (el) => el.closest('#wuyi-helper-root, #wuyi-order-helper-root');
    const excludedIds = ['txtFlowerOrder', 'txtCakeOrder', 'txtPricing', 'wuyiDateTagInput', 'inputManualOldTag'];

    // 優先序 0 (浮動標籤與覆蓋層特徵比對)：尋找頁面上含「Command + Enter : 傳送 / Enter : 換行」之節點或其相鄰輸入框
    const phElements = Array.from(document.querySelectorAll('*')).filter(el => {
      if (isExcluded(el) || excludedIds.includes(el.id)) return false;
      const ph = (el.placeholder || el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().toLowerCase();
      return (ph.includes('換行') && ph.includes('傳送')) || 
             (ph.includes('enter') && (ph.includes('command') || ph.includes('ctrl') || ph.includes('換行')));
    });
    for (const pEl of phElements) {
      if (pEl.tagName === 'TEXTAREA' || pEl.isContentEditable) return pEl;
      let p = pEl.parentElement;
      for (let d = 0; d < 5 && p && p !== document.body; d++) {
        const ta = p.querySelector('textarea, [contenteditable="true"]');
        if (ta && !isExcluded(ta) && !excludedIds.includes(ta.id)) return ta;
        p = p.parentElement;
      }
    }

    // 取得頁面上所有可能的文字輸入元件
    const allInputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')).filter(el => {
      if (isExcluded(el) || excludedIds.includes(el.id)) return false;
      // 嚴格排除記事本彈窗、側邊選單等
      if (el.closest('[class*="note-modal"], [class*="NoteModal"], [role="dialog"]') && !el.placeholder?.includes('換行') && !el.placeholder?.includes('傳送')) {
        return false;
      }
      return true;
    });

    // 優先序 1 (最高精準度)：特徵比對 placeholder 包含「換行」與「傳送」的對話框 (截圖特徵：Command + Enter : 傳送 / Enter : 換行)
    const exactMatch = allInputs.find(el => {
      const ph = (el.placeholder || el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return (ph.includes('換行') && ph.includes('傳送')) || 
             (ph.includes('enter') && (ph.includes('command') || ph.includes('ctrl') || ph.includes('換行')));
    });
    if (exactMatch) return exactMatch;

    // 優先序 2：placeholder 含有換行或訊息發送相關詞彙
    const fuzzyMatch = allInputs.find(el => {
      const ph = (el.placeholder || el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return /換行|傳送|command|enter|訊息|輸入|message/.test(ph);
    });
    if (fuzzyMatch) return fuzzyMatch;

    // 優先序 3：從 input[type="file"] (迴紋針上傳按鈕) 向上遍歷尋找共同聊天容器內的 textarea
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(fi => !isExcluded(fi));
    for (const fi of fileInputs) {
      let parent = fi.parentElement;
      for (let depth = 0; depth < 8 && parent && parent !== document.body; depth++) {
        const textareasInParent = Array.from(parent.querySelectorAll('textarea, [contenteditable="true"]')).filter(el => !isExcluded(el) && !excludedIds.includes(el.id));
        if (textareasInParent.length > 0) {
          textareasInParent.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
          return textareasInParent[0];
        }
        parent = parent.parentElement;
      }
    }

    // 優先序 4：依畫面位置挑選中間聊天區域最靠近底部的可見 textarea
    const visibleTextareas = allInputs.filter(el => {
      if (el.tagName !== 'TEXTAREA' && !el.isContentEditable) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 120 && rect.height > 25 && rect.bottom > 100;
    });
    if (visibleTextareas.length > 0) {
      visibleTextareas.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      return visibleTextareas[0];
    }

    // 優先序 5：檢查當前已 focus 的輸入框
    const active = document.activeElement;
    if (active && !isExcluded(active) && !excludedIds.includes(active.id)) {
      if (active.tagName === 'TEXTAREA' || active.isContentEditable) {
        return active;
      }
    }

    return null;
  }
  const getLineChatInput = findLineChatInput; // 向後相容別名

  // 直接將文字內容填入/貼入 LINE 聊天室輸入框 (對話框)
  async function pasteTextToLineChatInput(text, autoSend = true) {
    if (!text || !text.trim()) return { success: false, message: '⚠️ 訊息內容為空' };

    // 1. 同時寫入系統剪貼簿 (多視窗相容，保證隨時可手動 Ctrl+V / Cmd+V 貼上備用)
    const currentWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    try {
      await copyTextToClipboard(text, currentWin);
    } catch (_) {}

    // 2. 注入頁面主環境 (Main World)，直接對接 Vue.js 實例與雙向綁定 (保證 100% 寫入 Vue model)
    const escapedText = JSON.stringify(text);
    runInPageContext(`
      const textToInsert = ${escapedText};
      const isExcluded = (el) => el.closest('#wuyi-helper-root, #wuyi-order-helper-root');
      const allInputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')).filter(el => !isExcluded(el));

      let targetInput = allInputs.find(el => {
        const ph = (el.placeholder || el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || el.innerText || '').toLowerCase();
        return (ph.includes('換行') && ph.includes('傳送')) || (ph.includes('enter') && (ph.includes('command') || ph.includes('ctrl') || ph.includes('換行')));
      });

      if (!targetInput) {
        const fileInp = document.querySelector('input[type="file"]');
        if (fileInp) {
          let p = fileInp.parentElement;
          for (let d = 0; d < 8 && p; d++) {
            const ta = p.querySelector('textarea, [contenteditable="true"]');
            if (ta && !isExcluded(ta)) { targetInput = ta; break; }
            p = p.parentElement;
          }
        }
      }

      if (!targetInput) {
        targetInput = allInputs.find(el => el.tagName === 'TEXTAREA' && el.getBoundingClientRect().width > 120);
      }

      if (targetInput) {
        targetInput.focus();
        try { targetInput.composing = false; } catch(_) {}

        const proto = Object.getPrototypeOf(targetInput);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                       Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ||
                       Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          setter.call(targetInput, textToInsert);
        } else {
          targetInput.value = textToInsert;
        }

        targetInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // 綁定至 Vue 組件樹
        let cur = targetInput;
        for (let d = 0; d < 6 && cur; d++) {
          if (cur.__vue__) {
            const vm = cur.__vue__;
            ['text', 'value', 'message', 'inputText', 'chatMessage'].forEach(k => {
              if (k in vm) vm[k] = textToInsert;
            });
            if (typeof vm.$emit === 'function') {
              vm.$emit('input', textToInsert);
              vm.$emit('change', textToInsert);
            }
          }
          cur = cur.parentElement;
        }

        ${autoSend ? `
          setTimeout(() => {
            const allBtns = Array.from(document.querySelectorAll('button, [role="button"], a, div[class*="btn"]')).filter(b => {
              if (isExcluded(b)) return false;
              const t = (b.innerText || b.textContent || '').trim();
              return t.includes('傳送') || t.includes('Send');
            });
            if (allBtns.length > 0) {
              allBtns.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
              const btn = allBtns[0].querySelector('button, [role="button"]') || allBtns[0];
              btn.disabled = false;
              btn.classList.remove('disabled');
              btn.click();
            }
          }, 150);
        ` : ''}
      }
    `);

    // 3. 尋找 LINE 對話框 (Content Script 端同步雙保險)
    const chatInput = findLineChatInput();
    if (!chatInput) {
      return { success: false, message: '📋 已複製訊息至剪貼簿！可在 LINE 對話框按 Ctrl+V 貼上' };
    }

    try {
      try { chatInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
      chatInput.focus();
      try { chatInput.click(); } catch (_) {}
      try { chatInput.composing = false; } catch (_) {}

      let pasted = false;

      // 手法 A (最穩定原生貼上)：利用 Chrome 擴充功能 clipboardRead 權限執行原生 paste
      try {
        chatInput.focus();
        if (typeof chatInput.select === 'function') chatInput.select();
        pasted = document.execCommand('paste');
        if (pasted && chatInput.value && chatInput.value.length > 0) {
          pasted = true;
        }
      } catch (ePaste) {
        console.warn('document.execCommand paste fallback:', ePaste);
      }

      // 手法 B：使用 document.execCommand('insertText', false, text)
      if (!pasted || !chatInput.value || !chatInput.value.includes(text.slice(0, 5))) {
        try {
          chatInput.focus();
          document.execCommand('selectAll', false, null);
          const insertOk = document.execCommand('insertText', false, text);
          if (insertOk && chatInput.value && chatInput.value.includes(text.slice(0, 5))) {
            pasted = true;
          }
        } catch (_) {}
      }

      // 手法 C：透過 DataTransfer 發送合成 ClipboardEvent('paste')
      if (!pasted || !chatInput.value || !chatInput.value.includes(text.slice(0, 5))) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          const pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData: dt
          });
          chatInput.dispatchEvent(pasteEvt);
          if (chatInput.parentElement) {
            chatInput.parentElement.dispatchEvent(pasteEvt);
          }
          document.dispatchEvent(pasteEvt);
        } catch (_) {}
      }

      // 手法 D：原生 prototype setter 強制賦值
      if (!chatInput.value || !chatInput.value.includes(text.slice(0, 5))) {
        try {
          const proto = Object.getPrototypeOf(chatInput);
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                               Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                               Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(chatInput, text);
          } else {
            chatInput.value = text;
          }
          chatInput._value = text;
          chatInput.defaultValue = text;
        } catch (_) {}
      }

      // contenteditable 支援
      if (chatInput.isContentEditable) {
        try {
          chatInput.innerText = text;
          chatInput.innerHTML = text.replace(/\n/g, '<br>');
        } catch (_) {}
      }

      // 觸發全套 Vue.js / DOM 反應式事件通知
      try {
        chatInput.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, cancelable: true, data: text }));
      } catch (_) {}

      try {
        chatInput.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertFromPaste',
          data: text
        }));
      } catch (_) {}

      try {
        chatInput.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertFromPaste',
          data: text
        }));
      } catch (_) {}

      chatInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      chatInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      // 4. 將游標置於輸入框文字結尾
      try {
        chatInput.focus();
        if (typeof chatInput.setSelectionRange === 'function' && chatInput.value) {
          chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        }
      } catch (_) {}

      // 5. 若啟用 autoSend 且對話框確實有文字：嘗試觸發發送
      let sent = false;
      const hasContent = (chatInput.value && chatInput.value.length > 0) ||
                         (chatInput.textContent && chatInput.textContent.trim().length > 0);

      if (autoSend && hasContent) {
        // 短暫等待 200ms 讓 Vue.js 狀態響應完成
        await new Promise(r => setTimeout(r, 200));

        // 發送 Command+Enter / Ctrl+Enter 快捷鍵 (截圖特徵提示：Command + Enter : 傳送)
        chatInput.focus();
        const isMac = (navigator.platform || '').toUpperCase().includes('MAC');
        const keyConfigs = [
          { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, metaKey: isMac, ctrlKey: !isMac, bubbles: true, cancelable: true },
          { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, metaKey: true, bubbles: true, cancelable: true },
          { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, bubbles: true, cancelable: true }
        ];
        for (const cfg of keyConfigs) {
          try {
            chatInput.dispatchEvent(new KeyboardEvent('keydown', cfg));
            chatInput.dispatchEvent(new KeyboardEvent('keypress', cfg));
            chatInput.dispatchEvent(new KeyboardEvent('keyup', cfg));
          } catch (_) {}
        }

        // 尋找「傳送」按鈕並點擊
        const sendBtn = findLineSendButton();
        if (sendBtn) {
          try {
            sendBtn.disabled = false;
            sendBtn.classList.remove('disabled');
            sendBtn.click();
            sent = true;
          } catch (clickErr) {
            console.warn('sendBtn click failed:', clickErr);
          }
        }

        // 防呆防清空保護：若對話框文字被意外清空且未成功送出，立即還原文字保證對話框有內容
        await new Promise(r => setTimeout(r, 100));
        if (!chatInput.value) {
          chatInput.focus();
          try {
            document.execCommand('insertText', false, text);
          } catch (_) {
            chatInput.value = text;
            chatInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
        }
      }

      chatInput.focus();
      return {
        success: true,
        sent: sent,
        message: sent ? '🚀 已直接貼入對話框並送出！' : '✨ 已直接貼入對話框！(亦已複製至剪貼簿)'
      };
    } catch (err) {
      console.warn('pasteTextToLineChatInput error:', err);
      return { success: false, message: '📋 已複製訊息至剪貼簿！可在 LINE 對話框按 Ctrl+V 貼上' };
    }
  }

  // 記錄最後一次成功同步的訂單 Key，杜絕連點或重複點擊小卡重複寫入試算表
  let lastSyncedOrderKey = null;

  // 將小卡畫布直接貼入 LINE 對話框輔助函式
  async function pasteCanvasToLineChat(canvas, filename) {
    const chatInput = findLineChatInput();
    let pastedIntoChat = false;
    try {
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (blob) {
        const file = new File([blob], filename, { type: 'image/png', lastModified: Date.now() });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        if (chatInput) {
          chatInput.focus();

          // 手法 A: 使用 document.execCommand('paste') (搭配 manifest 的 clipboardRead 權限原生貼上)
          try {
            if (document.execCommand('paste')) {
              pastedIntoChat = true;
            }
          } catch (_) {}

          // 手法 B: 發送合成 ClipboardEvent('paste')
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData: dataTransfer
          });
          chatInput.dispatchEvent(pasteEvent);
          if (chatInput.parentElement) {
            chatInput.parentElement.dispatchEvent(pasteEvent);
          }
          document.dispatchEvent(pasteEvent);
          pastedIntoChat = true;

          // 手法 C: 拖放模擬 DragEvent('drop')
          try {
            const dropEvent = new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: dataTransfer
            });
            chatInput.dispatchEvent(dropEvent);
          } catch (_) {}
        }

        // 手法 D: 注入到頁面上的圖片上傳 file input
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'))
          .filter(el => !el.closest('#wuyi-helper-root, #wuyi-order-helper-root'));
        if (fileInputs.length > 0) {
          fileInputs.forEach(fi => {
            try {
              fi.files = dataTransfer.files;
              fi.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              fi.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              pastedIntoChat = true;
            } catch (_) {}
          });
        }
      }
    } catch (pasteErr) {
      console.warn('Direct paste to chatInput failed:', pasteErr);
    }
    return pastedIntoChat;
  }

  // 一鍵產生「預約取貨確認小卡」圖檔並直接貼入 LINE 對話框 (同時同步至 Google 試算表「⏳待複查」與 Google Drive)
  if (btnCopyCard) {
    btnCopyCard.addEventListener('click', copyCardImageAndPaste);
  }
  async function copyCardImageAndPaste() {
    try {
      const rawCustName = (state.orderState.customer.name || '').trim();
      const rawLineName = (state.orderState.customer.lineName || '').trim();
      const hasRescheduleKeyword = /改期/.test(rawCustName) || /改期/.test(rawLineName);

      let isReschedule = false;
      let oldDateTagToDelete = '';
      let rescheduleDecision = null;
      const cleanCustomerName = rawCustName.replace(/[\s(（]*改期[)）]*/g, '').trim() || '客戶';
      const cleanLineName = rawLineName.replace(/[\s(（]*改期[)）]*/g, '').trim() || cleanCustomerName;

      const dateTag = (inputDateTag ? inputDateTag.value.trim() : '') || state.orderState.pickup.dateTag || (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
      const pickupTime = state.orderState.pickup.time || '';
      const settings = await getSettings();
      const webhookUrl = settings.googleSheetsWebhookUrl;

      // 若顧客名稱含有「改期」，跳出視窗詢問是否改期與刪除舊單
      if (hasRescheduleKeyword) {
        rescheduleDecision = await promptRescheduleModal({
          rawCustName,
          rawLineName,
          cleanCustomerName,
          cleanLineName,
          newDateTag: dateTag,
          customerPhone: state.orderState.customer.phone || '',
          webhookUrl
        });

        if (rescheduleDecision.canceled) {
          showToast('已取消操作');
          return;
        }

        if (rescheduleDecision.isReschedule) {
          isReschedule = true;
          oldDateTagToDelete = rescheduleDecision.oldDateTagToDelete || '';
          const isManualDelete = Boolean(rescheduleDecision.manualDelete);
          state.orderState.customer.name = cleanCustomerName;
          state.orderState.customer.lineName = cleanLineName;

          if (!isManualDelete && oldDateTagToDelete && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && webhookUrl) {
            showToast(`🗑️ 正在刪除舊訂單【${oldDateTagToDelete} ${cleanCustomerName}】...`);
            try {
              await Promise.race([
                new Promise(resDel => {
                  chrome.runtime.sendMessage({
                    action: 'callGoogleWebhook',
                    url: webhookUrl,
                    payload: {
                      action: 'deleteOldOrder',
                      oldDateTag: oldDateTagToDelete,
                      customerName: cleanCustomerName,
                      lineName: cleanLineName,
                      customerPhone: state.orderState.customer.phone || ''
                    }
                  }, resDel);
                }),
                new Promise(r => setTimeout(r, 6000))
              ]);
            } catch (delErr) {
              console.warn('Delete old order error:', delErr);
            }
          }
        }
      }

      showToast('🎨 正在生成取貨確認單並貼入對話框...');
      if (!Renderer || typeof Renderer.renderCard !== 'function') {
        throw new Error('小卡渲染引擎尚未就緒');
      }
      const safeImgs = getSafeImages();
      const allItems = getAllOrderItems();
      const canvas = await Renderer.renderCard(state.orderState, {
        items: allItems,
        flowerText: getFlowerOrderText(),
        cakeText: getCakeOrderText(),
        flowerImages: safeImgs.flower,
        cakeImages: safeImgs.cake,
        addonImages: safeImgs.addon,
        addonImage: safeImgs.primaryAddon
      });

      const lineName = (state.orderState.customer.lineName || state.orderState.customer.name || '客戶').trim().replace(/[\/\\:*?"<>|]/g, '_');
      const filename = buildCardFilename(dateTag, pickupTime, lineName);

      // 1. 寫入系統剪貼簿 (讓使用者隨時可手動 Ctrl+V 貼上)
      let copiedToClipboard = false;
      const currentWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
      try {
        await Renderer.copyCardToClipboard(canvas, currentWin);
        copiedToClipboard = true;
      } catch (clipErr) {
        console.warn('System clipboard write failed:', clipErr);
      }

      // 2. 多層次觸發圖片貼入對話框給客人確認
      const pastedIntoChat = await pasteCanvasToLineChat(canvas, filename);
      state.isModifiedSinceLoad = false;
      state.currentReviewStatus = '⏳ 待複查';

      // 【防空白單】若尚未填寫取貨日期，只將小卡貼入 LINE 給客人預覽，暫不寫入試算表與雲端以免產生殘缺廢單
      if (!dateTag && !(state.orderState.pickup && state.orderState.pickup.date)) {
        if (pastedIntoChat) {
          showToast('🖼️ 小卡已貼入對話框！因尚未填寫【取貨日期】，暫不寫入試算表以免產生空白單');
        } else if (copiedToClipboard) {
          showToast('✨ 小卡已複製！因尚未填寫【取貨日期】，暫不寫入試算表');
        }
        return;
      }

      if (pastedIntoChat) {
        showToast('🖼️ 取貨確認小卡已直接貼入對話框！(正在同步至試算表與雲端...)');
      } else if (copiedToClipboard) {
        showToast('✨ 取貨確認單已複製！可在對話框按 Ctrl+V 貼上 (正在同步至試算表...)');
      } else {
        Renderer.downloadCard(canvas, filename);
        showToast('💾 已為您下載確認單圖檔備份！');
      }

      // 【防漏刪】忘記打「改期」自動偵測：若名字沒寫「改期」，背景自動檢查該客人是否在其他日期已有預約
      if (!hasRescheduleKeyword && webhookUrl && cleanCustomerName && cleanCustomerName !== '客戶' && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const checkRes = await Promise.race([
            new Promise(r => {
              chrome.runtime.sendMessage({
                action: 'callGoogleWebhook',
                url: webhookUrl,
                payload: {
                  action: 'queryCustomerOldOrders',
                  customerName: cleanCustomerName,
                  lineName: cleanLineName,
                  customerPhone: state.orderState.customer.phone || ''
                }
              }, r);
            }),
            new Promise(r => setTimeout(() => r(null), 3500))
          ]);
          const existingOrders = (checkRes && checkRes.data && Array.isArray(checkRes.data.orders)) ? checkRes.data.orders : [];
          const otherDateOrders = existingOrders.filter(o => o.dateTag && o.dateTag !== dateTag);
          if (otherDateOrders.length > 0) {
            rescheduleDecision = await promptRescheduleModal({
              rawCustName,
              rawLineName,
              cleanCustomerName,
              cleanLineName,
              newDateTag: dateTag,
              customerPhone: state.orderState.customer.phone || '',
              webhookUrl,
              preloadedOrders: otherDateOrders,
              autoDetectedCrossDate: true
            });
            if (rescheduleDecision && rescheduleDecision.isReschedule) {
              isReschedule = true;
              oldDateTagToDelete = rescheduleDecision.oldDateTagToDelete || '';
              const isManualDelete = Boolean(rescheduleDecision.manualDelete);
              if (!isManualDelete && oldDateTagToDelete) {
                showToast(`🗑️ 正在刪除舊訂單【${oldDateTagToDelete} ${cleanCustomerName}】...`);
                try {
                  await Promise.race([
                    new Promise(resDel => {
                      chrome.runtime.sendMessage({
                        action: 'callGoogleWebhook',
                        url: webhookUrl,
                        payload: {
                          action: 'deleteOldOrder',
                          oldDateTag: oldDateTagToDelete,
                          customerName: cleanCustomerName,
                          lineName: cleanLineName,
                          customerPhone: state.orderState.customer.phone || ''
                        }
                      }, resDel);
                    }),
                    new Promise(r => setTimeout(r, 6000))
                  ]);
                } catch (_) {}
              }
            }
          }
        } catch (autoCheckErr) {
          console.warn('Auto cross-date reschedule check warning:', autoCheckErr);
        }
      }

      // 3. 背景自動同步至 Google 試算表與上傳雲端小卡至 Google Drive
      const uploadCacheKey = `wuyi_uploaded_${filename}`;
      const storedCache = await new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([uploadCacheKey], r);
        } else {
          r({});
        }
      });
      const clientAlreadyUploaded = Boolean(storedCache && storedCache[uploadCacheKey]);

      const syncPromise = autoSyncToGoogleSheets(true, oldDateTagToDelete, '⏳ 待複查');

      if (!webhookUrl) {
        await syncPromise;
        showToast('⚠️ 請至「設定」填寫 Apps Script 網址以啟用 Google Drive 上傳與試算表同步！');
        return;
      }

      // 【防洗圖】檢查小幫手目前是否有放任何截圖；若無截圖，通知雲端保留原有的含圖小卡不覆蓋！
      const hasAnyUploadedImages = allItems.some(it => (it.images && it.images.length > 0) || (it.addonImages && it.addonImages.length > 0)) ||
                                   safeImgs.flower.length > 0 || safeImgs.cake.length > 0 || safeImgs.addon.length > 0;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const dataUrl = canvas.toDataURL('image/png');
        chrome.runtime.sendMessage({
          action: 'uploadToGoogleDrive',
          url: webhookUrl,
          payload: {
            action: 'uploadCardToDrive',
            folderId: '1aFAvK33ML41x0JgHlCF6WcA6006Emq4J',
            filename: filename,
            pickupDate: state.orderState.pickup.date || dateTag,
            dateTag: dateTag,
            deleteOldDateTag: (isReschedule && !(rescheduleDecision && rescheduleDecision.manualDelete)) ? oldDateTagToDelete : null,
            oldDateTag: (isReschedule && !(rescheduleDecision && rescheduleDecision.manualDelete)) ? oldDateTagToDelete : null,
            lineName: lineName,
            preserveExistingIfNoPhoto: !hasAnyUploadedImages,
            base64Image: dataUrl
          }
        }, async (res) => {
          await syncPromise;
          if (res && res.success && res.data && res.data.fileId) {
            const isDuplicate = Boolean(res.data.isDuplicate) || clientAlreadyUploaded;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ [uploadCacheKey]: Date.now() });
            }
            if (isReschedule && oldDateTagToDelete) {
              const successMsg = `改期成功 『${oldDateTagToDelete} ${cleanCustomerName}』改成『${dateTag} ${cleanCustomerName}』`;
              showToast(`🎉 ${successMsg}`);
              const extraNote = (rescheduleDecision && rescheduleDecision.manualDelete)
                ? `\n\n📌 舊訂單（${oldDateTagToDelete}）已為您保留，可依需求至試算表或雲端資料夾手動刪除/劃掉。`
                : `\n\n💡 若雲端舊單未完全自動清除，可至 Google 試算表或雲端資料夾手動確認。`;
              alert(successMsg + extraNote);
            } else if (res.data.preservedExistingImage) {
              showToast('🖼️ 小卡已貼入對話框！已同步至試算表，並自動保留雲端原有的含圖小卡(防洗圖保護)');
            } else if (isDuplicate) {
              showToast(`⚠️ 雲端已有同名小卡【${filename}】！已覆蓋更新並同步至試算表`);
            } else {
              showToast('🖼️ 小卡已貼入對話框！並已同步至 Google 試算表與 Google Drive 雲端');
            }
          } else {
            if (isReschedule && oldDateTagToDelete) {
              const successMsg = `改期成功 『${oldDateTagToDelete} ${cleanCustomerName}』改成『${dateTag} ${cleanCustomerName}』`;
              showToast(`🎉 ${successMsg} (新小卡已複製)`);
              alert(successMsg + '\n\n💡 新取貨小卡已複製至剪貼簿，試算表亦已同步！若雲端圖檔未完全上傳，可隨時手動確認或上傳。');
            } else {
              const errMsg = (res && res.error) ? res.error : '雲端上傳異常';
              showToast(`⚠️ 試算表已同步，但雲端圖檔回報：${errMsg}`);
            }
          }
        });
      } else {
        await syncPromise;
        if (isReschedule && oldDateTagToDelete) {
          const successMsg = `改期成功 『${oldDateTagToDelete} ${cleanCustomerName}』改成『${dateTag} ${cleanCustomerName}』`;
          showToast(`🎉 ${successMsg}`);
          alert(successMsg);
        }
      }
    } catch (err) {
      console.error(err);
      showToast('❌ 處理失敗：' + err.message);
    }
  }

  // 記錄最近一次成功上傳至 Google Drive 的資訊，供行事曆欄位選擇視窗使用
  let currentDriveUpload = null;

  function formatGCalDates(rawDate, rawTime) {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    let d = now.getDate();

    const mFull = String(rawDate || '').match(/(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
    const m4 = String(rawDate || '').match(/^(\d{2})(\d{2})$/);
    const mMD = String(rawDate || '').match(/(\d{1,2})[-\/\.](\d{1,2})/);

    if (mFull) {
      y = parseInt(mFull[1], 10);
      m = parseInt(mFull[2], 10);
      d = parseInt(mFull[3], 10);
    } else if (m4) {
      m = parseInt(m4[1], 10);
      d = parseInt(m4[2], 10);
    } else if (mMD) {
      m = parseInt(mMD[1], 10);
      d = parseInt(mMD[2], 10);
    }

    const yStr = String(y);
    const mStr = String(m).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');

    const timeMatch = String(rawTime || '').match(/(\d{1,2})[:：](\d{2})/);
    if (timeMatch) {
      let hh = parseInt(timeMatch[1], 10);
      let mm = parseInt(timeMatch[2], 10);
      const startStr = yStr + mStr + dStr + 'T' + String(hh).padStart(2, '0') + String(mm).padStart(2, '0') + '00';
      let endHh = hh;
      let endMm = mm + 30;
      if (endMm >= 60) {
        endHh = (endHh + 1) % 24;
        endMm -= 60;
      }
      const endStr = yStr + mStr + dStr + 'T' + String(endHh).padStart(2, '0') + String(endMm).padStart(2, '0') + '00';
      return startStr + '/' + endStr;
    }

    return yStr + mStr + dStr + '/' + yStr + mStr + dStr;
  }

  async function copyHtmlAndText(htmlContent, plainContent) {
    const currentWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    if (currentWin && currentWin.focus) {
      try { currentWin.focus(); } catch (_) {}
    }

    let copied = false;
    const nav = (currentWin && currentWin.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    if (nav && nav.clipboard && nav.clipboard.write) {
      try {
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        const textBlob = new Blob([plainContent], { type: 'text/plain' });
        await nav.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob
          })
        ]);
        copied = true;
      } catch (clipErr) {
        console.warn('ClipboardItem write failed:', clipErr);
      }
    }

    if (!copied) {
      try {
        const onCopy = (e) => {
          e.clipboardData.setData('text/html', htmlContent);
          e.clipboardData.setData('text/plain', plainContent);
          e.preventDefault();
        };
        document.addEventListener('copy', onCopy, { once: true });
        if (document.execCommand('copy')) {
          copied = true;
        }
      } catch (_) {}
    }

    if (!copied) {
      await copyTextToClipboard(plainContent);
    }
    return copied;
  }

  // 輔助函式：改期確認與舊單選擇彈窗 (支援「改期」關鍵字觸發，以及【防漏刪】自動偵測跨日既有預約觸發)
  async function promptRescheduleModal({ rawCustName, rawLineName, cleanCustomerName, cleanLineName, newDateTag, customerPhone, webhookUrl, preloadedOrders, autoDetectedCrossDate }) {
    return new Promise(async (resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'wuyi-reschedule-backdrop';

      const card = document.createElement('div');
      card.className = 'wuyi-reschedule-card';

      function cleanup() {
        if (overlay && overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
        }
      }

      // Step 1: 詢問是否改期
      function renderStep1() {
        const oldDatesStr = Array.isArray(preloadedOrders) && preloadedOrders.length > 0
          ? preloadedOrders.map(o => o.dateTag).filter(Boolean).join('、')
          : '';
        const promptHeading = autoDetectedCrossDate
          ? `🔔 <strong>防呆偵測（忘記打改期提醒）</strong>：<br>發現此客人在其他日期【<strong>${oldDatesStr}</strong>】已有預約紀錄！請問此筆是客人<strong>改期</strong>，還是<strong>新增第二筆不同日訂單</strong>？`
          : `偵測到顧客名稱含有<strong>【改期】</strong>二字！<br>請問此筆訂單是否為客人<strong>改期</strong>？`;

        card.innerHTML = `
          <div class="wuyi-reschedule-header">
            <div class="wuyi-reschedule-title">📅 訂單改期確認</div>
            <button class="wuyi-reschedule-close" id="btnRescheduleClose">✕</button>
          </div>
          <div class="wuyi-reschedule-body">
            <div class="wuyi-reschedule-msg">
              ${promptHeading}
            </div>
            <div style="font-size: 13px; color: #64748b; background: #f8fafc; padding: 10px 12px; border-radius: 8px; border: 1px dashed #cbd5e1;">
              👤 顧客名稱：<strong>${cleanCustomerName}</strong><br>
              📅 新取貨日期：<strong>${newDateTag || '未填寫'}</strong>
            </div>
            <div class="wuyi-reschedule-footer">
              <button class="wuyi-btn-reschedule secondary" id="btnRescheduleCancel">取消</button>
              <button class="wuyi-btn-reschedule normal" id="btnRescheduleNormal">否，正常傳送(第2筆)</button>
              <button class="wuyi-btn-reschedule primary" id="btnRescheduleConfirm">是，這是改期</button>
            </div>
          </div>
        `;

        card.querySelector('#btnRescheduleClose').onclick = () => { cleanup(); resolve({ canceled: true }); };
        card.querySelector('#btnRescheduleCancel').onclick = () => { cleanup(); resolve({ canceled: true }); };
        card.querySelector('#btnRescheduleNormal').onclick = () => { cleanup(); resolve({ isReschedule: false }); };
        card.querySelector('#btnRescheduleConfirm').onclick = () => {
          if (Array.isArray(preloadedOrders) && preloadedOrders.length > 0) {
            renderStep3Select(preloadedOrders);
          } else {
            renderStep2Query();
          }
        };
      }

      // Step 2: 查詢此客人舊預訂資訊並詢問是否刪除
      async function renderStep2Query() {
        card.innerHTML = `
          <div class="wuyi-reschedule-header">
            <div class="wuyi-reschedule-title">🔍 查詢舊預約紀錄</div>
            <button class="wuyi-reschedule-close" id="btnRescheduleClose">✕</button>
          </div>
          <div class="wuyi-reschedule-body">
            <div class="wuyi-reschedule-msg" style="text-align: center; padding: 20px 0; color: #64748b;">
              <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
              正在查詢客人【${cleanCustomerName}】的歷史預約資訊...
            </div>
          </div>
        `;
        card.querySelector('#btnRescheduleClose').onclick = () => { cleanup(); resolve({ canceled: true }); };

        let orders = [];
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && webhookUrl) {
            const res = await new Promise(r => {
              chrome.runtime.sendMessage({
                action: 'callGoogleWebhook',
                url: webhookUrl,
                payload: {
                  action: 'queryCustomerOldOrders',
                  customerName: cleanCustomerName,
                  lineName: cleanLineName,
                  customerPhone: customerPhone
                }
              }, r);
            });
            if (res && res.data && Array.isArray(res.data.orders)) {
              orders = res.data.orders;
            }
          }
        } catch (e) {
          console.warn('Query old orders error:', e);
        }

        renderStep3Select(orders);
      }

      // Step 3: 列出可刪除的舊日期並確認刪除
      function renderStep3Select(orders) {
        const candidateOrders = Array.isArray(orders) ? orders : [];
        let listHtml = '';
        let defaultOldTag = candidateOrders.length > 0 ? candidateOrders[0].dateTag : '';

        if (candidateOrders.length > 0) {
          listHtml = `
            <div class="wuyi-reschedule-msg">
              ${candidateOrders.length > 1 ? `此客人預定多次，請選擇欲<strong>刪除改期</strong>的舊取貨日期：` : `找到此客人舊的預約紀錄，確認是否刪除舊的 Google Drive 圖片與 Google 試算表檔案？`}
            </div>
            <div class="wuyi-reschedule-order-list">
              ${candidateOrders.map((o, idx) => `
                <div class="wuyi-reschedule-order-item ${idx === 0 ? 'selected' : ''}" data-tag="${o.dateTag}">
                  <span class="wuyi-reschedule-order-badge">📅 ${o.dateTag}</span>
                  <div class="wuyi-reschedule-order-desc">
                    <strong>${o.date} ${o.time ? '(' + o.time + ')' : ''}</strong><br>
                    <span>${o.summary || '訂單內容'}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `;
        } else {
          listHtml = `
            <div class="wuyi-reschedule-msg">
              在試算表未找到舊預約紀錄。<br>
              請確認或輸入客人原本的舊取貨日期 (4碼代碼，例如 <strong>1102</strong>) 以便刪除雲端小卡：
            </div>
            <input type="text" class="wuyi-reschedule-input" id="inputManualOldTag" placeholder="例：1102" maxlength="8" value="">
          `;
        }

        card.innerHTML = `
          <div class="wuyi-reschedule-header">
            <div class="wuyi-reschedule-title">🗑️ 確認刪除舊單並改期</div>
            <button class="wuyi-reschedule-close" id="btnRescheduleClose">✕</button>
          </div>
          <div class="wuyi-reschedule-body">
            ${listHtml}
            <div class="wuyi-reschedule-footer" style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px;">
              <button class="wuyi-btn-reschedule secondary" id="btnRescheduleCancel">取消</button>
              <button class="wuyi-btn-reschedule manual" id="btnRescheduleManual" title="不執行自動雲端刪除，直接改期建立新單（杜絕任何權限或逾時報錯，可隨後手動刪除）">📝 保留/手動刪除舊單並改期</button>
              <button class="wuyi-btn-reschedule primary" id="btnRescheduleDoDelete" title="自動嘗試刪除舊小卡與試算表列，並建立新改期單">🗑️ 自動刪除舊單並改期</button>
            </div>
            <div style="margin-top: 10px; padding: 8px 10px; background: #f8fafc; border-radius: 8px; font-size: 11px; color: #64748b; line-height: 1.5; border: 1px dashed #cbd5e1; text-align: left;">
              💡 <strong>其他方式（手動刪除）：</strong> 若雲端出現權限或逾時錯誤，推薦點擊「<strong>📝 保留/手動刪除舊單並改期</strong>」先順暢產出新單，再直接手動維護：
              <div style="margin-top: 5px; display: flex; gap: 8px;">
                <a href="https://docs.google.com/spreadsheets/d/1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU/edit" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; font-weight: 600;">📊 開啟 Google 試算表手動刪除</a>
                <span>•</span>
                <a href="https://drive.google.com/drive/folders/1aFAvK33ML41x0JgHlCF6WcA6006Emq4J" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; font-weight: 600;">📁 開啟雲端小卡資料夾</a>
              </div>
            </div>
          </div>
        `;

        let selectedTag = defaultOldTag;

        const items = card.querySelectorAll('.wuyi-reschedule-order-item');
        items.forEach(it => {
          it.onclick = () => {
            items.forEach(i => i.classList.remove('selected'));
            it.classList.add('selected');
            selectedTag = it.getAttribute('data-tag');
          };
        });

        const manualInput = card.querySelector('#inputManualOldTag');
        if (manualInput) {
          manualInput.oninput = () => { selectedTag = manualInput.value.trim(); };
        }

        card.querySelector('#btnRescheduleClose').onclick = () => { cleanup(); resolve({ canceled: true }); };
        card.querySelector('#btnRescheduleCancel').onclick = () => { cleanup(); resolve({ canceled: true }); };

        const btnManual = card.querySelector('#btnRescheduleManual');
        if (btnManual) {
          btnManual.onclick = () => {
            if (manualInput && !selectedTag) {
              selectedTag = manualInput.value.trim();
            }
            if (!selectedTag && candidateOrders.length > 0) {
              selectedTag = candidateOrders[0].dateTag;
            }
            cleanup();
            resolve({
              isReschedule: true,
              oldDateTagToDelete: selectedTag || '',
              manualDelete: true
            });
          };
        }

        card.querySelector('#btnRescheduleDoDelete').onclick = () => {
          if (manualInput && !selectedTag) {
            selectedTag = manualInput.value.trim();
          }
          if (!selectedTag && candidateOrders.length > 0) {
            selectedTag = candidateOrders[0].dateTag;
          }
          cleanup();
          resolve({
            isReschedule: true,
            oldDateTagToDelete: selectedTag || ''
          });
        };
      }

      overlay.appendChild(card);
      document.body.appendChild(overlay);
      renderStep1();
    });
  }

  // 【防漏做】多花單/多蛋糕試算表摘要自動合併輔助函式 (例：1️⃣4吋 / 2️⃣6吋)
  function summarizeMultiItemsForSheets(allItems, baseOrderState) {
    const fItems = (allItems || []).filter(it => it.type === 'flower' && it.text && it.text !== '無');
    const cItems = (allItems || []).filter(it => it.type === 'cake' && it.text && it.text !== '無');

    let orderType = baseOrderState.orderType;
    if (cItems.length > 1 || fItems.length > 1) {
      const parts = [];
      if (cItems.length > 0) parts.push(cItems.length > 1 ? `蛋糕x${cItems.length}` : '蛋糕');
      if (fItems.length > 0) parts.push(fItems.length > 1 ? `花束x${fItems.length}` : '花束');
      orderType = parts.join('+');
    }

    let cakeSize = baseOrderState.cake.size || '';
    let cakeFlavor = baseOrderState.cake.flavor || '';
    let cakeInscription = baseOrderState.cake.inscription || '';

    if (cItems.length > 1 && Ext && typeof Ext.parseOrderText === 'function') {
      const sizes = [];
      const flavors = [];
      const inscriptions = [];
      cItems.forEach((it, idx) => {
        const num = NUM_EMOJIS[idx] || `${idx + 1}️⃣`;
        const parsed = Ext.parseOrderText(it.text);
        const sz = (parsed && parsed.cake && parsed.cake.size) || '';
        const fl = (parsed && parsed.cake && parsed.cake.flavor) || '';
        const ins = (parsed && parsed.cake && parsed.cake.inscription) || '';
        if (sz) sizes.push(`${num}${sz}`);
        if (fl) flavors.push(`${num}${fl}`);
        if (ins) inscriptions.push(`${num}${ins}`);
      });
      if (sizes.length > 0) cakeSize = sizes.join(' / ');
      if (flavors.length > 0) cakeFlavor = flavors.join(' / ');
      if (inscriptions.length > 0) cakeInscription = inscriptions.join(' / ');
    }

    let flowerBudget = baseOrderState.flower.budget || '';
    let flowerColor = baseOrderState.flower.color || '';

    if (fItems.length > 1 && Ext && typeof Ext.parseOrderText === 'function') {
      const budgets = [];
      const colors = [];
      fItems.forEach((it, idx) => {
        const num = NUM_EMOJIS[idx] || `${idx + 1}️⃣`;
        const parsed = Ext.parseOrderText(it.text);
        const bg = (parsed && parsed.flower && parsed.flower.budget) || '';
        const cl = (parsed && parsed.flower && parsed.flower.color) || '';
        if (bg) budgets.push(`${num}${bg}`);
        if (cl) colors.push(`${num}${cl}`);
      });
      if (budgets.length > 0) flowerBudget = budgets.join(' / ');
      if (colors.length > 0) flowerColor = colors.join(' / ');
    }

    return {
      orderType,
      cakeSize,
      cakeFlavor,
      cakeInscription,
      flowerBudget,
      flowerColor
    };
  }

  // 自動同步至 Google 試算表 (雙重防重複：前端特徵比對 + 後端覆寫，完整填入 20+1 項標準稽核與複查狀態欄位)
  async function autoSyncToGoogleSheets(forceSync = false, deleteOldDateTag = null, reviewStatus = null) {
    try {
      const settings = await getSettings();
      if (!settings.googleSheetsWebhookUrl) {
        return { skipped: true, reason: 'no_webhook' };
      }

      const finalReviewStatus = reviewStatus || state.currentReviewStatus || '⏳ 待複查';
      const dateTagVal = (inputDateTag ? inputDateTag.value.trim() : '') || state.orderState.pickup.dateTag || (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');

      // 【防空白單】若尚未填寫取貨日期，自動略過同步，防止試算表產生無日期的空白廢單
      if (!dateTagVal) {
        return { skipped: true, reason: 'missing_pickup_date' };
      }

      // 計算目前訂單的特徵 Key
      const currentOrderKey = [
        state.orderState.pickup.date || '',
        state.orderState.customer.name || '',
        state.orderState.customer.phone || '',
        state.orderState.customer.lineName || '',
        state.pricingState.total || '0',
        finalReviewStatus
      ].join('__');

      // 若非強制同步且剛剛才同步過相同訂單，跳過重複發送
      if (!forceSync && lastSyncedOrderKey === currentOrderKey) {
        return { skipped: true, reason: 'already_synced' };
      }

      const pParsed = txtPricing && txtPricing.value ? Ext.parsePricingText(txtPricing.value) : state.pricingState;

      // 多層次訂單總額 (finalTotal) 強健擷取：確保金額絕不漏傳
      let finalTotal = (pParsed && pParsed.total) || (state.pricingState && state.pricingState.total) || 0;
      if (!finalTotal && pParsed && Array.isArray(pParsed.items) && pParsed.items.length > 0) {
        finalTotal = pParsed.items.reduce((s, it) => s + (Number(it.price) || 0), 0);
      }
      if (!finalTotal && txtPricing && txtPricing.value) {
        const mTot = txtPricing.value.match(/(?:總共|合計|總計|金額|尾款|費用|結帳|訂單總額)[\s:：\$]*([0-9,]+)/i);
        if (mTot) finalTotal = parseInt(mTot[1].replace(/,/g, ''), 10);
        else {
          const mDol = txtPricing.value.match(/(?:NT\$?|\$)\s*([0-9,]+)/i);
          if (mDol) finalTotal = parseInt(mDol[1].replace(/,/g, ''), 10);
          else {
            const mPure = txtPricing.value.trim().match(/^([0-9,]+)(?:\s*元)?$/);
            if (mPure) finalTotal = parseInt(mPure[1].replace(/,/g, ''), 10);
          }
        }
      }
      if (!finalTotal && state.orderState.flower && state.orderState.flower.budget) {
        const b = parseInt(String(state.orderState.flower.budget).replace(/[^\d]/g, ''), 10);
        if (b > 0) finalTotal = b;
      }
      if (!finalTotal) {
        const allNotes = [getCakeOrderText(), getFlowerOrderText(), (txtPricing ? txtPricing.value : ''), state.orderState.rawText].filter(Boolean).join('\n');
        const mAll = allNotes.match(/(?:總共|合計|總計|金額|尾款|結帳|預算)[\s:：\$]*([0-9,]+)/i);
        if (mAll) finalTotal = parseInt(mAll[1].replace(/,/g, ''), 10);
      }

      const lineNameVal = (state.orderState.customer.lineName || state.orderState.customer.name || '客戶').trim().replace(/[\/\\:*?"<>|]/g, '_');
      const pickupTimeVal = state.orderState.pickup.time || '';
      const filenameVal = buildCardFilename(dateTagVal, pickupTimeVal, lineNameVal);
      const multiSummary = summarizeMultiItemsForSheets(getAllOrderItems(), state.orderState);

      const payload = {
        pickupDate: dateTagVal || state.orderState.pickup.date,
        dateTag: dateTagVal,
        deleteOldDateTag: deleteOldDateTag || null,
        oldDateTag: deleteOldDateTag || null,
        pickupTime: state.orderState.pickup.time,
        location: state.orderState.pickup.location,
        customerName: state.orderState.customer.name,
        customerPhone: state.orderState.customer.phone,
        lineName: state.orderState.customer.lineName,
        orderType: multiSummary.orderType,
        cakeSize: multiSummary.cakeSize,
        cakeFlavor: multiSummary.cakeFlavor,
        cakeInscription: multiSummary.cakeInscription,
        addon: state.orderState.cake.addon,
        flowerBudget: multiSummary.flowerBudget,
        flowerColor: multiSummary.flowerColor,
        flowerPaper: state.orderState.flower.paper,
        totalPrice: finalTotal,
        cakeText: getCakeOrderText(),
        flowerText: getFlowerOrderText(),
        pricingText: txtPricing ? txtPricing.value : '',
        filename: filenameVal,
        reviewStatus: finalReviewStatus,
        nikkiChecked: finalReviewStatus.includes('已複查'),
        rawText: state.orderState.rawText || [getCombinedOrderText(), (txtPricing ? txtPricing.value : '')].filter(Boolean).join('\n\n')
      };

      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'syncToGoogleSheets',
            url: settings.googleSheetsWebhookUrl,
            payload: payload
          }, (res) => {
            if (res && res.success) {
              lastSyncedOrderKey = currentOrderKey;
              resolve({ success: true });
            } else if (res && res.error) {
              resolve({ error: res.error });
            } else {
              lastSyncedOrderKey = currentOrderKey;
              resolve({ success: true });
            }
          });
        } else {
          lastSyncedOrderKey = currentOrderKey;
          resolve({ success: true });
        }
      });
    } catch (err) {
      console.warn('Auto sync error:', err);
      return { error: err.message };
    }
  }

  // 7. 🎂 蛋糕 與 💐 花束 快速發送/編輯確認訊息功能
  // 按 1 下：傳送確認訊息給客人；快速連按 3 下：編輯要輸入的自訂訊息
  const btnQuickMsgCake = root.querySelector('#btnQuickMsgCake');
  const btnQuickMsgFlower = root.querySelector('#btnQuickMsgFlower');

  const DEFAULT_QUICK_MSG = {
    cake: `您好 ，
這是您 取 貨 出 示 的 『 訂 單 』建議先 截圖保存喔

麻煩確認後 回覆我們以上訂單 『正確』 或是 『不正確 需修改』謝謝您～



⭐️當天完成後「無法重做」或是「修改樣式」喔！

⭐️若一開始沒有告知題字內容
   訂單溝通且完成後才告知要加字
（會視情況拒絕&額外收費喔）

⭐️訂單有「特殊要求」或「客製的細節部分」
   請確認訂單內容 是 否 標  註  正 確
   當天會按照這訂單內容去製作


🔺麻煩務必檢查🔺

您的 「任 何 客 製  要 求」溝通的最終版本
有完整且明確表達在訂單上面
若是有『題字』請再三檢查確認喔～

---

▪️
請確認自行加購的商品標示清楚
當天領取請跟我們當面核對點交是否拿齊全
比如購買蛋糕(餐具 造型蠟燭 生日插牌 保冰袋劑 等)
比如購買花束(提袋 襯紙等)

⚠️取貨需提供上方的「訂單截圖」
   以方便核對是否資訊正確才領取唷！

⚠️取貨日當天，請『當面跟我們點清』
   加購物品是不是有齊全再領走唷！

▪️蛋糕製作時段為當日上午，
     期間無法即時回覆訊息，敬請見諒

▪️動物鮮奶油蛋糕比較脆弱，
    建議「開車取蛋糕並放在平坦的腳踏上會更安全」
    或是「機車雙載由後座提拿」，
    若是由跑腿取貨建議選擇『汽車』方式喔！

▪️若是訂購人與取貨人不同，
    請事先告知，以免領取無法核對資訊，
    也務必將訂單截圖資訊發給取貨人跟我們核對

▪️自取當天請在您約定的時間前來取貨，
    當天嚴重大大遲到不取貨，我們則不等候，
    需請您找家人朋友or付費找跑腿取走蛋糕，
    打烊後門店不保留代保管冷藏蛋糕

🥵🫠動物鮮奶油蛋糕在室溫下10-15分鐘
        就會融化容易導致蛋糕倒塌、傾斜
        加上運輸更有移位等問題
        有保冰袋＋保冰劑可以維持30-40分鐘

🥵🫠務必務必取貨當天
        要將蛋糕放置在冰箱裡面
        才有「保冷的狀態下」才能有完美的蛋糕喔 
        蛋糕冷藏即可，並在1-3天內食用口感最佳。

📦
漢堡盒（包裝盒15*15*8cm）
4寸（包裝盒17*17*20cm）
6寸（包裝盒22*22*24cm）
8寸（包裝盒26*26*24cm）

感謝您🫶🏻`,
    flower: `您好，這是您的花束 💐🤍
以下是花束照護小提醒，請您參考～


🌷 鮮花照護

▫️ 鮮花較脆弱，請避免風吹、日曬及雨淋，
     取貨時請先確認花況再離開喔！

▫️ 建議開車取貨；若騎機車，
     請將花束放入提袋並放置於腳踏板，
     避免放入車廂或受到強風吹襲。

▫️ 鮮花平均觀賞期約 3～7 天，
     回家後可拆除包裝，放入乾淨花器中。

▫️ 每 1～2 天換水一次，
     並將花腳斜剪一小段，
     幫助花朵吸水。

▫️ 建議放置於涼爽的冷氣房，
     避免陽光直曬、高溫環境及冷氣出風口直吹。

▫️ 鮮花若因高溫或曝曬而失水、影響花況，
     屬於自然現象。

▫️ 花草皆有自然生長的痕跡，
    每朵花的姿態與狀態都不同，
    無法保證完美無瑕，謝謝您的理解 🤍



🌹 永生花照護

▫️ 請放置於乾燥陰涼處，
     避免陽光直曬及潮濕環境。

▫️ 妥善保存約可觀賞 1～3 年，
     隨時間褪色或風化皆屬自然現象。

▫️ 若花朵沾附灰塵，可使用小刷具輕刷，
     或以吹風機的弱風吹除。`
  };

  const OLD_DEFAULT_MSG = {
    cake: '您好！這是為您安排的蛋糕預約取貨確認單，請核對上方圖片中的品項、日期與訂購資訊是否無誤喔！取貨當天請向門市夥伴出示確認小卡即可，感謝您！🍰',
    flower: '您好！這是為您安排的花束預約確認單，請核對上方圖片中的花材色系、包裝與取貨時間是否正確喔！感謝您的訂購，祝您有美好的一天！💐'
  };

  function getQuickMsg(type, defaultText) {
    const storageKey = `wuyi_custom_msg_${type}`;
    const stored = localStorage.getItem(storageKey);
    if (!stored || stored === OLD_DEFAULT_MSG[type]) {
      return defaultText;
    }
    return stored;
  }

  function setupQuickMsgButton(btn, type, label, defaultText) {
    if (!btn) return;
    let clickCount = 0;
    let clickTimer = null;
    const storageKey = `wuyi_custom_msg_${type}`;

    const handleEdit = () => {
      clearTimeout(clickTimer);
      clickCount = 0;
      const currentMsg = getQuickMsg(type, defaultText);
      const newMsg = prompt(`請編輯按【${label}】後傳送給客人的確認訊息內容：`, currentMsg);
      if (newMsg !== null && newMsg.trim()) {
        localStorage.setItem(storageKey, newMsg.trim());
        showToast(`✅ 已儲存自訂【${label}】訊息！`);
      }
    };

    // 支援滑鼠右鍵直接編輯，100% 穩定必出
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleEdit();
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 原生三連擊或雙擊 (e.detail >= 3 或按住 Shift/Alt) 進入編輯模式
      if (e.detail >= 3 || e.shiftKey || e.altKey) {
        handleEdit();
        return;
      }

      // 按 1 下：複製確認訊息至剪貼簿 (回歸最穩定快速的剪貼簿複製模式)
      const currentMsg = getQuickMsg(type, defaultText);
      const activeWin = (panel && panel.ownerDocument && panel.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
      const copied = await copyTextToClipboard(currentMsg, activeWin);
      if (copied) {
        showToast(`📋 已複製【${label}】確認訊息！可在對話框按 Ctrl+V 貼上`);
      } else {
        showToast(`⚠️ 複製【${label}】訊息失敗，請手動複製`);
      }
    });
  }

  setupQuickMsgButton(btnQuickMsgCake, 'cake', '🎂 蛋糕', DEFAULT_QUICK_MSG.cake);
  setupQuickMsgButton(btnQuickMsgFlower, 'flower', '💐 花束', DEFAULT_QUICK_MSG.flower);

  // 輔助函式：文字寫入剪貼簿 (多視窗相容：支援獨立視窗、PiP 浮窗與主視窗)
  async function copyTextToClipboard(text, preferredWin) {
    if (!text && text !== '') return false;

    let win = preferredWin;
    if (!win && typeof document !== 'undefined') {
      if (document.activeElement && document.activeElement.ownerDocument && document.activeElement.ownerDocument.defaultView) {
        win = document.activeElement.ownerDocument.defaultView;
      } else if (panel && panel.ownerDocument && panel.ownerDocument.defaultView) {
        win = panel.ownerDocument.defaultView;
      }
    }
    if (!win && typeof window !== 'undefined') win = window;

    if (win && win.focus) {
      try { win.focus(); } catch (_) {}
    }

    // 1. 優先嘗試現代 Clipboard API
    const nav = (win && win.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      try {
        await nav.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('nav.clipboard.writeText 失敗，切換至 execCommand 回退機制:', err);
      }
    }

    // 2. 回退方案：建立離屏 textarea 執行 document.execCommand('copy')
    const doc = (win && win.document) || (typeof document !== 'undefined' ? document : null);
    if (doc && doc.body) {
      try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '2em';
        ta.style.height = '2em';
        ta.style.padding = '0';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.boxShadow = 'none';
        ta.style.background = 'transparent';
        ta.style.opacity = '0';
        ta.setAttribute('readonly', '');
        doc.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const successful = doc.execCommand('copy');
        doc.body.removeChild(ta);
        if (successful) return true;
      } catch (fallbackErr) {
        console.error('所有剪貼簿寫入方式皆失敗:', fallbackErr);
      }
    }

    return false;
  }

  // 快捷按鈕：開啟 Google 試算表只檢視指定固定日期的全部訂單
  const btnViewSheetDate = root.querySelector('#btnViewSheetDate');
  if (btnViewSheetDate) {
    btnViewSheetDate.addEventListener('click', async () => {
      const dateTagVal = (inputDateTag ? inputDateTag.value.trim() : '') || state.orderState.pickup.dateTag || (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
      if (!dateTagVal) {
        showToast('⚠️ 請先輸入或由訂單帶入「標籤日期」(例：1108)');
        return;
      }

      const settings = await getSettings();
      const webhookUrl = settings.googleSheetsWebhookUrl || DEFAULT_WEBHOOK_URL;
      const sheetUrl = 'https://docs.google.com/spreadsheets/d/1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU/edit';

      showToast(`🔍 正在試算表篩選【${dateTagVal}】的訂單...`);

      // 透過 Service Worker 發送篩選指令給 Google Apps Script
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'syncToGoogleSheets',
          url: webhookUrl,
          payload: {
            action: 'filterSheetByDate',
            dateTag: dateTagVal
          }
        }, () => {});
      }

      // 開啟 Google 試算表 (在分頁中檢視)
      try {
        window.open(sheetUrl, '_blank');
      } catch (_) {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: sheetUrl });
        }
      }

      showToast(`🔍 已開啟 Google 試算表！只檢視【${dateTagVal}】的訂單`);
    });
  }

  // 預設 Google Apps Script 試算表 Webhook 網址
  const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyWmZqHYc1THus_JRa54ZDsU3rRck4r4snh_7B3mzjjKXrNLIUTWmibCQQloiSXefL_kQ/exec';

  // 讀取設定 (若尚未設定則自動採用最新預設網址)
  function getSettings() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['googleSheetsWebhookUrl'], (res) => {
          const cfg = res || {};
          if (!cfg.googleSheetsWebhookUrl) {
            cfg.googleSheetsWebhookUrl = DEFAULT_WEBHOOK_URL;
          }
          resolve(cfg);
        });
      } else {
        resolve({ googleSheetsWebhookUrl: DEFAULT_WEBHOOK_URL });
      }
    });
  }

  // Toast 提示
  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('wuyi-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('wuyi-show');
    }, 2800);
  }
})();

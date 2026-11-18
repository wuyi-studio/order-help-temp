/**
 * 梧藝 WUYI 下單小幫手 - 獨立小視窗邏輯
 */

document.addEventListener('DOMContentLoaded', () => {
  const Ext = window.Extractor;
  const Renderer = window.CardRenderer;

  const state = {
    orderState: Ext._createEmptyOrderState(),
    pricingState: { breakdownText: '', total: 0 },
    images: {
      flower: [null, null],
      cake: [null, null, null],
      addon: [null]
    }
  };

  const btnCloseWindow = document.getElementById('btnCloseWindow');
  const btnScrapeChat = document.getElementById('btnScrapeChat');
  const btnPrevOrder = document.getElementById('btnPrevOrder');
  const navCounter = document.getElementById('navCounter');
  const btnNextOrder = document.getElementById('btnNextOrder');
  const btnRefresh = document.getElementById('btnRefresh');

  const btnClearFlower = document.getElementById('btnClearFlower');
  const btnClearCake = document.getElementById('btnClearCake');
  const btnClearAddon = document.getElementById('btnClearAddon');

  const btnAddFlowerGroup = document.getElementById('btnAddFlowerGroup');
  const btnAddCakeGroup = document.getElementById('btnAddCakeGroup');
  const flowerGroupsContainer = document.getElementById('wuyiFlowerGroupsContainer');
  const cakeGroupsContainer = document.getElementById('wuyiCakeGroupsContainer');

  const inputDateTag = document.getElementById('inputDateTag');
  const btnAddLineTag = document.getElementById('btnAddLineTag');
  const btnCopyFlowerDirect = document.getElementById('btnCopyFlowerDirect');
  const btnCopyCakeDirect = document.getElementById('btnCopyCakeDirect');
  const btnCopyOrderWithPricing = document.getElementById('btnCopyOrderWithPricing');
  const btnCopyPricingDirect = document.getElementById('btnCopyPricingDirect');

  const txtFlowerOrder = document.getElementById('txtFlowerOrder');
  const txtCakeOrder = document.getElementById('txtCakeOrder');
  const txtPricing = document.getElementById('txtPricing');

  const btnCopyCard = document.getElementById('btnCopyCard');
  const btnCopyOrder = document.getElementById('btnCopyOrder');
  const btnAddLineNote = document.getElementById('btnAddLineNote');
  const toast = document.getElementById('wuyiToast');

  if (btnCloseWindow) {
    btnCloseWindow.addEventListener('click', () => window.close());
  }

  // 輔助函式：文字寫入剪貼簿 (雙重保險：現代 Clipboard API + 離屏 textarea 回退機制，杜絕 Document not focused 報錯)
  async function copyTextToClipboard(text) {
    if (!text && text !== '') return false;

    // 1. 嘗試主動獲取視窗焦點
    try {
      if (typeof window !== 'undefined' && window.focus) {
        window.focus();
      }
    } catch (_) {}

    // 2. 優先嘗試現代 Clipboard API
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('navigator.clipboard.writeText 失敗 (可能因未聚焦)，切換至 execCommand 回退機制:', err);
      }
    }

    // 3. 回退方案：建立離屏 textarea 執行 document.execCommand('copy')
    try {
      const ta = document.createElement('textarea');
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
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const successful = document.execCommand('copy');
      document.body.removeChild(ta);
      return successful;
    } catch (fallbackErr) {
      console.error('所有剪貼簿寫入方式皆失敗:', fallbackErr);
      return false;
    }
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

    document.querySelectorAll('.wuyi-size-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-size') === sizeKey);
    });

    try {
      localStorage.setItem('wuyi_window_size', sizeKey);
    } catch (e) {}

    if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getCurrent) {
      chrome.windows.getCurrent((win) => {
        if (win && win.id) {
          chrome.windows.update(win.id, { width: target.width, height: target.height });
        } else {
          window.resizeTo(target.width, target.height);
        }
      });
    } else {
      window.resizeTo(target.width, target.height);
    }
    showToast('📐 已設定為 ' + target.label + ' 視窗尺寸 (' + target.width + 'x' + target.height + ')');
  }

  document.querySelectorAll('.wuyi-size-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const sizeKey = btn.getAttribute('data-size');
      setWindowSize(sizeKey);
    });
  });

  try {
    const savedSize = localStorage.getItem('wuyi_window_size');
    if (savedSize && WINDOW_SIZES[savedSize]) {
      document.querySelectorAll('.wuyi-size-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-size') === savedSize);
      });
    }
  } catch (e) {}

  // 1. 動態圖框事件綁定與管理 (支援點擊「新增」增加空格、點擊空白框選檔、拖曳換位、單圖刪除)
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

  const hiddenFileInput = document.getElementById('wuyiHiddenFileInput');
  let currentUploadTarget = null; // { group, index }
  let currentDraggingBox = null; // { group, index }

  function renderGroupBoxes(group) {
    const rowId = group.startsWith('row') ? group : ('row' + group.charAt(0).toUpperCase() + group.slice(1));
    const row = document.getElementById(rowId);
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
          if (hiddenFileInput) {
            hiddenFileInput.value = '';
            hiddenFileInput.click();
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
      document.querySelectorAll('.wuyi-box-dropzone').forEach(b => b.classList.remove('wuyi-drag-over'));
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
            showToast('✅ ' + GROUP_LABELS[group] + ' 截圖已加入！');
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
        let finalUrl = url;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          try {
            const res = await new Promise(resolve => {
              chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url: url }, resolve);
            });
            if (res && res.dataUrl) finalUrl = res.dataUrl;
          } catch (e) {}
        }
        state.images[group][idx] = finalUrl;
        renderGroupBoxes(group);
        showToast('✅ ' + GROUP_LABELS[group] + ' 截圖已加入！');
      }
    });
  }

  // 初始渲染三個分類圖框
  renderGroupBoxes('flower');
  renderGroupBoxes('cake');
  renderGroupBoxes('addon');

  function applySyncedStateFromContent(synced) {
    if (!synced) return;
    if (synced.flowerText !== undefined && txtFlowerOrder) {
      txtFlowerOrder.value = synced.flowerText;
    }
    if (synced.cakeText !== undefined && txtCakeOrder) {
      txtCakeOrder.value = synced.cakeText;
    }
    if (synced.pricingText !== undefined && txtPricing) {
      txtPricing.value = synced.pricingText;
    }
    if (synced.dateTag !== undefined && inputDateTag) {
      inputDateTag.value = synced.dateTag;
    }
    if (synced.orderState) {
      state.orderState = synced.orderState;
    }
    if (synced.pricingState) {
      state.pricingState = synced.pricingState;
    }
    if (synced.images) {
      state.images = {
        flower: Array.isArray(synced.images.flower) ? synced.images.flower : [null, null],
        cake: Array.isArray(synced.images.cake) ? synced.images.cake : [null, null, null],
        addon: Array.isArray(synced.images.addon) ? synced.images.addon : [null]
      };
      renderGroupBoxes('flower');
      renderGroupBoxes('cake');
      renderGroupBoxes('addon');
    }
  }

  // 獨立視窗啟動時：自動向 LINE OA 頁面請求目前同步的訂單資料 (達成側欄與獨立視窗無縫同步)
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      const lineTab = tabs.find(t => t.url && (t.url.includes('chat.line.biz') || t.url.includes('manager.line.biz')));
      if (lineTab && lineTab.id) {
        chrome.tabs.sendMessage(lineTab.id, { action: 'getCurrentOrderHelperState' }, (res) => {
          if (res && res.success && res.state) {
            applySyncedStateFromContent(res.state);
          }
        });
      }
    });
  }

  // 透過事件代理處理所有截圖格「新增」與「清除」按鈕 (全面支援主組與動態新增的花單/蛋糕組)
  document.addEventListener('click', (e) => {
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

  if (hiddenFileInput) {
    hiddenFileInput.addEventListener('change', () => {
      if (!hiddenFileInput.files || hiddenFileInput.files.length === 0) return;
      const file = hiddenFileInput.files[0];
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

  // 2. 一鍵抓取與候選對話導覽
  let orderCandidates = [];
  let currentCandidateIndex = -1;

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

  btnScrapeChat.addEventListener('click', triggerScrape);
  btnRefresh.addEventListener('click', triggerScrape);

  async function triggerScrape() {
    showToast('🔍 正在搜尋具備完整取貨與訂購人資訊的訂單對話...');

    chrome.tabs.query({}, async (tabs) => {
      const lineTab = tabs.find(t => t.url && (t.url.includes('chat.line.biz') || t.url.includes('manager.line.biz')));
      if (!lineTab || !lineTab.id) {
        showToast('⚠️ 未找到開啟的 LINE 官方客服聊天分頁 (chat.line.biz)');
        return;
      }

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: lineTab.id },
          func: scrapeLineChatInPage
        });

        if (results && results[0] && results[0].result) {
          const res = results[0].result;
          orderCandidates = res.candidates || [];
          if (res.pricingText) {
            state.pricingState = Ext.parsePricingText(res.pricingText);
            txtPricing.value = state.pricingState.breakdownText;
          }

          if (orderCandidates.length === 0) {
            currentCandidateIndex = -1;
            updateNavUI();
            showToast('⚠️ 未在對話框中找到包含【訂購人 LINE 名稱】或訂單格式的訊息');
            return;
          }

          // 預設套用最新一筆 (最後一筆)
          await applyCandidate(orderCandidates.length - 1);
        } else {
          showToast('⚠️ 未偵測到對話資料');
        }
      } catch (err) {
        console.error(err);
        showToast('❌ 抓取失敗：' + err.message);
      }
    });
  }

  async function applyCandidate(index) {
    if (index < 0 || index >= orderCandidates.length) return;
    currentCandidateIndex = index;
    updateNavUI();

    const cand = orderCandidates[index];
    if (cand.text) {
      // 1. 依需求分成 1️⃣花束 與 2️⃣蛋糕 兩大部分填入對應文字框 (無該項目則填寫「無」)
      const cleanText = Ext.cleanOrderTextWithoutPricing(cand.text);
      const split = Ext.splitOrderText(cleanText);
      if (txtFlowerOrder) txtFlowerOrder.value = split.flowerText;
      if (txtCakeOrder) txtCakeOrder.value = split.cakeText;

      state.orderState = Ext.parseOrderText(cleanText);
      if (inputDateTag) {
        inputDateTag.value = state.orderState.pickup.dateTag || (Ext && Ext.formatWuyiDate(state.orderState.pickup.date)) || state.orderState.pickup.date || '';
      }

      // 2. 金額明細：優先提取「訂購人電話」下方的內容
      const trailingPricing = Ext.extractPricingFromOrderText(cand.text);
      if (trailingPricing) {
        txtPricing.value = trailingPricing;
        state.pricingState = Ext.parsePricingText(trailingPricing);
      }
    }

    // 自動依序分配圖片進各圖框 (全並行平行載入加速)
    if (cand.imageUrls && cand.imageUrls.length > 0) {
      const fetchedResults = await Promise.all(
        cand.imageUrls.map(url => fetchViaServiceWorker(url))
      );
      const dataUrls = fetchedResults.map(r => (r && r.dataUrl) ? r.dataUrl : null);

      const flowerVal = txtFlowerOrder ? txtFlowerOrder.value : '';
      const cakeVal = txtCakeOrder ? txtCakeOrder.value : '';
      const hasFlower = flowerVal && flowerVal !== '無';
      const hasCake = cakeVal && cakeVal !== '無';

      if (hasFlower && !hasCake) {
        // 純花束
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
        // 花束 + 蛋糕混和
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

    showToast(`📋 已載入第 ${currentCandidateIndex + 1}/${orderCandidates.length} 則訂單對話！`);
  }

  btnPrevOrder.addEventListener('click', () => {
    if (currentCandidateIndex > 0) {
      applyCandidate(currentCandidateIndex - 1);
    }
  });

  btnNextOrder.addEventListener('click', () => {
    if (currentCandidateIndex < orderCandidates.length - 1) {
      applyCandidate(currentCandidateIndex + 1);
    }
  });

  // 3. 文字與標籤編輯雙向同步
  if (inputDateTag) {
    inputDateTag.addEventListener('input', () => {
      const val = inputDateTag.value.trim();
      state.orderState.pickup.dateTag = val;
      // 維持完整訂單內容原始文字，不自動覆寫 txtRawOrder
    });
  }

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

      await copyTextToClipboard(tag);

      // 向 LINE 官方帳號分頁執行自動新增標籤 (優先使用 executeScript 確保不需重整網頁亦必定生效)
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          const allTabs = await chrome.tabs.query({});
          const lineTabs = allTabs.filter(t => t.url && t.url.includes('chat.line.biz'));
          const lineTab = lineTabs.find(t => t.active) || lineTabs[0];

          if (lineTab && chrome.scripting && chrome.scripting.executeScript) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: lineTab.id },
              func: addLineOfficialTagInPage,
              args: [tag]
            });
            if (results && results[0] && results[0].result && results[0].result.message) {
              showToast(results[0].result.message);
              return;
            }
          }

          if (lineTab) {
            chrome.tabs.sendMessage(lineTab.id, { action: 'addLineOfficialTag', tag: tag }, (res) => {
              if (res && res.message) {
                showToast(res.message);
              } else {
                showToast(`🏷️ 已複製標籤「${tag}」！`);
              }
            });
          } else {
            showToast(`🏷️ 已複製標籤「${tag}」至剪貼簿！`);
          }
        } catch (err) {
          showToast(`🏷️ 已複製標籤「${tag}」至剪貼簿！`);
        }
      } else {
        showToast(`🏷️ 已複製標籤「${tag}」至剪貼簿！`);
      }
    });
  }

  const NUM_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  function updateGroupNumbering() {
    let seq = 0;
    const fCards = document.querySelectorAll('[data-group-type="flower"]');
    fCards.forEach(c => {
      const lbl = c.querySelector('.wuyi-item-label');
      if (lbl) {
        const num = NUM_EMOJIS[seq] || `${seq + 1}️⃣`;
        lbl.textContent = `📝 ${num} 花束訂單內容：`;
      }
      seq++;
    });

    const cCards = document.querySelectorAll('[data-group-type="cake"]');
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

    const fCards = document.querySelectorAll('[data-group-type="flower"]');
    fCards.forEach((c) => {
      const gIdx = parseInt(c.dataset.groupIndex || '0', 10);
      const ta = c.querySelector('textarea');
      const text = (ta ? ta.value : '').trim();
      const imgs = getGroupImages('flower', gIdx);
      const hasContent = Boolean(text && text !== '無') || imgs.length > 0;
      if (hasContent) {
        items.push({
          type: 'flower',
          index: seq++,
          groupIndex: gIdx,
          text: text || '無',
          images: imgs
        });
      }
    });

    const cCards = document.querySelectorAll('[data-group-type="cake"]');
    cCards.forEach((c) => {
      const gIdx = parseInt(c.dataset.groupIndex || '0', 10);
      const ta = c.querySelector('textarea');
      const text = (ta ? ta.value : '').trim();
      const cImgs = getGroupImages('cake', gIdx);
      const aImgs = getGroupImages('addon', gIdx);
      const hasContent = Boolean(text && text !== '無') || cImgs.length > 0 || aImgs.length > 0;
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
    });

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

    card.querySelector('.wuyi-btn-remove-group').addEventListener('click', () => {
      card.remove();
      delete state.images[groupKey];
      updateGroupNumbering();
      onOrderInputChanged();
      showToast('🗑️ 已刪除花單組別');
    });

    card.querySelector('.btn-copy-item-direct').addEventListener('click', async () => {
      const ta = card.querySelector('textarea');
      const text = ta ? ta.value.trim() : '';
      if (!text) return showToast('⚠️ 目前沒有花束文字');
      await copyTextToClipboard(text);
      showToast('📋 已複製花束訂單內容！');
    });

    card.querySelector('textarea').addEventListener('input', onOrderInputChanged);

    const container = document.getElementById('wuyiFlowerGroupsContainer');
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

    card.querySelector('.wuyi-btn-remove-group').addEventListener('click', () => {
      card.remove();
      delete state.images[cakeKey];
      delete state.images[addonKey];
      updateGroupNumbering();
      onOrderInputChanged();
      showToast('🗑️ 已刪除蛋糕組別');
    });

    card.querySelector('.btn-copy-item-direct').addEventListener('click', async () => {
      const ta = card.querySelector('textarea');
      const text = ta ? ta.value.trim() : '';
      if (!text) return showToast('⚠️ 目前沒有訂單文字');
      await copyTextToClipboard(text);
      showToast('📋 已複製訂單內容！');
    });

    card.querySelector('textarea').addEventListener('input', onOrderInputChanged);

    const container = document.getElementById('wuyiCakeGroupsContainer');
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

  // 4. 快捷按鈕

  if (btnCopyFlowerDirect) {
    btnCopyFlowerDirect.addEventListener('click', async () => {
      const text = getFlowerOrderText();
      if (!text) return showToast('⚠️ 目前沒有花束文字');
      await copyTextToClipboard(text);
      showToast('📋 已複製花束訂單內容！');
    });
  }

  if (btnCopyCakeDirect) {
    btnCopyCakeDirect.addEventListener('click', async () => {
      const text = getCakeOrderText();
      if (!text) return showToast('⚠️ 目前沒有訂單文字');
      await copyTextToClipboard(text);
      showToast('📋 已複製訂單內容！');
    });
  }

  if (btnCopyOrderWithPricing) {
    btnCopyOrderWithPricing.addEventListener('click', async () => {
      const cakeText = getCakeOrderText();
      const pricingText = (txtPricing ? txtPricing.value : '').trim();
      if (!cakeText && !pricingText) return showToast('⚠️ 目前沒有訂單內容與金額');
      let combined = cakeText;
      if (pricingText) {
        combined = combined ? (combined + '\n\n' + pricingText) : pricingText;
      }
      await copyTextToClipboard(combined);
      showToast('📋 已複製訂單與金額明細！');
    });
  }

  if (btnCopyPricingDirect) {
    btnCopyPricingDirect.addEventListener('click', async () => {
      const text = txtPricing.value.trim();
      if (!text) return showToast('⚠️ 目前沒有金額明細');
      await copyTextToClipboard(text);
      showToast('📋 已複製金額明細！');
    });
  }

  // 安全取得各類截圖陣列，防止 state.images 或內部屬性未初始化時引發 TypeError
  function getSafeImages() {
    const imgs = state.images || {};
    return {
      flower: Array.isArray(imgs.flower) ? imgs.flower.filter(Boolean) : [],
      cake: Array.isArray(imgs.cake) ? imgs.cake.filter(Boolean) : [],
      addon: Array.isArray(imgs.addon) ? imgs.addon.filter(Boolean) : (imgs.addon ? [imgs.addon] : []),
      primaryAddon: Array.isArray(imgs.addon) ? (imgs.addon.filter(Boolean)[0] || null) : (imgs.addon || null)
    };
  }

  // 複製備忘錄格式 (富文字 HTML：按 1️⃣花束照片->花束文字、2️⃣蛋糕/蠟燭照片->蛋糕文字 排列，照片靠左且無多餘標題)
  if (btnCopyOrder) {
    btnCopyOrder.addEventListener('click', async () => {
      const allItems = getAllOrderItems();
      if (allItems.length === 0) return showToast('⚠️ 目前沒有訂單文字');

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

    const activeWin = typeof window !== 'undefined' ? window : null;
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
  });
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
      if (!textToCopy) return showToast('⚠️ 目前沒有訂單或日期內容可新增');

      await copyTextToClipboard(textToCopy);

      if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          const allTabs = await chrome.tabs.query({});
          const lineTabs = allTabs.filter(t => t.url && t.url.includes('chat.line.biz'));
          const lineTab = lineTabs.find(t => t.active) || lineTabs[0];

          if (lineTab && chrome.scripting && chrome.scripting.executeScript) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: lineTab.id },
              func: addLineOfficialNoteInPage,
              args: [textToCopy]
            });
            if (results && results[0] && results[0].result && results[0].result.message) {
              showToast(results[0].result.message);
              return;
            }
          }

          if (lineTab) {
            chrome.tabs.sendMessage(lineTab.id, { action: 'addLineOfficialNote', text: textToCopy }, (res) => {
              if (res && res.message) {
                showToast(res.message);
              } else {
                showToast('📝 已將訂單複製至剪貼簿！');
              }
            });
          } else {
            showToast('📝 已將訂單複製至剪貼簿！');
          }
        } catch (err) {
          showToast('📝 已將訂單複製至剪貼簿！');
        }
      } else {
        showToast('📝 已將訂單複製至剪貼簿！');
      }
    });
  }

  // 記錄最後一次成功同步的訂單 Key，杜絕連點或重複點擊小卡重複寫入試算表
  let lastSyncedOrderKey = null;

  if (btnCopyCard) {
    btnCopyCard.addEventListener('click', async () => {
      try {
        const rawCustName = (state.orderState.customer.name || (typeof inputCustomerName !== 'undefined' && inputCustomerName ? inputCustomerName.value : '') || '').trim();
        const rawLineName = (state.orderState.customer.lineName || (typeof inputCustomerLine !== 'undefined' && inputCustomerLine ? inputCustomerLine.value : '') || '').trim();
        const hasRescheduleKeyword = /改期/.test(rawCustName) || /改期/.test(rawLineName);

        let isReschedule = false;
        let oldDateTagToDelete = '';
        let rescheduleDecision = null;
        const cleanCustomerName = rawCustName.replace(/[\s(（]*改期[)）]*/g, '').trim() || '客戶';
        const cleanLineName = rawLineName.replace(/[\s(（]*改期[)）]*/g, '').trim() || cleanCustomerName;

        const dateTag = (inputDateTag ? inputDateTag.value.trim() : '') || state.orderState.pickup.dateTag || (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
        const pickupTime = state.orderState.pickup.time || '';

        const cfg = await new Promise((resolve) => {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(['googleSheetsWebhookUrl'], resolve);
          } else {
            resolve({});
          }
        });
        const webhookUrl = (cfg && cfg.googleSheetsWebhookUrl) ? cfg.googleSheetsWebhookUrl : DEFAULT_WEBHOOK_URL;

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

            // 移除名稱上的「改期」贅字，保持小卡檔名與試算表清爽
            state.orderState.customer.name = cleanCustomerName;
            state.orderState.customer.lineName = cleanLineName;
            if (typeof inputCustomerName !== 'undefined' && inputCustomerName) inputCustomerName.value = cleanCustomerName;
            if (typeof inputCustomerLine !== 'undefined' && inputCustomerLine) inputCustomerLine.value = cleanLineName;

            if (!isManualDelete && oldDateTagToDelete && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && webhookUrl) {
              showToast(`🗑️ 正在刪除舊訂單【${oldDateTagToDelete} ${cleanCustomerName}】的小卡與試算表資料...`);
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
                    }, (res) => {
                      if (chrome.runtime.lastError) {
                        console.warn('deleteOldOrder runtime warning:', chrome.runtime.lastError);
                      }
                      resDel(res);
                    });
                  }),
                  new Promise(r => setTimeout(r, 6000))
                ]);
              } catch (delErr) {
                console.warn('Delete old order error:', delErr);
              }
            }
          }
        }

        showToast('🎨 正在生成取貨確認小卡並貼入對話框...');
        if (!Renderer || typeof Renderer.renderCard !== 'function') {
          throw new Error('小卡渲染引擎尚未就緒');
        }
        const safeImgs = getSafeImages();
        const allItems = getAllOrderItems();
        const flowerText = getFlowerOrderText();
        const cakeText = getCakeOrderText();
        const canvas = await Renderer.renderCard(state.orderState, {
          items: allItems,
          flowerText,
          cakeText,
          flowerImages: safeImgs.flower,
          cakeImages: safeImgs.cake,
          addonImages: safeImgs.addon,
          addonImage: safeImgs.primaryAddon
        });
        const lineName = (state.orderState.customer.lineName || state.orderState.customer.name || '客戶').trim().replace(/[\/\\:*?"<>|]/g, '_');
        const filename = buildCardFilename(dateTag, pickupTime, lineName);
        const dataUrl = canvas.toDataURL('image/png');

        let copiedToClipboard = false;
        const currentWin = typeof window !== 'undefined' ? window : null;
        try {
          await Renderer.copyCardToClipboard(canvas, currentWin);
          copiedToClipboard = true;
        } catch (clipErr) {
          console.warn('Image copy to clipboard failed, downloading card image instead:', clipErr);
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
              action: 'downloadCardWithSaveAs',
              dataUrl: dataUrl,
              filename: filename
            });
          } else {
            Renderer.downloadCard(canvas, filename);
          }
          showToast('💾 因瀏覽器焦點限制，已為您自動下載確認單圖檔！');
        }

        // 通知活躍的 LINE 官方聊天室分頁直接將圖卡貼入對話框
        let pastedInLine = false;
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          try {
            const allTabs = await chrome.tabs.query({});
            const lineTabs = allTabs.filter(t => t.url && t.url.includes('chat.line.biz'));
            const lineTab = lineTabs.find(t => t.active) || lineTabs[0];
            if (lineTab) {
              chrome.tabs.sendMessage(lineTab.id, { action: 'pasteLineCardImage' }, () => {});
              pastedInLine = true;
            }
          } catch (_) {}
        }

        state.isModifiedSinceLoad = false;
        state.currentReviewStatus = '⏳ 待複查';

        // 【防空白單】若尚未填寫取貨日期，只將小卡貼入 LINE 給客人預覽，暫不寫入試算表與雲端以免產生殘缺廢單
        if (!dateTag && !(state.orderState.pickup && state.orderState.pickup.date)) {
          if (pastedInLine) {
            showToast('🖼️ 小卡已貼入對話框！因尚未填寫【取貨日期】，暫不寫入試算表以免產生空白單');
          } else if (copiedToClipboard) {
            showToast('✨ 小卡已複製！因尚未填寫【取貨日期】，暫不寫入試算表');
          }
          return;
        }

        if (pastedInLine) {
          showToast('🖼️ 取貨確認小卡已直接貼入對話框！(正在同步至試算表與雲端...)');
        } else if (copiedToClipboard) {
          showToast('✨ 預約取貨確認單已複製！可在 LINE 直接貼上 (正在同步至試算表與雲端...)');
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

        // 雙重重複檢查：檢查本機記錄中是否已上傳過此檔名
        const uploadCacheKey = `wuyi_uploaded_${filename}`;
        const storedCache = await new Promise(r => {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get([uploadCacheKey], r);
          } else {
            r({});
          }
        });
        const clientAlreadyUploaded = Boolean(storedCache && storedCache[uploadCacheKey]);

        // 同時自動同步至 Google 試算表與上傳雲端小卡至 Google Drive
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
        showToast('❌ 複製確認單失敗：' + err.message);
      }
    });
  }

  // 🎂 蛋糕 與 💐 花束 快速發送/編輯確認訊息功能
  // 按 1 下：傳送確認訊息給客人；快速連按 3 下：編輯要輸入的自訂訊息
  const btnQuickMsgCake = document.getElementById('btnQuickMsgCake');
  const btnQuickMsgFlower = document.getElementById('btnQuickMsgFlower');

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

  function getQuickMsgPopup(type, defaultText) {
    const storageKey = `wuyi_custom_msg_${type}`;
    const stored = localStorage.getItem(storageKey);
    if (!stored || stored === OLD_DEFAULT_MSG[type]) {
      return defaultText;
    }
    return stored;
  }

  function setupQuickMsgButtonPopup(btn, type, label, defaultText) {
    if (!btn) return;
    let clickCount = 0;
    let clickTimer = null;
    const storageKey = `wuyi_custom_msg_${type}`;

    const handleEdit = () => {
      clearTimeout(clickTimer);
      clickCount = 0;
      const currentMsg = getQuickMsgPopup(type, defaultText);
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

      // 原生三連擊或按住 Shift/Alt 進入編輯
      if (e.detail >= 3 || e.shiftKey || e.altKey) {
        handleEdit();
        return;
      }

      // 按 1 下：複製確認訊息至剪貼簿 (回歸最穩定快速的剪貼簿複製模式)
      const currentMsg = getQuickMsgPopup(type, defaultText);
      const copied = await copyTextToClipboard(currentMsg);
      if (copied) {
        showToast(`📋 已複製【${label}】確認訊息！可在對話框按 Ctrl+V 貼上`);
      } else {
        showToast(`⚠️ 複製【${label}】訊息失敗，請手動複製`);
      }
    });
  }

  // 快捷按鈕：開啟 Google 試算表只檢視指定固定日期的全部訂單
  const btnViewSheetDate = document.getElementById('btnViewSheetDate');
  if (btnViewSheetDate) {
    btnViewSheetDate.addEventListener('click', async () => {
      const dateTagVal = (inputDateTag ? inputDateTag.value.trim() : '') || state.orderState.pickup.dateTag || (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');
      if (!dateTagVal) {
        showToast('⚠️ 請先輸入或由訂單帶入「標籤日期」(例：1108)');
        return;
      }

      const cfg = await new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(['googleSheetsWebhookUrl'], resolve);
        } else {
          resolve({});
        }
      });
      const webhookUrl = (cfg && cfg.googleSheetsWebhookUrl) ? cfg.googleSheetsWebhookUrl : DEFAULT_WEBHOOK_URL;
      const sheetUrl = 'https://docs.google.com/spreadsheets/d/1TqaoolE2a1zSo9ON5b6OIJo0vNuztCAw7l0hcY0iQxU/edit';

      showToast(`🔍 正在試算表篩選【${dateTagVal}】的訂單...`);

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

      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: sheetUrl });
      } else {
        window.open(sheetUrl, '_blank');
      }

      showToast(`🔍 已開啟 Google 試算表！只檢視【${dateTagVal}】的訂單`);
    });
  }

  // 將時間格式化為 12 小時制 (如 15:00 -> 3點, 15:30 -> 3點半, 11:00 -> 11點)
  function format12HourTime(rawTime) {
    if (!rawTime || typeof rawTime !== 'string') return '';
    const s = rawTime.trim();
    if (!s) return '';

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

    const mPure = s.match(/^(\d{1,2})$/);
    if (mPure) {
      let hh = parseInt(mPure[1], 10);
      if (hh > 12) hh -= 12;
      if (hh === 0) hh = 12;
      return `${hh}點`;
    }

    return s;
  }

  // 小卡檔名格式：1108 取貨時間12小時制 Melody.png
  function buildCardFilename(dateTag, rawTime, lineName) {
    const time12 = format12HourTime(rawTime);
    const cleanDate = (dateTag || '').trim().replace(/[\/\\:*?"<>|]/g, '-');
    const cleanTime = (time12 || '').trim().replace(/[\/\\:*?"<>|]/g, '');
    const cleanName = (lineName || '客戶').trim().replace(/[\/\\:*?"<>|]/g, '_');

    const parts = [cleanDate, cleanTime, cleanName].filter(Boolean);
    return parts.join(' ') + '.png';
  }

  setupQuickMsgButtonPopup(btnQuickMsgCake, 'cake', '🎂 蛋糕', DEFAULT_QUICK_MSG.cake);
  setupQuickMsgButtonPopup(btnQuickMsgFlower, 'flower', '💐 花束', DEFAULT_QUICK_MSG.flower);

  const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyWmZqHYc1THus_JRa54ZDsU3rRck4r4snh_7B3mzjjKXrNLIUTWmibCQQloiSXefL_kQ/exec';

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

  async function autoSyncToGoogleSheets(forceSync = false, deleteOldDateTag = null, reviewStatus = null) {
    try {
      const cfg = await new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(['googleSheetsWebhookUrl'], resolve);
        } else {
          resolve({});
        }
      });

      const webhookUrl = (cfg && cfg.googleSheetsWebhookUrl) ? cfg.googleSheetsWebhookUrl : DEFAULT_WEBHOOK_URL;
      const finalReviewStatus = reviewStatus || state.currentReviewStatus || '⏳ 待複查';
      const dateTagVal = (inputDateTag ? inputDateTag.value.trim() : '') || state.orderState.pickup.dateTag || (state.orderState.pickup.date || '').replace(/[\/\.]/g, '-');

      // 【防空白單】若尚未填寫取貨日期，自動略過同步
      if (!dateTagVal) {
        return { skipped: true, reason: 'missing_pickup_date' };
      }

      const currentOrderKey = [
        state.orderState.pickup.date || '',
        state.orderState.customer.name || '',
        state.orderState.customer.phone || '',
        state.orderState.customer.lineName || '',
        state.pricingState.total || '0',
        finalReviewStatus
      ].join('__');

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
            url: webhookUrl,
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
      console.warn('Auto sync sheets error:', err);
      return { error: err.message };
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
    if (window.focus) {
      try { window.focus(); } catch (_) {}
    }

    let copied = false;
    if (navigator.clipboard && navigator.clipboard.write) {
      try {
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        const textBlob = new Blob([plainContent], { type: 'text/plain' });
        await navigator.clipboard.write([
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

  function fetchViaServiceWorker(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'fetchImageAsDataUrl', url }, (res) => {
        resolve(res || { success: false, dataUrl: url });
      });
    });
  }

  let toastTimer = null;
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('wuyi-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('wuyi-show'), 2800);
  }
});

function scrapeLineChatInPage() {
  const isPricingFormat = (text) => {
    if (!text) return false;
    return /(蛋糕|漢堡盒|花束|餐具|蠟燭|保冷|襯紙|提袋|鮮花預算)[\$：:]\s*\d+/.test(text) &&
           /(總共|合計|＝|=)\s*[\$]?\s*\d+/.test(text);
  };

  const isValidChatImage = (src) => {
    if (!src || typeof src !== 'string') return false;
    if (src.startsWith('data:image/svg')) return false;
    const lower = src.toLowerCase();
    if (lower.includes('avatar') || lower.includes('profile') || lower.includes('emoji') || lower.includes('icon') || lower.includes('sticker')) {
      return false;
    }
    return true;
  };

  const isInsideChatDialogue = (el) => {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root, #wuyi-helper-root')) return false;
    if (el.closest('[role="dialog"], [class*="modal" i], [class*="dialog" i], .modal, .dialog')) return false;
    if (el.closest('aside, [class*="drawer" i], [class*="sidebar-right" i], [class*="user-info" i], [class*="customer-profile" i], [class*="note" i], [class*="memo" i], [id*="note" i], [id*="memo" i], [class*="right" i], [role="tabpanel"], [class*="tabpanel" i]')) return false;
    if (el.closest('[class*="chat-list" i], [class*="chatList"], [class*="room-list" i], nav')) return false;

    // 幾何位置檢驗：確保元素必定落在中間對話串區域（嚴禁落在右側記事本欄位）
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
        if (rect.left > inputRect.right + 20) {
          return false;
        }
        if (rect.right < inputRect.left - 20) {
          return false;
        }
      }
    } catch (e) {}

    const raw = (el.innerText || el.textContent || '').trim();
    if (raw.includes('記錄與用戶之間的互動') || raw.includes('交接備註') || /^(記事本|記事)\s*\d*\/?\d*/.test(raw)) {
      return false;
    }
    if (el.closest('[aria-label*="記事本"], [title*="記事本"], [aria-label*="note" i]')) {
      return false;
    }
    return true;
  };

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

  const hasAllOrderRequiredFields = (str) => {
    if (!str || typeof str !== 'string') return false;
    // 嚴格判定：必須同時具備以下 6 項訂單核心資訊才能選入
    const hasPickupDate = /(?:取貨|自取)?日期\s*[：:]/.test(str) || /取貨日期|自取日期/.test(str);
    const hasPickupTime = /(?:取貨|自取)?時間\s*[：:]/.test(str) || /取貨時間|自取時間/.test(str);
    const hasPickupLocation = /(?:自取|取貨)(?:地點|門市)\s*[：:]/.test(str) || /自取地點|取貨地點/.test(str);
    const hasLineName = /(?:訂購人(?:的)?\s*)?(?:LINE|line)\s*名稱/i.test(str);
    const hasCustomerName = /訂購人姓名|訂購人\s*姓名/.test(str) || (/(?:訂購人)?姓名\s*[：:]/.test(str) && !/LINE\s*名稱/i.test(str));
    const hasCustomerPhone = /訂購人電話|訂購人\s*電話/.test(str) || /(?:訂購人|聯絡)?電話\s*[：:]/.test(str);
    return Boolean(hasPickupDate && hasPickupTime && hasPickupLocation && hasLineName && hasCustomerName && hasCustomerPhone);
  };

  for (const el of elements) {
    if (!isInsideChatDialogue(el)) continue;
    const text = (el.innerText || '').trim();
    if (!text) continue;

    // 重新設定：必須同時具備 取貨日期、取貨時間、自取地點、訂購人 LINE 名稱、訂購人姓名、訂購人電話 才能選入！
    if (hasAllOrderRequiredFields(text)) {
      matched.push({ el, text });
    }
  }

  // 剔除包含其他候選者的超大外層容器
  const filtered = matched.filter(item => {
    const containsChildOrder = matched.some(other => {
      return other.el !== item.el &&
             item.el.contains(other.el) &&
             (/LINE/i.test(other.text) || /取貨/.test(other.text) || /蛋糕/.test(other.text) || other.text.length > 40);
    });
    if (containsChildOrder) return false;

    const hasContent = /LINE|取貨|自取|蛋糕|口味|尺寸|題字|訂購人|加購|預算|花束/i.test(item.text);
    if (!hasContent && item.text.length < 20) {
      return false;
    }

    return true;
  });

  // 去重並按 DOM 順序排列（舊至新）
  const unique = [];
  const seenTexts = new Set();
  for (const item of filtered) {
    const key = item.text.replace(/\s+/g, ' ').substring(0, 100);
    if (!seenTexts.has(key)) {
      seenTexts.add(key);
      unique.push(item);
    }
  }

  unique.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  // 整理所有候選對話的文字與圖片
  const candidates = unique.map(item => {
    const images = [];
    item.el.querySelectorAll('img').forEach(img => {
      if (isValidChatImage(img.src) && !images.includes(img.src)) {
        images.push(img.src);
      }
    });
    const parentContainer = item.el.parentElement;
    if (parentContainer) {
      parentContainer.querySelectorAll('img').forEach(img => {
        if (isValidChatImage(img.src) && !images.includes(img.src)) {
          images.push(img.src);
        }
      });
    }
    return {
      text: item.text,
      imageUrls: images
    };
  });

  // 搜尋最新金額
  let latestPricingText = '';
  const allDivs = Array.from(document.querySelectorAll('.chat-content, .message-content, [data-testid*="message"], div, p'));
  for (let i = allDivs.length - 1; i >= 0; i--) {
    if (!isInsideChatDialogue(allDivs[i])) continue;
    const t = (allDivs[i].innerText || '').trim();
    if (isPricingFormat(t)) {
      latestPricingText = t;
      break;
    }
  }

  return {
    candidates: candidates,
    pricingText: latestPricingText
  };
}

// 供獨立視窗直接注入 LINE 頁面執行「＋ 新增標籤」
async function addLineOfficialTagInPage(tag) {
  if (!tag) return { success: false, message: '⚠️ 請先輸入取貨日期標籤' };

  const isVisibleOnScreen = (el) => {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root') || el.closest('#wuyi-helper-root')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {}
    return el.offsetParent !== null;
  };

  // 檢查右側顧客資訊欄中是否已存在日期標籤 (例如 4 碼數字 1010 等)
  // 依需求允許新增多個日期標籤 (如第二個、第三個日期)

  const triggerRealClick = (el) => {
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
  };

  const findTagInput = (beforeInputs) => {
    const allInputs = Array.from(document.querySelectorAll('input, [contenteditable="true"]'))
      .filter(inp => {
        if (!isVisibleOnScreen(inp)) return false;
        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(type)) return false;
        return true;
      });

    const newlyAppeared = allInputs.find(inp => !beforeInputs.has(inp));
    if (newlyAppeared) return newlyAppeared;

    if (document.activeElement && allInputs.includes(document.activeElement)) {
      const inLeftList = document.activeElement.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
      if (!inLeftList) return document.activeElement;
    }

    return allInputs.find(inp => {
      const inLeftList = inp.closest('[class*="chat-list"], [class*="chatList"], [class*="room-list"], nav');
      if (inLeftList) return false;
      const ph = (inp.placeholder || inp.getAttribute('aria-label') || '').toLowerCase();
      if (ph.includes('標籤') || ph.includes('tag')) return true;
      return Boolean(inp.closest('[role="dialog"], [class*="modal"], [class*="popover"], [class*="dropdown"], [class*="tag"], aside, [class*="drawer"], [class*="profile"]'));
    }) || null;
  };

  const beforeInputs = new Set(
    Array.from(document.querySelectorAll('input, [contenteditable="true"]')).filter(isVisibleOnScreen)
  );

  const all = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!isVisibleOnScreen(el)) return false;
    if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
    const t = (el.textContent || '').replace(/\s+/g, '');
    return t === '新增標籤' || t === '+新增標籤' || t === '＋新增標籤';
  });

  let addTagBtn = null;
  let deepest = null;

  if (all.length > 0) {
    all.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    deepest = all[0];
    addTagBtn = deepest.closest('button, a, [role="button"]') || deepest;
    triggerRealClick(addTagBtn);
    if (addTagBtn !== deepest) triggerRealClick(deepest);
  }

  let input = null;
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 100));
    input = findTagInput(beforeInputs);
    if (input) break;
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

  if (input) {
    input.focus();
    if (typeof input.select === 'function') input.select();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, tag);
    else input.value = tag;

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, tag);
    } catch (e) {}

    if (input.value !== tag) {
      if (nativeSetter) nativeSetter.call(input, tag);
      else input.value = tag;
    }

    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tag }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: tag.slice(-1), bubbles: true }));
  }

  await new Promise(r => setTimeout(r, 250));

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
    if (checkbox && !checkbox.checked) triggerRealClick(checkbox);
    else triggerRealClick(optTarget);
  }

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

  return {
    success: true,
    message: `🏷️ 已成功為此客戶新增 LINE 標籤：${tag}！`
  };
}

// 供獨立視窗直接注入 LINE 頁面執行「📝 ＋ 新增記事本」
async function addLineOfficialNoteInPage(noteText) {
  if (!noteText) return { success: false, message: '⚠️ 無訂單內容可新增' };

  let safeText = noteText.trim();
  if (safeText.length > 298) safeText = safeText.substring(0, 298);

  const isVisibleOnScreen = (el) => {
    if (!el) return false;
    if (el.closest('#wuyi-order-helper-root') || el.closest('#wuyi-helper-root')) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {}
    return el.offsetParent !== null;
  };

  const triggerRealClick = (el) => {
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
  };

  const findNoteModalTextarea = () => {
    const allTextareas = Array.from(document.querySelectorAll('textarea')).filter(isVisibleOnScreen);
    if (allTextareas.length === 0) return null;

    const exactMatch = allTextareas.find(t => {
      const ph = t.placeholder || '';
      return ph.includes('相關資訊') || ph.includes('不會向對方公開') || ph.includes('記事本中的資訊') || ph.includes('記事本');
    });
    if (exactMatch) return exactMatch;

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

    const inDialog = allTextareas.find(t => {
      if (t.closest('[class*="chat-room"], [class*="chat-footer"], [class*="message-input"], [class*="editor"]')) return false;
      return Boolean(t.closest('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'));
    });
    return inDialog || null;
  };

  const findLineAddNotePlusButton = () => {
    const noteTitleEls = Array.from(document.querySelectorAll('*')).filter(el => {
      if (!isVisibleOnScreen(el)) return false;
      if (el.closest('[class*="bubble"], [class*="Bubble"], [class*="message-text"], [data-testid*="message"]')) return false;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return (t === '記事本' || /^記事本\s*\d+\s*\/\s*\d+/.test(t)) && !t.includes('記錄與用戶') && !t.includes('負責人員') && t.length <= 30;
    });

    noteTitleEls.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

    const isInGrayInfoBox = (el) => {
      const cls = (el.className || '').toString().toLowerCase();
      if (cls.includes('info')) return true;
      let p = el;
      for (let d = 0; d < 3 && p && p !== document.body; d++) {
        const pt = (p.textContent || '').trim();
        if (pt.includes('記錄與用戶') || pt.includes('不會看見記事本')) {
          if (!pt.includes('記事本 0/') && !/記事本\s*\d+\s*\/\s*\d+/.test(pt)) return true;
        }
        p = p.parentElement;
      }
      return false;
    };

    const isOnSameHeaderLine = (el, labelRect) => {
      if (!labelRect || labelRect.height === 0 || labelRect.width === 0) return true;
      const r = el.getBoundingClientRect();
      if (r.height === 0 && r.width === 0) return true;
      const labelCy = labelRect.top + labelRect.height / 2;
      const elCy = r.top + r.height / 2;
      return Math.abs(elCy - labelCy) <= 30 && r.left >= labelRect.left;
    };

    for (const labelEl of noteTitleEls) {
      const labelRect = labelEl.getBoundingClientRect();
      let headerRow = labelEl;

      for (let depth = 0; depth < 5 && headerRow && headerRow !== document.body; depth++) {
        const rowText = headerRow.textContent || '';
        if (rowText.includes('負責人員') || rowText.includes('新增標籤')) break;

        const explicitBtns = Array.from(headerRow.querySelectorAll('button, a, [role="button"]')).filter(b => {
          if (!isVisibleOnScreen(b) || isInGrayInfoBox(b)) return false;
          const bt = (b.textContent || '').trim();
          return !bt.includes('記事本') && !bt.includes('記錄與用戶') && isOnSameHeaderLine(b, labelRect);
        });
        if (explicitBtns.length > 0) return explicitBtns[0];

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
          if ((tag === 'svg' || tag === 'i') && b.getBoundingClientRect().height <= 40) return true;
          return false;
        });

        if (iconCandidates.length > 0) {
          const icon = iconCandidates[0];
          return icon.closest('button, a, [role="button"]') || icon.parentElement || icon;
        }

        headerRow = headerRow.parentElement;
      }

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
  };

  let modalTextarea = findNoteModalTextarea();

  if (!modalTextarea) {
    const plusBtn = findLineAddNotePlusButton();
    if (plusBtn) {
      triggerRealClick(plusBtn);
      const innerIcon = plusBtn.querySelector('button, a, i, svg, span');
      if (innerIcon && innerIcon !== plusBtn) triggerRealClick(innerIcon);
    }

    for (let i = 0; i < 22; i++) {
      await new Promise(r => setTimeout(r, 100));
      modalTextarea = findNoteModalTextarea();
      if (modalTextarea) break;
      if (i === 2 && plusBtn && plusBtn.parentElement && !plusBtn.parentElement.closest('#wuyi-helper-root')) {
        triggerRealClick(plusBtn.parentElement);
      }
    }
  }

  if (modalTextarea) {
    modalTextarea.focus();
    if (typeof modalTextarea.select === 'function') modalTextarea.select();

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(modalTextarea, safeText);
    else modalTextarea.value = safeText;

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, safeText);
    } catch (e) {}

    if (modalTextarea.value !== safeText) {
      if (nativeSetter) nativeSetter.call(modalTextarea, safeText);
      else modalTextarea.value = safeText;
    }

    modalTextarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: safeText }));
    modalTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    modalTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    modalTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: safeText.slice(-1), bubbles: true }));

    return {
      success: true,
      message: '📝 已自動開啟並將內容填入「＋ 新增記事本」！請確認後點擊儲存'
    };
  }

  return {
    success: false,
    message: '📋 內容已複製至剪貼簿！(未偵測到記事本彈窗，請點選 LINE 記事本 ＋ 貼上)'
  };
}

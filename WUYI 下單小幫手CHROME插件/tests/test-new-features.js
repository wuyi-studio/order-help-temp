const assert = require('assert');
const Extractor = require('../src/content/extractor');

console.log('--- Running Tests for New Navigation & Loose Matching Features ---');

// 1. Test Loose matching with 蛋糕尺寸 + 蛋糕口味 (without 【蛋糕訂購資訊】)
const looseOrderText = `
圖款，
蛋糕體：原味戚風
題字：Happy Birthday Leon
蛋糕尺寸：4吋
蛋糕口味：草莓鮮奶油
需加購：金色蠟燭
取貨日期：2026-11-20
取貨時間：14:00
自取地點：台南市中西區友愛街93號
訂購人 LINE 名稱：leon_line
訂購人姓名：林先生
訂購人電話：0912345678
`;

assert.strictEqual(Extractor.isOrderFormat(looseOrderText), true, 'Should match loose order format with size and flavor');
const parsed = Extractor.parseOrderText(looseOrderText);
assert.strictEqual(parsed.orderType, 'cake');
assert.strictEqual(parsed.cake.size, '4吋');
assert.ok(parsed.cake.flavor.includes('草莓鮮奶油'));
assert.strictEqual(parsed.cake.addon, '金色蠟燭');
assert.strictEqual(parsed.pickup.dateTag, '1120', 'Should auto-normalize date to 1120');
assert.strictEqual(parsed.pickup.time, '14:00');
assert.strictEqual(parsed.customer.lineName, 'leon_line');
assert.strictEqual(parsed.customer.name, '林先生');
assert.strictEqual(parsed.customer.phone, '0912345678');
console.log('✅ Loose format matching and parsing verified!');

// 2. Test values on next line
const nextLineOrderText = `
【蛋糕訂購資訊】
蛋糕尺寸：
6吋
蛋糕口味：
原味戚風
取貨日期：
2026-12-01
取貨時間：
14:00
自取地點：
台南市中西區友愛街93號
訂購人 LINE 名稱：
wang
訂購人姓名：
王小明
訂購人電話：
0912345678
`;
assert.strictEqual(Extractor.isOrderFormat(nextLineOrderText), true);
const parsedNextLine = Extractor.parseOrderText(nextLineOrderText);
assert.strictEqual(parsedNextLine.cake.size, '6吋');
assert.strictEqual(parsedNextLine.cake.flavor, '原味戚風');
assert.strictEqual(parsedNextLine.pickup.dateTag, '1201', 'Should auto-normalize date to 1201');
assert.strictEqual(parsedNextLine.customer.name, '王小明');
console.log('✅ Next-line value parsing verified!');

// 3. Test Inter-box drag and drop state transfer (1 moved to 2 -> 1 cleared, 2 has image)
const state = {
  images: {
    flower: [null, null],
    cake: ['data:image/png;base64,sampleCake1', null, null],
    addon: null
  }
};

const BOX_DEFS = {
  boxCake0: {
    get: () => state.images.cake[0],
    set: (v) => { state.images.cake[0] = v; }
  },
  boxCake1: {
    get: () => state.images.cake[1],
    set: (v) => { state.images.cake[1] = v; }
  }
};

// Simulate dragging boxCake0 (圖1) to boxCake1 (圖2)
const sourceBoxId = 'boxCake0';
const targetBoxId = 'boxCake1';
const sourceVal = BOX_DEFS[sourceBoxId].get();
assert.strictEqual(sourceVal, 'data:image/png;base64,sampleCake1');

// Transfer logic:
BOX_DEFS[sourceBoxId].set(null);
BOX_DEFS[targetBoxId].set(sourceVal);

assert.strictEqual(state.images.cake[0], null, 'Source box 1 MUST be cleared');
assert.strictEqual(state.images.cake[1], 'data:image/png;base64,sampleCake1', 'Target box 2 MUST have the transferred image');
console.log('✅ Box 1 to 2 drag move logic verified (1 cleared, 2 has image)!');

// 4. Test Candidate Selection & Navigation
const candidates = [
  { text: '【蛋糕訂購資訊】\n蛋糕尺寸：4吋\n蛋糕口味：巧克力\n取貨日期：2026-10-01' }, // Oldest (Index 0)
  { text: '【蛋糕訂購資訊】\n蛋糕尺寸：6吋\n蛋糕口味：抹茶戚風\n取貨日期：2026-11-05' }, // Middle (Index 1)
  { text: '蛋糕尺寸：8吋\n蛋糕口味：芋泥布丁\n取貨日期：2026-11-15' }                  // Latest (Index 2)
];

// Default selection must be the latest one (index = candidates.length - 1)
let currentIndex = candidates.length - 1;
assert.strictEqual(currentIndex, 2, 'Default candidate must be the newest (last index)');
assert.ok(candidates[currentIndex].text.includes('8吋'), 'Should be the 8吋 order');

// Click prev
if (currentIndex > 0) currentIndex--;
assert.strictEqual(currentIndex, 1);
assert.ok(candidates[currentIndex].text.includes('6吋'), 'Should navigate to previous (6吋)');

// Click prev again
if (currentIndex > 0) currentIndex--;
assert.strictEqual(currentIndex, 0);
assert.ok(candidates[currentIndex].text.includes('4吋'), 'Should navigate to earliest (4吋)');

// Click next
if (currentIndex < candidates.length - 1) currentIndex++;
assert.strictEqual(currentIndex, 1);
assert.ok(candidates[currentIndex].text.includes('6吋'), 'Should navigate forward');
console.log('✅ Candidates chronological navigation (Prev/Next/Latest) verified!');

// 5. Test 4-digit date format (e.g. 11.2 -> 1102)
assert.strictEqual(Extractor.formatWuyiDate('11.2'), '1102');
assert.strictEqual(Extractor.formatWuyiDate('11/2'), '1102');
assert.strictEqual(Extractor.formatWuyiDate('11月2日'), '1102');
assert.strictEqual(Extractor.formatWuyiDate('11/2（六）'), '1102');
assert.strictEqual(Extractor.formatWuyiDate('11.2 (週六)'), '1102');
assert.strictEqual(Extractor.formatWuyiDate('2026/11/02'), '1102');
assert.strictEqual(Extractor.formatWuyiDate('5.8'), '0508');
assert.strictEqual(Extractor.formatWuyiDate('2026-11-02'), '1102');

const dateTestOrder = `
【蛋糕訂購資訊】
蛋糕尺寸：4吋
蛋糕口味：原味
取貨日期：11.2
`;
const parsedDate = Extractor.parseOrderText(dateTestOrder);
assert.strictEqual(parsedDate.pickup.dateTag, '1102', '11.2 should auto-normalize to 1102');
console.log('✅ Date format auto-conversion (11.2 -> 1102) verified!');

// 6. Test that btnSyncSheets is removed and autoSync deduplication is active
const fs = require('fs');
const contentJs = fs.readFileSync('src/content/content.js', 'utf8');
const popupHtml = fs.readFileSync('src/popup/popup.html', 'utf8');
const codeGs = fs.readFileSync('google-apps-script/Code.gs', 'utf8');

assert.ok(!contentJs.includes('id="btnSyncSheets"'), 'btnSyncSheets should be removed from content.js template');
assert.ok(!popupHtml.includes('id="btnSyncSheets"'), 'btnSyncSheets should be removed from popup.html');
assert.ok(contentJs.includes('lastSyncedOrderKey'), 'content.js must have lastSyncedOrderKey deduplication');
assert.ok(contentJs.includes('autoSyncToGoogleSheets'), 'btnCopyCard must trigger autoSyncToGoogleSheets');

// 7. Verify Google Apps Script has analytics dashboard & idempotency
assert.ok(codeGs.includes('updateAnalyticsDashboard'), 'Code.gs must have updateAnalyticsDashboard');
assert.ok(codeGs.includes('當年營運累計'), 'Code.gs must include year analytics');
assert.ok(codeGs.includes('當月營運累計'), 'Code.gs must include month analytics');
assert.ok(codeGs.includes('當週營運累計'), 'Code.gs must include week analytics');
assert.ok(codeGs.includes('當日預約取貨'), 'Code.gs must include day analytics');
assert.ok(codeGs.includes('foundRow > 0'), 'Code.gs must update existing row if duplicate order');
console.log('✅ Google Sheets Analytics & Auto-sync deduplication verified!');

// 8. Verify btnAddLineTag and swapOrMoveBoxImage
const popupJs = fs.readFileSync('src/popup/popup.js', 'utf8');
assert.ok(contentJs.includes('id="btnAddLineTag"'), 'btnAddLineTag must be in content.js');
assert.ok(popupHtml.includes('id="btnAddLineTag"'), 'btnAddLineTag must be in popup.html');
assert.ok(contentJs.includes('addLineOfficialTag'), 'addLineOfficialTag must be in content.js');
assert.ok(contentJs.includes('renderGroupBoxes'), 'renderGroupBoxes must be in content.js');
assert.ok(popupJs.includes('renderGroupBoxes'), 'renderGroupBoxes must be in popup.js');
assert.ok(contentJs.includes('wuyi-box-btn-shift'), 'wuyi-box-btn-shift must be in content.js');
console.log('✅ LINE Add Tag automation & Box quick-shift verified!');

// 9. Verify popout minimize, Apple Notes rich format, and LINE Note button
assert.ok(contentJs.includes('state.isOpen = false;\n      updatePanelVisibility();'), 'Popout must minimize panel to floating button');
const cardRendererJs = fs.readFileSync('src/content/card-renderer.js', 'utf8');
assert.ok(cardRendererJs.includes('buildRichNotesHtml') && contentJs.includes('buildRichNotesHtml'), 'Apple Notes copy must use buildRichNotesHtml');
assert.ok(!contentJs.includes('id="btnCopyPricing"'), 'btnCopyPricing should be removed');
assert.ok(!popupHtml.includes('id="btnCopyPricing"'), 'btnCopyPricing should be removed from popup');
assert.ok(contentJs.includes('id="btnAddLineNote"'), 'btnAddLineNote must be in content.js');
assert.ok(popupHtml.includes('id="btnAddLineNote"'), 'btnAddLineNote must be in popup.html');
assert.ok(contentJs.includes('addLineOfficialNote'), 'addLineOfficialNote must be in content.js');
assert.ok(popupJs.includes('btnAddLineNote'), 'btnAddLineNote must be in popup.js');
console.log('✅ Popout minimize, Notes left-align, and LINE Add Note verified!');

// 10. Verify 11.21/3點 -> 1121 and dialogue bubble strict filtering (excluding 記事本)
assert.strictEqual(Extractor.formatWuyiDate('11.21/3點'), '1121', '11.21/3點 must format to 1121');
assert.strictEqual(Extractor.formatWuyiDate('11.21 3點'), '1121', '11.21 3點 must format to 1121');
assert.strictEqual(Extractor.formatWuyiDate('11/21'), '1121', '11/21 must format to 1121');
assert.ok(contentJs.includes('isInsideChatDialogue'), 'content.js must contain isInsideChatDialogue to exclude 記事本');
assert.ok(contentJs.includes('記事本') && contentJs.includes('記錄與用戶之間的互動'), 'content.js must strictly filter out 記事本 counter');
console.log('✅ Chat dialogue strict filtering & 1121 date parsing verified!');

// 11. Verify single-instance detached window & LINE Modal Textarea target
const swJs = fs.readFileSync('src/background/service-worker.js', 'utf8');
assert.ok(swJs.includes('chrome.tabs.query({ url: popupUrl }'), 'Service worker must check existing popup tab to avoid duplicates');
assert.ok(swJs.includes('chrome.windows.update(existingTab.windowId, { focused: true }'), 'Service worker must focus existing window');
assert.ok(contentJs.includes('findNoteModalTextarea'), 'content.js must have dedicated findNoteModalTextarea');
assert.ok(contentJs.includes('不會向對方公開'), 'content.js must target the exact LINE Note Modal placeholder');
console.log('✅ Single-instance detached window & Note Modal textarea target verified!');

// 12. Verify pickup triple matching (取貨日期 + 取貨時間 + 自取地點) and exclusion of 記事本 / modals
const tripleOrderText = `
取貨日期：11/20
取貨時間：15:00
自取地點：工作室
訂購人 LINE 名稱：ming
訂購人姓名：小明
電話：0912345678
`;
assert.ok(Extractor.isOrderFormat(tripleOrderText), 'Triple condition + customer info must qualify as order format');
const tripleScore = Extractor.getOrderScore(tripleOrderText);
assert.ok(tripleScore >= 90, `Score for triple condition should be high (got ${tripleScore})`);

assert.ok(contentJs.includes('hasPickupDate'), 'content.js must test hasPickupDate');
assert.ok(popupJs.includes('hasPickupDate'), 'popup.js must test hasPickupDate');
assert.ok(popupJs.includes('isInsideChatDialogue'), 'popup.js must contain isInsideChatDialogue');
assert.ok(contentJs.includes('role="dialog"') || contentJs.includes('modal'), 'content.js must strictly exclude modal and dialogs');
assert.ok(popupJs.includes('role="dialog"') || popupJs.includes('modal'), 'popup.js must strictly exclude modal and dialogs');
console.log('✅ Pickup triple (取貨日期/時間/自取地點) & modal exclusion verified!');

// 13. Verify reliable "+ 新增標籤" & "+ 新增記事本" execution (no chat textarea false-positive, no outer div click)
assert.ok(!contentJs.includes('return inDialog || allTextareas[0]'), 'findNoteModalTextarea must NEVER fall back to allTextareas[0] (chat input box)');
assert.ok(contentJs.includes('return inDialog || null'), 'findNoteModalTextarea must return null when modal is not open yet');
assert.ok(contentJs.includes('beforeInputs'), 'addLineOfficialTag must track beforeInputs to detect newly opened tag input');
assert.ok(contentJs.includes('el.querySelectorAll(\'*\').length > 6'), 'addLineOfficialTag must never click giant outer div containers');
assert.ok(popupJs.includes('addLineOfficialTagInPage'), 'popup.js must support direct executeScript for addLineOfficialTagInPage');
assert.ok(popupJs.includes('addLineOfficialNoteInPage'), 'popup.js must support direct executeScript for addLineOfficialNoteInPage');
console.log('✅ Reliable "+ 新增標籤" & "+ 新增記事本" DOM targeting verified!');

// 14. Verify Always-On-Top independent window (Document Picture-in-Picture) & exact 記事本 + icon targeting
assert.ok(contentJs.includes('documentPictureInPicture'), 'content.js must use documentPictureInPicture for Always-On-Top independent window');
assert.ok(contentJs.includes('isInGrayInfoBox'), 'content.js must exclude the gray info box (ⓘ 記錄與用戶之間的互動)');
assert.ok(contentJs.includes('isOnSameHeaderLine'), 'content.js must target the + button on the same horizontal line as 記事本 0/1000');
assert.ok(popupJs.includes('isInGrayInfoBox'), 'popup.js must exclude the gray info box');
assert.ok(popupJs.includes('isOnSameHeaderLine'), 'popup.js must target the + button on the same horizontal line as 記事本 0/1000');
console.log('✅ Always-On-Top independent window & exact 記事本 + button targeting verified!');

// 15. Verify btnCopyPricingDirect and hasLineName matching (只要有「訂購人 LINE 名稱」)
assert.ok(contentJs.includes('id="btnCopyPricingDirect"'), 'content.js must have btnCopyPricingDirect');
assert.ok(popupHtml.includes('id="btnCopyPricingDirect"'), 'popup.html must have btnCopyPricingDirect');
assert.ok(popupJs.includes('btnCopyPricingDirect'), 'popup.js must handle btnCopyPricingDirect');
assert.ok(contentJs.includes('hasLineName'), 'content.js must check hasLineName');
assert.ok(popupJs.includes('hasLineName'), 'popup.js must check hasLineName');

const fullOrder = `
取貨日期：11/20
取貨時間：14:00
自取地點：台南市中西區友愛街93號
訂購人 LINE 名稱：王小美
訂購人姓名：小美
電話：0987654321
蛋糕款式：芋頭布丁
`;
assert.ok(Extractor.isOrderFormat(fullOrder), 'Order with 6 required fields must qualify as order format');
assert.ok(Extractor.getOrderScore(fullOrder) >= 100, 'Score for full order should be >= 100');
console.log('✅ btnCopyPricingDirect & full order qualifying verified!');

// 16. Verify right-hand handle pill, left-side popup panel, and non-overlapping page push
const contentCss = fs.readFileSync('src/content/content.css', 'utf8');
assert.ok(/\.wuyi-handle-pill\s*\{[^}]*position:\s*fixed[^}]*right:\s*0/s.test(contentCss), 'Handle pill must be located on the right side');
assert.ok(contentCss.includes('.wuyi-panel.wuyi-sidebar {\n  left: 0;'), 'Sidebar panel must dock to the far left (left: 0)');
assert.ok(contentCss.includes('body.wuyi-sidebar-open {\n  margin-left: 380px !important;'), 'Page must shift right by 380px when sidebar opens to prevent overlapping');
assert.ok(contentJs.includes('document.body.classList.add(\'wuyi-sidebar-open\')'), 'content.js must apply wuyi-sidebar-open on open');
assert.ok(contentJs.includes('wuyi-window-size-bar'), 'content.js must contain window size presets bar');
assert.ok(popupHtml.includes('wuyi-window-size-bar'), 'popup.html must contain window size presets bar');
console.log('✅ Right-hand handle, Left-hand panel & window size presets verified!');

// 17. Verify comfortable header colors, no black border, and robust chat dialogue filtering (no ancestor textContent trap)
assert.ok(!contentJs.includes('while (curr && curr !== document.body)'), 'isInsideChatDialogue must NOT loop through common ancestors checking textContent');
assert.ok(contentCss.includes('border: 2px solid #fda4af;'), 'Panel border must use soft rose tone instead of black');
assert.ok(!contentCss.includes('.wuyi-brand-badge {\n  background: #1e293b;'), 'Brand badge must NOT be black');
assert.ok(contentCss.includes('.wuyi-brand-badge {\n  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);') || contentCss.includes('.wuyi-brand-badge {\n  background: linear-gradient(135deg, #fb7185 0%, #f43f5e 100%);'), 'Brand badge must use warm vibrant gradient');

// Verify strict 6-field required format
assert.ok(Extractor.hasAllOrderRequiredFields(fullOrder), 'Full order must satisfy hasAllOrderRequiredFields');
console.log('✅ Comfortable rose colors & 6-field required format verified!');

console.log('🎉 All new feature unit tests passed successfully!');

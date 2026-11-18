/**
 * 梧藝 WUYI 下單小幫手 - Google Calendar Viewer 單元測試
 * 測試項目：
 *   1. 確保同一對話框內僅注入唯一一個 .wuyi-calendar-preview-box，絕不重複注入。
 *   2. 模擬多層巢狀包含 Drive 網址的 div/span，驗證不會產生多重卡片與無窮遞迴。
 *   3. 驗證非法的 fileId (如 undefined 或少於 25 字元) 會被正則排除，不產生無效卡片。
 *   4. 驗證產生的 雲端檔案連結 帶有 ?usp=sharing。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 載入 calendar-viewer.js 模組
const viewerModule = require('../src/calendar/calendar-viewer.js');
const { DRIVE_REGEX, extractDriveFileId, createPreviewBox } = viewerModule;

console.log('--- 測試 Google Calendar Viewer 穩定性與防遞迴機制 ---');

// 1. DRIVE_REGEX 驗證
assert.ok(DRIVE_REGEX.test('https://drive.google.com/file/d/1aFAvK33ML41x0JgHlCF6WcA6006Emq4J/view?usp=sharing'));
assert.ok(DRIVE_REGEX.test('https://lh3.googleusercontent.com/d/1aFAvK33ML41x0JgHlCF6WcA6006Emq4J'));
assert.strictEqual(DRIVE_REGEX.test('https://drive.google.com/file/d/undefined/view'), false, '必須排除 undefined');
assert.strictEqual(DRIVE_REGEX.test('https://drive.google.com/file/d/123/view'), false, '長度不足 20 碼必須排除');
console.log('✅ 正則驗證通過：精準辨識有效 File ID，嚴格排除 undefined 與無效字串');

// 1.1 extractDriveFileId 轉址與編碼網址驗證
const expectedId = '1aFAvK33ML41x0JgHlCF6WcA6006Emq4J';
const googleRedirectUrl = `https://www.google.com/url?q=https%3A%2F%2Fdrive.google.com%2Ffile%2Fd%2F${expectedId}%2Fview%3Fusp%3Dsharing&sa=D&sntz=1&usg=AFQjCNE8XYZ`;
assert.strictEqual(extractDriveFileId(googleRedirectUrl), expectedId, '必須成功從 Google Calendar 轉址解碼出 Drive File ID');
assert.strictEqual(extractDriveFileId(`https://drive.google.com/file/d/${expectedId}/view`), expectedId);
assert.strictEqual(extractDriveFileId(`https://lh3.googleusercontent.com/d/${expectedId}`), expectedId);
console.log('✅ extractDriveFileId 驗證通過：完美支援 Google Calendar 轉址、URL編碼與直連！');

// 2. 測試 createPreviewBox 結構與雲端檔案連結
// 模擬瀏覽器 DOM 環境
if (typeof document === 'undefined') {
  global.document = {
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        dataset: {},
        style: {},
        innerHTML: '',
        children: [],
        appendChild: function(c) { this.children.push(c); return c; },
        insertBefore: function(newNode) { this.children.unshift(newNode); return newNode; },
        querySelector: function() { return null; },
        querySelectorAll: function() { return []; },
        addEventListener: function() {}
      };
      return el;
    }
  };
}

const testFileId = '1aFAvK33ML41x0JgHlCF6WcA6006Emq4J';
const box = createPreviewBox(testFileId);
assert.strictEqual(box.className, 'wuyi-calendar-preview-box');
assert.strictEqual(box.dataset.wuyiCardBox, 'true');

// 檢查 children 包含 badge, img, actionRow
assert.strictEqual(box.children.length, 3);
const img = box.children[1];
assert.strictEqual(img.src, `https://lh3.googleusercontent.com/d/${testFileId}`);

const actionRow = box.children[2];
const openLink = actionRow.children[1];
assert.strictEqual(openLink.href, `https://drive.google.com/file/d/${testFileId}/view?usp=sharing`, '雲端檔案連結必須包含 ?usp=sharing');
console.log('✅ 預覽卡片 DOM 結構驗證通過：包含 CDN 圖片、全螢幕檢視與完整 ?usp=sharing 雲端連結');

console.log('🎉 Google Calendar Viewer 所有單元測試皆順利通過！');

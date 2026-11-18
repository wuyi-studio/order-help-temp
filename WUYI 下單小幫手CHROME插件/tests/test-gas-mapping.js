const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('--- Running Google Apps Script & 20-Field Mapping Tests ---');

  const gasScriptPath = path.resolve(__dirname, '../google-apps-script/Code.gs');
  const optionsHtmlPath = path.resolve(__dirname, '../src/options/options.html');
  const optionsJsPath = path.resolve(__dirname, '../src/options/options.js');

  assert.ok(fs.existsSync(gasScriptPath), 'google-apps-script/Code.gs must exist');
  assert.ok(fs.existsSync(optionsHtmlPath), 'src/options/options.html must exist');
  assert.ok(fs.existsSync(optionsJsPath), 'src/options/options.js must exist');

  const gasCode = fs.readFileSync(gasScriptPath, 'utf-8');

  // Verify 20 standard headers in GAS
  const required20Headers = [
    '取貨日期', '星期', '顧客姓名', '聯絡電話', 'LINE名稱',
    '商品類別', '蛋糕規格', '花束規格', '訂單總額', '蛋糕口味說明',
    '蛋糕題字/插牌內容', '慶祝歲數', '加購保冰袋', '加購餐具', '加購蠟燭',
    '加購插牌', '花束色系', '取件時間', '取件地點/配送', '原始備忘錄檔案'
  ];

  for (const h of required20Headers) {
    assert.ok(gasCode.includes(h), `GAS must support header: ${h}`);
  }

  // Verify Upsert / de-duplication logic in GAS
  assert.ok(gasCode.includes('doPost'), 'GAS must implement doPost');
  assert.ok(gasCode.includes('getSheetByName'), 'GAS must target sheet by Year-Month');
  assert.ok(gasCode.includes('update') || gasCode.includes('setValues') || gasCode.includes('foundRow'), 'GAS must support row update (Upsert)');

  // Verify Options page saves to chrome.storage
  const optionsJs = fs.readFileSync(optionsJsPath, 'utf-8');
  assert.ok(optionsJs.includes('chrome.storage') || optionsJs.includes('googleSheetsWebhookUrl'), 'options.js must manage googleSheetsWebhookUrl');

  console.log('✅ Google Apps Script & 20-Field Mapping tests passed successfully!');
}

runTests();

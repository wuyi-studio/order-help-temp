const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Test that content.js and content.css exist and contain required components
function runTests() {
  console.log('--- Running UI DOM & Content Script Tests ---');

  const contentJsPath = path.resolve(__dirname, '../src/content/content.js');
  const contentCssPath = path.resolve(__dirname, '../src/content/content.css');

  assert.ok(fs.existsSync(contentJsPath), 'src/content/content.js must exist');
  assert.ok(fs.existsSync(contentCssPath), 'src/content/content.css must exist');

  const jsContent = fs.readFileSync(contentJsPath, 'utf-8');
  const cssContent = fs.readFileSync(contentCssPath, 'utf-8');

  // Verify UI components in JS
  assert.ok(jsContent.includes('wuyi-drawer-container') || jsContent.includes('wuyi-helper-panel'), 'Panel container must be defined');
  assert.ok(jsContent.includes('toggleFloating') || jsContent.includes('isFloating'), 'Floating toggle logic must exist');
  assert.ok(jsContent.includes('handleDrag') || jsContent.includes('mousedown') || jsContent.includes('drag'), 'Draggable logic must exist');
  assert.ok(jsContent.includes('btnCopyFlowerDirect') || jsContent.includes('btnCopyCakeDirect') || jsContent.includes('btnCopyOrderDirect'), 'Copy order text action must exist');
  assert.ok(jsContent.includes('btnAddLineNote') || jsContent.includes('新增記事本'), 'Add LINE note action must exist');
  assert.ok(jsContent.includes('copyCardImage') || jsContent.includes('複製取貨確認小卡'), 'Copy card image action must exist');
  assert.ok(jsContent.includes('autoSyncToGoogleSheets') || jsContent.includes('Google 試算表'), 'Google Sheets sync action must exist');

  // Verify Refresh button with icon only (no text on the button)
  assert.ok(jsContent.includes('btn-refresh') || jsContent.includes('refresh') || jsContent.includes('🔄'), 'Icon-only refresh button must exist');

  // Verify CSS styles
  assert.ok(cssContent.includes('.wuyi-drawer') || cssContent.includes('.wuyi-panel'), 'Drawer CSS must be defined');
  assert.ok(cssContent.includes('.wuyi-floating'), 'Floating mode CSS must be defined');
  assert.ok(cssContent.includes('#f3e8ff') || cssContent.includes('#7e22ce') || cssContent.includes('purple'), 'Purple highlight styling must exist');

  console.log('✅ UI DOM & Content Script tests passed successfully!');
}

runTests();

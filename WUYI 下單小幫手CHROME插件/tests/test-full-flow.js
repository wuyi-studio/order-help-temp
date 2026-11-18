const assert = require('assert');
const path = require('path');

const Extractor = require('../src/content/extractor.js');
const CardRenderer = require('../src/content/card-renderer.js');

function createMockCanvas() {
  const operations = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    measureText: (text) => ({ width: (text || '').length * 14 }),
    fillRect: function(x, y, w, h) { operations.push({ op: 'fillRect', x, y, w, h, fillStyle: this.fillStyle }); },
    strokeRect: function(x, y, w, h) { operations.push({ op: 'strokeRect', x, y, w, h, strokeStyle: this.strokeStyle }); },
    fillText: function(text, x, y) { operations.push({ op: 'fillText', text, x, y, fillStyle: this.fillStyle }); },
    drawImage: function(img, ...args) { operations.push({ op: 'drawImage', img, args }); },
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    roundRect: function(x, y, w, h, r) { operations.push({ op: 'roundRect', x, y, w, h, r, fillStyle: this.fillStyle }); },
    save: () => {},
    restore: () => {},
    scale: () => {}
  };

  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb) => cb({ size: 1024, type: 'image/png' }),
    toDataURL: () => 'data:image/png;base64,mock',
    _operations: operations
  };
}

async function runEndToEndVerification() {
  console.log('=== [E2E] Running Full End-to-End Workflow Verification ===');

  // Step 1: Simulate Customer Order in LINE OA
  const customerRawMessage = `圖款
盤子題字：1112

蛋糕尺寸：4吋
蛋糕口味：原味戚風＋藍莓果醬&藍莓＋豆乳奶凍＋原味奶油

加購：5人餐具、扭曲蠟燭（銀）

取貨日期：2026-11-12
取貨時間：18:00
自取地點：台南市中西區友愛街９３號

訂購人 LINE 名稱：郭寶
訂購人姓名：郭惠菁
訂購人電話：0989562189`;

  const csReplyMessage = `您好呀～
幫您加總一下

蛋糕$790
2人餐具$15
蠟燭x2$90
總共$895

您再麻煩確認一下對不對喔
謝謝您`;

  // Step 2: Extractor parses text
  console.log('1. Verifying Extractor Parsing...');
  const orderState = Extractor.parseOrderText(customerRawMessage);
  const pricingState = Extractor.parsePricingText(csReplyMessage);

  assert.strictEqual(orderState.orderType, 'cake');
  assert.strictEqual(orderState.customer.name, '郭惠菁');
  assert.strictEqual(orderState.customer.phone, '0989562189');
  assert.strictEqual(orderState.cake.size, '4吋');
  assert.strictEqual(orderState.cake.addon, '5人餐具、扭曲蠟燭（銀）');
  assert.strictEqual(pricingState.total, 895);
  assert.strictEqual(pricingState.breakdownText, '蛋糕$790\n2人餐具$15\n蠟燭x2$90\n總共$895');

  // Step 3: Apple Notes format verification
  console.log('2. Verifying Apple Notes Format Retention...');
  const appleNotesText = Extractor.formatRawOrder(orderState);
  assert.ok(appleNotesText.includes('盤子題字：1112'));
  assert.ok(appleNotesText.includes('加購：5人餐具、扭曲蠟燭（銀）'));
  assert.ok(appleNotesText.includes('自取地點：台南市中西區友愛街９３號'));

  // Step 4: Canvas Card Generation Verification
  console.log('3. Verifying Canvas Card Synthesis (Zero-price policy & purple addon)...');
  const canvas = createMockCanvas();
  await CardRenderer.renderCard(orderState, {
    canvas,
    cakeImage: 'data:image/png;base64,mockCake',
    addonImage: 'data:image/png;base64,mockAddon'
  });

  const texts = canvas._operations.filter(op => op.op === 'fillText').map(op => op.text);
  assert.ok(texts.some(t => t.includes('郭惠菁')));
  assert.ok(texts.some(t => t.includes('5人餐具、扭曲蠟燭（銀）')));

  // Check no price leaks
  const combinedCardText = texts.join(' ');
  assert.ok(!combinedCardText.includes('$'), 'Customer card must not contain price symbols');
  assert.ok(!combinedCardText.includes('總共'), 'Customer card must not contain totals');

  // Check purple highlight
  const purpleCapsule = canvas._operations.find(op => op.op === 'roundRect' && (op.fillStyle.toLowerCase() === '#fae8ff' || op.fillStyle.toLowerCase() === '#f3e8ff'));
  assert.ok(purpleCapsule, 'Purple highlight capsule must exist for addons');

  console.log('🎉 [E2E] All full flow verifications passed cleanly!');
}

runEndToEndVerification().catch(err => {
  console.error('E2E Verification failed:', err);
  process.exit(1);
});

const assert = require('assert');
const path = require('path');
const Extractor = require('../src/content/extractor');
global.Extractor = Extractor;

// Step 1: Attempt to load CardRenderer
let CardRenderer;
try {
  CardRenderer = require(path.resolve(__dirname, '../src/content/card-renderer.js'));
} catch (e) {
  // Will fail if file does not exist
}

// Mock Canvas & 2D Context for Node.js testing environment
function createMockCanvas() {
  const operations = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    measureText(text) {
      return { width: (text || '').length * 14 };
    },
    fillRect(x, y, w, h) {
      operations.push({ op: 'fillRect', x, y, w, h, fillStyle: this.fillStyle });
    },
    strokeRect(x, y, w, h) {
      operations.push({ op: 'strokeRect', x, y, w, h, strokeStyle: this.strokeStyle });
    },
    fillText(text, x, y) {
      operations.push({ op: 'fillText', text, x, y, font: this.font, fillStyle: this.fillStyle });
    },
    drawImage(img, ...args) {
      operations.push({ op: 'drawImage', img, args });
    },
    beginPath() {},
    closePath() {},
    moveTo(x, y) { operations.push({ op: 'moveTo', x, y }); },
    lineTo(x, y) { operations.push({ op: 'lineTo', x, y }); },
    stroke() {},
    fill() {},
    roundRect(x, y, w, h, r) {
      operations.push({ op: 'roundRect', x, y, w, h, r, fillStyle: this.fillStyle });
    },
    arc() {},
    save() {},
    restore() {},
    scale() {}
  };

  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb) => cb(new Blob ? new Blob() : {}),
    toDataURL: () => 'data:image/png;base64,mock',
    _operations: operations
  };
}

async function runTests() {
  console.log('--- Running CardRenderer Tests ---');

  assert.ok(CardRenderer, 'CardRenderer must be defined and exported');
  assert.strictEqual(typeof CardRenderer.renderCard, 'function', 'renderCard must be a function');
  assert.strictEqual(typeof CardRenderer.copyCardToClipboard, 'function', 'copyCardToClipboard must be a function');
  assert.strictEqual(typeof CardRenderer.downloadCard, 'function', 'downloadCard must be a function');

  // Test Case 1: Pure Cake Order
  console.log('Testing Case 1: Pure Cake Card Layout');
  const cakeOrder = {
    orderType: 'cake',
    cake: {
      style: '圖款',
      inscription: 'Happy Birthday\nRaini',
      size: '4吋',
      flavor: '伯爵戚風＋焦糖核桃＋原味奶油',
      addon: '5人餐具、扭曲蠟燭（銀）'
    },
    pickup: {
      date: '2026-11-12',
      time: '18:00',
      location: '台南市中西區友愛街93號'
    },
    customer: {
      lineName: '郭寶',
      name: '郭惠菁',
      phone: '0989562189'
    }
  };

  const mockCanvas1 = createMockCanvas();
  await CardRenderer.renderCard(cakeOrder, {
    canvas: mockCanvas1,
    cakeImage: 'mock_cake_data_url',
    addonImage: 'mock_addon_data_url'
  });

  assert.strictEqual(mockCanvas1.width, 1160, 'Canvas width must be 1160');
  assert.ok(mockCanvas1.height >= 500, 'Canvas height should be appropriately calculated');

  // Verify operations contain required components
  const texts1 = mockCanvas1._operations.filter(op => op.op === 'fillText').map(op => op.text);
  assert.ok(texts1.some(t => t.includes('郭惠菁')), 'Customer name must be rendered');
  assert.ok(texts1.some(t => t.includes('0989562189')), 'Customer phone must be rendered');
  assert.ok(texts1.some(t => t.includes('友愛街93號')), 'Store location must be rendered');

  // Verify purple add-on highlight operation
  const purpleOp = mockCanvas1._operations.find(op => (op.op === 'roundRect' || op.op === 'fillRect') && (op.fillStyle.toLowerCase() === '#fae8ff' || op.fillStyle.toLowerCase() === '#f3e8ff'));
  assert.ok(purpleOp, 'Purple highlight capsule (#FAE8FF or #F3E8FF) must be drawn for add-on');

  // ABSOLUTE CRITICAL REQUIREMENT: Verify NO price signs or amounts appear on customer card!
  const allRenderedText1 = texts1.join(' ');
  assert.ok(!allRenderedText1.includes('$'), 'CRITICAL: Customer card must NOT contain "$"');
  assert.ok(!allRenderedText1.includes('總共'), 'CRITICAL: Customer card must NOT contain "總共"');
  assert.ok(!allRenderedText1.includes('總計'), 'CRITICAL: Customer card must NOT contain "總計"');

  // Test Case 2: Combined Flower + Cake Order
  console.log('Testing Case 2: Combined Flower + Cake Card Layout');
  const combinedOrder = {
    orderType: 'combined',
    flower: {
      budget: '2000',
      color: '白綠',
      paper: '白',
      note: '許願桔梗'
    },
    cake: {
      style: '圖款',
      inscription: '1112',
      size: '🍔',
      flavor: '原味戚風',
      addon: '保冷袋劑'
    },
    pickup: {
      date: '10/1',
      time: '3-4點',
      location: '台南市中西區友愛街93號'
    },
    customer: {
      lineName: '昀瞳',
      name: '陳昀瞳',
      phone: '0970006535'
    }
  };

  const mockCanvas2 = createMockCanvas();
  await CardRenderer.renderCard(combinedOrder, {
    canvas: mockCanvas2,
    flowerImage: 'mock_flower_url',
    cakeImage: 'mock_cake_url'
  });

  const texts2 = mockCanvas2._operations.filter(op => op.op === 'fillText').map(op => op.text);
  assert.ok(texts2.some(t => t.includes('精緻包裝花束')), 'Flower section header must be rendered');
  assert.ok(texts2.some(t => t.includes('白綠')), 'Flower color must be rendered');
  assert.ok(texts2.some(t => t.includes('許願桔梗')), 'Flower note must be rendered');
  assert.ok(texts2.some(t => t.includes('客製化蛋糕') || t.includes('蛋糕')), 'Cake section must be rendered');

  console.log('✅ All CardRenderer tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

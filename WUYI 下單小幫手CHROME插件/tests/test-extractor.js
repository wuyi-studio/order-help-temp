const assert = require('assert');
const path = require('path');

// Step 1: Attempt to load Extractor
let Extractor;
try {
  Extractor = require(path.resolve(__dirname, '../src/content/extractor.js'));
} catch (e) {
  // If extractor.js does not exist yet, Extractor remains undefined
}

async function runTests() {
  console.log('--- Running Extractor Engine Tests ---');

  // Verify Extractor module is loaded
  assert.ok(Extractor, 'Extractor must be defined and exported');
  assert.strictEqual(typeof Extractor.parseOrderText, 'function', 'parseOrderText must be a function');
  assert.strictEqual(typeof Extractor.parsePricingText, 'function', 'parsePricingText must be a function');
  assert.strictEqual(typeof Extractor.formatRawOrder, 'function', 'formatRawOrder must be a function');

  // ==========================================
  // Test Case 1: Pure Cake order with multiline inscription and addon
  // ==========================================
  console.log('Testing Case 1: Pure Cake Order with Multiline Inscription');
  const pureCakeText = `圖款
題字：
Happy
birthday
Raini

蛋糕尺寸：4吋
蛋糕口味：伯爵戚風＋焦糖核桃＋原味奶油

加購：5人餐具、扭曲蠟燭（銀）

取貨日期：2026-11-12
取貨時間：18:00
自取地點：台南市中西區友愛街93號

訂購人的LINE名稱：Raini
訂購人姓名：陳畇朣
訂購人電話：0970006535`;

  const parsedCake = Extractor.parseOrderText(pureCakeText);
  assert.strictEqual(parsedCake.orderType, 'cake', 'orderType should be cake');
  assert.strictEqual(parsedCake.cake.style, '圖款', 'cake style should match');
  assert.strictEqual(parsedCake.cake.inscription, 'Happy\nbirthday\nRaini', 'multiline inscription must be preserved');
  assert.strictEqual(parsedCake.cake.size, '4吋', 'cake size should match');
  assert.strictEqual(parsedCake.cake.flavor, '伯爵戚風＋焦糖核桃＋原味奶油', 'cake flavor should match');
  assert.strictEqual(parsedCake.cake.addon, '5人餐具、扭曲蠟燭（銀）', 'addon should match');
  assert.strictEqual(parsedCake.pickup.dateTag, '1112', 'pickup dateTag should match 4-digit format');
  assert.strictEqual(parsedCake.pickup.time, '18:00', 'pickup time should match');
  assert.strictEqual(parsedCake.pickup.location, '台南市中西區友愛街93號', 'pickup location should match');
  assert.strictEqual(parsedCake.customer.lineName, 'Raini', 'customer lineName should match');
  assert.strictEqual(parsedCake.customer.name, '陳畇朣', 'customer name should match');
  assert.strictEqual(parsedCake.customer.phone, '0970006535', 'customer phone should match');

  // ==========================================
  // Test Case 2: Combined Flower + Cake order
  // ==========================================
  console.log('Testing Case 2: Combined Flower + Cake Order');
  const combinedText = `1️⃣
💐精緻包裝花束💐
(圖片僅供參考)

想要的預算(填金額)：2000
鮮花色系：白綠
包裝紙色系：白
＊附提袋喔
備註：許願桔梗

2️⃣
圖款
題字：
Happy
birthday
Raini

蛋糕尺寸：🍔
蛋糕口味：伯爵戚風＋焦糖核桃＋原味奶油

加購：保冷袋劑

取貨日期：10/1
取貨時間：3-4點
自取地點：台南市中西區友愛街93號

訂購人的LINE名稱：畇朣
訂購人姓名：陳畇朣
訂購人電話：0970006535`;

  const parsedCombined = Extractor.parseOrderText(combinedText);
  assert.strictEqual(parsedCombined.orderType, 'combined', 'orderType should be combined');
  // Flower fields
  assert.strictEqual(parsedCombined.flower.budget, '2000', 'flower budget should match');
  assert.strictEqual(parsedCombined.flower.color, '白綠', 'flower color should match');
  assert.strictEqual(parsedCombined.flower.paper, '白', 'flower paper should match');
  assert.strictEqual(parsedCombined.flower.note, '許願桔梗', 'flower note should match');
  // Cake fields
  assert.strictEqual(parsedCombined.cake.style, '圖款', 'cake style should match');
  assert.strictEqual(parsedCombined.cake.inscription, 'Happy\nbirthday\nRaini', 'multiline inscription must be preserved in combined order');
  assert.strictEqual(parsedCombined.cake.size, '🍔', 'cake size should match');
  assert.strictEqual(parsedCombined.cake.flavor, '伯爵戚風＋焦糖核桃＋原味奶油', 'cake flavor should match');
  assert.strictEqual(parsedCombined.cake.addon, '保冷袋劑', 'addon should match');
  // Pickup & Customer
  assert.strictEqual(parsedCombined.pickup.dateTag, '1001', 'pickup dateTag should normalize 10/1 to 1001');
  assert.strictEqual(parsedCombined.pickup.time, '3-4點', 'pickup time should match');
  assert.strictEqual(parsedCombined.pickup.location, '台南市中西區友愛街93號', 'pickup location should match');
  assert.strictEqual(parsedCombined.customer.lineName, '畇朣', 'lineName should match');
  assert.strictEqual(parsedCombined.customer.name, '陳畇朣', 'name should match');
  assert.strictEqual(parsedCombined.customer.phone, '0970006535', 'phone should match');

  // ==========================================
  // Test Case 3: Price extraction from customer service reply
  // ==========================================
  console.log('Testing Case 3: Price Extraction from CS Reply');
  const csReplyText = `您好呀～
幫您加總一下

蛋糕$790
2人餐具$15
蠟燭x2$90
總共$895

您再麻煩確認一下對不對喔
謝謝您`;

  const parsedPricing = Extractor.parsePricingText(csReplyText);
  assert.strictEqual(parsedPricing.total, 895, 'total must be 895');
  assert.strictEqual(
    parsedPricing.breakdownText,
    '蛋糕$790\n2人餐具$15\n蠟燭x2$90\n總共$895',
    'breakdownText must match exact lines'
  );

  // Secondary pricing format with "=" syntax
  const csReplyText2 = `漢堡盒$760
鮮花預算：500
加購$100--襯紙
加購$40--提袋
＝1400`;
  const parsedPricing2 = Extractor.parsePricingText(csReplyText2);
  assert.strictEqual(parsedPricing2.total, 1400, 'total must be 1400');
  assert.strictEqual(
    parsedPricing2.breakdownText,
    '漢堡盒$760\n鮮花預算：500\n加購$100--襯紙\n加購$40--提袋\n＝1400'
  );

  // ==========================================
  // Test Case 4: Verify formatRawOrder retains identical structure
  // ==========================================
  console.log('Testing Case 4: formatRawOrder Consistency and Re-parsing');
  const formattedCake = Extractor.formatRawOrder(parsedCake);
  const reParsedCake = Extractor.parseOrderText(formattedCake);
  assert.deepStrictEqual(
    {
      orderType: reParsedCake.orderType,
      cake: reParsedCake.cake,
      pickup: reParsedCake.pickup,
      customer: reParsedCake.customer
    },
    {
      orderType: parsedCake.orderType,
      cake: parsedCake.cake,
      pickup: parsedCake.pickup,
      customer: parsedCake.customer
    },
    'Re-parsed formatted cake order should match original parsed cake order'
  );

  const formattedCombined = Extractor.formatRawOrder(parsedCombined);
  const reParsedCombined = Extractor.parseOrderText(formattedCombined);
  assert.deepStrictEqual(
    {
      orderType: reParsedCombined.orderType,
      flower: reParsedCombined.flower,
      cake: reParsedCombined.cake,
      pickup: reParsedCombined.pickup,
      customer: reParsedCombined.customer
    },
    {
      orderType: parsedCombined.orderType,
      flower: parsedCombined.flower,
      cake: parsedCombined.cake,
      pickup: parsedCombined.pickup,
      customer: parsedCombined.customer
    },
    'Re-parsed formatted combined order should match original parsed combined order'
  );

  // ==========================================
  // Test Case 5: Pure flower order parsing and formatting
  // ==========================================
  console.log('Testing Case 5: Pure Flower Order');
  const pureFlowerText = `💐精緻包裝花束💐

想要的預算(填金額)：2000
鮮花色系：粉色
包裝紙色系：請您幫忙配
＊附提袋喔
備註：無

取貨日期：10.3
取貨時間：5:30
自取地點：台南市中西區友愛街93號

訂購人的LINE名稱：浩宇
訂購人姓名：鄭浩宇
訂購人電話：0929361033`;

  const parsedFlower = Extractor.parseOrderText(pureFlowerText);
  assert.strictEqual(parsedFlower.orderType, 'flower', 'orderType should be flower');
  assert.strictEqual(parsedFlower.flower.budget, '2000', 'budget should match');
  assert.strictEqual(parsedFlower.flower.color, '粉色', 'color should match');
  assert.strictEqual(parsedFlower.flower.paper, '請您幫忙配', 'paper should match');
  assert.strictEqual(parsedFlower.flower.note, '無', 'note should match');
  assert.strictEqual(parsedFlower.pickup.dateTag, '1003', 'dateTag should normalize 10.3 to 1003');
  assert.strictEqual(parsedFlower.pickup.time, '5:30', 'time should match');
  assert.strictEqual(parsedFlower.customer.lineName, '浩宇', 'lineName should match');
  assert.strictEqual(parsedFlower.customer.name, '鄭浩宇', 'name should match');
  assert.strictEqual(parsedFlower.customer.phone, '0929361033', 'phone should match');

  const formattedFlower = Extractor.formatRawOrder(parsedFlower);
  const reParsedFlower = Extractor.parseOrderText(formattedFlower);
  assert.deepStrictEqual(
    {
      orderType: reParsedFlower.orderType,
      flower: reParsedFlower.flower,
      pickup: reParsedFlower.pickup,
      customer: reParsedFlower.customer
    },
    {
      orderType: parsedFlower.orderType,
      flower: parsedFlower.flower,
      pickup: parsedFlower.pickup,
      customer: parsedFlower.customer
    },
    'Re-parsed formatted flower order should match original parsed flower order'
  );

  console.log('✅ All Extractor Engine tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function runTests() {
  console.log('--- Running Manifest & Service Worker Tests ---');

  const projectRoot = path.resolve(__dirname, '..');
  const manifestPath = path.join(projectRoot, 'manifest.json');

  // 1. Verify manifest.json exists
  assert.ok(fs.existsSync(manifestPath), 'manifest.json should exist');

  // 2. Verify valid JSON
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestContent);
  } catch (e) {
    assert.fail('manifest.json must be valid JSON: ' + e.message);
  }

  // 3. Verify manifest_version
  assert.strictEqual(manifest.manifest_version, 3, 'manifest_version must be 3');

  // 4. Verify name and version
  assert.strictEqual(manifest.name, '梧藝 WUYI 下單小幫手', 'name must be 梧藝 WUYI 下單小幫手');
  assert.ok(manifest.version, 'version must be specified');

  // 5. Verify permissions
  const requiredPermissions = ['activeTab', 'storage', 'clipboardWrite'];
  assert.ok(Array.isArray(manifest.permissions), 'permissions must be an array');
  for (const perm of requiredPermissions) {
    assert.ok(manifest.permissions.includes(perm), `permissions must include ${perm}`);
  }

  // 6. Verify host_permissions (Strictly restricted to LINE Official & Google)
  const requiredHostPermissions = [
    'https://chat.line.biz/*',
    'https://*.line-scdn.net/*',
    'https://*.line.me/*'
  ];
  assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  assert.ok(!manifest.host_permissions.includes('<all_urls>'), 'host_permissions must NOT include <all_urls>');
  for (const hp of requiredHostPermissions) {
    assert.ok(manifest.host_permissions.includes(hp), `host_permissions must include ${hp}`);
  }

  // 6.1 Verify rules.json is strictly scoped (no global "*" intercept)
  const rulesJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'rules.json'), 'utf-8'));
  assert.ok(Array.isArray(rulesJson), 'rules.json must be an array');
  const hasGlobalFilter = rulesJson.some(r => r.condition && r.condition.urlFilter === '*');
  assert.ok(!hasGlobalFilter, 'rules.json must NOT use wildcard "*" urlFilter');

  // 7. Verify background service_worker
  assert.ok(manifest.background, 'background must be defined');
  assert.strictEqual(
    manifest.background.service_worker,
    'src/background/service-worker.js',
    'background.service_worker must be src/background/service-worker.js'
  );
  const swPath = path.join(projectRoot, manifest.background.service_worker);
  assert.ok(fs.existsSync(swPath), 'service-worker.js file must exist');

  // 8. Verify content_scripts
  assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
  const lineContentScript = manifest.content_scripts.find(cs =>
    cs.matches && cs.matches.includes('https://chat.line.biz/*')
  );
  assert.ok(lineContentScript, 'content_scripts must have a match for https://chat.line.biz/*');
  assert.ok(
    lineContentScript.js && lineContentScript.js.includes('src/content/extractor.js'),
    'content_scripts js must include src/content/extractor.js'
  );
  assert.ok(
    lineContentScript.js && lineContentScript.js.includes('src/content/card-renderer.js'),
    'content_scripts js must include src/content/card-renderer.js'
  );
  assert.ok(
    lineContentScript.js && lineContentScript.js.includes('src/content/content.js'),
    'content_scripts js must include src/content/content.js'
  );
  assert.ok(
    lineContentScript.css && lineContentScript.css.includes('src/content/content.css'),
    'content_scripts css must include src/content/content.css'
  );
  assert.ok(
    fs.existsSync(path.join(projectRoot, 'src/content/content.js')),
    'src/content/content.js file must exist'
  );
  assert.ok(
    fs.existsSync(path.join(projectRoot, 'src/content/content.css')),
    'src/content/content.css file must exist'
  );

  // 9. Verify icons
  assert.ok(manifest.icons, 'icons must be defined');
  for (const size of ['16', '48', '128']) {
    const iconRelPath = manifest.icons[size];
    assert.ok(iconRelPath, `icon ${size} must be defined`);
    const iconPath = path.join(projectRoot, iconRelPath);
    assert.ok(fs.existsSync(iconPath), `icon file ${iconRelPath} must exist`);
    const stats = fs.statSync(iconPath);
    assert.ok(stats.size > 0, `icon file ${iconRelPath} must not be empty`);
  }

  // 10. Verify service-worker functionality
  const sw = require(swPath);
  assert.ok(typeof sw.fetchImageAsDataUrl === 'function', 'fetchImageAsDataUrl function must exist');
  assert.ok(typeof sw.handleMessage === 'function', 'handleMessage function must exist');

  // Test handleMessage with missing URL
  let respondedData = null;
  const keepAlive = sw.handleMessage(
    { action: 'fetchImageAsDataUrl' },
    {},
    res => { respondedData = res; }
  );
  assert.strictEqual(keepAlive, false, 'handleMessage should return false when missing URL');
  assert.deepStrictEqual(respondedData, { success: false, error: 'Missing image URL' });

  // Test handleMessage with irrelevant action
  const ignored = sw.handleMessage({ action: 'unknownAction' }, {}, () => {});
  assert.strictEqual(ignored, false, 'handleMessage should ignore unknown actions');

  // Test fetchImageAsDataUrl with mocked fetch
  const originalFetch = global.fetch;
  try {
    const sampleBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
    global.fetch = async (url) => {
      if (url === 'https://example.com/test.png') {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-type', 'image/png']]),
          arrayBuffer: async () => sampleBytes.buffer
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      };
    };

    // Test success case
    const res = await sw.fetchImageAsDataUrl('https://example.com/test.png');
    assert.strictEqual(res.success, true, 'fetchImageAsDataUrl should succeed');
    assert.ok(res.dataUrl.startsWith('data:image/png;base64,'), 'dataUrl should start with data:image/png;base64,');

    // Test async handleMessage flow
    let asyncResult = null;
    const isAsync = sw.handleMessage(
      { action: 'fetchImageAsDataUrl', url: 'https://example.com/test.png' },
      {},
      r => { asyncResult = r; }
    );
    assert.strictEqual(isAsync, true, 'handleMessage should return true to keep message channel open');
    
    // Wait for promise resolution
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(asyncResult, 'sendResponse should have been called');
    assert.strictEqual(asyncResult.success, true);
    assert.ok(asyncResult.dataUrl.startsWith('data:image/png;base64,'));

    // Test 404 error case
    const errorRes = await sw.fetchImageAsDataUrl('https://example.com/not-found.png');
    assert.strictEqual(errorRes.success, false, 'fetchImageAsDataUrl should report failure on 404');
    assert.ok(errorRes.error.includes('HTTP 404'), 'error message should include HTTP 404');

  } finally {
    global.fetch = originalFetch;
  }

  // 10. Verify JS syntax for all source files
  const { execSync } = require('child_process');
  const jsFiles = [
    'src/content/content.js',
    'src/content/extractor.js',
    'src/content/card-renderer.js',
    'src/popup/popup.js',
    'src/background/service-worker.js'
  ];
  for (const f of jsFiles) {
    execSync(`node -c "${path.join(projectRoot, f)}"`);
  }

  console.log('✅ All Manifest & Service Worker tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

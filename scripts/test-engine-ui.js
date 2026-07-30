import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html, app, legacyCss, liveCss] = await Promise.all([
  fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/canvas-live.css', import.meta.url), 'utf8'),
]);

test('成员生成区提供动态引擎选择并提交 engineId', () => {
  assert.match(html, /id="engineSelector"[^>]*aria-label="生图引擎"[^>]*hidden/);
  assert.ok(
    html.indexOf('id="engineSelector"') < html.indexOf('aria-label="生成模式"'),
    '引擎选择器应位于生成模式之前',
  );
  assert.match(app, /function renderEngineSelector\(engines\)/);
  assert.match(app, /engines\.filter\(\(engine\) => engine\.available !== false\)/);
  assert.match(app, /renderEngineSelector\(status\.engines \|\| \[\]\)/);
  assert.match(app, /engineId: engineRadio\.value/);
});

test('切换引擎会使用该引擎能力更新生成控件', () => {
  assert.match(app, /engineSelector\?\.addEventListener\('change'/);
  assert.match(app, /currentStatus\.engines\.find\(\(engine\) => engine\.id === selected\.value\)/);
  assert.match(app, /updateCapabilityControls\(selectedEngine\?\.capabilities \|\| currentStatus\.capabilities\)/);
});

test('管理员设置抽屉提供完整引擎 CRUD 表单', () => {
  for (const id of [
    'engineSection',
    'engineList',
    'engineAddPanel',
    'engineForm',
    'engineId',
    'engineLabel',
    'engineProviderType',
    'engineModel',
    'engineChannels',
    'engineMemberEnabled',
    'engineAutoEnabled',
    'engineEnabled',
    'enginePriority',
    'engineSaveNote',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /async function loadEngineConfig\(\)/);
  assert.match(app, /function renderEngineList\(engines\)/);
  assert.match(app, /async function saveEngineConfig\(engines\)/);
  assert.match(app, /fetch\('\/api\/admin\/image-engines'/);
  assert.match(app, /method: 'POST'/);
  assert.match(app, /engineForm\?\.addEventListener\('submit'/);
});

test('新增渠道允许选择并提交 providerType', () => {
  assert.match(html, /id="keyProviderType"/);
  assert.ok(
    html.indexOf('id="keyProviderType"') < html.indexOf('id="keyValue"'),
    'providerType 应位于 Key 输入框之前',
  );
  assert.match(app, /const providerType = document\.querySelector\('#keyProviderType'\)\?\.value \|\| 'openai-images'/);
  assert.match(app, /JSON\.stringify\(\{ name: nameInput\.value\.trim\(\), baseURL, key, providerType \}\)/);
});

test('引擎配置样式同时覆盖任务目标和当前活动主题', () => {
  for (const css of [legacyCss, liveCss]) {
    assert.match(css, /\.engine-list\s*\{/);
    assert.match(css, /\.engine-item\s*\{/);
    assert.match(css, /\.engine-form\s*\{/);
    assert.match(css, /\.mini-btn\.danger\s*\{/);
  }
});

test('generation summary follows the selected image engine', () => {
  assert.match(app, /engineSelector\?\.addEventListener\('change'[\s\S]*updateGenerateChannelSummary\(\)/);
  assert.match(app, /currentStatus\?\.imageEnginesConfigured/);
  assert.match(app, /selectedEngine\?\.model/);
  assert.match(app, /selectedEngine\?\.channels/);
});

test('settings drawer provides an explicit image model management workflow', () => {
  for (const id of [
    'modelManagerChannel',
    'modelManagerModel',
    'modelManagerEngine',
    'refreshImageModelsButton',
    'testImageModelButton',
    'setDefaultImageModelButton',
    'modelManagerNote',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /imageModelCandidates/);
  assert.match(app, /matchingModelEngines/);
  assert.match(app, /isTestedSelection/);
  assert.match(app, /modelManagerTestState = null/);
  assert.match(app, /method: 'PATCH'/);
  assert.match(app, /\/api\/admin\/image-engines\/\$\{encodeURIComponent\(engineId\)\}\/model/);
});

test('runtime status lists configured models per engine in multi-engine mode', () => {
  assert.match(app, /status\.imageEnginesConfigured/);
  assert.match(app, /engine\.label.*engine\.model/s);
  assert.match(app, /默认挂载模型/);
});
test('channel rows expose an editable provider selector', () => {
  assert.match(app, /key-provider-select/);
  assert.match(app, /data-id="\$\{escapeAttr\(key\.id\)\}"/);
  assert.match(app, /method:\s*'PATCH'/);
});

test('new channel form defaults to automatic provider detection', () => {
  assert.match(html, /<option value="auto" selected>[^<]*自动探测/);
});

test('legacy channel assignment follows imageEnginesConfigured', () => {
  assert.match(html, /id="legacyChannelAssign"/);
  assert.match(app, /legacySection\.hidden = Boolean\(status\.imageEnginesConfigured\)/);
});

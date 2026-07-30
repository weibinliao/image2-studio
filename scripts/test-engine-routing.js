import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  resolveEngineRequestModel,
  selectChannelForEngine,
  shouldTryNextKey,
  updateEngineModel,
  validateImageEngine,
} from '../engine-routing.js';

const serverSource = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');

const keys = [
  { id: 'openai-1', enabled: true },
  { id: 'openai-2', enabled: true },
  { id: 'gemini-1', enabled: true },
];

test('validateImageEngine rejects an unknown provider type', () => {
  const error = validateImageEngine({
    id: 'unknown',
    label: 'Unknown',
    providerType: 'unknown-provider',
    channelIds: ['openai-1'],
    priority: 1,
  }, keys);

  assert.match(error, /未知 providerType/);
});

test('validateImageEngine rejects a missing channel id', () => {
  const error = validateImageEngine({
    id: 'gpt',
    label: 'GPT',
    providerType: 'openai-images',
    channelIds: ['missing'],
    priority: 10,
  }, keys);

  assert.match(error, /channelId missing 不存在/);
});

test('validateImageEngine accepts a valid engine', () => {
  const error = validateImageEngine({
    id: 'gpt',
    label: 'GPT',
    providerType: 'openai-images',
    model: 'gpt-image-2',
    channelIds: ['openai-1', 'openai-2'],
    priority: 10,
  }, keys);

  assert.equal(error, null);
});

test('engine generation uses the configured Gemini model instead of an admin legacy override', () => {
  const model = resolveEngineRequestModel({
    engine: { model: 'gemini-3.1-flash-image' },
    requestedModel: 'gpt-image-2',
    actorRole: 'admin',
  });

  assert.equal(model, 'gemini-3.1-flash-image');
});

test('engine generation never falls back to a cross-provider legacy model', () => {
  const model = resolveEngineRequestModel({
    engine: { model: '' },
    requestedModel: 'gpt-image-2',
    actorRole: 'admin',
  });

  assert.equal(model, '');
});

test('validateImageEngine rejects an engine without a configured model', () => {
  const error = validateImageEngine({
    id: 'gemini',
    label: 'Gemini',
    providerType: 'gemini-native',
    model: '',
    channelIds: ['gemini-1'],
    priority: 5,
  }, keys);

  assert.match(error, /model/);
});

test('updateEngineModel changes only the target engine model', () => {
  const engines = [
    {
      id: 'gpt',
      providerType: 'openai-images',
      model: 'gpt-image-2',
      channelIds: ['openai-1'],
      priority: 10,
      enabled: true,
    },
    {
      id: 'gemini',
      providerType: 'gemini-native',
      model: 'gemini-3.1-flash-image',
      channelIds: ['gemini-1'],
      priority: 5,
      enabled: true,
    },
  ];
  const modelKeys = [
    { id: 'openai-1', providerType: 'openai-images' },
    { id: 'gemini-1', providerType: 'gemini-native' },
  ];

  const result = updateEngineModel({
    engines,
    keys: modelKeys,
    engineId: 'gemini',
    channelId: 'gemini-1',
    model: 'gemini-3.1-flash-image-preview',
  });

  assert.equal(result.error, '');
  assert.equal(result.engine.model, 'gemini-3.1-flash-image-preview');
  assert.deepEqual(result.engines[0], engines[0]);
  assert.deepEqual(result.engines[1].channelIds, engines[1].channelIds);
  assert.equal(result.engines[1].priority, engines[1].priority);
  assert.equal(result.engines[1].enabled, engines[1].enabled);
});

test('updateEngineModel rejects unsafe engine and channel combinations', () => {
  const engines = [{
    id: 'gemini',
    providerType: 'gemini-native',
    model: 'gemini-3.1-flash-image',
    channelIds: ['gemini-1'],
  }];
  const modelKeys = [
    { id: 'gemini-1', providerType: 'gemini-native' },
    { id: 'gemini-2', providerType: 'gemini-native' },
    { id: 'openai-1', providerType: 'openai-images' },
  ];

  assert.match(updateEngineModel({ engines, keys: modelKeys, engineId: 'gemini', channelId: 'gemini-1', model: '' }).error, /model/);
  assert.match(updateEngineModel({ engines, keys: modelKeys, engineId: 'missing', channelId: 'gemini-1', model: 'image' }).error, /engine/);
  assert.match(updateEngineModel({ engines, keys: modelKeys, engineId: 'gemini', channelId: 'missing', model: 'image' }).error, /channel/);
  assert.match(updateEngineModel({ engines, keys: modelKeys, engineId: 'gemini', channelId: 'gemini-2', model: 'image' }).error, /assigned/);
  assert.match(updateEngineModel({
    engines: [{ ...engines[0], channelIds: ['openai-1'] }],
    keys: modelKeys,
    engineId: 'gemini',
    channelId: 'openai-1',
    model: 'image',
  }).error, /provider/);
});
test('server exposes an admin-only targeted engine model PATCH route', () => {
  assert.match(serverSource, /engineModelPatchMatch = requestUrl\.pathname\.match/);
  assert.match(serverSource, /req\.method === 'PATCH' && engineModelPatchMatch/);
  assert.match(serverSource, /isAdminRequest\(req\)/);
  assert.match(serverSource, /updateEngineModel\(/);
  assert.match(serverSource, /imageEngines: result\.engines/);
});
test('selectChannelForEngine only selects channels in the engine pool', () => {
  const engine = { id: 'gpt-pool-only', channelIds: ['openai-1', 'openai-2'] };
  const selected = selectChannelForEngine(engine, keys, new Set());

  assert.ok(engine.channelIds.includes(selected.id));
});

test('selectChannelForEngine skips channels already tried', () => {
  const engine = { id: 'gpt-skip-tried', channelIds: ['openai-1', 'openai-2'] };
  const selected = selectChannelForEngine(engine, keys, new Set(['openai-1']));

  assert.equal(selected.id, 'openai-2');
});

test('selectChannelForEngine returns null when no channel is usable', () => {
  const engine = { id: 'gpt-none', channelIds: ['openai-1'] };
  const selected = selectChannelForEngine(engine, keys, new Set(['openai-1']));

  assert.equal(selected, null);
});

test('shouldTryNextKey stops when the request may have been charged', () => {
  assert.equal(shouldTryNextKey({ retryable: true, maybeCharged: true }), false);
});

test('shouldTryNextKey stops for explicitly non-retryable errors', () => {
  assert.equal(shouldTryNextKey({ retryable: false, maybeCharged: false }), false);
});

test('shouldTryNextKey retries safe network errors', () => {
  assert.equal(shouldTryNextKey({ retryable: true, maybeCharged: false }), true);
});

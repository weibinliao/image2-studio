import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as imageProviders from '../image-providers.js';
import * as keyProviderStore from '../key-provider-store.js';
import { backfillProviderTypes } from './backfill-provider-types.js';

const serverSource = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
const appSource = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const { detectProviderType } = imageProviders;
const { updateFileKeyProviderType } = keyProviderStore;

const channel = {
  key: 'test-key',
  baseURL: 'https://proxy.example/v1',
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test('detectProviderType returns a confident gemini-native result when v1beta lists models', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return jsonResponse(200, { models: [{ name: 'models/gemini-image' }] });
  };

  const detection = await detectProviderType(channel, 12000, fetchImpl);

  assert.deepEqual(detection, {
    providerType: 'gemini-native',
    confident: true,
    reason: '',
  });
  assert.deepEqual(calls, ['https://proxy.example/v1beta/models']);
});

test('detectProviderType does not downgrade after a 503 even when v1 lists models', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/v1beta/models')) {
      return jsonResponse(503, { error: { message: 'No available Gemini accounts' } });
    }
    return jsonResponse(200, { data: [{ id: 'gpt-image-2' }] });
  };

  const detection = await detectProviderType(channel, 12000, fetchImpl);

  assert.equal(detection.confident, false);
  assert.equal(detection.providerType, null);
  assert.deepEqual(calls, [
    'https://proxy.example/v1beta/models',
    'https://proxy.example/v1/models',
  ]);
});

test('detectProviderType does not downgrade after a timeout', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1beta/models')) {
      const error = new Error('request timed out');
      error.name = 'TimeoutError';
      throw error;
    }
    return jsonResponse(404, { error: 'not found' });
  };

  const detection = await detectProviderType(channel, 12000, fetchImpl);

  assert.equal(detection.confident, false);
  assert.equal(detection.providerType, null);
});

for (const status of [401, 404]) {
  test(`detectProviderType treats HTTP ${status} as protocol disproof`, async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/v1beta/models')) return jsonResponse(status, { error: 'not supported' });
      return jsonResponse(200, { data: [{ id: 'gpt-image-2' }] });
    };

    const detection = await detectProviderType(channel, 12000, fetchImpl);

    assert.equal(detection.providerType, 'openai-images');
    assert.equal(detection.confident, true);
  });
}

test('detectProviderType tries openai-images after gemini-native is disproved', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/v1beta/models')) return jsonResponse(404, { error: 'not found' });
    return jsonResponse(200, { data: [{ id: 'gpt-image-2' }] });
  };

  const detection = await detectProviderType(channel, 12000, fetchImpl);

  assert.deepEqual(detection, {
    providerType: 'openai-images',
    confident: true,
    reason: '',
  });
  assert.deepEqual(calls, [
    'https://proxy.example/v1beta/models',
    'https://proxy.example/v1/models',
  ]);
});

test('detectProviderType confidently defaults only when both protocols are disproved', async () => {
  const fetchImpl = async () => jsonResponse(404, { error: 'not found' });

  assert.deepEqual(await detectProviderType(channel, 12000, fetchImpl), {
    providerType: 'openai-images',
    confident: true,
    reason: '两种协议均被上游否证，按默认协议保存',
  });
});

test('detectProviderType prefers gemini-native when both endpoints could succeed', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return url.endsWith('/v1beta/models')
      ? jsonResponse(200, { models: [{ name: 'models/gemini-3.1-flash-image' }] })
      : jsonResponse(200, { data: [{ id: 'gemini-3.1-flash-image' }] });
  };

  const detection = await detectProviderType(channel, 12000, fetchImpl);

  assert.equal(detection.providerType, 'gemini-native');
  assert.equal(detection.confident, true);
  assert.deepEqual(calls, ['https://proxy.example/v1beta/models']);
});

test('detectProviderTypeValue preserves the legacy string return shape', async () => {
  const fetchImpl = async () => jsonResponse(503, { error: 'unavailable' });

  assert.equal(await imageProviders.detectProviderTypeValue(channel, 12000, fetchImpl), 'openai-images');
});

test('resolveProviderTypeOnReprobe preserves the stored protocol when detection is uncertain', () => {
  const current = { id: 'gemini', providerType: 'gemini-native' };
  const detection = { providerType: null, confident: false, reason: '上游暂时不可用' };

  assert.equal(
    keyProviderStore.resolveProviderTypeOnReprobe(current, detection),
    'gemini-native',
  );
});

test('resolveProviderTypeOnAdd gives an explicit provider choice highest priority', () => {
  const input = { providerType: 'gemini-native' };
  const detection = { providerType: 'openai-images', confident: true, reason: '' };

  assert.equal(
    keyProviderStore.resolveProviderTypeOnAdd(input, detection),
    'gemini-native',
  );
});

test('updateFileKeyProviderType rejects an unregistered provider type', async () => {
  await assert.rejects(
    updateFileKeyProviderType('channel-1', 'not-registered'),
    /Unknown providerType: not-registered/,
  );
});

test('updateFileKeyProviderType preserves keys and unrelated fields', async () => {
  const records = [
    { id: 'channel-1', key: 'secret-1', name: 'One', providerType: 'openai-images', custom: 42 },
    { id: 'channel-2', key: 'secret-2', name: 'Two', enabled: false },
  ];
  const probe = { ok: true, modelCount: 3 };
  let written = null;

  const updated = await updateFileKeyProviderType('channel-1', 'gemini-native', {
    readKeys: async () => structuredClone(records),
    writeKeys: async (next) => {
      written = next;
    },
    probeChannel: async () => probe,
  });

  assert.deepEqual(updated, {
    ...records[0],
    providerType: 'gemini-native',
    probe,
  });
  assert.equal(written[0].key, 'secret-1');
  assert.equal(written[0].id, 'channel-1');
  assert.equal(written[0].custom, 42);
  assert.deepEqual(written[1], records[1]);
});

test('server auto-detects providers on add and reprobe', () => {
  assert.match(serverSource, /import \{[^}]*detectProviderType[^}]*\} from '\.\/image-providers\.js'/s);
  assert.match(serverSource, /const detection = await detectProviderType\(\{ key, baseURL \}\)/);
  assert.match(serverSource, /resolveProviderTypeOnAdd\(input, detection\)/);
  assert.match(serverSource, /async function reprobeFileKey\(id\)[\s\S]*detectProviderType\(current\)/);
  assert.match(serverSource, /resolveProviderTypeOnReprobe\(current, detection\)/);
});

test('frontend surfaces provider detection notes after add and reprobe', () => {
  assert.match(appSource, /payload\.probe\?\.providerTypeNote/);
  assert.match(appSource, /result\.probe\?\.providerTypeNote/);
});

test('server exposes provider PATCH and engine migration status', () => {
  assert.match(serverSource, /req\.method === 'PATCH' && keyPatchMatch/);
  assert.match(serverSource, /updateFileKeyProviderType\(keyPatchMatch\[1\], body\.providerType/);
  assert.match(serverSource, /imageEnginesConfigured:\s*Array\.isArray\(settings\.imageEngines\) && settings\.imageEngines\.length > 0/);
});

test('backfillProviderTypes backs up bytes and preserves key values', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-provider-backfill-'));
  const keyFile = path.join(tempDir, 'keys.json');
  const records = [
    { id: 'one', name: 'One', key: 'secret-one', baseURL: 'https://one.example/v1', extra: 1 },
    { id: 'two', name: 'Two', key: 'secret-two', baseURL: 'https://two.example/v1', providerType: 'openai-images' },
  ];
  const original = `${JSON.stringify(records, null, 2)}\n`;

  try {
    await fs.writeFile(keyFile, original, 'utf8');
    const result = await backfillProviderTypes({
      keyFile,
      detect: async () => 'gemini-native',
      logger: () => {},
      timestamp: '2026-07-29T10-20-30-000Z',
    });
    const backup = await fs.readFile(result.backupFile, 'utf8');
    const updated = JSON.parse(await fs.readFile(keyFile, 'utf8'));

    assert.equal(backup, original);
    assert.equal(updated[0].providerType, 'gemini-native');
    assert.equal(updated[0].key, records[0].key);
    assert.equal(updated[0].extra, 1);
    assert.deepEqual(updated[1], records[1]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

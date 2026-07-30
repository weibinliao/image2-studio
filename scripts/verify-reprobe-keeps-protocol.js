import assert from 'node:assert/strict';

import * as keyProviderStore from '../key-provider-store.js';

const current = {
  id: 'gemini',
  name: 'gemini',
  providerType: 'gemini-native',
};
const detection = {
  providerType: null,
  confident: false,
  reason: '上游暂时不可用（HTTP 503 等），无法判定协议',
};

const providerType = keyProviderStore.resolveProviderTypeOnReprobe(current, detection);

assert.equal(providerType, 'gemini-native');
console.log(`reprobe protocol preserved: ${providerType}`);

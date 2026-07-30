import assert from 'node:assert/strict';
import { providerDefaultImageModels, resolveImageModel } from '../provider-models.js';

assert.deepEqual(
  providerDefaultImageModels({
    name: 'grok',
    baseURL: 'https://api.example.com/v1',
  }),
  ['grok-imagine-image', 'grok-imagine-image-quality'],
);

assert.deepEqual(
  providerDefaultImageModels({
    name: 'single-image',
    baseURL: 'https://api.example.com/v1',
  }),
  ['gpt-image-2'],
);

assert.equal(
  resolveImageModel({
    name: 'grok',
    baseURL: 'https://api.example.com/v1',
  }, '', 'gpt-image-2'),
  'grok-imagine-image',
);

assert.equal(
  resolveImageModel({
    name: 'grok',
    baseURL: 'https://api.example.com/v1',
  }, 'grok-imagine-image-quality', 'gpt-image-2'),
  'grok-imagine-image-quality',
);

console.log('provider model defaults passed');

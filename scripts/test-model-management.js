import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  imageModelCandidates,
  isTestedSelection,
  matchingModelEngines,
} from '../public/model-management.js';

test('imageModelCandidates exposes only candidateModels', () => {
  assert.deepEqual(imageModelCandidates({
    models: ['gemini-3.5-flash', 'gemini-3-pro-image'],
    candidateModels: ['gemini-3-pro-image', 'gemini-3-pro-image', '  gemini-2.5-flash-image  '],
  }), ['gemini-3-pro-image', 'gemini-2.5-flash-image']);

  assert.deepEqual(imageModelCandidates({
    models: ['gemini-3.5-flash'],
    candidateModels: [],
  }), []);
});

test('matchingModelEngines requires channel membership and provider compatibility', () => {
  const channel = { id: 'gemini-1', providerType: 'gemini-native' };
  const engines = [
    { id: 'gemini', providerType: 'gemini-native', channelIds: ['gemini-1'] },
    { id: 'other-gemini', providerType: 'gemini-native', channelIds: ['gemini-2'] },
    { id: 'wrong-provider', providerType: 'openai-images', channelIds: ['gemini-1'] },
  ];

  assert.deepEqual(matchingModelEngines(channel, engines).map((engine) => engine.id), ['gemini']);
});

test('isTestedSelection matches the exact tested channel and model', () => {
  const tested = { channelId: 'gemini-1', model: 'gemini-3-pro-image' };

  assert.equal(isTestedSelection(tested, 'gemini-1', 'gemini-3-pro-image'), true);
  assert.equal(isTestedSelection(tested, 'gemini-1', 'gemini-2.5-flash-image'), false);
  assert.equal(isTestedSelection(tested, 'gemini-2', 'gemini-3-pro-image'), false);
  assert.equal(isTestedSelection(null, 'gemini-1', 'gemini-3-pro-image'), false);
});

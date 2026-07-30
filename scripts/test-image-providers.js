import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openaiImagesAdapter,
  geminiNativeAdapter,
  getProviderType,
  getAdapter,
  buildOpenAIRequest,
  buildGeminiRequest,
  parseGeminiResponse,
} from '../image-providers.js';

test('openai-images preserves standard request fields', () => {
  const request = buildOpenAIRequest(
    { provider: 'openai', baseURL: 'https://api.example.com/v1' },
    { prompt: 'A lighthouse', model: 'gpt-image-1', size: '1536x1024' },
  );

  assert.equal(request.prompt, 'A lighthouse');
  assert.equal(request.model, 'gpt-image-1');
  assert.equal(request.size, '1536x1024');
});

test('openai-images applies the single-image request format', () => {
  const request = buildOpenAIRequest(
    { provider: 'single-image', baseURL: 'https://api.example.com/v1' },
    { prompt: 'A lighthouse', model: 'custom-image-model', n: 4 },
  );

  assert.equal(request.stream, false);
  assert.equal(request.response_format, 'b64_json');
  assert.equal('n' in request, false);
});

test('gemini-native builds a generateContent request', () => {
  assert.deepEqual(buildGeminiRequest({ prompt: '  A lighthouse  ' }), {
    contents: [{ parts: [{ text: 'A lighthouse' }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
});

test('gemini-native parses inline image data', () => {
  const parsed = {
    candidates: [{
      content: {
        parts: [
          { text: 'Here is the image.' },
          { inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } },
        ],
      },
    }],
  };

  assert.deepEqual(parseGeminiResponse(parsed), {
    data: [{ b64_json: 'aW1hZ2U=', mimeType: 'image/png' }],
  });
});

test('gemini-native rejects a response without image data', () => {
  assert.throws(
    () => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'No image' }] } }] }),
    /Gemini.*(?:未返回|没有).*图片/,
  );
});

test('getProviderType defaults to openai-images', () => {
  assert.equal(getProviderType(), 'openai-images');
  assert.equal(getProviderType({}), 'openai-images');
});

test('getProviderType recognizes gemini-native', () => {
  assert.equal(getProviderType({ providerType: 'gemini-native' }), 'gemini-native');
  assert.equal(getAdapter({ providerType: 'gemini-native' }), geminiNativeAdapter);
});

test('getProviderType falls back for unknown providers', () => {
  assert.equal(getProviderType({ providerType: 'unknown-xyz' }), 'openai-images');
  assert.equal(getAdapter({ providerType: 'unknown-xyz' }), openaiImagesAdapter);
});

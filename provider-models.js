export function isGrokProvider(selected) {
  const provider = String(selected.provider || selected.name || '').toLowerCase();
  const baseURL = String(selected.baseURL || '').toLowerCase();
  return provider.includes('grok') || provider.includes('xai') || baseURL.includes('api.x.ai');
}

// The same predicate used to be inlined in both this file and server.js's
// buildProviderImageRequest, so a change in one place silently diverged.
export function isSingleImageProvider(selected) {
  const provider = String(selected.provider || selected.name || '').toLowerCase();
  return provider.includes('single-image');
}

export function providerDefaultImageModels(selected) {
  if (isGrokProvider(selected)) {
    return ['grok-imagine-image', 'grok-imagine-image-quality'];
  }

  if (isSingleImageProvider(selected)) {
    return ['gpt-image-2'];
  }

  return [];
}

export function resolveImageModel(selected, requestedModel, fallbackModel = '') {
  const explicitModel = String(requestedModel || '').trim();
  return explicitModel || providerDefaultImageModels(selected)[0] || String(fallbackModel || '').trim();
}

// What the active channel can actually honour. buildProviderImageRequest strips
// `n` for single-image, so offering a batch control there would be a UI that lies:
// the user asks for 4 images and silently gets 1.
export function providerCapabilities(selected) {
  if (!selected) return { batch: false, seed: false, maxBatch: 1 };

  if (isSingleImageProvider(selected)) {
    return { batch: false, seed: true, maxBatch: 1 };
  }

  return { batch: true, seed: true, maxBatch: 8 };
}

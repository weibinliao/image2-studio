export function isGrokProvider(selected) {
  const provider = String(selected.provider || selected.name || '').toLowerCase();
  const baseURL = String(selected.baseURL || '').toLowerCase();
  return provider.includes('grok') || provider.includes('xai') || baseURL.includes('api.x.ai');
}

export function providerDefaultImageModels(selected) {
  if (isGrokProvider(selected)) {
    return ['grok-imagine-image', 'grok-imagine-image-quality'];
  }

  const provider = String(selected.provider || selected.name || '').toLowerCase();
  if (provider.includes('gpteam') || selected.baseURL.includes('gpteamservices.com')) {
    return ['gpt-image-2'];
  }

  return [];
}

export function resolveImageModel(selected, requestedModel, fallbackModel = '') {
  const explicitModel = String(requestedModel || '').trim();
  return explicitModel || providerDefaultImageModels(selected)[0] || String(fallbackModel || '').trim();
}

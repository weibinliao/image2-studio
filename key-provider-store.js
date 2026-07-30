import { PROVIDER_ADAPTERS } from './image-providers.js';

export function resolveProviderTypeOnAdd(input, detection) {
  const requested = String(input?.providerType || '').trim();
  if (requested && requested !== 'auto') return requested;
  if (detection?.confident && detection.providerType) return detection.providerType;
  return 'openai-images';
}

export function resolveProviderTypeOnReprobe(current, detection) {
  if (detection?.confident && detection.providerType) return detection.providerType;
  return current?.providerType || 'openai-images';
}

export async function updateFileKeyProviderType(id, providerType, dependencies = {}) {
  const normalized = String(providerType || '').trim();
  if (!PROVIDER_ADAPTERS[normalized]) {
    throw new Error(`Unknown providerType: ${normalized || '(empty)'}`);
  }

  const { readKeys, writeKeys, probeChannel } = dependencies;
  if (!readKeys || !writeKeys || !probeChannel) {
    throw new Error('Key store dependencies are required');
  }

  const existing = await readKeys();
  const index = existing.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('Only file-backed keys can be changed here');

  const changed = { ...existing[index], providerType: normalized };
  const probe = await probeChannel(changed);
  const updated = { ...changed, probe };
  const next = existing.map((item, itemIndex) => itemIndex === index ? updated : item);

  await writeKeys(next);
  return updated;
}

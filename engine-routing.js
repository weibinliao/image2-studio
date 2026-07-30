import { PROVIDER_ADAPTERS } from './image-providers.js';

export const engineCursors = new Map();

export function validateImageEngine(engine, allKeys) {
  if (!engine || typeof engine !== 'object') return '引擎必须是对象';
  if (!String(engine.id || '').match(/^[a-z0-9_-]+$/i)) return 'id 只能包含字母、数字、_、-';
  if (!engine.label) return 'label 不能为空';
  if (!PROVIDER_ADAPTERS[engine.providerType]) return `未知 providerType: ${engine.providerType}`;
  if (!Array.isArray(engine.channelIds) || engine.channelIds.length === 0) return 'channelIds 不能为空';

  const knownIds = new Set(allKeys.map((key) => key.id));
  for (const channelId of engine.channelIds) {
    if (!knownIds.has(channelId)) return `channelId ${channelId} 不存在`;
  }

  if (!String(engine.model || '').trim()) return 'model is required';
  if (typeof engine.priority !== 'number') return 'priority 必须是数字';
  return null;
}

export function updateEngineModel({ engines, keys, engineId, channelId, model }) {
  const currentEngines = Array.isArray(engines) ? engines : [];
  const currentKeys = Array.isArray(keys) ? keys : [];
  const nextModel = String(model || '').trim();
  if (!nextModel) return { error: 'model is required', engines: currentEngines };

  const engine = currentEngines.find((item) => item.id === engineId);
  if (!engine) return { error: `engine ${engineId} not found`, engines: currentEngines };

  const channel = currentKeys.find((item) => item.id === channelId);
  if (!channel) return { error: `channel ${channelId} not found`, engines: currentEngines };
  if (!engine.channelIds.includes(channelId)) {
    return { error: 'channel is not assigned to engine', engines: currentEngines };
  }
  if (engine.providerType !== channel.providerType) {
    return { error: 'provider type mismatch', engines: currentEngines };
  }

  const updatedEngine = { ...engine, model: nextModel };
  return {
    error: '',
    engine: updatedEngine,
    engines: currentEngines.map((item) => item.id === engineId ? updatedEngine : item),
  };
}
export function resolveEngineRequestModel({ engine }) {
  return String(engine?.model || '').trim();
}

export function selectChannelForEngine(engine, keys, tried, getChannelState = () => ({})) {
  const now = Date.now();
  const pool = keys.filter((key) => {
    const state = getChannelState(key.id);
    return engine.channelIds.includes(key.id)
      && key.enabled !== false
      && !tried.has(key.id)
      && !state.disabled
      && (!state.cooldownUntil || state.cooldownUntil <= now);
  });

  if (pool.length === 0) return null;
  const cursor = (engineCursors.get(engine.id) || 0) % pool.length;
  engineCursors.set(engine.id, cursor + 1);
  return pool[cursor];
}

export function shouldTryNextKey(error) {
  if (error.maybeCharged) return false;
  if (error.retryable === false) return false;
  return true;
}

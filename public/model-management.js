export function imageModelCandidates(payload) {
  const seen = new Set();
  const candidates = Array.isArray(payload?.candidateModels) ? payload.candidateModels : [];
  return candidates
    .map((model) => String(model || '').trim())
    .filter((model) => model && !seen.has(model) && seen.add(model));
}

export function matchingModelEngines(channel, engines) {
  if (!channel) return [];
  const items = Array.isArray(engines) ? engines : [];
  return items.filter((engine) => (
    engine.providerType === channel.providerType
    && Array.isArray(engine.channelIds)
    && engine.channelIds.includes(channel.id)
  ));
}

export function isTestedSelection(testState, channelId, model) {
  return Boolean(
    testState
    && testState.channelId === String(channelId || '')
    && testState.model === String(model || ''),
  );
}

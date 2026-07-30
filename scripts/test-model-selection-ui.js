import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');

assert.match(
  app,
  /let currentModelChannelId = '';/,
  'the selected model channel should be tracked',
);

assert.match(
  app,
  /const selectedChannelChanged = currentModelChannelId !== channelId;/,
  'changing channels should be detected',
);

assert.match(
  app,
  /payload\.providerDefaults\?\.length && \(selectedChannelChanged \|\| !modelInput\.value\)/,
  'a provider default should replace the old model after changing channels',
);

assert.match(
  app,
  /testChannelSelect\.value = channelId;\s+await loadModels\(\{ log: false \}\);/,
  'changing the admin generation channel should sync the model channel and refresh models',
);

assert.match(
  app,
  /model: isAdmin && !currentStatus\?\.imageEnginesConfigured \? form\.get\('model'\) : ''/,
  'multi-engine submissions should leave model selection to the configured engine',
);

assert.match(
  app,
  /imageModelCandidates\(payload\)/,
  'the model manager should consume only provider-classified image candidates',
);

assert.doesNotMatch(
  app,
  /payload\.candidateModels\?\.length\) \? \[\] : \(payload\.models \|\| \[\]\)/,
  'non-image upstream models must never be used as model choices',
);

console.log('model selection UI contract passed');

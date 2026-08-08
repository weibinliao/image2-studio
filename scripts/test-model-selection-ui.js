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
  /model: isAdmin \? form\.get\('model'\) : ''/,
  'member submissions should allow the server to select the configured channel default model',
);

assert.match(
  app,
  /\.\.\.\(\(payload\.providerDefaults\?\.length \|\| payload\.candidateModels\?\.length\) \? \[\] : \(payload\.models \|\| \[\]\)\)/,
  'non-image upstream models should only be shown when no image candidates are available',
);

console.log('model selection UI contract passed');

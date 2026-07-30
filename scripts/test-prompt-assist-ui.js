import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const dimensionsMatch = app.match(/const ASSIST_DIMENSIONS = \[([\s\S]*?)\];/);
assert.ok(dimensionsMatch, 'prompt assist dimensions should be declared in app.js');

const labels = [...dimensionsMatch[1].matchAll(/label:\s*'([^']+)'/g)].map((match) => match[1]);
assert.ok(labels.length > 0, 'prompt assist should expose suggestion labels');

const englishLabels = labels.filter((label) => /[A-Za-z]/.test(label));
assert.deepEqual(
  englishLabels,
  [],
  `prompt assist labels should be Chinese-facing; found: ${englishLabels.join(', ')}`,
);

console.log('prompt assist UI contract passed');

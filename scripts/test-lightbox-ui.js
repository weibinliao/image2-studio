import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const clampSource = app.match(/function clamp\(value, min, max\) \{[\s\S]*?\n\}/)?.[0];
const stageClickSource = app.match(/function handleLightboxStageClick\(event\) \{[\s\S]*?\n\}/)?.[0];

assert.ok(clampSource, 'lightbox zoom should declare the clamp helper it calls');

const clamp = Function(`"use strict"; ${clampSource}; return clamp;`)();

assert.equal(clamp(-1, 0.25, 6), 0.25, 'clamp should enforce the minimum zoom');
assert.equal(clamp(2, 0.25, 6), 2, 'clamp should preserve an in-range zoom');
assert.equal(clamp(10, 0.25, 6), 6, 'clamp should enforce the maximum zoom');

assert.ok(stageClickSource, 'lightbox should declare a testable stage click handler');
assert.match(
  app,
  /lightboxStage\?\.addEventListener\('click', handleLightboxStageClick\)/,
  'lightbox stage should register the edge-click handler',
);

const runStageClick = Function(
  'event',
  'lightboxImage',
  'closeLightbox',
  'dragMoved',
  `"use strict"; let lightboxDragMoved = dragMoved; ${stageClickSource}; handleLightboxStageClick(event); return lightboxDragMoved;`,
);

const stage = { id: 'lightboxStage' };
const image = {
  id: 'lightboxImage',
  contains(target) {
    return target === this;
  },
};

let closeCalls = 0;
let dragMoved = runStageClick({ target: stage }, image, () => { closeCalls += 1; }, false);
assert.equal(closeCalls, 1, 'clicking the lightbox stage edge should close the lightbox');
assert.equal(dragMoved, false);

closeCalls = 0;
dragMoved = runStageClick({ target: image }, image, () => { closeCalls += 1; }, false);
assert.equal(closeCalls, 0, 'clicking the lightbox image should not close the lightbox');
assert.equal(dragMoved, false);

closeCalls = 0;
dragMoved = runStageClick({ target: stage }, image, () => { closeCalls += 1; }, true);
assert.equal(closeCalls, 0, 'the click immediately after a drag should not close the lightbox');
assert.equal(dragMoved, false, 'the drag suppression flag should reset after suppressing one click');

console.log('lightbox UI tests passed');

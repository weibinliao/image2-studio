import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [html, app, styles, skill] = await Promise.all([
  fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  fs.readFile(new URL('../codex-skill/image2-studio-generate/SKILL.md', import.meta.url), 'utf8'),
]);

assert.match(html, /id="inputImage"[^>]*\bmultiple\b/, 'the webpage should accept multiple reference files');
assert.match(html, /Image2 Skills/, 'the prominent Skill install section should be visible');
assert.match(html, /id="importSkillButton"/, 'the single Skill import button should be available');
assert.match(html, /优先从局域网获取；局域网不可用时自动切换到 GitHub/, 'the import fallback should be explained');
assert.match(app, /const MAX_INPUT_IMAGE_COUNT = 8;/, 'the webpage should enforce the eight-image limit');
assert.match(app, /let inputImages = \[\];/, 'multiple reference image state should be tracked');
assert.match(app, /images: mode === 'image' \? inputImages\.map\(\(item\) => item\.dataUrl\) : \[\]/, 'every selected reference should be submitted');
assert.match(app, /data-remove-input/, 'individual reference images should be removable');
assert.match(app, /api\/codex-skill\/install-local/, 'the webpage should support local Agent installation');
assert.match(app, /raw\.githubusercontent\.com\/weibinliao\/image2-studio\/main\/scripts\/install-image2-studio-skill\.ps1/, 'the webpage should provide a GitHub fallback');
assert.match(styles, /\.skill-install-panel/, 'the Skill install section should have dedicated styling');
assert.match(skill, /Treat every image attached to the user's request as a reference automatically/, 'the Skill should automatically consume chat attachments');

console.log('multi-reference webpage and automatic Skill attachment contract passed');

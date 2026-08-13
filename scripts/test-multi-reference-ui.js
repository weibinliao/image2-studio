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
assert.match(html, /id="importSkillButton"/, 'the Skill install command button should be available');
assert.match(html, /id="verifySkillButton"/, 'the Skill verification command button should be available');
assert.match(html, /id="skillInstallProcess"/, 'the Skill install section should show installation progress');
assert.match(html, /优先从本网页的内网服务获取；内网不可用时才从 GitHub 获取模板/, 'the LAN-first client install should be explained');
assert.match(app, /const MAX_INPUT_IMAGE_COUNT = 8;/, 'the webpage should enforce the eight-image limit');
assert.match(app, /let inputImages = \[\];/, 'multiple reference image state should be tracked');
assert.match(app, /images: mode === 'image' \? inputImages\.map\(\(item\) => item\.dataUrl\) : \[\]/, 'every selected reference should be submitted');
assert.match(app, /data-remove-input/, 'individual reference images should be removable');
assert.match(app, /api\/codex-skill\/install-command/, 'the webpage should request a client-side install command');
assert.match(app, /api\/codex-skill\/verify-command/, 'the webpage should request a client-side verification command');
assert.doesNotMatch(app, /api\/codex-skill\/(?:install|verify)-local/, 'a remote browser must not ask the server to install into the server account');
assert.match(app, /extractSkillCommandServerUrl/, 'the webpage should display the server-selected network URL');
assert.match(styles, /\.skill-install-panel/, 'the Skill install section should have dedicated styling');
assert.match(skill, /Treat every image attached to the user's request as a reference automatically/, 'the Skill should automatically consume chat attachments');

console.log('multi-reference webpage and automatic Skill attachment contract passed');

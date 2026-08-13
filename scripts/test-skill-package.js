import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillInstallCommand, buildSkillInstallScript, buildSkillManifest, buildSkillPackage, buildSkillVerifyCommand } from '../skill-package.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skillDir = path.join(root, 'codex-skill', 'image2-studio-generate');

test('downloadable skill archive contains only the required skill files and configured URL', async () => {
  const archive = await buildSkillPackage({
    skillDir,
    serverUrl: 'http://192.0.2.10:3020',
  });
  const visibleContent = archive.toString('utf8');

  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.match(visibleContent, /image2-studio-generate\/SKILL\.md/);
  assert.match(visibleContent, /image2-studio-generate\/agents\/openai\.yaml/);
  assert.match(visibleContent, /image2-studio-generate\/scripts\/generate-image\.mjs/);
  assert.match(visibleContent, /http:\/\/192\.0\.2\.10:3020/);
  assert.doesNotMatch(visibleContent, /IMAGE2_STUDIO_PACKAGE_URL/);
  assert.doesNotMatch(visibleContent, /sk-[A-Za-z0-9_-]{12,}/);
});

test('install command prefers the current Image2 Studio and gives GitHub the same dynamic URL', () => {
  const command = buildSkillInstallCommand({
    serverUrl: 'http://192.0.2.10:3020',
  });

  assert.match(command, /http:\/\/192\.0\.2\.10:3020\/api\/codex-skill\/install\.ps1/);
  assert.match(command, /raw\.githubusercontent\.com\/weibinliao\/image2-studio\/main\/scripts\/install-image2-studio-skill\.ps1/);
  assert.match(command, /-ServerUrl \$server/);
  assert.ok(command.indexOf('/api/codex-skill/install.ps1') < command.indexOf('raw.githubusercontent.com'));
  assert.doesNotMatch(command, /sk-[A-Za-z0-9_-]{12,}/);
});

test('verification command checks the dynamically selected Image2 Studio URL', () => {
  const command = buildSkillVerifyCommand({ serverUrl: 'http://192.0.2.55:4040' });

  assert.match(command, /http:\/\/192\.0\.2\.55:4040/);
  assert.match(command, /\.agents/);
  assert.match(command, /\.codex/);
  assert.match(command, /generate-image\.mjs/);
  assert.match(command, /X-Image2-Role/);
});

test('manifest contains the required UTF-8 skill files and configured URL', async () => {
  const manifest = await buildSkillManifest({
    skillDir,
    serverUrl: 'http://192.0.2.11:3020',
  });

  assert.equal(manifest.name, 'image2-studio-generate');
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.files.map((file) => file.path), [
    'SKILL.md',
    'agents/openai.yaml',
    'scripts/generate-image.mjs',
  ]);
  assert.match(manifest.files.find((file) => file.path.endsWith('generate-image.mjs')).content, /http:\/\/192\.0\.2\.11:3020/);
});

test('direct installer downloads the Skill ZIP and targets only skill directories', () => {
  const script = buildSkillInstallScript({
    serverUrl: 'http://192.0.2.10:3020',
  });

  assert.match(script, /http:\/\/192\.0\.2\.10:3020\/api\/codex-skill/);
  assert.match(script, /api\/codex-skill\/manifest/);
  assert.match(script, /\.agents/);
  assert.match(script, /\.codex/);
  assert.match(script, /image2-studio-generate/);
  assert.doesNotMatch(script, /github|npm|npx|public\/|package\.json/i);
  assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]{12,}/);
});

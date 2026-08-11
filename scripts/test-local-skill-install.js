import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installLocalSkill, verifyLocalSkill } from '../skill-local-install.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(root, 'codex-skill', 'image2-studio-generate');
const serverUrl = 'http://192.0.2.12:3020';

test('local Skill install replaces both Agent directories and verifies the configured server', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-local-skill-'));
  try {
    const before = await verifyLocalSkill({ homeDir, serverUrl });
    assert.equal(before.valid, false);
    assert.equal(before.targets.length, 2);

    const result = await installLocalSkill({ sourceDir, homeDir, serverUrl });
    assert.equal(result.valid, true);
    assert.equal(result.callableAfterRestart, true);
    assert.equal(result.restartRequired, true);
    assert.deepEqual(result.targets.map((target) => target.id), ['agents', 'codex']);
    assert.ok(result.targets.every((target) => target.valid));
    assert.ok(result.targets.every((target) => target.action === 'created'));

    const repeated = await installLocalSkill({ sourceDir, homeDir, serverUrl });
    assert.ok(repeated.targets.every((target) => target.action === 'replaced'));

    const verification = await verifyLocalSkill({ homeDir, serverUrl });
    assert.equal(verification.valid, true);
    assert.ok(verification.targets.every((target) => target.serverUrlConfigured));
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('local Skill verification reports a missing required file', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-local-skill-'));
  try {
    await installLocalSkill({ sourceDir, homeDir, serverUrl });
    await fs.rm(path.join(homeDir, '.codex', 'skills', 'image2-studio-generate', 'agents', 'openai.yaml'));

    const verification = await verifyLocalSkill({ homeDir, serverUrl });
    assert.equal(verification.valid, false);
    const codexTarget = verification.targets.find((target) => target.id === 'codex');
    assert.deepEqual(codexTarget.missingFiles, ['agents/openai.yaml']);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

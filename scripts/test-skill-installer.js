import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildSkillInstallScript, buildSkillManifest, buildSkillPackage } from '../skill-package.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);
const githubFallbackScriptPath = path.join(root, 'scripts', 'install-image2-studio-skill.ps1');

test('npx-style installer copies the skill and writes the server URL', async () => {
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-skill-install-'));
  try {
    execFileSync(process.execPath, [
      path.join(root, 'bin', 'image2-studio-skill.mjs'),
      'install',
      '--url',
      'http://192.0.2.44:3020',
      '--target',
      targetRoot,
    ], { cwd: root, stdio: 'pipe' });

    const skillDir = path.join(targetRoot, 'image2-studio-generate');
    const skillText = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    const scriptText = await fs.readFile(path.join(skillDir, 'scripts', 'generate-image.mjs'), 'utf8');

    assert.match(skillText, /name: image2-studio-generate/);
    assert.match(scriptText, /http:\/\/192\.0\.2\.44:3020/);
    assert.doesNotMatch(scriptText, /IMAGE2_STUDIO_PACKAGE_URL/);
  } finally {
    await fs.rm(targetRoot, { recursive: true, force: true });
  }
});

test('direct installer downloads only the packaged Skill files', { skip: process.platform !== 'win32' }, async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-direct-skill-install-'));
  const installHome = path.join(testRoot, 'home');
  const scriptPath = path.join(testRoot, 'install.ps1');
  const skillDir = path.join(root, 'codex-skill', 'image2-studio-generate');
  const server = http.createServer();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const serverUrl = `http://127.0.0.1:${address.port}`;
    const archive = await buildSkillPackage({ skillDir, serverUrl });
    server.on('request', (request, response) => {
      if (request.url !== '/api/codex-skill') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': archive.length,
      });
      response.end(archive);
    });

    await fs.writeFile(scriptPath, buildSkillInstallScript({ serverUrl }), 'utf8');
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], {
      env: { ...process.env, IMAGE2_SKILL_HOME: installHome },
      windowsHide: true,
    });

    for (const rootName of ['.agents', '.codex']) {
      const installedDir = path.join(installHome, rootName, 'skills', 'image2-studio-generate');
      const files = await listRelativeFiles(installedDir);
      assert.deepEqual(files, ['SKILL.md', 'agents/openai.yaml', 'scripts/generate-image.mjs']);
      const script = await fs.readFile(path.join(installedDir, 'scripts', 'generate-image.mjs'), 'utf8');
      assert.match(script, new RegExp(serverUrl.replaceAll('.', '\\.')));
      assert.doesNotMatch(script, /IMAGE2_STUDIO_PACKAGE_URL/);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test('direct installer can install from the manifest without an archive extractor', { skip: process.platform !== 'win32' }, async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-manifest-skill-install-'));
  const installHome = path.join(testRoot, 'home');
  const scriptPath = path.join(testRoot, 'install.ps1');
  const skillDir = path.join(root, 'codex-skill', 'image2-studio-generate');
  const server = http.createServer();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const serverUrl = `http://127.0.0.1:${address.port}`;
    const manifest = await buildSkillManifest({ skillDir, serverUrl });
    server.on('request', (request, response) => {
      if (request.url !== '/api/codex-skill/manifest') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(manifest));
    });

    await fs.writeFile(scriptPath, buildSkillInstallScript({ serverUrl }), 'utf8');
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
    ], {
      env: { ...process.env, IMAGE2_SKILL_HOME: installHome },
      windowsHide: true,
    });

    const installedDir = path.join(installHome, '.agents', 'skills', 'image2-studio-generate');
    assert.deepEqual(await listRelativeFiles(installedDir), [
      'SKILL.md',
      'agents/openai.yaml',
      'scripts/generate-image.mjs',
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test('GitHub fallback installer copies the bundled Skill without a LAN service', { skip: process.platform !== 'win32' }, async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-github-skill-install-'));
  const installHome = path.join(testRoot, 'home');
  const skillDir = path.join(root, 'codex-skill', 'image2-studio-generate');
  const server = http.createServer(async (request, response) => {
    const relativePath = decodeURIComponent(String(request.url || '').replace(/^\/skill\//, ''));
    if (!['SKILL.md', 'agents/openai.yaml', 'scripts/generate-image.mjs'].includes(relativePath)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(await fs.readFile(path.join(skillDir, ...relativePath.split('/'))));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const githubRoot = `http://127.0.0.1:${address.port}/skill`;

    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      githubFallbackScriptPath,
    ], {
      env: {
        ...process.env,
        IMAGE2_SKILL_HOME: installHome,
        IMAGE2_STUDIO_SKILL_GITHUB_ROOT: githubRoot,
      },
      windowsHide: true,
    });

    for (const rootName of ['.agents', '.codex']) {
      const installedDir = path.join(installHome, rootName, 'skills', 'image2-studio-generate');
      assert.deepEqual(await listRelativeFiles(installedDir), [
        'SKILL.md',
        'agents/openai.yaml',
        'scripts/generate-image.mjs',
      ]);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

async function listRelativeFiles(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else files.push(path.relative(directory, fullPath).replaceAll('\\', '/'));
    }
  }
  await walk(directory);
  return files.sort();
}

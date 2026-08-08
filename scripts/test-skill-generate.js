import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scriptPath = path.join(root, 'codex-skill', 'image2-studio-generate', 'scripts', 'generate-image.mjs');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image2-skill-generate-'));
let submittedBody = null;
const submittedClientIds = [];
let rememberedClientId = 'user_skill_test';

const server = http.createServer(async (request, response) => {
  if (request.url === '/api/client-identity') return json(response, 200, { clientId: rememberedClientId });
  if (request.url === '/api/status') return json(response, 200, { admin: false });
  if (request.method === 'POST' && request.url === '/api/jobs') {
    submittedClientIds.push(request.headers['x-client-id']);
    submittedBody = JSON.parse(await readBody(request));
    return json(response, 202, { job: { id: 'test-job' } });
  }
  if (request.url === '/api/jobs/test-job') {
    return json(response, 200, {
      job: {
        status: 'succeeded',
        progress: 100,
        result: {
          images: [{ localUrl: '/outputs/result.png' }],
          entry: { model: 'hidden-model', key: { name: 'hidden-channel' } },
        },
      },
    });
  }
  if (request.url === '/outputs/result.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    return response.end(pixel);
  }
  return json(response, 404, { error: 'Not found' });
});

try {
  const firstImage = path.join(tempDir, 'first.png');
  const secondImage = path.join(tempDir, 'second.png');
  const outputDir = path.join(tempDir, 'output');
  const isolatedIdentityEnv = { LOCALAPPDATA: tempDir, USERPROFILE: tempDir, HOME: tempDir };
  await Promise.all([fs.writeFile(firstImage, pixel), fs.writeFile(secondImage, pixel)]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  const result = await run(process.execPath, [
    scriptPath,
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--prompt', 'Combine both references',
    '--input-image', firstImage,
    '--input-image', secondImage,
    '--size', '1536x1024',
    '--quality', 'high',
    '--n', '1',
    '--output-dir', outputDir,
  ], isolatedIdentityEnv);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(submittedBody.images.length, 2);
  assert.match(submittedBody.images[0], /^data:image\/png;base64,/);
  assert.match(submittedBody.images[1], /^data:image\/png;base64,/);
  assert.equal(submittedBody.size, '1536x1024');
  assert.equal(submittedBody.quality, 'high');
  assert.equal(submittedBody.n, 1);

  // The first server lookup bootstraps the local identity. A later session
  // must keep that persisted identity even if the server sees another route.
  rememberedClientId = 'user_different_route';
  const secondOutputDir = path.join(tempDir, 'output-second');
  const secondResult = await run(process.execPath, [
    scriptPath,
    '--base-url', `http://127.0.0.1:${address.port}`,
    '--prompt', 'Keep the same member identity',
    '--output-dir', secondOutputDir,
  ], { ...isolatedIdentityEnv, LOCALAPPDATA: path.join(tempDir, 'new-local-appdata') });
  assert.equal(secondResult.code, 0, secondResult.stderr);
  assert.deepEqual(submittedClientIds, ['user_skill_test', 'user_skill_test']);
  await assert.doesNotReject(() => fs.access(path.join(tempDir, 'Image2 Studio', 'codex-skill-client-id')));
  await assert.doesNotReject(() => fs.access(path.join(tempDir, '.image2-studio', 'codex-skill-client-id')));

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.images.length, 1);
  assert.deepEqual(Object.keys(output.images[0]), ['path']);
  assert.doesNotMatch(result.stdout, /hidden-model|hidden-channel|channel|elapsed/i);
  await fs.access(output.images[0].path);
  console.log('Skill generation script supports multiple references and image-only output.');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function run(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

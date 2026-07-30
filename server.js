import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { isSingleImageProvider, providerCapabilities, resolveImageModel } from './provider-models.js';
import { detectProviderType, getAdapter } from './image-providers.js';
import {
  resolveProviderTypeOnAdd,
  resolveProviderTypeOnReprobe,
  updateFileKeyProviderType,
} from './key-provider-store.js';
import {
  resolveEngineRequestModel,
  selectChannelForEngine,
  shouldTryNextKey,
  updateEngineModel,
  validateImageEngine,
} from './engine-routing.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
const KEY_FILE = path.join(DATA_DIR, 'keys.json');
const HIDDEN_KEY_FILE = path.join(DATA_DIR, 'hidden-keys.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit-log.json');
const USER_DIR = path.join(DATA_DIR, 'users');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SECRET_FILE = path.join(DATA_DIR, 'server-secret.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
// Kept out of audit-log.json on purpose: that file is append-only by design
// (DELETE /api/history is a hard 405), so reconciliation marks live beside it.
const RECONCILED_FILE = path.join(DATA_DIR, 'charged-reconciled.json');
// 成员删除是软删除：只在这里记一条，图片文件不动，管理员照旧能看到并恢复。
// 只有管理员删除才真的删文件。
const DELETED_FILE = path.join(DATA_DIR, 'deleted-items.json');

await loadEnv(path.join(ROOT, '.env'));

const config = {
  port: Number(process.env.PORT || 3020),
  host: process.env.HOST || '0.0.0.0',
  publicLanIP: process.env.PUBLIC_LAN_IP || '',
  baseURL: normalizeBaseUrl(process.env.IMAGE2_BASE_URL || ''),
  defaultModel: process.env.IMAGE2_MODEL || 'gpt-image-2',
  userChannelId: process.env.IMAGE2_USER_CHANNEL_ID || '',
  adminChannelId: process.env.IMAGE2_ADMIN_CHANNEL_ID || '',
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 180000),
  // 缩略图长边。墙上的图块是 222px，2x 屏取 480 足够清晰。
  thumbMaxEdge: Number(process.env.THUMB_MAX_EDGE || 480),
};

const runtime = new Map();
const jobs = new Map();
const fileWriteQueues = new Map();
const generateRateBuckets = new Map();

// Declared here rather than beside the job helpers below: restoreJobs() runs from
// the top-level await further down, and a `const` further down the file is still
// in its temporal dead zone at that point.
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const JOB_PERSIST_DEBOUNCE_MS = 1500;
let jobPersistTimer = null;
let jobPersistPending = false;
let roundRobinIndex = -1;

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const CLIENT_TOKEN_COOKIE = 'image2_client_token';
const serverSecret = await ensureServerSecret();
await restoreJobs();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
      return json(res, 200, await buildStatus(req, res));
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/keys') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, { keys: await listPublicKeys() });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/image-engines') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const settings = await readSettings();
      const keys = await getAllKeys();
      const engines = (settings.imageEngines || []).map((engine) => ({
        ...engine,
        channels: engine.channelIds.map((id) => {
          const channel = keys.find((key) => key.id === id);
          return channel ? publicKey(channel) : { id, missing: true };
        }),
      }));
      return json(res, 200, { engines });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/image-engines') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const engines = Array.isArray(body.engines) ? body.engines : [];
      const keys = await getAllKeys();
      const ids = new Set();

      for (const engine of engines) {
        const error = validateImageEngine(engine, keys);
        if (error) return json(res, 400, { error: `引擎 ${engine.id || '?'}: ${error}` });
        if (ids.has(engine.id)) return json(res, 400, { error: `重复的引擎 id: ${engine.id}` });
        ids.add(engine.id);
      }

      const settings = await readSettings();
      await writeSettings({ ...settings, imageEngines: engines });
      return json(res, 200, { ok: true, engines });
    }

    const engineModelPatchMatch = requestUrl.pathname.match(/^\/api\/admin\/image-engines\/([^/]+)\/model$/);
    if (req.method === 'PATCH' && engineModelPatchMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const settings = await readSettings();
      const keys = await getAllKeys();
      const result = updateEngineModel({
        engines: settings.imageEngines || [],
        keys,
        engineId: decodeURIComponent(engineModelPatchMatch[1]),
        channelId: String(body.channelId || '').trim(),
        model: body.model,
      });
      if (result.error) return json(res, 400, { error: result.error });

      await writeSettings({ ...settings, imageEngines: result.engines });
      return json(res, 200, { ok: true, engine: result.engine });
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/models') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return handleModels(res, requestUrl.searchParams.get('channelId') || '');
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/keys') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const record = await addFileKey(body);
      // The probe verdict travels with the response so the admin learns about a
      // dead channel now rather than when a member hits it.
      return json(res, 201, { key: publicKey(record), probe: record.probe });
    }

    const keyProbeMatch = requestUrl.pathname.match(/^\/api\/keys\/([^/]+)\/probe$/);
    if (req.method === 'POST' && keyProbeMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const updated = await reprobeFileKey(keyProbeMatch[1]);
      return json(res, 200, { key: publicKey(updated), probe: updated.probe });
    }

    const keyToggleMatch = requestUrl.pathname.match(/^\/api\/keys\/([^/]+)\/toggle$/);
    if (req.method === 'POST' && keyToggleMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const updated = await setFileKeyEnabled(keyToggleMatch[1], body.enabled !== false);
      return json(res, 200, { key: publicKey(updated) });
    }

    const keyPatchMatch = requestUrl.pathname.match(/^\/api\/keys\/([^/]+)$/);
    if (req.method === 'PATCH' && keyPatchMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const updated = await updateFileKeyProviderType(keyPatchMatch[1], body.providerType, {
        readKeys: () => readJsonFile(KEY_FILE, []),
        writeKeys: (keys) => writeJsonFile(KEY_FILE, keys),
        probeChannel,
      });
      return json(res, 200, { key: publicKey(updated) });
    }

    const keyDeleteMatch = requestUrl.pathname.match(/^\/api\/keys\/([^/]+)$/);
    if (req.method === 'DELETE' && keyDeleteMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const result = await removeKeyRecord(keyDeleteMatch[1]);
      if (!result.removed) return json(res, 404, { error: 'Channel not found' });
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/test-model') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return handleTestModel(req, res);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/settings/user-channel') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return handleSetUserChannel(req, res);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/settings/admin-channel') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return handleSetAdminChannel(req, res);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/settings/appearance') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return handleSetAppearance(req, res);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/generate') {
      return handleGenerate(req, res);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/jobs') {
      return handleCreateJob(req, res);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/jobs') {
      return handleListJobs(req, res);
    }

    const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      return handleGetJob(jobMatch[1], req, res);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/history') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, await readAllUserHistory());
    }

    // 成员可见的失败记录：只有自己的，且字段经过白名单裁剪。
    if (req.method === 'GET' && requestUrl.pathname === '/api/failures') {
      const actor = await getActor(req, res);
      return json(res, 200, { failures: await buildMemberFailures(actor.id) });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/charged') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, await buildChargedReport());
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/admin/charged/reconcile') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      await setReconciled(body.id, body.reconciled !== false, body.note || '');
      return json(res, 200, await buildChargedReport());
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/audit-log') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, { events: await readAuditLog() });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/history') {
      return json(res, 200, { history: await readRepairedUserHistory((await getActor(req, res)).id) });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/client/reset') {
      // The identity cookie is HttpOnly, so switching users has to happen here.
      const minted = newClientId();
      issueClientToken(res, minted);
      return json(res, 200, { clientId: minted });
    }

    // Mints a claim link for an existing archive. Admin-only: this is the one way
    // to take ownership of an id, so it must not be reachable from the LAN.
    if (req.method === 'POST' && requestUrl.pathname === '/api/client/adopt') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });

      const body = await readJson(req);
      const target = safeClientId(body.clientId || '');
      if (!target || target === 'default') return json(res, 400, { error: 'clientId is required' });

      const origin = getLanUrls()[0] || `http://localhost:${config.port}`;
      return json(res, 200, {
        clientId: target,
        claimUrl: `${origin}/claim?token=${encodeURIComponent(makeClaimToken(target))}`,
        expiresInMinutes: Math.round(CLAIM_TOKEN_TTL_MS / 60000),
      });
    }

    // The owner of a pre-token archive opens this in their own browser to bind
    // the identity cookie. Consuming the link is the only path where a caller
    // ends up with an id they did not just receive.
    if (req.method === 'GET' && requestUrl.pathname === '/claim') {
      const claim = verifyClaimToken(requestUrl.searchParams.get('token'));
      if (!claim.ok) {
        const reason = claim.reason === 'expired' ? '认领链接已过期，请让管理员重新生成。' : '认领链接无效。';
        return html(res, 400, claimResultPage(false, reason));
      }

      issueClientToken(res, claim.clientId);
      return html(res, 200, claimResultPage(true, `已绑定档案 ${claim.clientId}，历史记录会回到这个浏览器。`));
    }

    // 删除一条。成员 = 软删除（只是自己看不到，管理员可恢复）；
    // 管理员 = 真删除（删图片文件和缩略图缓存）。
    const historyItemMatch = requestUrl.pathname.match(/^\/api\/history\/([^/]+)$/);
    if (req.method === 'DELETE' && historyItemMatch) {
      const actor = await getActor(req, res);
      const id = decodeURIComponent(historyItemMatch[1]);

      if (actor.role === 'admin') {
        const { history } = await readAllUserHistory();
        const item = history.find((entry) => entry.id === id);
        if (!item) return json(res, 404, { error: '记录不存在' });

        await hardDeleteItem(item);
        return json(res, 200, { deleted: 'permanent', id });
      }

      // 成员只能删自己的。用未过滤的索引查，避免"已软删的再删一次"报 404。
      const own = await repairUserHistoryIndex(actor.id, await readAuditLog());
      if (!own.some((entry) => entry.id === id)) {
        return json(res, 404, { error: '记录不存在或不属于你' });
      }

      await softDeleteItem(id, actor.id);
      return json(res, 200, { deleted: 'hidden', id });
    }

    // 恢复被成员删除的条目。只有管理员能做。
    const restoreMatch = requestUrl.pathname.match(/^\/api\/history\/([^/]+)\/restore$/);
    if (req.method === 'POST' && restoreMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });

      const id = decodeURIComponent(restoreMatch[1]);
      const existed = await restoreItem(id);
      if (!existed) return json(res, 404, { error: '这条记录没有被删除' });
      return json(res, 200, { restored: id });
    }

    if (req.method === 'DELETE' && requestUrl.pathname === '/api/history') {
      return json(res, 405, { error: 'History is an append-only audit archive and cannot be cleared.' });
    }

    // 缩略图走同一套归属校验（resolveOutputRequest），不会绕过 /outputs/ 的权限。
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/thumbs/')) {
      return serveThumb(requestUrl.pathname, req, res);
    }

    if (req.method === 'GET' && requestUrl.pathname.startsWith('/outputs/')) {
      return serveOutput(requestUrl.pathname, req, res);
    }

    if (req.method === 'GET') {
      return serveStatic(requestUrl.pathname, res);
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return json(res, 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Image2 Studio local: http://localhost:${config.port}`);
  for (const url of getLanUrls()) {
    console.log(`Image2 Studio LAN:   ${url}`);
  }
});

// `npm run stop` sends SIGTERM, which exits immediately by default and would
// drop the debounced job snapshot. Flush it before going away.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (jobPersistTimer) clearTimeout(jobPersistTimer);
    try {
      await persistJobs();
    } catch {
      // Nothing useful left to do on the way out.
    }
    process.exit(0);
  });
}

async function handleGenerate(req, res) {
  const body = await readJson(req, 32 * 1024 * 1024);
  const actor = await getActor(req, res);
  const result = await runGenerateRequest(body, () => {}, actor.id, actor.role);
  return json(res, result.status, result.payload);
}

async function handleCreateJob(req, res) {
  const body = await readJson(req, 32 * 1024 * 1024);
  // Resolve the actor before responding: issuing an identity cookie needs the
  // headers to still be open.
  const actor = await getActor(req, res);

  const limit = checkGenerateRateLimit(actor, req);
  if (!limit.ok) {
    return json(res, 429, { error: `生成请求过于频繁，请在 ${limit.retryAfterSeconds} 秒后重试。`, retryAfterSeconds: limit.retryAfterSeconds });
  }

  const job = {
    id: crypto.randomUUID(),
    ownerId: actor.id,
    ok: true,
    status: 'queued',
    progress: 3,
    stage: '已入队',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null,
  };

  jobs.set(job.id, job);
  scheduleJobPersist();
  queueMicrotask(() => runJob(job.id, body, actor.id, actor.role));
  return json(res, 202, { job: publicJob(job) });
}

// Lets a browser that was closed mid-generation find its way back to the run.
// Without this, "submit and walk away" only works if the tab survives.
async function handleListJobs(req, res) {
  const actor = await getActor(req, res);
  const mine = [];

  for (const job of jobs.values()) {
    if (actor.role !== 'admin' && job.ownerId !== actor.id) continue;
    mine.push(publicJob(job));
  }

  mine.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  return json(res, 200, { jobs: mine.slice(0, 20) });
}

async function handleGetJob(id, req, res) {
  const job = jobs.get(id);
  if (!job) return json(res, 404, { error: 'Job not found' });

  // A job carries the prompt and the finished images, so knowing the id is not
  // enough — the caller has to own it.
  const actor = await getActor(req, res);
  if (actor.role !== 'admin' && job.ownerId && job.ownerId !== actor.id) {
    return json(res, 403, { error: 'Forbidden' });
  }

  updateEstimatedProgress(job);
  return json(res, 200, { job: publicJob(job) });
}

async function runJob(id, body, clientId, actorRole = 'member') {
  const job = jobs.get(id);
  if (!job) return;

  try {
    setJobProgress(job, 'running', 8, '准备请求参数');
    const result = await runGenerateRequest(body, (progress, stage) => {
      setJobProgress(job, 'running', progress, stage);
    }, clientId, actorRole);

    if (result.status >= 200 && result.status < 300) {
      job.ok = true;
      job.status = 'succeeded';
      job.progress = 100;
      job.stage = '生成完成';
      job.result = result.payload;
      job.updatedAt = new Date().toISOString();
    } else {
      job.ok = false;
      job.status = 'failed';
      job.progress = 100;
      job.stage = '生成失败';
      job.error = result.payload;
      job.updatedAt = new Date().toISOString();
    }
  } catch (error) {
    job.ok = false;
    job.status = 'failed';
    job.progress = 100;
    job.stage = '生成失败';
    job.error = { error: error.message || 'Job failed' };
    job.updatedAt = new Date().toISOString();
  } finally {
    // Terminal state: write it straight through rather than waiting on the
    // debounce, so a restart right after completion still finds the result.
    await persistJobs();
  }
}

async function runGenerateRequest(body, onProgress = () => {}, clientId = 'default', actorRole = 'member') {
  const prompt = String(body.prompt || '').trim();
  if (!prompt) return { status: 400, payload: { error: 'Prompt is required' } };

  const keys = await getAllKeys();
  if (keys.length === 0) return { status: 400, payload: { error: 'No API keys configured' } };

  onProgress(12, '正在构建图片请求');
  const requestedModel = actorRole === 'admin' ? String(body.model || '').trim() : '';
  const upstreamBody = buildImageRequest(body, prompt, '', actorRole);
  const mode = hasInputImages(upstreamBody) ? 'image-to-image' : 'text-to-image';

  const settings = await readSettings();
  const engines = settings.imageEngines;

  if (engines && engines.length > 0) {
    return runGenerateWithEngines(
      engines,
      keys,
      body,
      upstreamBody,
      requestedModel,
      mode,
      prompt,
      onProgress,
      clientId,
      actorRole,
    );
  }

  return runGenerateLegacy(
    keys,
    upstreamBody,
    requestedModel,
    mode,
    prompt,
    onProgress,
    clientId,
    actorRole,
  );
}

async function runGenerateWithEngines(
  engines,
  keys,
  body,
  upstreamBody,
  requestedModel,
  mode,
  prompt,
  onProgress,
  clientId,
  actorRole,
) {
  const requestedEngineId = String(body.engineId || '').trim();
  const enabledEngines = engines.filter((engine) => engine.enabled);
  const memberVisible = enabledEngines.filter((engine) => engine.memberEnabled);

  let candidateEngines;
  if (requestedEngineId && requestedEngineId !== 'auto') {
    const engine = memberVisible.find((item) => item.id === requestedEngineId);
    if (!engine) {
      return { status: 400, payload: { error: `引擎 ${requestedEngineId} 不可用` } };
    }
    candidateEngines = [engine];
  } else {
    candidateEngines = memberVisible
      .filter((engine) => engine.autoEnabled)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    if (candidateEngines.length === 0) candidateEngines = memberVisible;
  }

  const isManual = candidateEngines.length === 1 && requestedEngineId && requestedEngineId !== 'auto';
  const attempts = [];
  let lastError = null;

  for (const engine of candidateEngines) {
    const tried = new Set();
    for (;;) {
      const selected = selectChannelForEngine(engine, keys, tried, getState);
      if (!selected) break;
      tried.add(selected.id);

      const model = resolveEngineRequestModel({ engine, requestedModel, actorRole });
      const selectedRequest = { ...upstreamBody, ...(model ? { model } : {}) };
      const selectedPublic = publicKey(selected);

      try {
        onProgress(mode === 'image-to-image' ? 24 : 32, `正在调用 ${selected.name || selected.id}`);
        const upstream = await callImageApi(selected, selectedRequest);
        markSuccess(selected.id);

        onProgress(88, '上游已返回，正在保存图片');
        const images = await normalizeAndStoreImages(upstream, prompt, clientId);
        const entry = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          prompt,
          negativePrompt: body.negativePrompt || '',
          model: selectedRequest.model || model,
          mode,
          size: upstreamBody.size || '',
          n: upstreamBody.n || images.length,
          seed: upstreamBody.seed === undefined ? '' : String(upstreamBody.seed),
          key: selectedPublic,
          images,
        };
        await saveHistory(entry, clientId);
        await appendAuditEvent({
          status: 'succeeded',
          clientId,
          actorRole,
          requestedEngineId,
          resolvedEngineId: engine.id,
          providerType: engine.providerType,
          model: selectedRequest.model || model,
          channel: selectedPublic,
          mode,
          size: upstreamBody.size || '',
          imageCount: images.length,
          images,
          prompt,
        });
        attempts.push({ key: selectedPublic, ok: true });
        return {
          status: 200,
          payload: { ok: true, images, entry, attempts, resolvedEngineId: engine.id },
        };
      } catch (error) {
        lastError = error;
        markFailure(selected.id, error);
        await appendAuditEvent({
          status: 'failed',
          clientId,
          actorRole,
          requestedEngineId,
          resolvedEngineId: engine.id,
          providerType: engine.providerType,
          model: selectedRequest.model || model,
          channel: selectedPublic,
          mode,
          size: upstreamBody.size || '',
          imageCount: 0,
          prompt,
          error: error.publicMessage || error.message,
          errorCode: error.code || '',
          errorCategory: error.category || '',
          retryable: Boolean(error.retryable),
          maybeCharged: Boolean(error.maybeCharged),
          details: error.details || null,
        });
        attempts.push({
          key: selectedPublic,
          ok: false,
          status: error.status || 0,
          error: error.publicMessage || error.message,
          errorCode: error.code || '',
          errorCategory: error.category || '',
          retryable: Boolean(error.retryable),
          maybeCharged: Boolean(error.maybeCharged),
        });

        if (!shouldTryNextKey(error)) {
          return {
            status: statusFromError(lastError),
            payload: { error: lastError.publicMessage || lastError.message, attempts },
          };
        }
      }
    }

    if (isManual) break;
  }

  return {
    status: statusFromError(lastError),
    payload: {
      error: lastError?.publicMessage || lastError?.message || 'No usable engine/channel',
      attempts,
    },
  };
}

async function runGenerateLegacy(
  keys,
  upstreamBody,
  requestedModel,
  mode,
  prompt,
  onProgress,
  clientId,
  actorRole,
) {
  const generationChannelId = await resolveGenerationChannelId(actorRole, keys);
  if (!generationChannelId) {
    return {
      status: 400,
      payload: { error: actorRole === 'admin' ? 'No admin channel configured' : 'No member channel configured' },
    };
  }

  const tried = new Set();
  const attempts = [];
  const maxAttempts = Math.max(1, keys.filter((key) => key.enabled !== false).length);
  let lastError = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const selected = selectKey(keys, tried, { preferredId: generationChannelId, strictPreferred: false, advance: false });
    if (!selected) {
      const configuredChannel = keys.find((key) => key.id === generationChannelId);
      lastError = upstreamError(actorRole === 'admin' ? '管理员生图渠道不可用' : '成员生图渠道不可用', 503);
      await appendAuditEvent({
        status: 'failed',
        clientId,
        actorRole,
        model: resolveImageModel(configuredChannel, requestedModel, config.defaultModel),
        channel: configuredChannel ? publicKey(configuredChannel) : { id: generationChannelId, name: generationChannelId },
        mode,
        size: upstreamBody.size || '',
        imageCount: 0,
        prompt,
        error: lastError.publicMessage,
      });
      break;
    }

    tried.add(selected.id);
    const selectedPublic = publicKey(selected);
    const selectedRequest = {
      ...upstreamBody,
      model: resolveImageModel(selected, requestedModel, config.defaultModel),
    };

    try {
      onProgress(mode === 'image-to-image' ? 24 : 32, `正在调用 ${selected.name || selected.id}`);
      const upstream = await callImageApi(selected, selectedRequest);
      markSuccess(selected.id);

      onProgress(88, '上游已返回，正在保存图片');
      const images = await normalizeAndStoreImages(upstream, prompt, clientId);
      const entry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        prompt,
        negativePrompt: upstreamBody.negative_prompt || '',
        model: selectedRequest.model,
        mode,
        size: upstreamBody.size || '',
        n: upstreamBody.n || images.length,
        // 记下实际发出去的 seed，否则"填相同 seed 可复现"这句话没法照做——
        // 用户看不到上次用的是几。留空时上游自己随机，我们无从得知，存空字符串。
        seed: upstreamBody.seed === undefined ? '' : String(upstreamBody.seed),
        key: selectedPublic,
        images,
      };
      await saveHistory(entry, clientId);
      await appendAuditEvent({
        status: 'succeeded',
        clientId,
        actorRole,
        model: selectedRequest.model,
        channel: selectedPublic,
        mode,
        size: upstreamBody.size || '',
        imageCount: images.length,
        images,
        prompt,
      });

      attempts.push({ key: selectedPublic, ok: true });
      return { status: 200, payload: { ok: true, images, entry, attempts } };
    } catch (error) {
      lastError = error;
      markFailure(selected.id, error);
      await appendAuditEvent({
        status: 'failed',
        clientId,
        actorRole,
        model: selectedRequest.model,
        channel: selectedPublic,
        mode,
        size: upstreamBody.size || '',
        imageCount: 0,
        prompt,
        error: error.publicMessage || error.message,
        errorCode: error.code || '',
        errorCategory: error.category || '',
        retryable: Boolean(error.retryable),
        maybeCharged: Boolean(error.maybeCharged),
        details: error.details || null,
      });
      attempts.push({
        key: selectedPublic,
        ok: false,
        status: error.status || 0,
        error: error.publicMessage || error.message,
        errorCode: error.code || '',
        errorCategory: error.category || '',
        retryable: Boolean(error.retryable),
        maybeCharged: Boolean(error.maybeCharged),
      });

      if (!shouldTryNextKey(error)) {
        break;
      }
    }
  }

  return {
    status: statusFromError(lastError),
    payload: {
      error: lastError?.publicMessage || lastError?.message || 'No usable API key available',
      attempts,
    },
  };
}

function setJobProgress(job, status, progress, stage) {
  job.status = status;
  job.progress = Math.max(job.progress || 0, Math.min(99, progress));
  job.stage = stage;
  job.updatedAt = new Date().toISOString();
  scheduleJobPersist();
}

// Jobs used to live only in the `jobs` Map, so a restart mid-generation left the
// browser polling a 404 forever — which is why nobody dared close the tab during
// a 5-15 minute image-to-image run. (Constants are declared near the top of the
// file because restoreJobs() runs before this point.)

// Progress ticks every couple of seconds per job; writing the file on each one
// would be pointless churn, so coalesce them.
function scheduleJobPersist() {
  jobPersistPending = true;
  if (jobPersistTimer) return;
  jobPersistTimer = setTimeout(() => {
    jobPersistTimer = null;
    if (jobPersistPending) persistJobs();
  }, JOB_PERSIST_DEBOUNCE_MS);
}

async function persistJobs() {
  jobPersistPending = false;
  const now = Date.now();
  const serializable = [];

  for (const [id, job] of jobs) {
    const age = now - Date.parse(job.createdAt || 0);
    if (Number.isFinite(age) && age > JOB_TTL_MS) {
      jobs.delete(id);
      continue;
    }
    serializable.push(job);
  }

  try {
    await enqueueFileWrite(JOBS_FILE, () => writeJsonFileAtomic(JOBS_FILE, serializable));
  } catch {
    // A failed job snapshot must never take a running generation down with it.
  }
}

async function restoreJobs() {
  const stored = await readJsonFile(JOBS_FILE, []);
  if (!Array.isArray(stored)) return;

  const now = Date.now();
  let interrupted = 0;

  for (const job of stored) {
    if (!job?.id) continue;
    const age = now - Date.parse(job.createdAt || 0);
    if (Number.isFinite(age) && age > JOB_TTL_MS) continue;

    // Reloading a job does not resume the upstream fetch that was in flight, so
    // anything unfinished is genuinely dead. Say so instead of letting the client
    // poll a job that will never advance. The request may still have been billed.
    if (job.status === 'running' || job.status === 'queued') {
      job.ok = false;
      job.status = 'failed';
      job.progress = 100;
      job.stage = '服务重启，任务中断';
      job.error = {
        error: '服务在生成过程中重启，这个任务已中断。上游可能已经计费，请先到历史记录确认是否已出图，再决定是否重试。',
        maybeCharged: true,
        interruptedByRestart: true,
      };
      job.updatedAt = new Date().toISOString();
      interrupted += 1;
    }

    jobs.set(job.id, job);
  }

  if (jobs.size > 0) {
    console.log(`Restored ${jobs.size} job(s) from disk${interrupted ? `, ${interrupted} marked interrupted` : ''}.`);
  }
}

// 真实阶段。服务端只有三个 checkpoint（构建请求 12、调用上游 24/32、
// 上游返回 88），中间那段占了绝大部分时间，而我们确实不知道上游进行到哪了。
// 所以不再编百分比，改成"第几步 + 已等待多久"——后者是事实。
const JOB_STEPS = ['已入队', '正在构建请求', '正在等待上游生成', '正在保存图片'];

// 终态要返回 totalSteps（= 全部完成），不能返回最后一个索引：那会被前端当成
// "正在进行最后一步"而一直转圈——图都已经显示出来了还在转，图返回就是成功。
function stepFromProgress(progress, status) {
  if (status === 'succeeded' || status === 'failed') return JOB_STEPS.length;
  if (progress >= 88) return 3;
  if (progress >= 20) return 2;
  if (progress >= 12) return 1;
  return 0;
}

// 只更新"已等待时间"这一个事实。原来这里按 timeoutMs 插值算出一个假百分比，
// 爬到 92% 就卡住不动，和上游真实状态毫无关系。
function updateEstimatedProgress(job) {
  if (job.status !== 'running' && job.status !== 'queued') return;

  const startedAt = Date.parse(job.createdAt || job.updatedAt || Date.now());
  job.elapsedMs = Math.max(0, Date.now() - startedAt);
}

function publicJob(job) {
  return {
    id: job.id,
    ok: job.ok,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    // 真实阶段与已等待时间。progress 仍然保留（旧字段），但前端现在显示的是
    // step / totalSteps 和 elapsedMs，因为那两个不是编的。
    step: stepFromProgress(job.progress || 0, job.status),
    totalSteps: JOB_STEPS.length,
    steps: JOB_STEPS,
    elapsedMs: job.elapsedMs || 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.result,
    error: job.error,
  };
}

async function handleModels(res, channelId = '') {
  const keys = await getAllKeys();
  const selected = selectKey(keys, new Set(), { advance: false, preferredId: channelId, strictPreferred: Boolean(channelId) });
  if (!selected) {
    return json(res, 400, { error: 'No usable API key available' });
  }

  try {
    const result = await getAdapter(selected).listModels(selected, Math.min(config.timeoutMs, 30000));
    return json(res, 200, { ...result, key: publicKey(selected) });
  } catch (error) {
    markFailure(selected.id, error);
    return json(res, statusFromError(error), { error: error.publicMessage || error.message || 'Failed to load models' });
  }
}

async function handleTestModel(req, res) {
  const body = await readJson(req, 2 * 1024 * 1024);
  const keys = await getAllKeys();
  const selected = selectKey(keys, new Set(), { advance: false, preferredId: body.channelId, strictPreferred: Boolean(body.channelId) });

  if (!selected) {
    return json(res, 400, { error: 'No usable API key available' });
  }

  const model = resolveImageModel(selected, body.model, config.defaultModel);
  const prompt = String(body.prompt || 'A tiny green check mark icon on a black background, simple, clean.').trim();
  const requestBody = buildImageRequest({
    model,
    prompt,
    size: body.size || '1024x1024',
    quality: body.quality || 'low',
    extraParams: {
      output_format: body.outputFormat || 'png',
    },
  }, prompt);

  try {
    const upstream = await callImageApi(selected, requestBody);
    const images = await normalizeAndStoreImages(upstream, prompt);
    markSuccess(selected.id);
    await appendAuditEvent({
      status: 'succeeded',
      clientId: 'admin',
      actorRole: 'admin',
      model,
      channel: publicKey(selected),
      mode: 'model-test',
      size: requestBody.size || '',
      imageCount: images.length,
      images,
      prompt,
    });
    return json(res, 200, {
      ok: true,
      model,
      channel: publicKey(selected),
      images,
      message: '模型真实生图测试成功。',
    });
  } catch (error) {
    markFailure(selected.id, error);
    await appendAuditEvent({
      status: 'failed',
      clientId: 'admin',
      actorRole: 'admin',
      model,
      channel: publicKey(selected),
      mode: 'model-test',
      size: requestBody.size || '',
      imageCount: 0,
      prompt,
      error: error.publicMessage || error.message || '模型生图测试失败。',
    });
    return json(res, statusFromError(error), {
      ok: false,
      model,
      channel: publicKey(selected),
      error: error.publicMessage || error.message || '模型生图测试失败。',
      status: error.status || 0,
    });
  }
}

async function handleSetUserChannel(req, res) {
  return handleSetGenerationChannel(req, res, 'userChannelId', 'userChannel');
}

async function handleSetAdminChannel(req, res) {
  return handleSetGenerationChannel(req, res, 'adminChannelId', 'adminChannel');
}

async function handleSetGenerationChannel(req, res, settingKey, responseKey) {
  const body = await readJson(req);
  const channelId = String(body.channelId || '').trim();
  const keys = await getAllKeys();
  const selected = keys.find((key) => key.id === channelId);

  if (!selected) {
    return json(res, 400, { error: 'Channel not found' });
  }

  if (selected.enabled === false) {
    return json(res, 400, { error: 'Cannot assign a disabled channel' });
  }

  const settings = await readSettings();
  await writeSettings({ ...settings, [settingKey]: channelId });
  return json(res, 200, { ok: true, [settingKey]: channelId, [responseKey]: publicKey(selected) });
}

const DEFAULT_APPEARANCE = Object.freeze({ brandName: 'Image2 Studio', brandIcon: 'I2' });

async function handleSetAppearance(req, res) {
  const body = await readJson(req);
  const appearance = normalizeAppearance(body);
  const settings = await readSettings();
  await writeSettings({ ...settings, appearance });
  return json(res, 200, { ok: true, appearance });
}

async function readAppearance() {
  const settings = await readSettings();
  return normalizeAppearance(settings.appearance || {});
}

function normalizeAppearance(input = {}) {
  const brandName = String(input.brandName || input.name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 32) || DEFAULT_APPEARANCE.brandName;
  const brandIcon = [...String(input.brandIcon || input.icon || '')
    .trim()
    .replace(/\s+/g, '')]
    .slice(0, 2)
    .join('') || DEFAULT_APPEARANCE.brandIcon;
  return { brandName, brandIcon };
}

// Keys a member may set through the "advanced params JSON" box. Anything that
// picks the model or multiplies upstream cost stays out; the client blanks
// `model` for members but that is a UI-side guard only, so enforce it here.
const MEMBER_EXTRA_PARAM_KEYS = new Set([
  'output_format',
  'format',
  'background',
  'style',
  'quality',
  'size',
  'negative_prompt',
  'seed',
  'response_format',
  'moderation',
  'output_compression',
]);

function pickExtraParams(extraParams, actorRole) {
  if (!extraParams || typeof extraParams !== 'object' || Array.isArray(extraParams)) return {};
  if (actorRole === 'admin') return { ...extraParams };

  const allowed = {};
  for (const [key, value] of Object.entries(extraParams)) {
    if (MEMBER_EXTRA_PARAM_KEYS.has(key)) allowed[key] = value;
  }
  return allowed;
}

function buildImageRequest(input, prompt, defaultModel = config.defaultModel, actorRole = 'admin') {
  const model = String(input.model || defaultModel || '').trim();
  const request = {
    prompt,
  };
  if (model) request.model = model;

  if (input.negativePrompt) request.negative_prompt = String(input.negativePrompt);
  if (input.size) request.size = String(input.size);
  // Guard both against NaN: the seed box is free text, and `Number('abc')` would
  // otherwise put a bare `null` in the upstream JSON body.
  if (input.n !== undefined && input.n !== '') {
    const count = Number(input.n);
    if (Number.isFinite(count)) request.n = clamp(Math.round(count), 1, 8);
  }
  if (input.responseFormat) request.response_format = String(input.responseFormat);
  if (input.quality) request.quality = String(input.quality);
  if (input.style) request.style = String(input.style);
  if (input.seed !== undefined && input.seed !== '') {
    const seed = Number(input.seed);
    if (Number.isFinite(seed)) request.seed = Math.trunc(seed);
  }
  if (Array.isArray(input.images)) request.images = input.images;
  if (input.image) request.image = input.image;
  if (input.input_image) request.input_image = input.input_image;
  if (Array.isArray(input.input_images)) request.input_images = input.input_images;
  if (input.mask) request.mask = input.mask;

  Object.assign(request, pickExtraParams(input.extraParams, actorRole));

  // Re-clamp after the merge so an allowed key cannot smuggle a larger batch in.
  if (request.n !== undefined) request.n = clamp(Number(request.n) || 1, 1, 8);

  return request;
}

function buildProviderImageRequest(selected, requestBody) {
  const images = normalizeImageReferences(requestBody.images || requestBody.input_images || requestBody.image || requestBody.input_image);
  const mask = firstImageReference(requestBody.mask || requestBody.mask_path);

  if (isSingleImageProvider(selected)) {
    const outputFormat = String(requestBody.output_format || requestBody.format || 'png').toLowerCase();
    const payload = {
      ...requestBody,
      model: requestBody.model || 'gpt-image-2',
      response_format: 'b64_json',
      stream: false,
      size: requestBody.size || '1024x1024',
      quality: requestBody.quality || 'high',
      output_format: outputFormat === 'jpg' ? 'jpeg' : outputFormat,
    };
    if (images.length > 0) payload.images = images.map((imageURL) => ({ image_url: imageURL }));
    else delete payload.images;
    delete payload.image;
    delete payload.input_image;
    delete payload.input_images;
    if (mask) payload.mask = { image_url: mask };
    delete payload.n;
    return payload;
  }

  const payload = { ...requestBody };
  if (images.length > 0) payload.images = images.map((imageURL) => ({ image_url: imageURL }));
  if (mask) payload.mask = { image_url: mask };
  delete payload.image;
  delete payload.input_image;
  delete payload.input_images;
  return payload;
}

async function callImageApi(selected, requestBody) {
  const adapter = getAdapter(selected);
  // buildProviderImageRequest remains mirrored inside the openai-images adapter;
  // the Gemini adapter receives requestBody and maps it to generateContent.
  return adapter.generate(selected, requestBody, config.timeoutMs);
}
function hasInputImages(payload) {
  return normalizeImageReferences(payload?.images || payload?.input_images || payload?.image || payload?.input_image).length > 0;
}

function normalizeImageReferences(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'object') return item.image_url || item.url || item.dataUrl || '';
      return String(item || '').trim();
    })
    .filter(Boolean);
}

function firstImageReference(value) {
  return normalizeImageReferences(value)[0] || '';
}

function isEventStreamContentType(contentType) {
  return /text\/event-stream/i.test(String(contentType || ''));
}

function parseImageSSE(text) {
  let lastError = null;
  for (const event of parseSSEDataEvents(text)) {
    if (!event || event === '[DONE]') continue;
    const payload = parseMaybeJson(event);
    if (!payload || typeof payload === 'string') continue;

    if (payload.error) {
      lastError = payload.error;
      continue;
    }

    if (String(payload.type || '').endsWith('.completed')) {
      return { data: [payload] };
    }
  }

  if (lastError) {
    throw upstreamError(extractErrorMessage({ error: lastError }, '') || 'Upstream stream returned an error', 502, lastError);
  }

  throw upstreamError('Upstream image stream did not contain a completed image event', 502);
}

function parseSSEDataEvents(text) {
  const events = [];
  let current = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (rawLine === '') {
      if (current.length > 0) events.push(current.join('\n'));
      current = [];
      continue;
    }
    if (rawLine.startsWith('data:')) current.push(rawLine.slice(5).trimStart());
  }
  if (current.length > 0) events.push(current.join('\n'));
  return events;
}

async function normalizeAndStoreImages(upstream, prompt, clientId = 'default') {
  const items = collectImageItems(upstream);
  if (items.length === 0) {
    throw upstreamError('Upstream response did not contain any image URL or base64 image', 502, upstream);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const images = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const revisedPrompt = item.revised_prompt || item.revisedPrompt || prompt;

    if (item.b64_json) {
      const saved = await saveBase64Image(item.b64_json, `${stamp}-${index}.png`, clientId);
      images.push({ url: saved.url, localUrl: saved.url, revisedPrompt, source: 'base64' });
      continue;
    }

    if (item.dataUrl) {
      const saved = await saveDataUrlImage(item.dataUrl, `${stamp}-${index}`, clientId);
      images.push({ url: saved.url, localUrl: saved.url, revisedPrompt, source: 'data-url' });
      continue;
    }

    if (item.url) {
      const downloaded = await downloadImage(item.url, `${stamp}-${index}`, clientId);
      images.push({
        url: downloaded?.url || item.url,
        localUrl: downloaded?.url || '',
        remoteUrl: item.url,
        revisedPrompt,
        source: downloaded ? 'downloaded-url' : 'remote-url',
      });
    }
  }

  return images;
}

function collectImageItems(upstream) {
  const direct = [];
  const candidates = [upstream?.data, upstream?.images, upstream?.output, upstream?.result, upstream?.results];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      direct.push(...candidate);
    }
  }

  if (direct.length === 0 && upstream?.url) {
    direct.push(upstream);
  }

  return direct.flatMap((item) => {
    if (!item) return [];
    if (typeof item === 'string') {
      if (item.startsWith('data:image/')) return [{ dataUrl: item }];
      if (looksLikeBase64(item)) return [{ b64_json: item }];
      return [{ url: item }];
    }

    const imageUrl = item.url || item.image_url || item.imageUrl || item.output_url;
    const b64 = item.b64_json || item.base64 || item.image_base64;
    const dataUrl = typeof imageUrl === 'string' && imageUrl.startsWith('data:image/') ? imageUrl : item.dataUrl;

    return [{
      ...item,
      url: dataUrl ? '' : imageUrl,
      dataUrl,
      b64_json: b64,
    }];
  }).filter((item) => item.url || item.b64_json || item.dataUrl);
}

function collectModelIds(payload) {
  const raw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return raw
    .map((item) => (typeof item === 'string' ? item : item.id || item.name || item.model))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function saveBase64Image(base64, filename, clientId = 'default') {
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const outputDir = userOutputDir(clientId);
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, path.basename(filename));
  await fs.writeFile(filePath, Buffer.from(clean, 'base64'));
  return { url: `/outputs/${safeClientId(clientId)}/${path.basename(filename)}` };
}

async function saveDataUrlImage(dataUrl, filenameWithoutExtension, clientId = 'default') {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw upstreamError('Invalid data URL image returned by upstream', 502);
  }

  const extension = extensionFromContentType(match[1]);
  return saveBase64Image(match[2], `${filenameWithoutExtension}.${extension}`, clientId);
}

async function downloadImage(url, filenameWithoutExtension, clientId = 'default') {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(config.timeoutMs, 60000)) });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) return null;

    const extension = extensionFromContentType(contentType);
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `${filenameWithoutExtension}.${extension}`;
    const outputDir = userOutputDir(clientId);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, filename), buffer);
    return { url: `/outputs/${safeClientId(clientId)}/${filename}` };
  } catch {
    return null;
  }
}

async function buildStatus(req, res = null) {
  const keys = await listPublicKeys();
  const admin = isAdminRequest(req);
  // Identity now lives in an HttpOnly cookie the page cannot read, so hand the
  // resolved id back here. This is also where a first-time visitor gets one.
  const actor = await getActor(req, res);
  const settings = await readSettings();
  const allKeys = await getAllKeys();
  const memberEngines = (settings.imageEngines || [])
    .filter((engine) => engine.enabled && engine.memberEnabled)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map((engine) => {
      const adapter = getAdapter({ providerType: engine.providerType });
      const firstChannel = allKeys.find(
        (key) => engine.channelIds.includes(key.id) && key.enabled !== false,
      );
      return {
        id: engine.id,
        label: engine.label,
        capabilities: adapter.capabilities(firstChannel || null),
        available: engine.channelIds.some((id) => {
          const channel = allKeys.find((key) => key.id === id);
          return channel && channel.enabled !== false && !getState(id).disabled;
        }),
        ...(admin ? {
          providerType: engine.providerType,
          model: engine.model,
          channels: engine.channelIds
            .map((id) => allKeys.find((key) => key.id === id))
            .filter((channel) => channel && channel.enabled !== false && !getState(channel.id).disabled)
            .map(publicKey),
        } : {}),
      };
    });
  const userChannelId = await resolveUserChannelId();
  const adminChannelId = await resolveAdminChannelId();
  const userChannel = keys.find((key) => key.id === userChannelId) || null;
  const adminChannel = keys.find((key) => key.id === adminChannelId) || null;

  // Capabilities of the channel this caller's generations will actually use, so
  // the UI can hide a control the provider would silently ignore rather than
  // accepting input and discarding it.
  const effectiveChannel = admin ? adminChannel : userChannel;
  return {
    admin,
    clientId: actor.id,
    capabilities: providerCapabilities(effectiveChannel),
    engines: memberEngines,
    imageEnginesConfigured: Array.isArray(settings.imageEngines) && settings.imageEngines.length > 0,
    appearance: await readAppearance(),
    ...(admin ? {
      baseURL: keys[0]?.baseURL || (config.baseURL ? hideUrlSecret(config.baseURL) : ''),
      defaultModel: config.defaultModel,
    } : {}),
    userChannelId: admin ? userChannelId : '',
    userChannel: admin ? userChannel : null,
    adminChannelId: admin ? adminChannelId : '',
    adminChannel: admin ? adminChannel : null,
    port: config.port,
    host: config.host,
    localUrl: `http://localhost:${config.port}`,
    lanUrls: getLanUrls(),
    keyCount: keys.length,
    readyKeyCount: keys.filter((key) => key.enabled && !key.coolingDown && !key.disabledByRuntime).length,
    keys: admin ? keys : [],
  };
}

async function listPublicKeys() {
  return (await getAllKeys()).map(publicKey);
}

async function getAllKeys() {
  const hiddenIds = new Set(await readJsonFile(HIDDEN_KEY_FILE, []));
  const channelKeys = getEnvChannels();
  const envKeys = String(process.env.IMAGE2_API_KEYS || process.env.IMAGE2_API_KEY || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key, index) => ({
      id: `env-${index + 1}`,
      name: `Env Key ${index + 1}`,
      key,
      baseURL: normalizeBaseUrl(config.baseURL),
      enabled: true,
      source: 'env',
      createdAt: '',
    }))
    .filter((key) => key.baseURL);

  const fileKeys = await readJsonFile(KEY_FILE, []);
  return [...channelKeys, ...envKeys, ...fileKeys.filter((item) => item.key && item.baseURL)]
    .map((key) => ({
      ...key,
      baseURL: normalizeBaseUrl(key.baseURL),
    }))
    .filter((key) => !hiddenIds.has(key.id));
}

function getEnvChannels() {
  const channels = [];
  for (let index = 1; index <= 50; index += 1) {
    const key = process.env[`IMAGE2_CHANNEL_${index}_API_KEY`];
    const baseURL = process.env[`IMAGE2_CHANNEL_${index}_BASE_URL`];
    if (!key || !baseURL) continue;

    channels.push({
      id: `channel-${index}`,
      name: process.env[`IMAGE2_CHANNEL_${index}_NAME`] || `Channel ${index}`,
      key: key.trim(),
      baseURL: normalizeBaseUrl(baseURL),
      enabled: process.env[`IMAGE2_CHANNEL_${index}_ENABLED`] !== 'false',
      source: 'env',
      createdAt: '',
    });
  }

  return channels;
}

async function readSettings() {
  return readJsonFile(SETTINGS_FILE, {});
}

async function writeSettings(settings) {
  await writeJsonFile(SETTINGS_FILE, settings);
}

async function resolveUserChannelId(keys = null) {
  return resolveConfiguredChannelId('userChannelId', config.userChannelId, keys);
}

async function resolveAdminChannelId(keys = null) {
  return resolveConfiguredChannelId('adminChannelId', config.adminChannelId || config.userChannelId, keys);
}

async function resolveGenerationChannelId(actorRole, keys = null) {
  return actorRole === 'admin' ? resolveAdminChannelId(keys) : resolveUserChannelId(keys);
}

async function resolveConfiguredChannelId(settingKey, envValue, keys = null) {
  const allKeys = keys || await getAllKeys();
  if (allKeys.length === 0) return '';

  const settings = await readSettings();
  const explicitId = String(settings[settingKey] || envValue || '').trim();
  if (explicitId) {
    return allKeys.some((key) => key.id === explicitId) ? explicitId : '';
  }

  return allKeys.find((key) => key.enabled !== false)?.id || '';
}

// 27% of all recorded failures (112 of 414) were configuration problems rather
// than upstream faults — a channel that was never usable, discovered only when a
// member tried to generate. Checking at save time moves that discovery to the
// person who can actually fix it.
async function probeChannel(channel) {
  const adapter = getAdapter(channel);
  return adapter.probe(channel, 15000);
}

async function addFileKey(input) {
  const key = String(input.key || '').trim();
  const baseURL = normalizeBaseUrl(input.baseURL || config.baseURL);
  if (!key) throw new Error('API key is required');
  if (!baseURL) throw new Error('API base URL is required');

  const detection = await detectProviderType({ key, baseURL });
  const providerType = resolveProviderTypeOnAdd(input, detection);

  // Probed before saving, but a failed probe does not block the save: /models is
  // optional upstream, so a channel can legitimately fail it and still generate.
  // The caller decides what to do with the verdict.
  const probe = await probeChannel({ key, baseURL, providerType });
  if (!detection.confident && detection.reason) {
    probe.providerTypeNote = `协议未能自动判定，已按 ${providerType} 保存（${detection.reason}）。请在渠道列表确认协议。`;
  }

  const existing = await readJsonFile(KEY_FILE, []);
  const record = {
    id: crypto.randomUUID(),
    name: String(input.name || `Key ${existing.length + 1}`).trim(),
    key,
    baseURL,
    providerType,
    enabled: input.enabled !== false,
    source: 'file',
    createdAt: new Date().toISOString(),
    probe,
  };

  await writeJsonFile(KEY_FILE, [...existing, record]);
  return record;
}

async function reprobeFileKey(id) {
  const existing = await readJsonFile(KEY_FILE, []);
  const index = existing.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('Only file-backed keys can be probed here');

  const current = existing[index];
  const detection = await detectProviderType(current);

  // 探测判不准（上游 503/超时）时保留管理员已确认的协议。
  // 否则一次上游抖动就会把 gemini-native 悄悄改回 openai-images。
  const providerType = resolveProviderTypeOnReprobe(current, detection);
  const changed = { ...current, providerType };
  const probe = await probeChannel(changed);

  // 让管理员看到“协议没动过”以及为什么。
  if (!detection.confident && detection.reason) {
    probe.providerTypeNote = `协议保持 ${providerType}（${detection.reason}）`;
  }

  existing[index] = { ...changed, probe };
  await writeJsonFile(KEY_FILE, existing);
  return existing[index];
}

async function setFileKeyEnabled(id, enabled) {
  const existing = await readJsonFile(KEY_FILE, []);
  const index = existing.findIndex((item) => item.id === id);
  if (index === -1) throw new Error('Only file-backed keys can be changed here');

  existing[index] = { ...existing[index], enabled };
  await writeJsonFile(KEY_FILE, existing);
  return existing[index];
}

async function removeKeyRecord(id) {
  const existing = await readJsonFile(KEY_FILE, []);
  const next = existing.filter((item) => item.id !== id);

  if (next.length !== existing.length) {
    await writeJsonFile(KEY_FILE, next);
    return { removed: true, source: 'file' };
  }

  const envRemoved = await removeEnvKeyRecord(id);
  if (envRemoved) return { removed: true, source: 'env' };

  return { removed: false, source: '' };
}

async function removeEnvKeyRecord(id) {
  const channelMatch = String(id).match(/^channel-(\d+)$/);
  if (channelMatch) {
    const index = Number(channelMatch[1]);
    const keys = [
      `IMAGE2_CHANNEL_${index}_NAME`,
      `IMAGE2_CHANNEL_${index}_BASE_URL`,
      `IMAGE2_CHANNEL_${index}_API_KEY`,
      `IMAGE2_CHANNEL_${index}_ENABLED`,
    ];
    const changed = await removeEnvKeys(keys);
    for (const key of keys) delete process.env[key];
    return changed;
  }

  const envMatch = String(id).match(/^env-(\d+)$/);
  if (envMatch) {
    const index = Number(envMatch[1]) - 1;
    const raw = String(process.env.IMAGE2_API_KEYS || process.env.IMAGE2_API_KEY || '');
    const values = raw.split(',').map((key) => key.trim()).filter(Boolean);
    if (index < 0 || index >= values.length) return false;

    values.splice(index, 1);
    process.env.IMAGE2_API_KEYS = values.join(',');
    delete process.env.IMAGE2_API_KEY;
    await setEnvValue('IMAGE2_API_KEYS', process.env.IMAGE2_API_KEYS);
    await removeEnvKeys(['IMAGE2_API_KEY']);
    return true;
  }

  return false;
}

async function removeEnvKeys(keys) {
  const keySet = new Set(keys);
  const content = await readEnvText();
  let changed = false;
  const lines = content.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    const splitAt = trimmed.indexOf('=');
    if (splitAt === -1) return true;
    const key = trimmed.slice(0, splitAt).trim();
    if (!keySet.has(key)) return true;
    changed = true;
    return false;
  });

  if (changed) await writeEnvText(lines.join('\n'));
  return changed;
}

async function setEnvValue(key, value) {
  const content = await readEnvText();
  const lines = content.split(/\r?\n/);
  let changed = false;
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    const splitAt = trimmed.indexOf('=');
    if (splitAt === -1) return line;
    const currentKey = trimmed.slice(0, splitAt).trim();
    if (currentKey !== key) return line;
    found = true;
    changed = true;
    return `${key}=${value}`;
  });

  if (!found) {
    next.push(`${key}=${value}`);
    changed = true;
  }

  if (changed) await writeEnvText(next.join('\n'));
}

async function readEnvText() {
  try {
    return await fs.readFile(path.join(ROOT, '.env'), 'utf8');
  } catch {
    return '';
  }
}

async function writeEnvText(content) {
  const normalized = `${String(content).replace(/\s+$/g, '')}\n`;
  await fs.writeFile(path.join(ROOT, '.env'), normalized, 'utf8');
}

function selectKey(keys, tried, options = {}) {
  const now = Date.now();
  const candidates = keys.filter((key) => {
    const state = getState(key.id);
    return key.enabled !== false && !tried.has(key.id) && !state.disabled && (!state.cooldownUntil || state.cooldownUntil <= now);
  });

  if (options.preferredId) {
    const preferred = candidates.find((key) => key.id === options.preferredId);
    if (preferred) return preferred;
    if (options.strictPreferred) return null;
  }

  if (candidates.length === 0) return null;
  if (options.advance === false) {
    return candidates[0];
  }

  roundRobinIndex = (roundRobinIndex + 1) % candidates.length;
  return candidates[roundRobinIndex];
}

function publicKey(key) {
  const state = getState(key.id);
  const cooldownRemainingMs = Math.max(0, (state.cooldownUntil || 0) - Date.now());

  return {
    id: key.id,
    name: key.name || key.id,
    providerType: key.providerType || 'openai-images',
    source: key.source || 'file',
    masked: maskKey(key.key),
    baseURL: hideUrlSecret(key.baseURL || ''),
    enabled: key.enabled !== false,
    disabledByRuntime: Boolean(state.disabled),
    coolingDown: cooldownRemainingMs > 0,
    cooldownRemainingSeconds: Math.ceil(cooldownRemainingMs / 1000),
    successes: state.successes,
    failures: state.failures,
    lastError: state.lastError,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    // Save-time connectivity verdict. Contains no secret — only ok/when/message.
    probe: key.probe || null,
  };
}

function markSuccess(id) {
  const state = getState(id);
  state.successes += 1;
  state.lastSuccessAt = new Date().toISOString();
  state.lastError = '';
  state.cooldownUntil = 0;
}

function markFailure(id, error) {
  const state = getState(id);
  state.failures += 1;
  state.lastFailureAt = new Date().toISOString();
  state.lastError = error.publicMessage || error.message || 'Request failed';

  if (error.status === 401 || error.status === 403) {
    state.disabled = true;
  }

  if (error.status === 429) {
    state.cooldownUntil = Date.now() + 120000;
  }

  if ([408, 500, 502, 503, 504, 0].includes(error.status || 0)) {
    state.cooldownUntil = Date.now() + 15000;
  }
}

function getState(id) {
  if (!runtime.has(id)) {
    runtime.set(id, {
      successes: 0,
      failures: 0,
      disabled: false,
      cooldownUntil: 0,
      lastError: '',
      lastSuccessAt: '',
      lastFailureAt: '',
    });
  }

  return runtime.get(id);
}

function statusFromError(error) {
  if (!error?.status) return 502;
  if (error.status === 401 || error.status === 403) return 502;
  if (error.status >= 400 && error.status < 500) return error.status;
  return 502;
}

async function saveHistory(entry, clientId = 'default') {
  const filePath = historyFileForClient(clientId);
  await updateJsonArrayFile(filePath, (history) => mergeHistoryEntries([entry, ...history]));
}

async function appendAuditEvent(event) {
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: event.status || 'unknown',
    clientId: safeClientId(event.clientId || 'default'),
    actorRole: event.actorRole === 'admin' ? 'admin' : 'member',
    requestedEngineId: String(event.requestedEngineId || ''),
    resolvedEngineId: String(event.resolvedEngineId || ''),
    providerType: String(event.providerType || ''),
    model: String(event.model || ''),
    channel: event.channel || null,
    mode: String(event.mode || ''),
    size: String(event.size || ''),
    imageCount: Number(event.imageCount || 0),
    prompt: String(event.prompt || ''),
    images: normalizeAuditImages(event.images),
    error: String(event.error || ''),
    errorCode: String(event.errorCode || ''),
    errorCategory: String(event.errorCategory || ''),
    retryable: Boolean(event.retryable),
    maybeCharged: Boolean(event.maybeCharged),
    details: normalizeAuditDetails(event.details),
  };
  await updateJsonArrayFile(AUDIT_LOG_FILE, (events) => [entry, ...events]);
}

function normalizeAuditImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => ({
      url: String(image?.url || ''),
      localUrl: String(image?.localUrl || image?.url || ''),
      remoteUrl: String(image?.remoteUrl || ''),
      revisedPrompt: String(image?.revisedPrompt || ''),
      source: String(image?.source || ''),
    }))
    .filter((image) => image.url || image.localUrl || image.remoteUrl);
}

function normalizeAuditDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  return {
    endpoint: String(details.endpoint || ''),
    method: String(details.method || ''),
    httpStatus: details.httpStatus === undefined ? '' : String(details.httpStatus),
    durationMs: Number(details.durationMs || 0),
    stream: Boolean(details.stream),
    responseFormat: String(details.responseFormat || ''),
    contentType: String(details.contentType || ''),
    size: String(details.size || ''),
    quality: String(details.quality || ''),
    hasInputImages: Boolean(details.hasInputImages),
    originalError: String(details.originalError || ''),
    networkMessage: String(details.networkMessage || ''),
    responsePreview: String(details.responsePreview || '').slice(0, 500),
  };
}

async function readAuditLog() {
  return readJsonFile(AUDIT_LOG_FILE, []);
}

// A member whose generation fails has nowhere to see why: the image never
// appears on the wall and the failure only lands in the admin-only audit log.
// That is exactly the situation behind the 119 rapid retries on 2026-07-22 —
// someone clicking every 5 seconds for 28 minutes with no feedback.
//
// Whitelist the fields deliberately: the raw audit record carries `channel`
// (name + masked key) and `details` (upstream endpoint URL), neither of which a
// member should see.
async function buildMemberFailures(clientId) {
  const events = await readAuditLog();

  return events
    .filter((event) => event.status === 'failed' && (event.clientId || 'default') === clientId)
    .slice(0, 50)
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      prompt: event.prompt || '',
      mode: event.mode || '',
      size: event.size || '',
      // 面向用户的说法，不是上游原文
      reason: memberFacingReason(event),
      retryable: Boolean(event.retryable),
      maybeCharged: Boolean(event.maybeCharged),
    }));
}

// 上游原文对成员没有意义（"No available compatible accounts"、"fetch failed"
// 之类），他真正需要的是"该不该重试、要不要改参数"。
//
// 分支按日志里的真实分布写：415 条失败里 222 条根本没有 errorCode，最常见的原文
// 是"图片参数未在模型合同中声明"(72)、"An error occurred..."(40)、
// "fetch failed"(25)。只按 errorCode 分类会有 40% 落进兜底。
function memberFacingReason(event) {
  const code = String(event.errorCode || '');
  const raw = String(event.error || '');

  // 配置/服务不可用：重试一万次也不会成功，必须说清楚。
  if (/渠道不可用|No member channel|No API keys|No available compatible accounts/i.test(raw)) {
    return { text: '生图服务当前不可用，需要管理员处理。重试不会成功，请先联系管理员。', retry: false };
  }
  if (code === 'UPSTREAM_AUTH_FAILED' || /invalid api key|unauthorized|401|403/i.test(raw)) {
    return { text: '生图渠道的凭据失效了，需要管理员更换。重试不会成功。', retry: false };
  }

  // 参数问题：重试同样的参数没用，得改尺寸或质量。
  if (/参数未在模型合同中声明|not declared in the model contract|invalid_request_error|unsupported/i.test(raw)) {
    return { text: '当前的尺寸或格式组合这个模型不支持。换一个尺寸（比如 1024×1024）再试。', retry: false };
  }

  if (code === 'UPSTREAM_RATE_LIMITED' || /rate limit/i.test(raw)) {
    return { text: '请求太密集，超出了服务额度。等几分钟再试。', retry: true };
  }
  if (code === 'UPSTREAM_TIMEOUT' || /timeout|timed out/i.test(raw)) {
    return { text: '上游太久没返回图片，任务超时。可以直接重试。', retry: true };
  }
  if (code === 'UPSTREAM_CONNECTION_TERMINATED' || /terminated|socket hang up/i.test(raw)) {
    return { text: '和上游的连接中途断开。重试前先看一眼图是不是其实已经生成了。', retry: true };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(raw)) {
    return { text: '连不上上游服务，可能是网络波动。稍等一下再试。', retry: true };
  }
  if (code === 'UPSTREAM_SERVICE_ERROR' || /An error occurred while processing/i.test(raw)) {
    return { text: '上游服务临时故障，不是你的提示词的问题。稍后重试。', retry: true };
  }

  // 兜底：不要自相矛盾——说"重试无用"就不要同时写"可以重试一次"。
  return { text: '生成失败，原因未能识别。可以重试一次，如果一直失败请联系管理员。', retry: true };
}

// 25 failures across the log are flagged maybeCharged: the upstream connection
// dropped after the request went out, so money may be gone with no image to show
// for it. Until now they were only findable by grepping the log by hand.
// 成员删除 = 软删除（只记 id，文件保留，管理员可恢复）
// 管理员删除 = 真删除（删图片文件 + 缩略图缓存）
async function readDeletedItems() {
  const stored = await readJsonFile(DELETED_FILE, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

async function softDeleteItem(id, clientId) {
  return enqueueFileWrite(DELETED_FILE, async () => {
    const current = await readDeletedItems();
    current[id] = { at: new Date().toISOString(), by: clientId };
    await writeJsonFileAtomic(DELETED_FILE, current);
    return current[id];
  });
}

async function restoreItem(id) {
  return enqueueFileWrite(DELETED_FILE, async () => {
    const current = await readDeletedItems();
    const existed = Boolean(current[id]);
    delete current[id];
    await writeJsonFileAtomic(DELETED_FILE, current);
    return existed;
  });
}

// 真删除：图片文件 + 对应的缩略图缓存都要清掉，否则缩略图会变成孤儿。
async function hardDeleteItem(item) {
  const owner = safeClientId(item.ownerClientId || 'default');

  for (const image of item.images || []) {
    const url = String(image.url || '');
    if (!url.startsWith('/outputs/')) continue;

    const parts = decodeURIComponent(url.replace('/outputs/', '')).split('/').filter(Boolean);
    const name = path.basename(parts.length >= 2 ? parts.slice(1).join('/') : (parts[0] || ''));
    if (!name) continue;

    const dir = parts.length >= 2 ? userOutputDir(safeClientId(parts[0])) : OUTPUT_DIR;
    await fs.rm(path.join(dir, name), { force: true });
    await fs.rm(thumbCachePath(parts.length >= 2 ? safeClientId(parts[0]) : '', name), { force: true });
  }

  // 从该用户的历史索引里移除。审计日志不动——它是 append-only 的记录，
  // 删图不该抹掉"这次生成发生过"的事实。
  const historyPath = userHistoryFile(owner);
  const stored = await readJsonFile(historyPath, []);
  if (Array.isArray(stored)) {
    const next = stored.filter((entry) => entry.id !== item.id);
    await enqueueFileWrite(historyPath, () => writeJsonFileAtomic(historyPath, next));
  }

  // 软删除记录也清掉，避免留下指向已不存在条目的垃圾。
  await restoreItem(item.id);
}

async function readReconciled() {
  const stored = await readJsonFile(RECONCILED_FILE, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

async function buildChargedReport() {
  const [events, reconciled] = await Promise.all([readAuditLog(), readReconciled()]);

  const items = events
    .filter((event) => event.maybeCharged)
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      clientId: event.clientId || 'default',
      actorRole: event.actorRole || 'member',
      model: event.model || '',
      channel: event.channel ? { name: event.channel.name || '', masked: event.channel.masked || '' } : null,
      size: event.size || '',
      prompt: event.prompt || '',
      error: event.error || '',
      errorCode: event.errorCode || '',
      reconciled: Boolean(reconciled[event.id]),
      reconciledAt: reconciled[event.id]?.at || '',
      note: reconciled[event.id]?.note || '',
    }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const open = items.filter((item) => !item.reconciled);
  const byUser = {};
  for (const item of open) byUser[item.clientId] = (byUser[item.clientId] || 0) + 1;

  return {
    items,
    total: items.length,
    openCount: open.length,
    reconciledCount: items.length - open.length,
    byUser: Object.entries(byUser).sort((a, b) => b[1] - a[1]).map(([clientId, count]) => ({ clientId, count })),
  };
}

async function setReconciled(id, done, note = '') {
  const target = String(id || '');
  if (!target) throw new Error('id is required');

  return enqueueFileWrite(RECONCILED_FILE, async () => {
    const current = await readReconciled();
    if (done) {
      current[target] = { at: new Date().toISOString(), note: String(note || '').slice(0, 300) };
    } else {
      delete current[target];
    }
    await writeJsonFileAtomic(RECONCILED_FILE, current);
    return current[target] || null;
  });
}

async function serveStatic(urlPath, res) {
  const pathname = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const target = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!target.startsWith(PUBLIC_DIR)) {
    return text(res, 403, 'Forbidden');
  }

  try {
    const data = await fs.readFile(target);
    // No cache headers at all meant browsers cached app.js/css heuristically, so a
    // reload could keep running the previous build. Generated images under
    // /outputs still get long-lived caching in serveOutput — those never change.
    res.writeHead(200, {
      'Content-Type': contentTypeForPath(target),
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(data);
  } catch {
    text(res, 404, 'Not found');
  }
}

// Shared by /outputs/ and /thumbs/ so the thumbnail route cannot drift from the
// original's authorization. Getting this wrong once already leaked other members'
// images (the old check compared against the caller-supplied X-Client-Id header).
// Returns { ok:false } to deny, or { ok:true, target, owner } to serve.
function resolveOutputRequest(relPath, req) {
  const parts = decodeURIComponent(relPath).split('/').filter(Boolean);
  const isAdmin = isAdminRequest(req);
  // Authorization uses the signed cookie only. `X-Client-Id` is attacker-chosen,
  // so comparing against it let anyone read another member's images by naming
  // their id. No claiming here either: fetching an image must not mint identity.
  const provenClientId = verifiedClientId(req);

  if (parts.length >= 2) {
    if (!isAdmin && safeClientId(parts[0]) !== provenClientId) return { ok: false };
  } else if (!isAdmin) {
    // Legacy flat directory predates per-user folders; treat it as admin-only.
    return { ok: false };
  }

  const owner = parts.length >= 2 ? safeClientId(parts[0]) : '';
  const name = path.basename(parts.length >= 2 ? parts.slice(1).join('/') : (parts[0] || ''));
  const target = owner ? path.join(userOutputDir(owner), name) : path.join(OUTPUT_DIR, name);

  return { ok: true, target, owner, name, isAdmin };
}

// 缩略图：按需生成一次，之后走磁盘缓存。
// 墙上的图块只有 222px，而原图平均 2.3MB（748 张共 1712MB），一屏可能要下
// 46~216MB。480px 的 JPEG 实测约 64KB，差 28 倍。
const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
const THUMB_SCRIPT = path.join(ROOT, 'scripts', 'make-thumb.ps1');
const thumbJobs = new Map();

// 首屏 24 张图会同时请求缩略图。每次生成都要起一个 PowerShell 进程（约 400ms +
// 可观的内存），24 个一起上会有相当一部分超时失败、回落到原图——正好在最需要
// 省流量的冷启动时刻失效。所以限制同时只跑 4 个，其余排队。
const THUMB_CONCURRENCY = 4;
let thumbRunning = 0;
const thumbQueue = [];

function acquireThumbSlot() {
  if (thumbRunning < THUMB_CONCURRENCY) {
    thumbRunning += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => thumbQueue.push(resolve));
}

function releaseThumbSlot() {
  const next = thumbQueue.shift();
  if (next) next();
  else thumbRunning -= 1;
}

function thumbCachePath(owner, name) {
  // 用 owner+name 的哈希做文件名，避免路径穿越，也不用建嵌套目录。
  const key = crypto.createHash('sha1').update(`${owner}/${name}`).digest('hex');
  return path.join(THUMB_DIR, `${key}.jpg`);
}

async function ensureThumb(source, cachePath) {
  // 已有缓存且比原图新 → 直接用。
  try {
    const [thumbStat, srcStat] = await Promise.all([fs.stat(cachePath), fs.stat(source)]);
    if (thumbStat.mtimeMs >= srcStat.mtimeMs) return true;
  } catch {
    // 没缓存，继续生成。
  }

  // 同一张图并发请求时只生成一次。
  if (thumbJobs.has(cachePath)) return thumbJobs.get(cachePath);

  const job = (async () => {
    await fs.mkdir(THUMB_DIR, { recursive: true });
    await acquireThumbSlot();
    try {
      // 排队期间可能已经被另一个请求生成好了，再查一次省一次进程启动。
      try {
        await fs.access(cachePath);
        return true;
      } catch {
        // 还没有，继续生成。
      }

      // execFile 传参数数组，不经 shell —— 文件名里的引号或分号不会变成命令。
      // 刻意不加 -ExecutionPolicy Bypass：那会降低这台机器的脚本执行防护，而本机
      // 策略是 RemoteSigned，本地创建的脚本本来就允许运行，不需要绕过。
      await execFileAsync('powershell', [
        '-NoProfile', '-NonInteractive',
        '-File', THUMB_SCRIPT,
        '-SourcePath', source,
        '-TargetPath', cachePath,
        '-MaxEdge', String(config.thumbMaxEdge),
      ], { timeout: 30000, windowsHide: true });
      return true;
    } catch {
      // 生成失败（非图片、损坏、PowerShell 不可用）时回退到原图，
      // 页面照常能看，只是这一张没省流量。
      return false;
    } finally {
      releaseThumbSlot();
      thumbJobs.delete(cachePath);
    }
  })();

  thumbJobs.set(cachePath, job);
  return job;
}

async function serveThumb(urlPath, req, res) {
  const resolved = resolveOutputRequest(urlPath.replace('/thumbs/', ''), req);
  if (!resolved.ok) return text(res, 403, 'Forbidden');

  const cachePath = thumbCachePath(resolved.owner, resolved.name);
  const ready = await ensureThumb(resolved.target, cachePath);

  try {
    const data = await fs.readFile(ready ? cachePath : resolved.target);
    res.writeHead(200, {
      'Content-Type': ready ? 'image/jpeg' : contentTypeForPath(resolved.target),
      // 回落的原图绝对不能长缓存：生成失败一次，浏览器就会把整张原图永久锁在
      // 缩略图 URL 下（immutable 一年），之后即使缓存生成好了也再也不请求。
      // 实测就是这样让首屏 24 张全部退化成原图的。
      'Cache-Control': ready
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    });
    res.end(data);
  } catch {
    text(res, 404, 'Not found');
  }
}

async function serveOutput(urlPath, req, res) {
  const resolved = resolveOutputRequest(urlPath.replace('/outputs/', ''), req);
  if (!resolved.ok) return text(res, 403, 'Forbidden');

  try {
    const data = await fs.readFile(resolved.target);
    res.writeHead(200, {
      'Content-Type': contentTypeForPath(resolved.target),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(data);
  } catch {
    text(res, 404, 'Not found');
  }
}

async function readJson(req, limit = 256 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('Request body is too large');
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await writeJsonFileAtomic(filePath, value);
}

async function updateJsonArrayFile(filePath, updater) {
  return enqueueFileWrite(filePath, async () => {
    const current = await readJsonFile(filePath, []);
    const currentArray = Array.isArray(current) ? current : [];
    const next = updater(currentArray);
    await writeJsonFileAtomic(filePath, Array.isArray(next) ? next : []);
  });
}

function enqueueFileWrite(filePath, task) {
  const previous = fileWriteQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  let tracked;
  tracked = next.finally(() => {
    if (fileWriteQueues.get(filePath) === tracked) {
      fileWriteQueues.delete(filePath);
    }
  });
  fileWriteQueues.set(filePath, tracked);
  return next;
}

async function writeJsonFileAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(payload);
}

function html(res, status, markup) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(markup);
}

function escapeHtmlText(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[char]));
}

function claimResultPage(ok, message) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${ok ? '认领成功' : '认领失败'} · Image2 Studio</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #080b10; color: #f7f1e8;
    font-family: "Aptos", "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  .card { width: min(440px, calc(100vw - 32px)); padding: 28px;
    border: 1px solid rgba(168,183,204,0.28); border-left: 3px solid ${ok ? '#50e3a4' : '#ff6b6b'};
    border-radius: 8px; background: rgba(24,30,42,0.94); }
  h1 { margin: 0 0 10px; font-size: 17px; }
  p { margin: 0 0 20px; font-size: 13px; line-height: 1.6; color: #9daaba; }
  a { display: inline-block; padding: 9px 16px; border: 1px solid rgba(168,183,204,0.28);
    border-radius: 6px; color: #f6c96d; font-size: 13px; text-decoration: none; }
  a:hover { background: rgba(255,255,255,0.045); }
</style>
</head>
<body>
  <main class="card">
    <h1>${ok ? '档案已认领' : '无法认领'}</h1>
    <p>${escapeHtmlText(message)}</p>
    <a href="/">返回工作台</a>
  </main>
</body>
</html>`;
}

// Every generation spends upstream credit and a failure walks the whole key
// list, so cap how fast one member can queue work. Admin is left alone.
const GENERATE_RATE_WINDOW_MS = 60 * 1000;
const GENERATE_RATE_MAX = 6;

// Keyed on the peer address, not the client id: dropping the identity cookie
// mints a fresh id on every request, so an id-keyed bucket resets for free.
function checkGenerateRateLimit(actor, req) {
  if (actor.role === 'admin') return { ok: true };

  const bucketKey = normalizeRemoteAddress(req.socket?.remoteAddress || '') || actor.id;
  const now = Date.now();
  const recent = (generateRateBuckets.get(bucketKey) || []).filter((at) => now - at < GENERATE_RATE_WINDOW_MS);

  if (recent.length >= GENERATE_RATE_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((GENERATE_RATE_WINDOW_MS - (now - recent[0])) / 1000));
    generateRateBuckets.set(bucketKey, recent);
    return { ok: false, retryAfterSeconds };
  }

  recent.push(now);
  generateRateBuckets.set(bucketKey, recent);

  // The map would otherwise grow one entry per address forever.
  if (generateRateBuckets.size > 500) {
    for (const [key, stamps] of generateRateBuckets) {
      if (stamps.every((at) => now - at >= GENERATE_RATE_WINDOW_MS)) generateRateBuckets.delete(key);
    }
  }
  return { ok: true };
}

async function ensureServerSecret() {
  const existing = await readJsonFile(SECRET_FILE, null);
  if (existing && typeof existing.secret === 'string' && existing.secret) return existing.secret;

  const secret = crypto.randomBytes(32).toString('hex');
  await writeJsonFile(SECRET_FILE, { secret, createdAt: new Date().toISOString() });
  return secret;
}

function signClientId(clientId) {
  return crypto.createHmac('sha256', serverSecret).update(clientId).digest('base64url');
}

function makeClientToken(clientId) {
  return `${clientId}.${signClientId(clientId)}`;
}

// Returns the client id only when the signature checks out, so a caller cannot
// name themselves. An empty string means "no proven identity".
function verifyClientToken(token) {
  const raw = String(token || '');
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return '';

  const id = raw.slice(0, separator);
  const provided = Buffer.from(raw.slice(separator + 1));
  const expected = Buffer.from(signClientId(id));
  if (provided.length !== expected.length) return '';
  if (!crypto.timingSafeEqual(provided, expected)) return '';

  return safeClientId(id) === id ? id : '';
}

function verifiedClientId(req) {
  return verifyClientToken(parseCookies(req.headers.cookie || '')[CLIENT_TOKEN_COOKIE]);
}

// Claim tokens are deliberately NOT cookie tokens: a link gets pasted into chat
// logs and screenshots, so it expires, and its signature covers a different
// message so it can never be replayed as a session cookie.
const CLAIM_TOKEN_TTL_MS = 30 * 60 * 1000;

function signClaim(clientId, expiresAt) {
  return crypto.createHmac('sha256', serverSecret).update(`claim:${clientId}:${expiresAt}`).digest('base64url');
}

function makeClaimToken(clientId) {
  const expiresAt = Date.now() + CLAIM_TOKEN_TTL_MS;
  return `${clientId}.${expiresAt}.${signClaim(clientId, expiresAt)}`;
}

function verifyClaimToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [id, expiresRaw, signature] = parts;
  if (safeClientId(id) !== id) return { ok: false, reason: 'malformed' };

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };

  const provided = Buffer.from(signature);
  const expected = Buffer.from(signClaim(id, expiresRaw));
  if (provided.length !== expected.length) return { ok: false, reason: 'invalid' };
  if (!crypto.timingSafeEqual(provided, expected)) return { ok: false, reason: 'invalid' };
  if (Date.now() > expiresAt) return { ok: false, reason: 'expired' };

  return { ok: true, clientId: id };
}

function issueClientToken(res, clientId) {
  if (!res || res.headersSent) return;
  res.setHeader('Set-Cookie', `${CLIENT_TOKEN_COOKIE}=${encodeURIComponent(makeClientToken(clientId))}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
}

function newClientId() {
  return `user_${crypto.randomBytes(6).toString('hex')}`;
}

// An id asserted by the caller is never honoured, not even once. "First request
// to claim an id owns it" sounds migration-friendly but is a race any LAN
// visitor wins by enumerating ids — and ids are on display in the history and
// audit panels. Winning it would hand over a validly signed token for someone
// else's archive. Legacy histories are re-attached deliberately instead, via an
// admin-issued claim link (`/claim`).
function resolveClientIdentity(req, res = null) {
  const proven = verifiedClientId(req);
  if (proven) return proven;

  const minted = newClientId();
  issueClientToken(res, minted);
  return minted;
}

function getActor(req, res = null) {
  if (isAdminRequest(req)) {
    return { id: 'admin', role: 'admin' };
  }
  return { id: resolveClientIdentity(req, res), role: 'member' };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const chunk of String(cookieHeader || '').split(';')) {
    const [rawKey, ...valueParts] = chunk.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(valueParts.join('=') || '');
  }
  return cookies;
}

function isAdminRequest(req) {
  // Admin is decided by the TCP peer address only. The Host header is supplied by
  // the client, so trusting it here let any LAN visitor send `Host: localhost`
  // and gain key management plus every user's history.
  const remote = normalizeRemoteAddress(req.socket?.remoteAddress || '');
  return isLoopbackAddress(remote) || isConfiguredAdminLanAddress(remote);
}

function normalizeRemoteAddress(address) {
  return String(address || '').replace(/^::ffff:/, '');
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}

function isConfiguredAdminLanAddress(address) {
  return Boolean(config.publicLanIP) && address === config.publicLanIP;
}

function safeClientId(value) {
  return String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'default';
}

function userDataDir(clientId) {
  return path.join(USER_DIR, safeClientId(clientId));
}

function userOutputDir(clientId) {
  return path.join(userDataDir(clientId), 'outputs');
}

function userHistoryFile(clientId) {
  return path.join(userDataDir(clientId), 'history.json');
}

function historyFileForClient(clientId) {
  return userHistoryFile(safeClientId(clientId));
}

async function readUserHistory(clientId) {
  return readJsonFile(userHistoryFile(clientId), []);
}

async function readRepairedUserHistory(clientId) {
  const safeId = safeClientId(clientId);
  const [items, deleted] = await Promise.all([
    repairUserHistoryIndex(safeId, await readAuditLog()),
    readDeletedItems(),
  ]);
  // 成员看不到自己软删除的条目。文件还在磁盘上，管理员那边照旧可见、可恢复。
  return items.filter((item) => !deleted[item.id]);
}

async function readAllUserHistory() {
  const users = [];
  const history = [];
  const seenClientIds = new Set();
  const seenImageUrls = new Set();
  const seenHistoryIds = new Set();
  const auditEvents = await readAuditLog();

  const defaultItems = await repairUserHistoryIndex('default', auditEvents);
  collectHistoryItems('default', defaultItems, history, users, seenClientIds, seenImageUrls, seenHistoryIds);

  try {
    const entries = await fs.readdir(USER_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const clientId = safeClientId(entry.name);
      if (clientId === 'default') continue;
      const items = await repairUserHistoryIndex(clientId, auditEvents);
      collectHistoryItems(clientId, items, history, users, seenClientIds, seenImageUrls, seenHistoryIds);
    }
  } catch {
    // No per-user history has been created yet.
  }

  history.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  // 管理员看得到被成员删除的条目，只是打上标记——这样才能恢复。
  const deleted = await readDeletedItems();
  for (const item of history) {
    const mark = deleted[item.id];
    if (mark) {
      item.deletedByMember = true;
      item.deletedAt = mark.at;
    }
  }

  return { history, users, deletedCount: history.filter((item) => item.deletedByMember).length };
}

async function collectUserHistory(clientId, history, users, seenClientIds, seenImageUrls, seenHistoryIds, filePath) {
  const items = await readJsonFile(filePath, []);
  if (!Array.isArray(items) || items.length === 0) return;

  collectHistoryItems(clientId, items, history, users, seenClientIds, seenImageUrls, seenHistoryIds);
}

function collectHistoryItems(clientId, items, history, users, seenClientIds, seenImageUrls, seenHistoryIds) {
  const normalized = mergeHistoryEntries(items);
  addUserHistoryCount(clientId, normalized.length, users, seenClientIds);

  for (const item of normalized) {
    if (item?.id) seenHistoryIds.add(String(item.id));
    markHistoryImagesSeen(item, seenImageUrls);
    history.push({
      ...item,
      ownerClientId: clientId,
      ownerRole: clientId === 'admin' ? 'admin' : 'member',
    });
  }
}

async function repairUserHistoryIndex(clientId, auditEvents = []) {
  const safeId = safeClientId(clientId);
  const filePath = historyFileForClient(safeId);

  return enqueueFileWrite(filePath, async () => {
    const stored = await readJsonFile(filePath, []);
    const legacy = safeId === 'default' ? await readJsonFile(HISTORY_FILE, []) : [];
    const existing = mergeHistoryEntries([
      ...(Array.isArray(stored) ? stored : []),
      ...(Array.isArray(legacy) ? legacy : []),
    ]);
    const repaired = await buildRepairedUserHistory(safeId, existing, auditEvents);
    const targetNeedsWrite = !Array.isArray(stored) || !sameHistoryIndex(stored, repaired);

    if (targetNeedsWrite || !sameHistoryIndex(existing, repaired)) {
      await writeJsonFileAtomic(filePath, repaired);
    }

    return repaired;
  });
}

async function buildRepairedUserHistory(clientId, existingItems, auditEvents) {
  const files = await listOutputImageFiles(clientId);
  const items = mergeHistoryEntries(existingItems);
  const seenImageUrls = new Set();

  for (const item of items) {
    markHistoryImagesSeen(item, seenImageUrls);
  }

  const events = auditEvents
    .filter((event) => event.status === 'succeeded' && safeClientId(event.clientId) === clientId)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  for (const file of files) {
    const url = outputUrlForFile(clientId, file.name);
    if (seenImageUrls.has(url)) continue;

    const event = findAuditEventForOutput(file, url, events);
    const createdAt = event?.createdAt || createdAtFromOutputFilename(file.name) || file.lastModified.toISOString();
    const recoveredItem = {
      id: `recovered-${clientId}-${path.basename(file.name, path.extname(file.name))}`,
      createdAt,
      prompt: event?.prompt || '',
      negativePrompt: '',
      model: event?.model || '',
      mode: event?.mode || '',
      size: event?.size || '',
      n: 1,
      key: event?.channel || null,
      images: [{
        url,
        localUrl: url,
        revisedPrompt: event?.prompt || '',
        source: 'recovered-output',
      }],
      recovered: true,
    };

    seenImageUrls.add(url);
    items.push(recoveredItem);
  }

  return mergeHistoryEntries(items);
}

function mergeHistoryEntries(items) {
  const byId = new Map();
  const byImage = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const normalized = normalizeHistoryItem(item);
    const imageKey = firstHistoryImageUrl(normalized);
    const idKey = normalized.id ? `id:${normalized.id}` : '';
    const existingKey = imageKey && byImage.has(imageKey) ? byImage.get(imageKey) : idKey;
    const key = existingKey || idKey || `item:${byId.size}`;
    const current = byId.get(key);
    const merged = current ? mergeHistoryItem(current, normalized) : normalized;
    byId.set(key, merged);
    if (imageKey) byImage.set(imageKey, key);
  }

  return [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function normalizeHistoryItem(item) {
  return {
    ...item,
    id: String(item.id || crypto.randomUUID()),
    createdAt: String(item.createdAt || ''),
    prompt: String(item.prompt || ''),
    negativePrompt: String(item.negativePrompt || ''),
    model: String(item.model || ''),
    mode: String(item.mode || ''),
    size: String(item.size || ''),
    // 老记录没有这个字段，读出来是空字符串，前端据此不显示 seed 行。
    seed: item.seed === undefined || item.seed === null ? '' : String(item.seed),
    n: Number(item.n || item.images?.length || 0),
    images: normalizeHistoryImages(item.images),
  };
}

function normalizeHistoryImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => ({
      ...image,
      url: String(image?.url || image?.localUrl || ''),
      localUrl: String(image?.localUrl || image?.url || ''),
      revisedPrompt: String(image?.revisedPrompt || ''),
      source: String(image?.source || ''),
    }))
    .filter((image) => image.url || image.localUrl);
}

function mergeHistoryItem(current, next) {
  return {
    ...current,
    ...next,
    prompt: next.prompt || current.prompt || '',
    negativePrompt: next.negativePrompt || current.negativePrompt || '',
    model: next.model || current.model || '',
    mode: next.mode || current.mode || '',
    size: next.size || current.size || '',
    seed: next.seed || current.seed || '',
    key: next.key || current.key || null,
    images: next.images?.length ? next.images : current.images,
    recovered: current.recovered && !next.recovered ? false : Boolean(next.recovered || current.recovered),
  };
}

function firstHistoryImageUrl(item) {
  const image = item?.images?.[0];
  return normalizeOutputUrl(image?.localUrl || image?.url || '');
}

function sameHistoryIndex(previous, next) {
  return JSON.stringify(mergeHistoryEntries(previous)) === JSON.stringify(mergeHistoryEntries(next));
}

async function listOutputImageFiles(clientId) {
  try {
    const entries = await fs.readdir(userOutputDir(clientId), { withFileTypes: true });
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(userOutputDir(clientId), entry.name);
        const stat = await fs.stat(filePath);
        return { name: entry.name, lastModified: stat.mtime };
      }));
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function addUserHistoryCount(clientId, count, users, seenClientIds) {
  if (count <= 0 || clientId === 'admin') return;
  if (!seenClientIds.has(clientId)) {
    seenClientIds.add(clientId);
    users.push({ clientId, count });
    return;
  }

  const user = users.find((item) => item.clientId === clientId);
  if (user) user.count += count;
}

function markHistoryImagesSeen(item, seenImageUrls) {
  for (const image of item?.images || []) {
    const url = normalizeOutputUrl(image?.localUrl || image?.url || '');
    if (url) seenImageUrls.add(url);
  }
}

function findAuditEventForOutput(file, url, events) {
  const direct = events.find((event) => auditEventHasImageUrl(event, url));
  if (direct) return direct;

  const fileTime = outputFileTime(file.name, file.lastModified);
  if (!fileTime) return null;

  let best = null;
  let bestDelta = Infinity;
  for (const event of events) {
    const eventTime = Date.parse(event.createdAt || '');
    if (!Number.isFinite(eventTime)) continue;
    const delta = Math.abs(eventTime - fileTime);
    if (delta < bestDelta) {
      best = event;
      bestDelta = delta;
    }
  }

  return bestDelta <= 30000 ? best : null;
}

function auditEventHasImageUrl(event, url) {
  return normalizeAuditImages(event.images).some((image) => (
    normalizeOutputUrl(image.localUrl) === url
    || normalizeOutputUrl(image.url) === url
  ));
}

function outputFileTime(filename, fallbackDate) {
  const fromName = Date.parse(createdAtFromOutputFilename(filename) || '');
  if (Number.isFinite(fromName)) return fromName;
  const fallback = fallbackDate instanceof Date ? fallbackDate.getTime() : Number.NaN;
  return Number.isFinite(fallback) ? fallback : 0;
}

function createdAtFromOutputFilename(filename) {
  const match = String(filename || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!match) return '';
  const [, year, month, day, hour, minute, second, ms] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`;
}

function outputUrlForFile(clientId, filename) {
  return `/outputs/${safeClientId(clientId)}/${encodeURIComponent(path.basename(filename)).replace(/%2F/gi, '/')}`;
}

function normalizeOutputUrl(url) {
  const value = String(url || '');
  const match = value.match(/\/outputs\/([^?#]+)/);
  if (!match) return '';
  const parts = match[1].split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return `/outputs/${safeClientId(decodeURIComponent(parts[0]))}/${encodeURIComponent(path.basename(decodeURIComponent(parts.slice(1).join('/'))))}`;
}

async function loadEnv(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const splitAt = trimmed.indexOf('=');
      if (splitAt === -1) continue;

      const key = trimmed.slice(0, splitAt).trim();
      const value = trimmed.slice(splitAt + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Missing .env is allowed when configuration is supplied by the shell.
  }
}

function parseMaybeJson(textValue) {
  try {
    return JSON.parse(textValue);
  } catch {
    return textValue;
  }
}

function extractErrorMessage(payload, fallback) {
  if (!payload || typeof payload === 'string') return fallback;
  return payload.error?.message || payload.error || payload.message || payload.detail || fallback;
}

function upstreamError(message, status = 0, payload = null) {
  const error = new Error(message);
  error.status = status;
  error.payload = payload;
  error.publicMessage = message;
  return error;
}

// 幂等：分类会给消息加前缀（"上游服务异常：" + 原文）并写回 publicMessage，
// 而分类本身又是读 publicMessage 的。同一个 error 被 enrich 两次就会叠成
// "上游服务异常：上游服务异常：..."，日志里确实出现过。所以第一次就把原文
// 固定在 rawMessage 上，之后永远从原文分类。
function enrichUpstreamError(error, details = {}) {
  if (error.rawMessage === undefined) {
    error.rawMessage = String(error.publicMessage || error.message || '');
  }

  const classification = classifyUpstreamError(error, details);
  error.details = { ...(error.details || {}), ...details };
  error.code = classification.code;
  error.category = classification.category;
  error.retryable = classification.retryable;
  error.maybeCharged = Boolean(details.maybeCharged || classification.maybeCharged);
  error.publicMessage = classification.message;
  return error;
}

function classifyUpstreamError(error, details = {}) {
  // rawMessage 优先：publicMessage 可能已经被上一次分类加过前缀。
  const rawMessage = String(error.rawMessage ?? error.publicMessage ?? error.message ?? '');
  const status = Number(error.status || details.httpStatus || 0);
  const original = String(details.originalError || '');
  const networkMessage = String(details.networkMessage || rawMessage);
  const lower = [rawMessage, original, networkMessage].join(' ').toLowerCase();

  if (status === 408 || lower.includes('timeout') || lower.includes('timed out')) {
    return {
      code: 'UPSTREAM_TIMEOUT',
      category: 'timeout',
      retryable: true,
      maybeCharged: false,
      message: '\u4e0a\u6e38\u8bf7\u6c42\u8d85\u65f6\uff0c\u672a\u6536\u5230\u56fe\u7247\u7ed3\u679c\u3002\u901a\u5e38\u672a\u6210\u529f\u4fdd\u5b58\u56fe\u7247\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
    };
  }

  if (lower.includes('terminated') || lower.includes('socket') || lower.includes('econnreset') || lower.includes('connection')) {
    return {
      code: 'UPSTREAM_CONNECTION_TERMINATED',
      category: 'network',
      retryable: true,
      maybeCharged: Boolean(details.maybeCharged),
      message: '\u4e0a\u6e38\u8fde\u63a5\u4e2d\u9014\u65ad\u5f00\uff0c\u53ef\u80fd\u5df2\u7ecf\u5f00\u59cb\u751f\u6210/\u6263\u8d39\uff0c\u4f46\u672c\u5730\u6ca1\u6709\u6536\u5230\u56fe\u7247\u7ed3\u679c\u3002\u5efa\u8bae\u5148\u67e5\u4e0a\u6e38\u8d26\u5355\u6216\u4efb\u52a1\u8bb0\u5f55\uff0c\u518d\u51b3\u5b9a\u662f\u5426\u91cd\u8bd5\u3002',
    };
  }

  if (status === 429) {
    return {
      code: 'UPSTREAM_RATE_LIMITED',
      category: 'rate_limit',
      retryable: true,
      maybeCharged: false,
      message: '\u4e0a\u6e38\u9650\u6d41\u6216\u989d\u5ea6\u6682\u4e0d\u53ef\u7528\uff1a' + rawMessage,
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: 'UPSTREAM_AUTH_FAILED',
      category: 'auth',
      retryable: false,
      maybeCharged: false,
      message: '\u4e0a\u6e38\u9274\u6743\u5931\u8d25\u6216\u6e20\u9053\u4e0d\u53ef\u7528\uff1a' + rawMessage,
    };
  }

  if (status >= 500 || status === 0) {
    return {
      code: 'UPSTREAM_SERVICE_ERROR',
      category: 'upstream',
      retryable: true,
      maybeCharged: false,
      message: '\u4e0a\u6e38\u670d\u52a1\u5f02\u5e38\uff1a' + (rawMessage || 'Network error'),
    };
  }

  return {
    code: 'UPSTREAM_REQUEST_FAILED',
    category: 'request',
    retryable: false,
    maybeCharged: false,
    message: rawMessage || '\u4e0a\u6e38\u8bf7\u6c42\u5931\u8d25',
  };
}
function readableNetworkError(error) {
  const message = String(error?.message || 'Network error');
  if (message.toLowerCase() === 'terminated') {
    return 'Upstream connection terminated before returning an image';
  }
  return message;
}

function previewText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, maxLength);
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 12) return `${key.slice(0, 3)}...`;
  return `${key.slice(0, 7)}...${key.slice(-5)}`;
}

function hideUrlSecret(url) {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeBaseUrl(value) {
  const trimmed = trimTrailingSlash(value);
  if (!trimmed) return '';
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }[extension] || 'application/octet-stream';
}

function extensionFromContentType(contentType) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'png';
}

function looksLikeBase64(value) {
  return value.length > 100 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function getLanUrls() {
  if (config.publicLanIP) {
    return [`http://${config.publicLanIP}:${config.port}`];
  }

  const urls = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      urls.push(`http://${address.address}:${config.port}`);
    }
  }
  return urls;
}

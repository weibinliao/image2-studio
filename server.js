import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerDefaultImageModels, resolveImageModel } from './provider-models.js';

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
};

const runtime = new Map();
const jobs = new Map();
const fileWriteQueues = new Map();
let roundRobinIndex = -1;

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === '/api/status') {
      return json(res, 200, await buildStatus(req));
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/keys') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, { keys: await listPublicKeys() });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/models') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return handleModels(res, requestUrl.searchParams.get('channelId') || '');
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/keys') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const record = await addFileKey(body);
      return json(res, 201, { key: publicKey(record) });
    }

    const keyToggleMatch = requestUrl.pathname.match(/^\/api\/keys\/([^/]+)\/toggle$/);
    if (req.method === 'POST' && keyToggleMatch) {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      const body = await readJson(req);
      const updated = await setFileKeyEnabled(keyToggleMatch[1], body.enabled !== false);
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

    if (req.method === 'POST' && requestUrl.pathname === '/api/generate') {
      return handleGenerate(req, res);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/jobs') {
      return handleCreateJob(req, res);
    }

    const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
      return handleGetJob(jobMatch[1], res);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/history') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, await readAllUserHistory());
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/admin/audit-log') {
      if (!isAdminRequest(req)) return json(res, 403, { error: 'Admin only' });
      return json(res, 200, { events: await readAuditLog() });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/history') {
      return json(res, 200, { history: await readRepairedUserHistory(getActor(req).id) });
    }

    if (req.method === 'DELETE' && requestUrl.pathname === '/api/history') {
      return json(res, 405, { error: 'History is an append-only audit archive and cannot be cleared.' });
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

async function handleGenerate(req, res) {
  const body = await readJson(req, 32 * 1024 * 1024);
  const actor = getActor(req);
  const result = await runGenerateRequest(body, () => {}, actor.id, actor.role);
  return json(res, result.status, result.payload);
}

async function handleCreateJob(req, res) {
  const body = await readJson(req, 32 * 1024 * 1024);
  const job = {
    id: crypto.randomUUID(),
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
  queueMicrotask(() => {
    const actor = getActor(req);
    return runJob(job.id, body, actor.id, actor.role);
  });
  return json(res, 202, { job: publicJob(job) });
}

function handleGetJob(id, res) {
  const job = jobs.get(id);
  if (!job) return json(res, 404, { error: 'Job not found' });

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
  }
}

async function runGenerateRequest(body, onProgress = () => {}, clientId = 'default', actorRole = 'member') {
  const prompt = String(body.prompt || '').trim();

  if (!prompt) {
    return { status: 400, payload: { error: 'Prompt is required' } };
  }

  const keys = await getAllKeys();
  if (keys.length === 0) {
    return { status: 400, payload: { error: 'No API keys configured' } };
  }

  const generationChannelId = await resolveGenerationChannelId(actorRole, keys);
  if (!generationChannelId) {
    return { status: 400, payload: { error: actorRole === 'admin' ? 'No admin channel configured' : 'No member channel configured' } };
  }

  onProgress(12, '正在构建图片请求');
  const requestedModel = String(body.model || '').trim();
  const upstreamBody = buildImageRequest(body, prompt, '');
  const mode = hasInputImages(upstreamBody) ? 'image-to-image' : 'text-to-image';
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
        negativePrompt: body.negativePrompt || '',
        model: selectedRequest.model,
        mode,
        size: upstreamBody.size || '',
        n: upstreamBody.n || images.length,
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
}

function updateEstimatedProgress(job) {
  if (job.status !== 'running') return;

  const elapsedMs = Date.now() - Date.parse(job.createdAt || job.updatedAt || new Date().toISOString());
  const estimated = Math.min(92, 8 + Math.floor((elapsedMs / config.timeoutMs) * 82));
  if (estimated > job.progress) {
    job.progress = estimated;
    job.stage = estimated >= 80 ? '仍在等待上游返回图片' : job.stage || '正在生成';
  }
}

function publicJob(job) {
  return {
    id: job.id,
    ok: job.ok,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
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
    const response = await fetch(`${selected.baseURL}/models`, {
      headers: { Authorization: `Bearer ${selected.key}` },
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30000)),
    });
    const text = await response.text();
    const payload = parseMaybeJson(text);

    if (!response.ok) {
      const message = extractErrorMessage(payload, text) || `Upstream returned HTTP ${response.status}`;
      throw upstreamError(message, response.status, payload);
    }

    const models = collectModelIds(payload);
    const candidateModels = models.filter((model) => /image|dall|flux|sd|stable|midjourney|mj|ideogram|recraft|imagen|kolors|dream|photo|paint|draw/i.test(model));
    const providerDefaults = providerDefaultImageModels(selected);
    return json(res, 200, {
      models,
      candidateModels,
      providerDefaults,
      note: '候选模型来自 /models 名称匹配，不代表一定支持图片 endpoint；请用测试按钮验证。',
      key: publicKey(selected),
    });
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

function buildImageRequest(input, prompt, defaultModel = config.defaultModel) {
  const model = String(input.model || defaultModel || '').trim();
  const request = {
    prompt,
  };
  if (model) request.model = model;

  if (input.negativePrompt) request.negative_prompt = String(input.negativePrompt);
  if (input.size) request.size = String(input.size);
  if (input.n) request.n = clamp(Number(input.n), 1, 8);
  if (input.responseFormat) request.response_format = String(input.responseFormat);
  if (input.quality) request.quality = String(input.quality);
  if (input.style) request.style = String(input.style);
  if (input.seed !== undefined && input.seed !== '') request.seed = Number(input.seed);
  if (Array.isArray(input.images)) request.images = input.images;
  if (input.image) request.image = input.image;
  if (input.input_image) request.input_image = input.input_image;
  if (Array.isArray(input.input_images)) request.input_images = input.input_images;
  if (input.mask) request.mask = input.mask;

  if (input.extraParams && typeof input.extraParams === 'object' && !Array.isArray(input.extraParams)) {
    Object.assign(request, input.extraParams);
  }

  return request;
}

function buildProviderImageRequest(selected, requestBody) {
  const provider = String(selected.provider || selected.name || '').toLowerCase();
  const images = normalizeImageReferences(requestBody.images || requestBody.input_images || requestBody.image || requestBody.input_image);
  const mask = firstImageReference(requestBody.mask || requestBody.mask_path);

  if (provider.includes('gpteam') || selected.baseURL.includes('gpteamservices.com')) {
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
  const payload = buildProviderImageRequest(selected, requestBody);
  const endpoint = `${selected.baseURL}${hasInputImages(payload) ? '/images/edits' : '/images/generations'}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  const requestMeta = {
    endpoint: hideUrlSecret(endpoint),
    method: 'POST',
    stream: Boolean(payload.stream),
    responseFormat: payload.response_format || '',
    size: payload.size || '',
    quality: payload.quality || '',
    hasInputImages: hasInputImages(payload),
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${selected.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    const parsed = parseMaybeJson(text);

    if (!response.ok) {
      const message = extractErrorMessage(parsed, text) || `Upstream returned HTTP ${response.status}`;
      throw enrichUpstreamError(upstreamError(message, response.status, parsed), {
        ...requestMeta,
        httpStatus: response.status,
        contentType: response.headers.get('content-type') || '',
        durationMs: Date.now() - startedAt,
        responsePreview: previewText(text),
      });
    }

    if (isEventStreamContentType(response.headers.get('content-type'))) {
      return parseImageSSE(text);
    }

    return parseMaybeJson(text);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error.name === 'AbortError') {
      throw enrichUpstreamError(upstreamError(`Request timed out after ${Math.round(config.timeoutMs / 1000)} seconds`, 408), {
        ...requestMeta,
        durationMs,
        originalError: error.name,
      });
    }

    if (error.status) {
      throw enrichUpstreamError(error, {
        ...requestMeta,
        durationMs,
        originalError: error.name || '',
      });
    }

    throw enrichUpstreamError(upstreamError(readableNetworkError(error), 0), {
      ...requestMeta,
      durationMs,
      originalError: error.name || error.code || '',
      networkMessage: error.message || '',
      maybeCharged: durationMs > 5000,
    });
  } finally {
    clearTimeout(timeout);
  }
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

async function buildStatus(req) {
  const keys = await listPublicKeys();
  const admin = isAdminRequest(req);
  const userChannelId = await resolveUserChannelId();
  const adminChannelId = await resolveAdminChannelId();
  const userChannel = keys.find((key) => key.id === userChannelId) || null;
  const adminChannel = keys.find((key) => key.id === adminChannelId) || null;
  return {
    admin,
    baseURL: keys[0]?.baseURL || (config.baseURL ? hideUrlSecret(config.baseURL) : ''),
    defaultModel: config.defaultModel,
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
  if (explicitId && allKeys.some((key) => key.id === explicitId)) {
    return explicitId;
  }

  const readyKey = allKeys.find((key) => key.enabled !== false);
  return readyKey?.id || '';
}

async function addFileKey(input) {
  const key = String(input.key || '').trim();
  const baseURL = normalizeBaseUrl(input.baseURL || config.baseURL);
  if (!key) throw new Error('API key is required');
  if (!baseURL) throw new Error('API base URL is required');

  const existing = await readJsonFile(KEY_FILE, []);
  const record = {
    id: crypto.randomUUID(),
    name: String(input.name || `Key ${existing.length + 1}`).trim(),
    key,
    baseURL,
    enabled: input.enabled !== false,
    source: 'file',
    createdAt: new Date().toISOString(),
  };

  await writeJsonFile(KEY_FILE, [...existing, record]);
  return record;
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

function shouldTryNextKey(error) {
  return [0, 401, 403, 408, 429, 500, 502, 503, 504].includes(error.status || 0);
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

async function serveStatic(urlPath, res) {
  const pathname = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const target = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!target.startsWith(PUBLIC_DIR)) {
    return text(res, 403, 'Forbidden');
  }

  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': contentTypeForPath(target) });
    res.end(data);
  } catch {
    text(res, 404, 'Not found');
  }
}

async function serveOutput(urlPath, req, res) {
  const parts = decodeURIComponent(urlPath.replace('/outputs/', '')).split('/').filter(Boolean);
  const requestedClientId = parts.length >= 2 ? safeClientId(parts[0]) : 'default';
  const currentClientId = getClientId(req);

  if (parts.length >= 2 && requestedClientId !== currentClientId && !isAdminRequest(req)) {
    return text(res, 403, 'Forbidden');
  }

  const target = parts.length >= 2
    ? path.join(userOutputDir(parts[0]), path.basename(parts.slice(1).join('/')))
    : path.join(OUTPUT_DIR, path.basename(parts[0] || ''));

  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': contentTypeForPath(target),
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

function getClientId(req) {
  const headerValue = req.headers['x-client-id'];
  const cookieValue = parseCookies(req.headers.cookie || '').image2_client_id;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return safeClientId(raw || cookieValue || 'default');
}

function getActor(req) {
  if (isAdminRequest(req)) {
    return { id: 'admin', role: 'admin' };
  }
  return { id: getClientId(req), role: 'member' };
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
  const remote = normalizeRemoteAddress(req.socket?.remoteAddress || '');
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  return isLoopbackAddress(remote) || isConfiguredAdminLanAddress(remote) || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
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
  return repairUserHistoryIndex(safeId, await readAuditLog());
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
  return { history, users };
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

function enrichUpstreamError(error, details = {}) {
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
  const rawMessage = String(error.publicMessage || error.message || '');
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


import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const prompt = requiredValue(args, 'prompt');
const packagedBaseUrl = 'IMAGE2_STUDIO_PACKAGE_URL';
const defaultBaseUrl = packagedBaseUrl.startsWith('IMAGE2_STUDIO_PACKAGE_') ? 'http://127.0.0.1:3020' : packagedBaseUrl;
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.IMAGE2_STUDIO_URL || defaultBaseUrl);
const clientId = await resolveClientId({
  explicitValue: args['client-id'] || process.env.IMAGE2_STUDIO_CLIENT_ID || '',
  baseUrl,
});
const outputDir = path.resolve(args['output-dir'] || process.env.IMAGE2_STUDIO_OUTPUT_DIR || path.join(os.tmpdir(), 'image2-studio-skill'));
const timeoutSeconds = positiveInteger(args['timeout-seconds'] || '900', 'timeout-seconds', 1, 3600);
const imageCount = positiveInteger(args.n || '1', 'n', 1, 8);
const inputImages = await resolveInputImages([
  ...argumentValues(args['input-image']),
  ...argumentValues(args['reference-image']),
]);

const headers = {
  'X-Client-Id': clientId,
  'X-Image2-Role': 'member',
};

const status = await fetchJson(new URL('/api/status', baseUrl), { headers });
if (status.admin !== false) {
  throw new Error('Image2 Studio did not accept explicit member mode. Update and restart the server before using this skill.');
}

const requestBody = {
  prompt,
  n: imageCount,
  extraParams: { output_format: 'png' },
};
if (args.size) requestBody.size = String(args.size);
if (args.quality) requestBody.quality = String(args.quality);
if (inputImages.length > 0) requestBody.images = inputImages;

const created = await fetchJson(new URL('/api/jobs', baseUrl), {
  method: 'POST',
  headers: {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
  },
  body: JSON.stringify(requestBody),
});

const jobId = String(created.job?.id || '');
if (!jobId) throw new Error('Image2 Studio did not return a job ID.');

process.stderr.write(`[image2-studio] job ${jobId} created\n`);
const deadline = Date.now() + timeoutSeconds * 1000;
let lastProgress = -1;
let completedJob = null;

while (Date.now() < deadline) {
  const payload = await fetchJson(new URL(`/api/jobs/${encodeURIComponent(jobId)}`, baseUrl), { headers });
  const job = payload.job || {};
  const progress = Number(job.progress || 0);

  if (progress !== lastProgress) {
    process.stderr.write(`[image2-studio] ${progress}% ${String(job.stage || job.status || '')}\n`);
    lastProgress = progress;
  }

  if (job.status === 'succeeded') {
    completedJob = job;
    break;
  }
  if (job.status === 'failed') {
    throw new Error(formatJobError(job.error));
  }

  await delay(1500);
}

if (!completedJob) {
  throw new Error(`Image2 Studio job ${jobId} timed out after ${timeoutSeconds} seconds.`);
}

const result = completedJob.result || {};
const images = Array.isArray(result.images) ? result.images : [];
if (images.length === 0) throw new Error('Image2 Studio completed without returning an image.');

await fs.mkdir(outputDir, { recursive: true });
const downloaded = [];

for (let index = 0; index < images.length; index += 1) {
  const image = images[index] || {};
  const remoteUrl = new URL(String(image.localUrl || image.url || ''), baseUrl);
  const response = await fetch(remoteUrl, { headers, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}: ${remoteUrl}`);

  const contentType = response.headers.get('content-type') || '';
  const extension = imageExtension(contentType, remoteUrl.pathname);
  const filename = `image2-${jobId}-${index + 1}.${extension}`;
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));

  downloaded.push({ path: filePath });
}

const summary = {
  ok: true,
  images: downloaded,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (parsed[key] === undefined) parsed[key] = value;
    else if (Array.isArray(parsed[key])) parsed[key].push(value);
    else parsed[key] = [parsed[key], value];
    index += 1;
  }
  return parsed;
}

function argumentValues(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return value ? [String(value)] : [];
}

function requiredValue(values, key) {
  const value = String(values[key] || '').trim();
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}

function positiveInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`--${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--base-url must use http or https.');
  url.pathname = url.pathname.replace(/\/$/, '');
  return `${url.href.replace(/\/$/, '')}/`;
}

function cleanClientId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function sanitizeClientId(value) {
  const clientId = cleanClientId(value);
  if (!clientId) throw new Error('--client-id must contain letters, numbers, underscores, or hyphens.');
  return clientId;
}

async function resolveInputImages(values) {
  if (values.length > 8) throw new Error('Use at most 8 --input-image values.');

  const references = [];
  let encodedBytes = 0;

  for (const rawValue of values) {
    const value = String(rawValue || '').trim();
    if (!value) continue;

    let reference = value;
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported image URL: ${value}`);
      reference = url.href;
    } else if (/^data:image\//i.test(value)) {
      if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) {
        throw new Error('Input data URLs must be base64 PNG, JPEG, WEBP, or GIF images.');
      }
    } else {
      const filePath = path.resolve(value);
      const file = await fs.readFile(filePath);
      reference = `data:${imageMimeType(filePath)};base64,${file.toString('base64')}`;
    }

    encodedBytes += Buffer.byteLength(reference, 'utf8');
    if (encodedBytes > 30 * 1024 * 1024) {
      throw new Error('Combined reference images are too large. Keep their encoded request under 30 MB.');
    }
    references.push(reference);
  }

  return references;
}

function imageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mimeType = types[extension];
  if (!mimeType) throw new Error(`Unsupported input image type: ${extension || '(none)'}`);
  return mimeType;
}

async function resolveClientId({ explicitValue, baseUrl }) {
  if (explicitValue) return sanitizeClientId(explicitValue);

  const stateFiles = skillStateFiles();
  const saved = await readPersistedClientId(stateFiles);
  if (saved.clientId) {
    if (!saved.conflicted) {
      try {
        await persistClientId(stateFiles, saved.clientId);
      } catch (error) {
        process.stderr.write(`[image2-studio] identity state mirror skipped: ${error.message}\n`);
      }
    }
    process.stderr.write(`[image2-studio] using persisted skill client id ${saved.clientId}\n`);
    return saved.clientId;
  }

  // Bootstrap once from the browser identity when available. Subsequent
  // sessions must keep the local ID even if the network route changes.
  const remembered = await resolveRememberedClientId(baseUrl);
  if (remembered) {
    await persistClientId(stateFiles, remembered);
    return remembered;
  }

  const generated = stableFallbackClientId();
  await persistClientId(stateFiles, generated);
  return generated;
}

function stableFallbackClientId() {
  const scope = [
    process.env.IMAGE2_STUDIO_IDENTITY_SCOPE || '',
    os.hostname(),
    os.userInfo?.().username || process.env.USERNAME || process.env.USER || '',
    process.env.USERDOMAIN || '',
    process.platform,
  ].join('|');
  const digest = crypto.createHash('sha256').update(scope).digest('hex').slice(0, 20);
  return `codex-${digest}`;
}

async function resolveRememberedClientId(baseUrl) {
  try {
    const payload = await fetchJson(new URL('/api/client-identity', baseUrl), {
      headers: { 'X-Image2-Role': 'member' },
    });
    const clientId = cleanClientId(payload.clientId);
    if (clientId) {
      process.stderr.write(`[image2-studio] using website client id ${clientId}\n`);
      return clientId;
    }
  } catch (error) {
    process.stderr.write(`[image2-studio] website client id lookup skipped: ${error.message}\n`);
  }
  return '';
}

async function readPersistedClientId(stateFiles) {
  const remembered = [];
  for (const stateFile of stateFiles) {
    try {
      const saved = String(await fs.readFile(stateFile, 'utf8')).trim();
      if (saved) remembered.push({ stateFile, clientId: sanitizeClientId(saved) });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        process.stderr.write(`[image2-studio] identity state lookup skipped for ${stateFile}: ${error.message}\n`);
      }
    }
  }
  const first = remembered[0]?.clientId || '';
  const conflicts = remembered.filter((entry) => entry.clientId !== first);
  if (conflicts.length > 0) {
    process.stderr.write(`[image2-studio] multiple persisted client ids found; using ${remembered[0].stateFile}\n`);
  }
  return { clientId: first, conflicted: conflicts.length > 0 };
}

async function persistClientId(stateFiles, clientId) {
  const value = `${sanitizeClientId(clientId)}\n`;
  const failures = [];
  let written = 0;
  for (const stateFile of stateFiles) {
    try {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(stateFile, value, 'utf8');
      written += 1;
    } catch (error) {
      failures.push(`${stateFile}: ${error.message}`);
    }
  }
  if (written === 0) {
    throw new Error(`Unable to persist Image2 Studio client ID. ${failures.join('; ')}`);
  }
  if (failures.length > 0) {
    process.stderr.write(`[image2-studio] identity state mirror skipped: ${failures.join('; ')}\n`);
  }
}

function skillStateFiles() {
  const candidates = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Image2 Studio', 'codex-skill-client-id'));
  }
  candidates.push(path.join(os.homedir(), '.image2-studio', 'codex-skill-client-id'));
  return [...new Set(candidates.map((value) => path.resolve(value)))];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Image2 Studio returned invalid JSON with HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(String(payload.error || `Image2 Studio request failed with HTTP ${response.status}.`));
  }
  return payload;
}

function formatJobError(error) {
  if (!error) return 'Image2 Studio generation failed.';
  if (typeof error === 'string') return error;
  return String(error.error || error.message || JSON.stringify(error));
}

function imageExtension(contentType, pathname) {
  const byType = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const normalizedType = String(contentType).split(';')[0].trim().toLowerCase();
  if (byType[normalizedType]) return byType[normalizedType];
  const suffix = path.extname(pathname).slice(1).toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(suffix) ? suffix : 'png';
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

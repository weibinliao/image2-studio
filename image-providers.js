import { isSingleImageProvider, providerCapabilities, providerDefaultImageModels } from './provider-models.js';

const IMAGE_MODEL_PATTERN = /image|dall|flux|sd|stable|midjourney|mj|ideogram|recraft|imagen|kolors|dream|photo|paint|draw/i;

function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
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

function previewText(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, maxLength);
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

function readableNetworkError(error) {
  const message = String(error?.message || 'Network error');
  if (message.toLowerCase() === 'terminated') {
    return 'Upstream connection terminated before returning an image';
  }
  return message;
}

function isEventStreamContentType(contentType) {
  return /text\/event-stream/i.test(String(contentType || ''));
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

function hasInputImages(payload) {
  return normalizeImageReferences(payload?.images || payload?.input_images || payload?.image || payload?.input_image).length > 0;
}

function collectModelIds(payload) {
  const raw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return raw
    .map((item) => (typeof item === 'string' ? item : item.id || item.name || item.model))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function fetchModelPayload(endpoint, channel, timeoutMs, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint, {
    headers: { Authorization: `Bearer ${channel.key}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const payload = parseMaybeJson(text);

  if (!response.ok) {
    const message = extractErrorMessage(payload, text) || `Upstream returned HTTP ${response.status}`;
    throw upstreamError(message, response.status, payload);
  }

  return payload;
}

async function probeModels(endpoint, channel, timeoutMs, collectModels) {
  const startedAt = Date.now();
  try {
    const payload = await fetchModelPayload(endpoint, channel, timeoutMs);
    const models = collectModels(payload);
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      ms: Date.now() - startedAt,
      modelCount: models.length,
      message: `\u8fde\u63a5\u6b63\u5e38\uff0c\u4e0a\u6e38\u5217\u51fa ${models.length} \u4e2a\u6a21\u578b`,
    };
  } catch (error) {
    const raw = String(error.message || '');
    let message = raw || '\u65e0\u6cd5\u8fde\u63a5\u5230\u4e0a\u6e38';
    if (error.name === 'TimeoutError' || /aborted|timeout/i.test(raw)) {
      message = `\u8fde\u63a5\u8d85\u65f6\uff08${Math.round(timeoutMs / 1000)} \u79d2\u65e0\u54cd\u5e94\uff09\uff0c\u8bf7\u68c0\u67e5\u5730\u5740\u548c\u7f51\u7edc`;
    } else if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|certificate|ssl/i.test(raw)) {
      message = '\u65e0\u6cd5\u8fde\u63a5\u5230\u8fd9\u4e2a\u5730\u5740\uff0c\u8bf7\u68c0\u67e5 URL \u662f\u5426\u6b63\u786e\u3001\u7f51\u7edc\u662f\u5426\u53ef\u8fbe';
    }

    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      ms: Date.now() - startedAt,
      message,
    };
  }
}

export function buildOpenAIRequest(channel, requestBody) {
  const images = normalizeImageReferences(requestBody.images || requestBody.input_images || requestBody.image || requestBody.input_image);
  const mask = firstImageReference(requestBody.mask || requestBody.mask_path);

  if (isSingleImageProvider(channel)) {
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

export const openaiImagesAdapter = {
  capabilities(channel) {
    return providerCapabilities(channel);
  },

  async listModels(channel, timeoutMs = 30000) {
    const payload = await fetchModelPayload(`${channel.baseURL}/models`, channel, timeoutMs);
    const models = collectModelIds(payload);
    return {
      models,
      candidateModels: models.filter((model) => IMAGE_MODEL_PATTERN.test(model)),
      providerDefaults: providerDefaultImageModels(channel),
    };
  },

  async probe(channel, timeoutMs = 15000) {
    return probeModels(`${channel.baseURL}/models`, channel, timeoutMs, collectModelIds);
  },

  async generate(channel, requestBody, timeoutMs = 180000) {
    const payload = buildOpenAIRequest(channel, requestBody);
    const endpoint = `${channel.baseURL}${hasInputImages(payload) ? '/images/edits' : '/images/generations'}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
          Authorization: `Bearer ${channel.key}`,
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
        throw enrichUpstreamError(upstreamError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`, 408), {
          ...requestMeta,
          durationMs,
          originalError: error.name,
          maybeCharged: durationMs > 5000,
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
  },

  classifyError(error) {
    return error;
  },
};

function geminiBaseFrom(storedBaseURL) {
  return String(storedBaseURL || '')
    .replace(/\/+$/, '')
    .replace(/\/(?:v1|v1beta)$/i, '');
}

function collectGeminiModelIds(payload) {
  const raw = Array.isArray(payload?.models) ? payload.models : [];
  return raw
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .map((name) => String(name).replace(/^models\//, ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// 探测语义：只有上游明确表示“这个端点不是这么用的”才算协议否证。
// 401/403 = 认证不适用于该协议；404/400 = 路径不存在或参数不对，都算否证。
// 5xx / 超时 / 网络中断 = 上游自身故障，对协议归属零信息量，不可作为降级依据。
function isProtocolDisproof(error) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403 || status === 404 || status === 400) return true;
  return false;
}

function isUpstreamOutage(error) {
  const status = Number(error?.status || 0);
  if (status >= 500) return true;
  if (status === 429) return true;
  const name = String(error?.name || '');
  const message = String(error?.message || '').toLowerCase();
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return /fetch failed|timeout|timed out|econnreset|enotfound|eai_again|econnrefused|socket|terminated/.test(message);
}

// 渠道协议只能由真实端点响应判定。Gemini 中继也可能兼容 /v1/models，
// 所以必须先检查原生 v1beta，不能根据模型名称推断协议。
export async function detectProviderType(channel, timeoutMs = 12000, fetchImpl = fetch) {
  const attempts = [
    {
      providerType: 'gemini-native',
      endpoint: `${geminiBaseFrom(channel.baseURL)}/v1beta/models`,
      collectModels: collectGeminiModelIds,
    },
    {
      providerType: 'openai-images',
      endpoint: `${channel.baseURL}/models`,
      collectModels: collectModelIds,
    },
  ];

  const deadline = Date.now() + timeoutMs;
  let disproofCount = 0;
  let sawOutage = false;

  for (const attempt of attempts) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const payload = await fetchModelPayload(attempt.endpoint, channel, remainingMs, fetchImpl);
      if (attempt.collectModels(payload).length > 0 && !sawOutage) {
        return { providerType: attempt.providerType, confident: true, reason: '' };
      }
    } catch (error) {
      if (isUpstreamOutage(error)) {
        sawOutage = true;
      } else if (isProtocolDisproof(error)) {
        disproofCount += 1;
      }
    }
  }

  if (sawOutage) {
    return {
      providerType: null,
      confident: false,
      reason: '上游暂时不可用（HTTP 503 等），无法判定协议',
    };
  }

  if (disproofCount === attempts.length) {
    return {
      providerType: 'openai-images',
      confident: true,
      reason: '两种协议均被上游否证，按默认协议保存',
    };
  }

  return {
    providerType: null,
    confident: false,
    reason: '上游未返回可识别的模型，无法判定协议',
  };
}

export async function detectProviderTypeValue(channel, timeoutMs = 12000, fetchImpl = fetch) {
  const result = await detectProviderType(channel, timeoutMs, fetchImpl);
  return result.providerType || 'openai-images';
}

export function buildGeminiRequest(requestBody) {
  const prompt = String(requestBody.prompt || '').trim();
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
}

export function parseGeminiResponse(parsed) {
  const parts = Array.isArray(parsed?.candidates?.[0]?.content?.parts)
    ? parsed.candidates[0].content.parts
    : [];
  const data = parts
    .filter((part) => part?.inlineData?.data)
    .map((part) => ({
      b64_json: part.inlineData.data,
      mimeType: part.inlineData.mimeType,
    }));

  if (data.length === 0) {
    throw upstreamError('Gemini \u672a\u8fd4\u56de\u56fe\u7247\u6570\u636e', 502, parsed);
  }

  return { data };
}

export const geminiNativeAdapter = {
  capabilities(_channel) {
    return { batch: false, seed: false, maxBatch: 1 };
  },

  async listModels(channel, timeoutMs = 30000) {
    const endpoint = `${geminiBaseFrom(channel.baseURL)}/v1beta/models`;
    const payload = await fetchModelPayload(endpoint, channel, timeoutMs);
    const models = collectGeminiModelIds(payload);
    return {
      models,
      candidateModels: models.filter((model) => /image/i.test(model)),
      providerDefaults: [],
    };
  },

  async probe(channel, timeoutMs = 15000) {
    const endpoint = `${geminiBaseFrom(channel.baseURL)}/v1beta/models`;
    return probeModels(endpoint, channel, timeoutMs, collectGeminiModelIds);
  },

  async generate(channel, requestBody, timeoutMs = 180000) {
    const model = String(requestBody.model || '').trim();
    if (!model) throw upstreamError('gemini-native \u8981\u6c42\u6307\u5b9a model', 400);

    const endpoint = `${geminiBaseFrom(channel.baseURL)}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const requestMeta = {
      endpoint: hideUrlSecret(endpoint),
      method: 'POST',
      model,
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${channel.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildGeminiRequest(requestBody)),
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

      return parseGeminiResponse(parsed);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (error.name === 'AbortError') {
        throw enrichUpstreamError(upstreamError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`, 408), {
          ...requestMeta,
          durationMs,
          originalError: error.name,
          maybeCharged: true,
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
        maybeCharged: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  },

  classifyError(error) {
    return error;
  },
};

export const PROVIDER_ADAPTERS = {
  'openai-images': openaiImagesAdapter,
  'gemini-native': geminiNativeAdapter,
};

export function getProviderType(channel) {
  if (!channel) return 'openai-images';
  const providerType = String(channel.providerType || '').trim();
  return PROVIDER_ADAPTERS[providerType] ? providerType : 'openai-images';
}

export function getAdapter(channel) {
  return PROVIDER_ADAPTERS[getProviderType(channel)];
}

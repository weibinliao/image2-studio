const statusCard = document.querySelector('#statusCard');
const roleBadge = document.querySelector('#roleBadge');
const lanBadge = document.querySelector('#lanBadge');
const clientBadge = document.querySelector('#clientBadge');
const clientBadgeSide = document.querySelector('#clientBadgeSide');
const resetClientButton = document.querySelector('#resetClientButton');
const adminPanel = document.querySelector('#adminPanel');
const keyList = document.querySelector('#keyList');
const logs = document.querySelector('#logs');
const auditLogs = document.querySelector('#auditLogs');
const gallery = document.querySelector('#gallery');
const historyEl = document.querySelector('#history');
const historyTitle = document.querySelector('.history-header h2');
const historyScopeLabel = document.querySelector('.history-header .user-badge span');
const promptModal = document.querySelector('#promptModal');
const promptMeta = document.querySelector('#promptMeta');
const promptModalPrompt = document.querySelector('#promptModalPrompt');
const promptModalNegative = document.querySelector('#promptModalNegative');
const copyPromptButton = document.querySelector('#copyPromptButton');
const runState = document.querySelector('#runState');
const progressCard = document.querySelector('#progressCard');
const progressStage = document.querySelector('#progressStage');
const progressPercent = document.querySelector('#progressPercent');
const progressBar = document.querySelector('#progressBar');
const generateForm = document.querySelector('#generateForm');
const keyForm = document.querySelector('#keyForm');
const clearHistoryButton = document.querySelector('#clearHistoryButton');
const generateButton = document.querySelector('#generateButton');
const generateChannelSummary = document.querySelector('#generateChannelSummary');
const modelInput = document.querySelector('#model');
const modelSuggestions = document.querySelector('#modelSuggestions');
const loadModelsButton = document.querySelector('#loadModelsButton');
const testModelButton = document.querySelector('#testModelButton');
const modelNote = document.querySelector('#modelNote');
const userChannelSelect = document.querySelector('#userChannelId');
const userChannelNote = document.querySelector('#userChannelNote');
const adminChannelSelect = document.querySelector('#adminChannelId');
const adminChannelNote = document.querySelector('#adminChannelNote');
const testChannelSelect = document.querySelector('#testChannelId');
const imageInputBox = document.querySelector('#imageInputBox');
const inputImage = document.querySelector('#inputImage');
const inputPreview = document.querySelector('#inputPreview');
const promptInput = document.querySelector('#prompt');

let lastPrompt = '';
let currentKeys = [];
let currentHistory = [];
let inputImageDataUrl = '';
let activeJobTimer = null;
let isAdmin = false;
let activePromptText = '';
let currentModelChannelId = '';
const clientId = getOrCreateClientId();
document.cookie = `image2_client_id=${encodeURIComponent(clientId)}; path=/; max-age=31536000; SameSite=Lax`;

clientBadge.textContent = clientId;
clientBadgeSide.textContent = clientId;

resetClientButton.addEventListener('click', () => {
  if (!confirm('切换为新用户后，这个浏览器会使用新的独立历史。旧历史仍保存在服务器上。')) return;
  localStorage.removeItem('image2StudioClientId');
  location.reload();
});

userChannelSelect.addEventListener('change', async () => {
  await saveUserChannel();
});

adminChannelSelect.addEventListener('change', async () => {
  await saveAdminChannel();
});

testChannelSelect.addEventListener('change', async () => {
  await loadModels({ log: false });
});

generateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await generateImage();
});

keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await addKey();
});

clearHistoryButton.addEventListener('click', async () => {
  await loadHistory();
  addLog('历史记录已根据本地图片和审计日志重新校准');
});

loadModelsButton.addEventListener('click', async () => {
  await loadModels({ log: true });
});

testModelButton.addEventListener('click', async () => {
  await testCurrentModel();
});

generateForm.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener('change', updateModeUI);
});

inputImage.addEventListener('change', async () => {
  const file = inputImage.files?.[0];
  inputImageDataUrl = file ? await fileToDataUrl(file) : '';
  renderInputPreview(file, inputImageDataUrl);
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    promptInput.value = button.dataset.prompt || '';
    promptInput.focus();
  });
});

historyEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view-prompt]');
  if (!button) return;
  const item = currentHistory.find((historyItem) => historyItem.id === button.dataset.viewPrompt);
  if (item) openPromptModal(item);
});

document.querySelectorAll('[data-close-prompt]').forEach((button) => {
  button.addEventListener('click', closePromptModal);
});

copyPromptButton.addEventListener('click', async () => {
  if (!activePromptText) return;
  await navigator.clipboard.writeText(activePromptText);
  copyPromptButton.textContent = '已复制';
  setTimeout(() => {
    copyPromptButton.textContent = '复制';
  }, 1200);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !promptModal.hidden) closePromptModal();
});

await refreshAll();
setInterval(loadStatus, 10000);
setInterval(loadAuditLog, 15000);

async function refreshAll() {
  await loadStatus();
  await loadHistory();
  await loadAuditLog();
  await loadModels({ log: false });
}

async function loadModels(options = {}) {
  if (!isAdmin) return;

  try {
    const channelId = testChannelSelect.value;
    const payload = await getJson(`/api/models${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`);
    const suggestions = uniqueValues([
      ...(payload.providerDefaults || []),
      ...(payload.candidateModels || []),
      ...((payload.providerDefaults?.length || payload.candidateModels?.length) ? [] : (payload.models || [])),
    ]);
    modelSuggestions.innerHTML = suggestions.map((model) => `<option value="${escapeAttr(model)}"></option>`).join('');

    const selectedChannelChanged = currentModelChannelId !== channelId;
    if (payload.providerDefaults?.length && (selectedChannelChanged || !modelInput.value)) {
      modelInput.value = payload.providerDefaults[0];
    }
    currentModelChannelId = channelId;

    const defaults = payload.providerDefaults?.length ? payload.providerDefaults.join(', ') : '无';
    const candidates = payload.candidateModels?.length ? payload.candidateModels.slice(0, 8).join(', ') : '无';
    modelNote.textContent = `推荐默认：${defaults}。名称候选：${candidates}。候选只来自 /models 名称匹配，请点“测试能否生图”验证。`;

    if (options.log) {
      addLog(`模型列表已读取。推荐默认：${defaults}；名称候选：${candidates}`);
    }
  } catch (error) {
    modelNote.textContent = `读取模型列表失败：${error.message}`;
    if (options.log) addLog(`读取模型列表失败：${error.message}`, true);
  }
}

async function testCurrentModel() {
  if (!isAdmin) {
    addLog('访客不能测试或管理模型', true);
    return;
  }

  const channelId = testChannelSelect.value;
  const model = modelInput.value.trim();

  if (!model) {
    addLog('请先填写要测试的模型名', true);
    return;
  }

  testModelButton.disabled = true;
  modelNote.textContent = `正在测试 ${model} 是否能真实生图...`;
  addLog(`开始真实生图测试：${model}`);

  try {
    const response = await apiFetch('/api/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, model, size: '1024x1024', quality: 'low', outputFormat: 'png' }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || '模型生图测试失败');
    }

    renderGallery(payload.images || []);
    modelNote.textContent = `${model} 真实生图测试成功，已生成测试图。`;
    addLog(`${model} 生图测试成功，使用 ${payload.channel?.masked || '当前 key'}`);
    await refreshAll();
  } catch (error) {
    modelNote.textContent = `${model} 生图测试失败：${error.message}`;
    addLog(`${model} 生图测试失败：${error.message}`, true);
  } finally {
    testModelButton.disabled = false;
  }
}

async function generateImage() {
  const form = new FormData(generateForm);
  const prompt = String(form.get('prompt') || '').trim();
  const mode = String(form.get('mode') || 'text');
  const extraParamsText = document.querySelector('#extraParams').value.trim();

  if (!prompt) {
    addLog('Prompt 不能为空', true);
    return;
  }

  if (mode === 'image' && !inputImageDataUrl) {
    addLog('图生图需要先上传一张参考图', true);
    return;
  }

  let extraParams = {};
  if (extraParamsText) {
    try {
      extraParams = JSON.parse(extraParamsText);
    } catch (error) {
      addLog(`高级参数不是合法 JSON：${error.message}`, true);
      return;
    }
  }

  lastPrompt = prompt;
  generateButton.disabled = true;
  runState.textContent = mode === 'image' ? '正在执行图生图任务，可能需要 5-15 分钟...' : '正在创建生图任务...';
  addLog(`${mode === 'image' ? '开始图生图，请耐心等待，不要重复点击' : '开始生成图片'} · ${getGenerationChannelLogLabel()}`);

  try {
    setProgress({ progress: 2, stage: '正在创建任务' });
    const response = await apiFetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negativePrompt: form.get('negativePrompt'),
        model: isAdmin ? form.get('model') : '',
        size: form.get('size'),
        quality: form.get('quality'),
        extraParams: {
          ...extraParams,
          output_format: form.get('outputFormat'),
        },
        images: mode === 'image' ? [inputImageDataUrl] : [],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '创建任务失败');
    }

    await pollJob(payload.job.id);
  } catch (error) {
    runState.textContent = '生成失败';
    setProgress({ progress: 100, stage: '生成失败' });
    addLog(error.message, true);
  } finally {
    generateButton.disabled = false;
  }
}

async function pollJob(jobId) {
  clearActiveJobTimer();
  addLog(`任务已创建：${jobId}`);

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const payload = await getJson(`/api/jobs/${encodeURIComponent(jobId)}`);
        const job = payload.job;
        setProgress(job);
        runState.textContent = `${job.stage} · ${job.progress}%`;

        if (job.status === 'succeeded') {
          clearActiveJobTimer();
          const result = job.result || {};
          renderGallery(result.images || []);
          const successAttempt = result.attempts?.find((item) => item.ok);
          runState.textContent = `生成成功，共 ${result.images?.length || 0} 张`;
          addLog(`生成成功，使用 ${formatKeyLabel(successAttempt?.key) || '可用渠道'}`);
          await refreshAll();
          resolve(job);
          return;
        }

        if (job.status === 'failed') {
          clearActiveJobTimer();
          const attempts = job.error?.attempts?.map((item) => `${item.key?.masked || 'key'}: ${item.error}`).join(' | ');
          reject(new Error(attempts || job.error?.message || job.error?.error || '生成失败'));
          return;
        }

        activeJobTimer = setTimeout(tick, 2000);
      } catch (error) {
        clearActiveJobTimer();
        reject(error);
      }
    };

    tick();
  });
}

function setProgress(job) {
  const value = Math.max(0, Math.min(100, Number(job.progress || 0)));
  progressCard.hidden = false;
  progressStage.textContent = job.stage || '处理中';
  progressPercent.textContent = `${value}%`;
  progressBar.style.width = `${value}%`;
}

function clearActiveJobTimer() {
  if (activeJobTimer) {
    clearTimeout(activeJobTimer);
    activeJobTimer = null;
  }
}

async function addKey() {
  if (!isAdmin) {
    addLog('访客不能添加 API Key', true);
    return;
  }

  const nameInput = document.querySelector('#keyName');
  const baseURLInput = document.querySelector('#keyBaseURL');
  const keyInput = document.querySelector('#keyValue');
  const key = keyInput.value.trim();
  const baseURL = baseURLInput.value.trim();

  if (!key) {
    addLog('API Key 不能为空', true);
    return;
  }

  if (!baseURL) {
    addLog('API URL 不能为空', true);
    return;
  }

    const response = await apiFetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nameInput.value.trim(), baseURL, key }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    addLog(payload.error || '添加 key 失败', true);
    return;
  }

  keyInput.value = '';
  nameInput.value = '';
  addLog('已添加本地 key，可直接用于生图');
  await loadStatus();
  if (payload.key?.id) testChannelSelect.value = payload.key.id;
}

async function loadStatus() {
  const status = await getJson('/api/status');
  isAdmin = Boolean(status.admin);
  document.body.classList.toggle('visitor', !isAdmin);
  adminPanel.hidden = !isAdmin;
  resetClientButton.hidden = isAdmin;
  clearHistoryButton.textContent = '重新校准历史';
  currentKeys = status.keys || [];

  statusCard.innerHTML = `
    <div class="status-item"><span>可用 API Key</span><span>${status.readyKeyCount} / ${status.keyCount}</span></div>
    <div class="status-item"><span>局域网网关</span><span>${escapeHtml(status.lanUrls?.[0] || '未检测到 IPv4')}</span></div>
    <div class="status-item"><span>默认挂载模型</span><span>${escapeHtml(status.defaultModel)}</span></div>
    <div class="status-item"><span>当前角色</span><span>${isAdmin ? 'Admin' : 'Visitor'}</span></div>
  `;

  roleBadge.textContent = isAdmin ? 'Admin' : 'Visitor';
  lanBadge.textContent = status.lanUrls?.[0] || status.localUrl || '';

  renderChannelControls(currentKeys, status.userChannelId || '', status.adminChannelId || '');
  keyList.innerHTML = currentKeys.map(renderKey).join('') || '<p class="key-meta">还没有配置 key。</p>';

  keyList.querySelectorAll('[data-toggle-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      await toggleKey(button.dataset.toggleKey, button.dataset.enabled !== 'true');
    });
  });

  keyList.querySelectorAll('[data-delete-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      await deleteKey(button.dataset.deleteKey, button.dataset.source || '');
    });
  });
}

function renderChannelControls(keys, userChannelId = '', adminChannelId = '') {
  const previousUser = userChannelSelect.value || userChannelId;
  const previousAdmin = adminChannelSelect.value || adminChannelId;
  const previousTest = testChannelSelect.value;
  const enabledKeys = keys.filter((key) => key.enabled);
  const readyKeys = enabledKeys.filter((key) => !key.disabledByRuntime);

  if (!isAdmin) {
    userChannelSelect.innerHTML = '<option value="">管理员预设渠道</option>';
    adminChannelSelect.innerHTML = '<option value="">管理员自用渠道</option>';
    testChannelSelect.innerHTML = '<option value="">自动选择可用渠道</option>';
    userChannelSelect.value = '';
    adminChannelSelect.value = '';
    testChannelSelect.value = '';
    userChannelNote.textContent = '成员提交生图任务时会固定使用管理员设置的渠道。';
    adminChannelNote.textContent = '管理员生图渠道只在本机管理员界面显示。';
    return;
  }

  const channelOptions = enabledKeys.length
    ? enabledKeys.map(renderChannelOption).join('')
    : '<option value="">暂无可用渠道</option>';
  userChannelSelect.innerHTML = channelOptions;
  adminChannelSelect.innerHTML = channelOptions;

  testChannelSelect.innerHTML = [
    '<option value="">自动选择可用渠道</option>',
    ...readyKeys.map(renderChannelOption),
  ].join('');

  if (previousUser && enabledKeys.some((key) => key.id === previousUser)) {
    userChannelSelect.value = previousUser;
  } else if (enabledKeys.length > 0) {
    userChannelSelect.value = enabledKeys[0].id;
  }

  if (previousAdmin && enabledKeys.some((key) => key.id === previousAdmin)) {
    adminChannelSelect.value = previousAdmin;
  } else if (enabledKeys.length > 0) {
    adminChannelSelect.value = enabledKeys[0].id;
  }

  const selectedUserChannel = keys.find((key) => key.id === userChannelSelect.value);
  const selectedAdminChannel = keys.find((key) => key.id === adminChannelSelect.value);
  userChannelNote.textContent = selectedUserChannel
    ? `成员生成将使用：${selectedUserChannel.name} · ${selectedUserChannel.baseURL}`
    : '还没有可用渠道，成员暂时不能生成。';
  adminChannelNote.textContent = selectedAdminChannel
    ? `管理员生成将使用：${selectedAdminChannel.name} · ${selectedAdminChannel.baseURL}`
    : '还没有可用渠道，管理员暂时不能生成。';
  updateGenerateChannelSummary(selectedAdminChannel);

  if (previousTest && readyKeys.some((key) => key.id === previousTest)) {
    testChannelSelect.value = previousTest;
  } else {
    testChannelSelect.value = '';
  }
}

function renderChannelOption(key) {
  const suffix = key.disabledByRuntime
    ? ' · 运行时不可用'
    : key.coolingDown
      ? ` · 冷却 ${key.cooldownRemainingSeconds}s`
      : '';
  return `<option value="${escapeAttr(key.id)}">${escapeHtml(key.name)} · ${escapeHtml(key.baseURL)}${escapeHtml(suffix)}</option>`;
}

async function saveUserChannel() {
  if (!isAdmin) return;

  const channelId = userChannelSelect.value;
  if (!channelId) return;

  const response = await apiFetch('/api/settings/user-channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    addLog(payload.error || '保存用户固定渠道失败', true);
    await loadStatus();
    return;
  }

  addLog(`成员生成固定为：${payload.userChannel?.name || channelId}`);
  await loadStatus();
  await loadAuditLog();
}

async function saveAdminChannel() {
  if (!isAdmin) return;

  const channelId = adminChannelSelect.value;
  if (!channelId) return;

  const response = await apiFetch('/api/settings/admin-channel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    addLog(payload.error || '保存管理员生图渠道失败', true);
    await loadStatus();
    return;
  }

  addLog(`管理员生成固定为：${payload.adminChannel?.name || channelId}`);
  updateGenerateChannelSummary(payload.adminChannel);
  testChannelSelect.value = channelId;
  await loadModels({ log: false });
  await loadAuditLog();
}

function updateGenerateChannelSummary(channel = null) {
  if (!generateChannelSummary) return;
  if (!isAdmin) {
    generateChannelSummary.textContent = '';
    return;
  }
  const label = channel ? formatKeyLabel(channel) : '未设置';
  generateChannelSummary.textContent = `本次生成使用：管理员生图渠道 · ${label}`;
}

function getGenerationChannelLogLabel() {
  if (!isAdmin) return '成员渠道：管理员预设渠道';
  const selected = currentKeys.find((key) => key.id === adminChannelSelect.value);
  return `管理员渠道：${formatKeyLabel(selected) || '未设置'}`;
}

function formatKeyLabel(key) {
  if (!key) return '';
  return [key.name, key.masked].filter(Boolean).join(' · ') || key.id || '';
}

async function loadAuditLog() {
  if (!isAdmin) {
    auditLogs.innerHTML = '';
    return;
  }

  try {
    const payload = await getJson('/api/admin/audit-log');
    const events = payload.events || [];
    auditLogs.innerHTML = events.slice(0, 80).map(renderAuditEvent).join('') || '<p class="key-meta">暂无生成审计记录。</p>';
  } catch (error) {
    auditLogs.innerHTML = `<p class="key-meta">读取审计日志失败：${escapeHtml(error.message)}</p>`;
  }
}

async function loadHistory() {
  const payload = await getJson(isAdmin ? '/api/admin/history' : '/api/history');
  const history = payload.history || [];
  const users = payload.users || [];
  currentHistory = history;

  historyTitle.textContent = isAdmin ? '生成历史总览' : '个人历史画廊';
  historyScopeLabel.textContent = isAdmin ? '历史记录' : '当前创作者';
  clientBadge.textContent = isAdmin ? `${history.length} 条` : clientId;

  historyEl.innerHTML = history.map(renderHistoryItem).join('') || '<p class="key-meta">暂无历史。</p>';
}

async function toggleKey(id, enabled) {
  if (!isAdmin) return;

  const response = await apiFetch(`/api/keys/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    addLog(payload.error || '这个 key 不能在网页里切换，env key 请改 .env', true);
  }

  await loadStatus();
}

async function deleteKey(id, source) {
  if (!isAdmin) return;

  if (!confirm('删除这个渠道？env 渠道会从 .env 中移除，网页新增渠道会从 keys.json 中删除。')) return;
  const response = await apiFetch(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    addLog(payload.error || '删除渠道失败', true);
    return;
  }
  addLog(payload.source === 'env' ? 'env 渠道已从 .env 删除' : '文件渠道已删除');
  await loadStatus();
}

function renderHistoryItem(item) {
  const image = item.images?.[0];
  const imageUrl = image?.url || '';
  const owner = formatOwnerLabel(item.ownerClientId || clientId, item.ownerRole);
  const imageCount = item.images?.length || 0;
  const meta = [
    isAdmin ? owner : '',
    item.mode || '',
    imageCount > 1 ? `${imageCount} 张` : '',
  ].filter(Boolean).join(' · ');

  return `
    <article class="history-item" title="${escapeHtml(item.prompt)}">
      ${imageUrl ? `<img src="${escapeAttr(imageUrl)}" alt="历史图片" loading="lazy" />` : '<div class="history-missing-image">无图片</div>'}
      ${meta ? `<div class="history-owner">${escapeHtml(meta)}</div>` : ''}
      <p>${escapeHtml(item.prompt || '').slice(0, 100)}</p>
      ${imageUrl ? `
        <div class="history-actions">
          <a href="${escapeAttr(imageUrl)}" target="_blank" rel="noreferrer">预览</a>
          <a href="${escapeAttr(imageUrl)}" download>下载</a>
          <button type="button" data-view-prompt="${escapeAttr(item.id)}">查看提示器</button>
        </div>
      ` : ''}
    </article>
  `;
}

function renderAuditEvent(event) {
  const channel = event.channel || {};
  const channelText = formatKeyLabel(channel) || '\u672a\u77e5\u6e20\u9053';
  const actorText = formatOwnerLabel(event.clientId || 'default', event.actorRole);
  const statusText = event.status === 'succeeded' ? '\u6210\u529f' : event.status === 'failed' ? '\u5931\u8d25' : event.status || '\u672a\u77e5';
  const className = event.status === 'failed' ? 'audit-event failed' : 'audit-event';
  const details = event.details || {};
  const detail = [
    actorText,
    `\u6a21\u578b ${event.model || '\u672a\u586b\u5199'}`,
    `\u6e20\u9053 ${channelText}`,
    event.imageCount ? `${event.imageCount} \u5f20` : '',
    event.errorCode ? `\u9519\u8bef\u7801 ${event.errorCode}` : '',
    event.errorCategory ? `\u7c7b\u578b ${event.errorCategory}` : '',
    details.durationMs ? `\u8017\u65f6 ${Math.round(details.durationMs / 1000)}s` : '',
    event.maybeCharged ? '\u53ef\u80fd\u5df2\u6263\u8d39' : '',
    event.retryable ? '\u53ef\u91cd\u8bd5' : '',
  ].filter(Boolean).join(' \u00b7 ');
  const technicalDetail = [
    details.endpoint ? `Endpoint ${details.endpoint}` : '',
    details.httpStatus ? `HTTP ${details.httpStatus}` : '',
    details.contentType ? `Content-Type ${details.contentType}` : '',
    details.stream ? 'stream=true' : details.responseFormat ? 'stream=false' : '',
    details.networkMessage ? `\u7f51\u7edc ${details.networkMessage}` : '',
  ].filter(Boolean).join(' \u00b7 ');

  return `
    <article class="${className}">
      <div class="audit-top">
        <strong>${escapeHtml(statusText)}</strong>
        <time>${escapeHtml(formatDateTime(event.createdAt))}</time>
      </div>
      <p>${escapeHtml(detail)}</p>
      ${event.error ? `<span>${escapeHtml(event.error)}</span>` : ''}
      ${technicalDetail ? `<span>${escapeHtml(technicalDetail)}</span>` : ''}
    </article>
  `;
}
function openPromptModal(item) {
  activePromptText = item.prompt || '';
  const owner = formatOwnerLabel(item.ownerClientId || clientId, item.ownerRole);
  const meta = [
    ['创建者', owner],
    ['模式', item.mode || ''],
    ['模型', item.model || ''],
    ['尺寸', item.size || ''],
    ['图片', `${item.images?.length || 0} 张`],
    ['时间', formatDateTime(item.createdAt)],
  ];

  promptMeta.innerHTML = meta
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join('');
  promptModalPrompt.textContent = item.prompt || '无';
  promptModalNegative.textContent = item.negativePrompt || '无';
  copyPromptButton.textContent = '复制';
  promptModal.hidden = false;
  document.body.classList.add('modal-open');
}

function formatOwnerLabel(ownerId, ownerRole = '') {
  if (ownerRole === 'admin' || ownerId === 'admin') return '管理员';
  return `成员 ${ownerId || 'default'}`;
}

function closePromptModal() {
  promptModal.hidden = true;
  activePromptText = '';
  document.body.classList.remove('modal-open');
}

function renderGallery(images) {
  if (!images.length) {
    gallery.innerHTML = '<div class="empty"><strong>没有返回图片</strong><span>请查看右侧日志。</span></div>';
    return;
  }

  gallery.innerHTML = images.map((image, index) => `
    <article class="image-card">
      <img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.revisedPrompt || lastPrompt || 'generated image')}" />
      <div class="image-actions">
        <a href="${escapeAttr(image.url)}" download>高清下载</a>
        <button type="button" data-open="${escapeAttr(image.url)}">放大预览</button>
      </div>
    </article>
  `).join('');

  gallery.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => window.open(button.dataset.open, '_blank', 'noopener,noreferrer'));
  });
}

function renderKey(key) {
  const bad = !key.enabled || key.disabledByRuntime;
  const cooling = key.coolingDown;
  const status = bad ? '不可用' : cooling ? `冷却 ${key.cooldownRemainingSeconds}s` : '就绪';
  const badgeClass = bad ? 'bad' : cooling ? '' : 'ok';
  const canToggle = key.source === 'file';

  return `
    <article class="key-item">
      <div class="key-top">
        <strong>${escapeHtml(key.name)}</strong>
        <span class="badge ${badgeClass}">${status}</span>
      </div>
      <div class="key-meta">
        <div>${escapeHtml(key.masked)} · ${escapeHtml(key.source)}</div>
        <div>${escapeHtml(key.baseURL || '')}</div>
        <div>成功 ${key.successes} · 失败 ${key.failures}</div>
        ${key.lastError ? `<div>最近错误：${escapeHtml(key.lastError)}</div>` : ''}
      </div>
      <div class="key-actions">
        ${canToggle ? `<button class="btn-outline" type="button" data-toggle-key="${escapeAttr(key.id)}" data-enabled="${String(key.enabled)}">${key.enabled ? '停用' : '启用'}</button>` : ''}
        <button class="btn-outline" type="button" data-delete-key="${escapeAttr(key.id)}" data-source="${escapeAttr(key.source)}">删除</button>
      </div>
    </article>
  `;
}

function updateModeUI() {
  const mode = new FormData(generateForm).get('mode');
  document.body.classList.toggle('image-mode', mode === 'image');
  imageInputBox.hidden = false;

  if (mode === 'image') {
    addLog('已切换到图生图模式，请上传参考图后再生成');
  }
}

function renderInputPreview(file, dataUrl) {
  if (!file || !dataUrl) {
    inputPreview.innerHTML = '';
    return;
  }

  inputPreview.innerHTML = `
    <article>
      <img src="${escapeAttr(dataUrl)}" alt="输入图预览" />
      <p>${escapeHtml(file.name)} · ${Math.round(file.size / 1024)} KB</p>
    </article>
  `;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error || new Error('读取图片失败')));
    reader.readAsDataURL(file);
  });
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function getJson(url) {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return response.json();
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'X-Client-Id': clientId,
      ...(options.headers || {}),
    },
  });
}

function getOrCreateClientId() {
  const existing = localStorage.getItem('image2StudioClientId');
  if (existing) return existing;

  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const id = `user_${randomPart}`;
  localStorage.setItem('image2StudioClientId', id);
  return id;
}

function addLog(message, isError = false) {
  const line = document.createElement('div');
  line.className = `log-line${isError ? ' error' : ''}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logs.prepend(line);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

updateModeUI();

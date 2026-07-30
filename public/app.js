import {
  imageModelCandidates,
  isTestedSelection,
  matchingModelEngines,
} from './model-management.js';

const statusCard = document.querySelector('#statusCard');
const roleBadge = document.querySelector('#roleBadge');
const brandIcon = document.querySelector('#brandIcon');
const brandName = document.querySelector('#brandName');
// LAN 地址现在只在设置抽屉的运行状态里出现一次，顶栏不再重复显示。
// 身份只显示在顶栏一处。旧结构在底部历史区还有一个 #clientBadge，已随结构去掉。
const clientBadgeSide = document.querySelector('#clientBadgeSide');
const resetClientButton = document.querySelector('#resetClientButton');
const adminPanel = document.querySelector('#adminPanel');
const visitorPanel = document.querySelector('#visitorPanel');
const currentBlock = document.querySelector('#currentBlock');
const statusLine = document.querySelector('#statusLine');
const statusDot = document.querySelector('#statusDot');
const statusText = document.querySelector('#statusText');
const channelPulse = document.querySelector('#channelPulse');
const failedCountBadge = document.querySelector('#failedCount');
const activityPanel = document.querySelector('#activityPanel');
const jobSteps = document.querySelector('#jobSteps');
const assistRow = document.querySelector('#assistRow');
const rewriteSlot = document.querySelector('#rewriteSlot');
const ownerFilter = document.querySelector('#ownerFilter');
const clearOwnerFilterButton = document.querySelector('#clearOwnerFilter');
const keyList = document.querySelector('#keyList');
const logs = document.querySelector('#logs');
const auditLogs = document.querySelector('#auditLogs');
const gallery = document.querySelector('#gallery');
const historyEl = document.querySelector('#history');
// 旧的 .history-header 标题栏被顶部筛选 tab 取代，不再需要引用。
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
const engineSelector = document.querySelector('#engineSelector');
const engineList = document.querySelector('#engineList');
const engineForm = document.querySelector('#engineForm');
const engineChannelsSelect = document.querySelector('#engineChannels');
const engineSaveNote = document.querySelector('#engineSaveNote');
const modelManagerChannel = document.querySelector('#modelManagerChannel');
const modelManagerModel = document.querySelector('#modelManagerModel');
const modelManagerEngine = document.querySelector('#modelManagerEngine');
const refreshImageModelsButton = document.querySelector('#refreshImageModelsButton');
const testImageModelButton = document.querySelector('#testImageModelButton');
const setDefaultImageModelButton = document.querySelector('#setDefaultImageModelButton');
const modelManagerNote = document.querySelector('#modelManagerNote');
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
const appearanceForm = document.querySelector('#appearanceForm');
const appearanceNameInput = document.querySelector('#appearanceName');
const appearanceIconInput = document.querySelector('#appearanceIcon');
const imageInputBox = document.querySelector('#imageInputBox');
const inputImage = document.querySelector('#inputImage');
const inputPreview = document.querySelector('#inputPreview');
const promptInput = document.querySelector('#prompt');
const toastRegion = document.querySelector('#toastRegion');
const retryBox = document.querySelector('#retryBox');
const retryButton = document.querySelector('#retryButton');
const archiveList = document.querySelector('#archiveList');
const imageCountInput = document.querySelector('#imageCount');
const seedInput = document.querySelector('#seed');
const randomSeedButton = document.querySelector('#randomSeedButton');
const clearSeedButton = document.querySelector('#clearSeedButton');
const promptSeedRow = document.querySelector('#promptSeedRow');
const promptSeedValue = document.querySelector('#promptSeedValue');
const reuseSeedButton = document.querySelector('#reuseSeedButton');
const negativePromptInput = document.querySelector('#negativePrompt');
const sizeSelect = document.querySelector('#size');
const lightbox = document.querySelector('#lightbox');
const lightboxStage = document.querySelector('#lightboxStage');
const lightboxImage = document.querySelector('#lightboxImage');
const lightboxCaption = document.querySelector('#lightboxCaption');
const lightboxCounter = document.querySelector('#lightboxCounter');
const lightboxPrev = document.querySelector('#lightboxPrev');
const lightboxNext = document.querySelector('#lightboxNext');
const lightboxDownload = document.querySelector('#lightboxDownload');
const lightboxZoomOut = document.querySelector('#lightboxZoomOut');
const lightboxZoomIn = document.querySelector('#lightboxZoomIn');
const lightboxFit = document.querySelector('#lightboxFit');
const lightboxActual = document.querySelector('#lightboxActual');
const lightboxZoomValue = document.querySelector('#lightboxZoomValue');
const chargedSummary = document.querySelector('#chargedSummary');
const chargedList = document.querySelector('#chargedList');
const memberStats = document.querySelector('#memberStats');
const recentPrompts = document.querySelector('#recentPrompts');
const historySearch = document.querySelector('#historySearch');
const historyPageInfo = document.querySelector('#historyPageInfo');
const historyPrev = document.querySelector('#historyPrev');
const historyNext = document.querySelector('#historyNext');
const batchGroup = document.querySelector('#batchGroup');
const batchNote = document.querySelector('#batchNote');

let lastPrompt = '';
let currentKeys = [];
let currentStatus = null;
let currentHistory = [];
let inputImageDataUrl = '';
let activeJobTimer = null;
let isAdmin = false;
let activePromptText = '';
// 详情弹窗当前那条记录的 seed，供"用这个 seed 重生成"回填。
let activePromptSeed = '';
let currentModelChannelId = '';
let modelManagerTestState = null;
let modelManagerEngines = [];
let modelManagerBusy = '';
// Filled in from /api/status: what the channel we actually generate on supports.
// Defaults to the conservative shape so a failed status call cannot present a
// batch control that silently returns one image.
let capabilities = { batch: false, seed: true, maxBatch: 1 };
let historyPage = 0;
let historyQuery = '';
// Anything reachable from refreshAll() must be declared above the top-level
// `await refreshAll()` below — a `const` further down the file is still in its
// temporal dead zone when that runs.
const HISTORY_PAGE_SIZE = 24;
let lightboxItems = [];
let lightboxIndex = 0;
let lastFocusedBeforeModal = null;
// 顶部筛选 tab：全部 / 我的 / 失败。失败不混在墙里——上一版混排导致浏览时
// 每隔几块就得停下读错误文本，墙不再可扫视。
let historyScope = 'all';
let chargedReport = null;
// 按成员筛选（管理员）。空字符串 = 全部。
let ownerFilterValue = '';
// 失败来自审计日志而不是历史记录：失败没有图片，历史里根本没有它们。
let failedEvents = [];
// 成员视角预览。必须声明在顶层 await refreshAll() 之上——loadStatus 会读它，
// 而下方的 let 在那时还处于暂时性死区。
let previewingMember = false;
// 本次生成区的图片数据。resumeActiveJob → pollJob → renderGallery 会在顶层 await
// 之后立刻触达它，所以同样必须声明在这里。
let currentGalleryEntries = [];
let lightboxZoom = { scale: 1, x: 0, y: 0 };
let lightboxDrag = null;
let lightboxDragMoved = false;
const LIGHTBOX_MIN_SCALE = 0.25;
const LIGHTBOX_MAX_SCALE = 6;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_APPEARANCE = { brandName: 'Image2 Studio', brandIcon: 'I2' };
// 输入建议的防抖计时器。同样必须在顶层 await 之上。
let assistTimer = null;
// 已被手动关闭的失败告警。存 localStorage 而不是模块变量——之前刷新一次就
// 重置，用户每次进页面都得重新关一遍。
// 记的是"关闭时的失败条数 + 当天日期"：新失败会让告警重新出现，跨天自动失效。
// updateStatusLine 由 15 秒轮询触发，所以这个状态必须在顶层 await 之上。
const DISMISS_KEY = 'image2DismissedFailures';

function readDismissedFailures() {
  try {
    const stored = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null');
    if (!stored || stored.day !== new Date().toISOString().slice(0, 10)) return -1;
    return Number(stored.count) || -1;
  } catch {
    return -1;
  }
}

function writeDismissedFailures(count) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ day: new Date().toISOString().slice(0, 10), count }));
  } catch {
    // 隐私模式下存不了，当次会话生效即可。
  }
}
// Display only. The real identity is an HttpOnly cookie this script cannot read;
// /api/status reports which id the server assigned us. localStorage just avoids
// a blank badge on first paint.
let clientId = localStorage.getItem('image2StudioClientId') || '识别中…';

clientBadgeSide.textContent = clientId;

resetClientButton.addEventListener('click', async () => {
  // Identity is now a signed cookie, so this is effectively one-way: the old
  // archive stays on the server but only an admin-issued claim link can get this
  // browser back to it. The old wording made it sound casually reversible.
  if (!confirm('切换后这个浏览器会得到一个全新身份，旧的历史记录将不再显示。\n\n旧图片仍然保存在服务器上，但要重新看到它们，需要管理员生成一个认领链接。\n\n确定要切换吗？')) return;

  try {
    const result = await postJson('/api/client/reset');
    localStorage.setItem('image2StudioClientId', result.clientId);
    location.reload();
  } catch (error) {
    showError(`切换用户失败：${error.message}`);
  }
});

userChannelSelect.addEventListener('change', async () => {
  await saveUserChannel();
});

adminChannelSelect.addEventListener('change', async () => {
  await saveAdminChannel();
});

appearanceForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveAppearance();
});

testChannelSelect.addEventListener('change', async () => {
  await loadModels({ log: false });
});

modelManagerChannel?.addEventListener('change', async () => {
  resetModelManagerTest();
  modelManagerModel.innerHTML = '';
  syncModelManagerEngineOptions();
  await loadImageModelsForManager();
});

modelManagerModel?.addEventListener('change', () => {
  resetModelManagerTest('模型已切换，请重新测试后再设为默认。');
});

modelManagerEngine?.addEventListener('change', updateModelManagerControls);

refreshImageModelsButton?.addEventListener('click', async () => {
  await loadImageModelsForManager();
});

testImageModelButton?.addEventListener('click', async () => {
  await testManagedImageModel();
});

setDefaultImageModelButton?.addEventListener('click', async () => {
  await setDefaultManagedImageModel();
});

generateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await generateImage();
});

retryButton?.addEventListener('click', async () => {
  await generateImage();
});

historyPrev?.addEventListener('click', () => {
  historyPage -= 1;
  renderHistoryPage();
});

historyNext?.addEventListener('click', () => {
  historyPage += 1;
  renderHistoryPage();
});

let historySearchTimer = null;
historySearch?.addEventListener('input', () => {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    historyQuery = historySearch.value;
    historyPage = 0;
    renderHistoryPage();
  }, 200);
});

// Ctrl/Cmd+Enter submits from inside the prompt textarea.
promptInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    generateForm.requestSubmit();
  }
});

keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await addKey();
});

engineSelector?.addEventListener('change', () => {
  const selected = engineSelector.querySelector('input[name="engine"]:checked');
  if (!selected || !currentStatus?.engines) return;
  const selectedEngine = selected.value === 'auto'
    ? null
    : currentStatus.engines.find((engine) => engine.id === selected.value);
  updateCapabilityControls(selectedEngine?.capabilities || currentStatus.capabilities);
  updateGenerateChannelSummary();
});

engineForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const channelIds = Array.from(engineChannelsSelect?.selectedOptions || []).map((option) => option.value);
  const priorityValue = Number(document.querySelector('#enginePriority').value);
  const newEngine = {
    id: document.querySelector('#engineId').value.trim(),
    label: document.querySelector('#engineLabel').value.trim(),
    providerType: document.querySelector('#engineProviderType').value,
    model: document.querySelector('#engineModel').value.trim(),
    channelIds,
    memberEnabled: document.querySelector('#engineMemberEnabled').checked,
    autoEnabled: document.querySelector('#engineAutoEnabled').checked,
    priority: Number.isFinite(priorityValue) ? priorityValue : 10,
    enabled: document.querySelector('#engineEnabled').checked,
  };

  try {
    const response = await fetch('/api/admin/image-engines', { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '加载现有引擎配置失败');
    const existing = data.engines || [];
    const index = existing.findIndex((engine) => engine.id === newEngine.id);
    const updated = index >= 0
      ? existing.map((engine, itemIndex) => itemIndex === index ? newEngine : engine)
      : [...existing, newEngine];
    await saveEngineConfig(updated);
    engineForm.reset();
    const addPanel = document.querySelector('#engineAddPanel');
    if (addPanel) addPanel.open = false;
  } catch (error) {
    showEngineNote(`保存失败: ${error.message}`, 'error');
  }
});

// Labelled 重新校准历史 but it only re-fetches — DELETE /api/history is a hard
// 405 by design, so the old wording promised a repair that never happened.
clearHistoryButton.addEventListener('click', async () => {
  clearHistoryButton.disabled = true;
  try {
    await loadHistory();
    showSuccess('历史记录已刷新');
  } catch (error) {
    showError(`刷新历史失败：${error.message}`);
  } finally {
    clearHistoryButton.disabled = false;
  }
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
  if (!file) {
    clearReferenceImage();
    return;
  }
  await acceptReferenceFile(file);
});

// 参考图有三个入口（选文件 / 粘贴 / 拖入），校验和压缩必须走同一条路，
// 否则粘贴进来的图会绕过 image/* 检查和 2048 压缩。
async function acceptReferenceFile(file, { announce = false } = {}) {
  // The accept attribute is a filter, not a guarantee — a renamed file gets past it.
  if (!file.type.startsWith('image/')) {
    showError('请选择图片文件（JPG、PNG、WebP）。');
    clearReferenceImage();
    return false;
  }

  try {
    const original = await fileToDataUrl(file);
    // Reference images were posted at full size as base64 inside the JSON body
    // against a 32MB cap, so a phone photo could be tens of megabytes on the wire.
    inputImageDataUrl = await downscaleDataUrl(original, 2048, file.type);
    renderInputPreview(file, inputImageDataUrl, original.length);
    // 有了参考图却还停在文生图，提交时会被服务端拒；直接切过去省一步。
    switchToImageMode();
    if (announce) showSuccess('参考图已就绪，已切到图生图。');
    return true;
  } catch (error) {
    showError(`读取图片失败：${error.message}`);
    clearReferenceImage();
    return false;
  }
}

function clearReferenceImage() {
  inputImage.value = '';
  inputImageDataUrl = '';
  renderInputPreview(null, '');
  updateModeUI();
}

function switchToImageMode() {
  const imageModeRadio = document.querySelector('input[name="mode"][value="image"]');
  if (imageModeRadio && !imageModeRadio.checked) imageModeRadio.checked = true;
  updateModeUI();
}

// 从剪贴板/拖拽事件里挑第一张图。截图粘贴是这类工具最高频的动作。
function firstImageFile(list) {
  return [...(list || [])].find((item) => item && item.type?.startsWith('image/')) || null;
}

// 粘贴：光标在 prompt 里也要能贴图，所以挂在 document 上。
document.addEventListener('paste', async (event) => {
  // 纯文本粘贴不要拦，否则贴提示词就废了。
  const file = firstImageFile(event.clipboardData?.files);
  if (!file) return;
  event.preventDefault();
  await acceptReferenceFile(file, { announce: true });
});

// 拖拽：整页都是放置区，拖到哪都能松手。
const dropZone = document.body;
let dragDepth = 0;

dropZone.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add('dropping');
});

dropZone.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  // 不 preventDefault 的话浏览器会直接打开这张图，页面就没了。
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

dropZone.addEventListener('dragleave', () => {
  // dragleave 会在子元素边界反复触发，用计数器判断是否真的离开了窗口。
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dropping');
});

dropZone.addEventListener('drop', async (event) => {
  const file = firstImageFile(event.dataTransfer?.files);
  dragDepth = 0;
  document.body.classList.remove('dropping');
  if (!file) return;
  event.preventDefault();
  await acceptReferenceFile(file, { announce: true });
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    // Append instead of replace: clicking a template used to silently destroy
    // whatever the user had already written.
    appendPrompt(button.dataset.prompt || '');
  });
});

historyEl.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view-prompt]');
  if (viewButton) {
    const item = currentHistory.find((historyItem) => historyItem.id === viewButton.dataset.viewPrompt);
    if (item) openPromptModal(item);
    return;
  }

  // The archive was view-only, which broke the generate → tweak → generate loop
  // that is how image work actually gets done.
  const reuseButton = event.target.closest('[data-reuse]');
  if (reuseButton) {
    const item = currentHistory.find((historyItem) => historyItem.id === reuseButton.dataset.reuse);
    if (item) reuseHistoryItem(item);
    return;
  }

  // 失败图块上的重试：把当时的提示词填回去重跑。
  const refailButton = event.target.closest('[data-refail]');
  if (refailButton) {
    const event2 = failedEvents.find((item) => item.id === refailButton.dataset.refail);
    if (event2?.prompt) {
      promptInput.value = event2.prompt;
      syncComposerLabels();
      generateForm.requestSubmit();
    }
    return;
  }

  // 迭代要便宜：同参数换 seed 直接重跑，是图块上最省事的动作。
  const againButton = event.target.closest('[data-again]');
  if (againButton) {
    const item = currentHistory.find((historyItem) => historyItem.id === againButton.dataset.again);
    if (item) {
      reuseHistoryItem(item, { silent: true });
      generateForm.requestSubmit();
    }
    return;
  }

  // 点图片任意位置（不只是那个隐形层）都能放大。遮罩之前会吞掉这个点击。
  const tileImage = event.target.closest('.tile img');
  if (tileImage) {
    const id = tileImage.closest('.tile')?.dataset.id;
    if (id) openLightboxForHistoryId(id);
    return;
  }

  // 点图上的归属标签直接筛这个成员——比先滚到顶部再找下拉快。
  const ownerButton = event.target.closest('[data-filter-owner]');
  if (ownerButton) {
    const owner = ownerButton.dataset.filterOwner;
    // 再点一次取消，符合"切换"的直觉。
    setOwnerFilter(ownerFilterValue === owner ? '' : owner);
    showSuccess(ownerFilterValue ? `只看 ${formatOwnerLabel(owner, '')} 的作品` : '已显示全部成员');
    return;
  }

  // 删除。成员是软删除（管理员可恢复），管理员是真删除——文案必须说清区别，
  // 因为后者不可撤销。
  const delButton = event.target.closest('[data-del]');
  if (delButton) {
    deleteHistoryItem(delButton.dataset.del, delButton);
    return;
  }

  const restoreButton = event.target.closest('[data-restore]');
  if (restoreButton) {
    restoreHistoryItem(restoreButton.dataset.restore, restoreButton);
    return;
  }

  const previewButton = event.target.closest('[data-lightbox]');
  if (previewButton) openLightboxForHistoryId(previewButton.dataset.lightbox);
});

async function deleteHistoryItem(id, button) {
  const hardDelete = isAdmin && !previewingMember;
  const message = hardDelete
    ? '彻底删除这张图？\n\n图片文件会从磁盘删除，无法恢复。\n\n（如果只是想让成员看不到，请让成员自己删除——那种删除管理员随时能恢复。）'
    : '删除这张图？\n\n它会从你的列表里消失。管理员那边仍保留一份，需要的话可以帮你恢复。';
  if (!confirm(message)) return;

  button.disabled = true;
  try {
    const result = await deleteJson(`/api/history/${encodeURIComponent(id)}`);
    showSuccess(result.deleted === 'permanent' ? '已彻底删除' : '已删除。如需恢复请联系管理员。');
    await loadHistory();
  } catch (error) {
    showError(`删除失败：${error.message}`);
    button.disabled = false;
  }
}

async function restoreHistoryItem(id, button) {
  button.disabled = true;
  try {
    await postJson(`/api/history/${encodeURIComponent(id)}/restore`);
    showSuccess('已恢复，成员那边又能看到了。');
    await loadHistory();
  } catch (error) {
    showError(`恢复失败：${error.message}`);
    button.disabled = false;
  }
}

// 双击图片同样放大——有人本能会双击。
historyEl.addEventListener('dblclick', (event) => {
  const tile = event.target.closest('.tile');
  if (tile?.dataset.id) openLightboxForHistoryId(tile.dataset.id);
});

// 打开当前这一页的全部图片，方向键可以在整页之间走，而不是卡在一张上。
function openLightboxForHistoryId(id) {
  const pageItems = filteredHistory().slice(historyPage * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);
  const entries = pageItems
    .filter((item) => item.images?.[0]?.url)
    .map((item) => ({ id: item.id, url: item.images[0].url, caption: item.prompt || '' }));
  const index = entries.findIndex((entry) => entry.id === id);
  if (entries.length === 0) return;
  openLightbox(entries, Math.max(0, index));
}

function appendPrompt(text) {
  if (!text) return;
  const current = promptInput.value.trim();
  promptInput.value = current ? `${current}，${text}` : text;
  promptInput.focus();
  promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
}

// Pull a past generation's settings back into the form so the next run is a
// variation of it rather than a fresh start.
// silent: 「再来一张」会紧接着提交，弹一条"已载入参数"只会和生成提示打架。
function reuseHistoryItem(item, { silent = false } = {}) {
  promptInput.value = item.prompt || '';
  if (negativePromptInput) negativePromptInput.value = item.negativePrompt || '';
  // 复用参数刻意不带 seed：这个入口也服务"再来一张"，带上旧 seed 会原样重出
  // 同一张图，看起来像按钮坏了。要复现请走详情里的"用这个 seed 重生成"。
  if (seedInput) seedInput.value = '';
  if (item.size && sizeSelect) {
    const match = [...sizeSelect.options].some((option) => option.value === item.size);
    if (match) sizeSelect.value = item.size;
  }
  syncComposerLabels();

  // Text-to-image: the reference image of a past run is not carried over.
  const textModeRadio = document.querySelector('input[name="mode"][value="text"]');
  if (textModeRadio) {
    textModeRadio.checked = true;
    updateModeUI();
  }

  if (silent) return;

  promptInput.focus();
  promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
  showSuccess('已载入这条记录的参数，可以修改后重新生成。');
}

document.querySelectorAll('[data-close-prompt]').forEach((button) => {
  button.addEventListener('click', closePromptModal);
});

/* ---------- 悬浮提示条上的 chip + popover ---------- */

// 参数收进 popover，不再占一整列常驻空间。chip 上显示当前值，所以改完要同步。
function syncComposerLabels() {
  const sizeLabel = document.querySelector('#sizeLabel');
  const qualityLabel = document.querySelector('#qualityLabel');
  if (sizeLabel && sizeSelect) sizeLabel.textContent = sizeSelect.value.replace('x', '×');
  if (qualityLabel) qualityLabel.textContent = document.querySelector('#quality')?.value || '';
}

function closeAllPops(except = null) {
  document.querySelectorAll('.pop').forEach((pop) => {
    if (pop !== except) pop.hidden = true;
  });
}

document.querySelectorAll('[data-pop]').forEach((chip) => {
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    const pop = document.querySelector(`#${chip.dataset.pop}`);
    if (!pop) return;
    const willOpen = pop.hidden;
    closeAllPops(pop);
    pop.hidden = !willOpen;
  });
});

document.querySelectorAll('.pop').forEach((pop) => {
  pop.addEventListener('click', (event) => event.stopPropagation());
});

document.addEventListener('click', () => closeAllPops());

sizeSelect?.addEventListener('change', syncComposerLabels);
document.querySelector('#quality')?.addEventListener('change', syncComposerLabels);

/* ---------- 抽屉 ---------- */

function setDrawer(panel, open) {
  const scrim = document.querySelector('#drawerScrim');
  if (!panel) return;
  panel.hidden = !open;
  if (scrim) scrim.hidden = !open;
  document.body.classList.toggle('modal-open', open);
  if (open && panel === adminPanel && isAdmin) void loadEngineConfig();
}

document.querySelector('#openSettings')?.addEventListener('click', () => {
  setDrawer(adminPanel, true);
  void loadEngineConfig();
});
document.querySelector('#closeSettings')?.addEventListener('click', () => setDrawer(adminPanel, false));
document.querySelector('#closeVisitor')?.addEventListener('click', () => setDrawer(visitorPanel, false));

// 活动记录独立于设置。状态行的「详情」也指向这里——出错时想看的是发生了什么，
// 不是渠道配置。
document.querySelector('#openActivity')?.addEventListener('click', () => setDrawer(activityPanel, true));
document.querySelector('#closeActivity')?.addEventListener('click', () => setDrawer(activityPanel, false));
document.querySelector('#openSettingsAlt')?.addEventListener('click', () => setDrawer(activityPanel, true));

document.querySelectorAll('[data-activity]').forEach((tab) => {
  tab.addEventListener('click', () => {
    const which = tab.dataset.activity;
    document.querySelectorAll('[data-activity]').forEach((other) => other.classList.toggle('on', other === tab));
    const audit = document.querySelector('#activityAudit');
    const logs = document.querySelector('#activityLogs');
    if (audit) audit.hidden = which !== 'audit';
    if (logs) logs.hidden = which !== 'logs';
  });
});

/* ---------- 主题 ---------- */

// 主题只换 CSS 变量，不动结构。head 里的内联脚本已经在首绘前应用过一次，
// 这里只负责切换和高亮当前项。
document.querySelectorAll('.theme-dot').forEach((dot) => {
  dot.addEventListener('click', () => {
    const set = dot.dataset.set;
    document.documentElement.dataset.theme = set;
    try {
      localStorage.setItem('image2Theme', set);
    } catch {
      // 隐私模式下存不了，当次会话生效即可。
    }
    syncThemeDots();
  });
});

function syncThemeDots() {
  const active = document.documentElement.dataset.theme || 'amber';
  document.querySelectorAll('.theme-dot').forEach((dot) => {
    dot.classList.toggle('on', dot.dataset.set === active);
  });
}

syncThemeDots();

/* ---------- 成员视角预览 ---------- */

// 纯前端模拟：加上 body.visitor 就会隐藏所有 .admin-only。服务端权限不变，
// 所以这只是"看看成员看到什么"，不是降权。
// （previewingMember 声明在文件顶部的状态区，见那里的 TDZ 说明。）
function setMemberPreview(on) {
  previewingMember = on;
  document.body.classList.toggle('visitor', on || !isAdmin);
  document.body.classList.toggle('previewing-member', on);

  const exitButton = document.querySelector('#exitPreview');
  if (exitButton) exitButton.hidden = !on;

  if (on) {
    setDrawer(adminPanel, false);
    setDrawer(activityPanel, false);
  }

  // 墙上的归属标签、失败 tab 等都跟角色相关，重渲染一次。
  if (historyScope === 'failed' && on) {
    historyScope = 'all';
    document.querySelectorAll('.tab[data-scope]').forEach((tab) => tab.classList.toggle('on', tab.dataset.scope === 'all'));
  }
  renderHistoryPage();

  // 立刻换掉提示条那行文案，否则渠道名和 Key 掩码会一直挂在预览态里，
  // 要等下一次 10s 轮询才消失。
  updateGenerateChannelSummary(currentKeys.find((key) => key.id === adminChannelSelect?.value) || null);
}

document.querySelector('#previewMember')?.addEventListener('click', () => {
  setMemberPreview(true);
  showSuccess('已切换到成员视角预览。管理功能只是隐藏，权限没有变化。');
});

document.querySelector('#exitPreview')?.addEventListener('click', () => {
  setMemberPreview(false);
  showSuccess('已退出成员视角预览。');
});

// 成员点自己的 id 打开工作台（统计 + 最近提示词）。
clientBadgeSide?.addEventListener('click', () => {
  if (isAdmin) setDrawer(adminPanel, true);
  else setDrawer(visitorPanel, true);
});

document.querySelector('#drawerScrim')?.addEventListener('click', () => {
  setDrawer(adminPanel, false);
  setDrawer(visitorPanel, false);
});

/* ---------- 筛选 tab ---------- */

document.querySelectorAll('.tab[data-scope]').forEach((tab) => {
  tab.addEventListener('click', () => {
    historyScope = tab.dataset.scope;
    document.querySelectorAll('.tab[data-scope]').forEach((other) => other.classList.toggle('on', other === tab));
    historyPage = 0;
    renderHistoryPage();
  });
});

copyPromptButton.addEventListener('click', async () => {
  if (!activePromptText) return;
  await navigator.clipboard.writeText(activePromptText);
  copyPromptButton.textContent = '已复制';
  setTimeout(() => {
    copyPromptButton.textContent = '复制';
  }, 1200);
});

// Seed 是唯一能拿去复现的元数据，但它原来只存在于提交那一刻——出图之后
// 谁都不知道用的是几，"填入相同 seed 可复现"就成了句空话。
randomSeedButton?.addEventListener('click', () => {
  if (!seedInput) return;
  // 2^31 以内的正整数，足够分散，又不会撞上某些上游对 int32 的限制。
  seedInput.value = String(Math.floor(Math.random() * 2147483647) + 1);
  seedInput.focus();
});

clearSeedButton?.addEventListener('click', () => {
  if (!seedInput) return;
  seedInput.value = '';
  seedInput.focus();
});

reuseSeedButton?.addEventListener('click', () => {
  if (!activePromptSeed || !seedInput) return;
  seedInput.value = activePromptSeed;
  if (activePromptText) promptInput.value = activePromptText;
  syncComposerLabels();
  closePromptModal();
  showSuccess(`已填入 seed ${activePromptSeed}，同参数生成会得到相近的结果。`);
  promptInput.focus();
});

document.querySelectorAll('[data-close-lightbox]').forEach((element) => {
  element.addEventListener('click', closeLightbox);
});

lightboxPrev?.addEventListener('click', () => stepLightbox(-1));
lightboxNext?.addEventListener('click', () => stepLightbox(1));
lightboxZoomOut?.addEventListener('click', () => zoomLightboxBy(1 / 1.25));
lightboxZoomIn?.addEventListener('click', () => zoomLightboxBy(1.25));
lightboxFit?.addEventListener('click', () => resetLightboxZoom());
lightboxActual?.addEventListener('click', () => setLightboxZoom(nativeLightboxScale(), 0, 0));
lightboxImage?.addEventListener('load', () => resetLightboxZoom());

lightboxStage?.addEventListener('wheel', handleLightboxWheel, { passive: false });
lightboxStage?.addEventListener('dblclick', (event) => {
  event.preventDefault();
  if (Math.abs(lightboxZoom.scale - nativeLightboxScale()) < 0.03) resetLightboxZoom();
  else setLightboxZoom(nativeLightboxScale(), 0, 0);
});
lightboxStage?.addEventListener('pointerdown', startLightboxDrag);
lightboxStage?.addEventListener('pointermove', moveLightboxDrag);
lightboxStage?.addEventListener('pointerup', endLightboxDrag);
lightboxStage?.addEventListener('pointercancel', endLightboxDrag);
lightboxStage?.addEventListener('click', handleLightboxStageClick);

// 灯箱左右滑动切图。手机上没有方向键，←/→ 两个小按钮又正好落在拇指最难够到的
// 位置，滑动才是这个场景的自然手势。
let touchStartX = 0;
let touchStartY = 0;
let touchTracking = false;

lightbox?.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) return;
  touchStartX = event.touches[0].clientX;
  touchStartY = event.touches[0].clientY;
  touchTracking = true;
}, { passive: true });

lightbox?.addEventListener('touchend', (event) => {
  if (!touchTracking) return;
  touchTracking = false;
  const touch = event.changedTouches[0];
  if (!touch) return;

  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  // 图片已经放大时，滑动优先给拖拽看细节，不切图。
  if (isLightboxZoomed()) return;

  // 横向位移要足够大、且明显大于纵向，否则那是滚动或误触，不是切图。
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  stepLightbox(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('keydown', (event) => {
  // Lightbox first: it opens on top of the prompt modal when both are reachable.
  if (!lightbox?.hidden) {
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') stepLightbox(-1);
    if (event.key === 'ArrowRight') stepLightbox(1);
    return;
  }

  if (event.key === 'Escape' && !promptModal.hidden) closePromptModal();
});

// Polling runs forever; a transient failure should not spam the user with a
// toast on every tick, so only the first of a repeated failure is surfaced.
// Declared above the awaited refreshAll() below, which assigns to it.
let lastBackgroundError = '';
function reportBackgroundError(error) {
  const message = error?.message || String(error);
  if (message === lastBackgroundError) return;
  lastBackgroundError = message;
  showError(`后台刷新失败：${message}`);
}

// Guarded: this used to be a bare top-level `await`, so one failing /api/status
// aborted module evaluation and the updateModeUI() call at the bottom of this
// file never ran, leaving the form in a half-initialized state.
await refreshAll().catch((error) => {
  showError(`初始化失败：${error.message}`);
});
// Runs after the first paint so a stuck poll cannot delay the UI appearing.
resumeActiveJob().catch(() => {});
setInterval(() => { loadStatus().catch(reportBackgroundError); }, 10000);
setInterval(() => { loadAuditLog().catch(reportBackgroundError); }, 15000);

async function refreshAll() {
  await loadStatus();
  lastBackgroundError = '';
  await loadHistory();
  await loadAuditLog();
  await loadMemberFailures();
  await loadCharged();
  await loadModels({ log: false });
}

// Reattach to a generation that was still running when the tab was closed.
// Without this, jobs surviving on the server does the user no good — they come
// back to an idle-looking page with no way to find the run.
async function resumeActiveJob() {
  if (activeJobTimer) return;

  const payload = await getJson('/api/jobs');
  const active = (payload.jobs || []).find((job) => job.status === 'running' || job.status === 'queued');
  if (!active) return;

  showSuccess('检测到未完成的生成任务，已重新接入进度。');
  setProgress(active);
  runState.textContent = describeJobState(active);
  generateButton.disabled = true;

  try {
    await pollJob(active.id);
  } catch (error) {
    runState.textContent = '生成失败';
    setProgress({ progress: 100, stage: '生成失败' });
    showError(error.message);
    offerRetry();
  } finally {
    generateButton.disabled = false;
  }
}

async function loadModels(options = {}) {
  if (!isAdmin) return;

  try {
    const channelId = testChannelSelect.value;
    const payload = await getJson(`/api/models${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`);
    const suggestions = imageModelCandidates(payload);
    modelSuggestions.innerHTML = suggestions.map((model) => `<option value="${escapeAttr(model)}"></option>`).join('');

    const selectedChannelChanged = currentModelChannelId !== channelId;
    if (payload.providerDefaults?.length && (selectedChannelChanged || !modelInput.value)) {
      modelInput.value = payload.providerDefaults.find((model) => suggestions.includes(model)) || suggestions[0] || '';
    } else if (!suggestions.includes(modelInput.value)) {
      modelInput.value = suggestions[0] || '';
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

function resetModelManagerTest(message = '') {
  modelManagerTestState = null;
  if (message && modelManagerNote) modelManagerNote.textContent = message;
  updateModelManagerControls();
}

function updateModelManagerControls() {
  if (!modelManagerChannel || !modelManagerModel || !modelManagerEngine) return;
  const channelId = modelManagerChannel.value;
  const model = modelManagerModel.value;
  const engineId = modelManagerEngine.value;
  const busy = Boolean(modelManagerBusy);

  refreshImageModelsButton.disabled = busy || !channelId;
  modelManagerModel.disabled = busy || modelManagerModel.options.length === 0;
  modelManagerEngine.disabled = busy || modelManagerEngine.options.length === 0;
  testImageModelButton.disabled = busy || !channelId || !model;
  setDefaultImageModelButton.disabled = busy
    || !engineId
    || !isTestedSelection(modelManagerTestState, channelId, model);
}

function syncModelManagerTargets() {
  if (!modelManagerChannel) return;
  const previousChannelId = modelManagerChannel.value;
  const channels = currentKeys.filter((key) => key.enabled !== false);
  modelManagerChannel.innerHTML = channels.length
    ? channels.map((channel) => `
      <option value="${escapeAttr(channel.id)}">${escapeHtml(channel.name || channel.id)} · ${escapeHtml(channel.providerType || 'openai-images')}</option>
    `).join('')
    : '<option value="">暂无可用渠道</option>';

  if (channels.some((channel) => channel.id === previousChannelId)) {
    modelManagerChannel.value = previousChannelId;
  }
  if (modelManagerChannel.value !== previousChannelId) {
    modelManagerModel.innerHTML = '';
    resetModelManagerTest();
  }
  syncModelManagerEngineOptions();
  updateModelManagerControls();
}

function syncModelManagerEngineOptions() {
  if (!modelManagerChannel || !modelManagerEngine) return;
  const channel = currentKeys.find((key) => key.id === modelManagerChannel.value);
  const previousEngineId = modelManagerEngine.value;
  const engines = matchingModelEngines(channel, modelManagerEngines);
  modelManagerEngine.innerHTML = engines.map((engine) => `
    <option value="${escapeAttr(engine.id)}">${escapeHtml(engine.label || engine.id)} · 当前 ${escapeHtml(engine.model || '未设置')}</option>
  `).join('');
  if (engines.some((engine) => engine.id === previousEngineId)) {
    modelManagerEngine.value = previousEngineId;
  }
  updateModelManagerControls();
}

async function loadImageModelsForManager() {
  if (!modelManagerChannel || !modelManagerModel || !modelManagerNote) return;
  const channelId = modelManagerChannel.value;
  if (!channelId) {
    modelManagerNote.textContent = '暂无可读取的渠道。';
    updateModelManagerControls();
    return;
  }

  modelManagerBusy = 'models';
  modelManagerTestState = null;
  modelManagerModel.innerHTML = '';
  modelManagerNote.textContent = '正在从上游读取图片模型...';
  updateModelManagerControls();

  try {
    const payload = await getJson(`/api/models?channelId=${encodeURIComponent(channelId)}`);
    const candidates = imageModelCandidates(payload);
    modelManagerModel.innerHTML = candidates.map((model) => `
      <option value="${escapeAttr(model)}">${escapeHtml(model)}</option>
    `).join('');

    const total = Array.isArray(payload.models) ? payload.models.length : 0;
    if (candidates.length === 0) {
      modelManagerNote.textContent = `上游列出 ${total} 个模型，但没有识别到图片模型。`;
      addLog(`渠道模型列表已读取：上游 ${total} 个，图片模型 0 个`, true);
    } else {
      modelManagerNote.textContent = `识别到 ${candidates.length} 个图片模型。请选择后真实测试，测试不会修改当前默认模型。`;
      addLog(`渠道模型列表已读取：${candidates.join(', ')}`);
    }
  } catch (error) {
    modelManagerNote.textContent = `读取图片模型失败：${error.message}`;
    addLog(`读取图片模型失败：${error.message}`, true);
  } finally {
    modelManagerBusy = '';
    updateModelManagerControls();
  }
}

async function testManagedImageModel() {
  const channelId = modelManagerChannel?.value || '';
  const model = modelManagerModel?.value || '';
  if (!channelId || !model || !modelManagerNote) return;

  modelManagerBusy = 'test';
  modelManagerTestState = null;
  modelManagerNote.textContent = `正在用 ${model} 真实生图，测试期间不会修改业务配置...`;
  addLog(`开始真实生图测试：${model}`);
  updateModelManagerControls();

  try {
    const payload = await readJsonResponse(await apiFetch('/api/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, model, size: '1024x1024', quality: 'low', outputFormat: 'png' }),
    }));
    renderGallery(payload.images || []);
    modelManagerTestState = { channelId, model };
    modelManagerNote.textContent = `${model} 生图测试成功，现在可以设为对应引擎的默认模型。`;
    addLog(`${model} 生图测试成功，使用 ${payload.channel?.masked || '当前 key'}`);
    showSuccess(`${model} 生图测试成功`);
    await loadAuditLog().catch(reportBackgroundError);
  } catch (error) {
    modelManagerNote.textContent = `${model} 生图测试失败：${error.message}`;
    addLog(`${model} 生图测试失败：${error.message}`, true);
    showError(`${model} 生图测试失败：${error.message}`);
  } finally {
    modelManagerBusy = '';
    updateModelManagerControls();
  }
}

async function setDefaultManagedImageModel() {
  const channelId = modelManagerChannel?.value || '';
  const model = modelManagerModel?.value || '';
  const engineId = modelManagerEngine?.value || '';
  if (!engineId || !isTestedSelection(modelManagerTestState, channelId, model) || !modelManagerNote) return;

  const engine = modelManagerEngines.find((item) => item.id === engineId);
  if (!confirm(`确认把 ${model} 设为 ${engine?.label || engineId} 的默认模型？`)) return;

  modelManagerBusy = 'save';
  modelManagerNote.textContent = '正在更新引擎默认模型...';
  updateModelManagerControls();

  try {
    await readJsonResponse(await apiFetch(`/api/admin/image-engines/${encodeURIComponent(engineId)}/model`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, model }),
    }));
    modelManagerTestState = null;
    await loadEngineConfig();
    await loadStatus();
    modelManagerNote.textContent = `${engine?.label || engineId} 的默认模型已更新为 ${model}。`;
    showSuccess('引擎默认模型已更新');
  } catch (error) {
    modelManagerNote.textContent = `设置默认模型失败：${error.message}`;
    showError(`设置默认模型失败：${error.message}`);
  } finally {
    modelManagerBusy = '';
    updateModelManagerControls();
  }
}

async function generateImage() {
  const form = new FormData(generateForm);
  const engineRadio = engineSelector?.querySelector('input[name="engine"]:checked');
  const prompt = String(form.get('prompt') || '').trim();
  const mode = String(form.get('mode') || 'text');
  const extraParamsText = document.querySelector('#extraParams').value.trim();

  if (!prompt) {
    showError('Prompt 不能为空');
    promptInput.focus();
    return;
  }

  if (mode === 'image' && !inputImageDataUrl) {
    showError('图生图需要先上传一张参考图');
    inputImage.focus();
    return;
  }

  let extraParams = {};
  if (extraParamsText) {
    try {
      extraParams = JSON.parse(extraParamsText);
    } catch (error) {
      showError(`高级参数不是合法 JSON：${error.message}`);
      return;
    }
  }

  lastPrompt = prompt;
  hideRetry();
  clearCompletionAnnouncement();
  requestNotificationPermissionOnce();
  closeAllPops();
  // 本次生成区在提交时就出现，进度直接长在结果要出现的位置。
  if (currentBlock) currentBlock.hidden = false;
  gallery.innerHTML = '';
  // 上一次的改写卡属于上一次的结果，别让它挂在新任务旁边。
  if (rewriteSlot) rewriteSlot.innerHTML = '';
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
        ...(engineRadio?.value ? { engineId: engineRadio.value } : {}),
        negativePrompt: form.get('negativePrompt'),
        model: isAdmin && !currentStatus?.imageEnginesConfigured ? form.get('model') : '',
        size: form.get('size'),
        quality: form.get('quality'),
        // Both were already supported server-side but had no control until now.
        n: capabilities.batch ? Number(form.get('imageCount')) || 1 : 1,
        seed: String(form.get('seed') || '').trim(),
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
    showError(error.message);
    // A failed run used to leave nothing but static text, even though every
    // parameter is still sitting in the form.
    offerRetry();
  } finally {
    generateButton.disabled = false;
  }
}

function renderEngineSelector(engines) {
  if (!engineSelector) return;

  if (!Array.isArray(engines) || engines.length === 0) {
    engineSelector.hidden = true;
    engineSelector.innerHTML = '';
    return;
  }

  const previousValue = engineSelector.querySelector('input[name="engine"]:checked')?.value || 'auto';
  const buttons = [
    { id: 'auto', label: '自动' },
    ...engines.filter((engine) => engine.available !== false),
  ];
  const selectedValue = buttons.some((engine) => engine.id === previousValue) ? previousValue : 'auto';

  engineSelector.innerHTML = buttons.map((engine) => `
    <label>
      <input type="radio" name="engine" value="${escapeAttr(engine.id)}" ${engine.id === selectedValue ? 'checked' : ''} />
      <span>${escapeHtml(engine.label)}</span>
    </label>
  `).join('');
  engineSelector.hidden = false;
}

function updateCapabilityControls(nextCapabilities) {
  capabilities = nextCapabilities || capabilities;
  applyCapabilities();
}

// Reflect what the active channel can honour. buildProviderImageRequest strips
// `n` for single-image (the member channel), so showing a batch box there would take
// input and throw it away.
function applyCapabilities() {
  if (!imageCountInput || !batchGroup) return;

  if (capabilities.batch) {
    imageCountInput.disabled = false;
    imageCountInput.max = String(capabilities.maxBatch || 8);
    if (batchNote) batchNote.hidden = true;
  } else {
    imageCountInput.value = '1';
    imageCountInput.disabled = true;
    if (batchNote) batchNote.hidden = false;
  }

  if (seedInput) seedInput.disabled = !capabilities.seed;
}

function offerRetry() {
  if (!retryBox) return;
  retryBox.hidden = false;
}

function hideRetry() {
  if (!retryBox) return;
  retryBox.hidden = true;
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
        runState.textContent = describeJobState(job);

        if (job.status === 'succeeded') {
          clearActiveJobTimer();
          const result = job.result || {};
          renderGallery(result.images || []);
          renderRewrite(result.images || []);
          const successAttempt = result.attempts?.find((item) => item.ok);
          const count = result.images?.length || 0;
          runState.textContent = `生成成功，共 ${count} 张`;
          addLog(`生成成功，使用 ${formatKeyLabel(successAttempt?.key) || '可用渠道'}`);
          announceCompletion(`生成完成，共 ${count} 张`);
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

// 显示真实阶段和已等待时间，不再显示编出来的百分比。
// 服务端只有三个 checkpoint，中间"等待上游"那段占了绝大部分时间，我们确实
// 不知道上游进行到哪了——所以说"第 3/4 步，已等 2 分 15 秒"，那是事实。
function setProgress(job) {
  progressCard.hidden = false;

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const step = Number(job.step ?? 0);
  const total = Number(job.totalSteps ?? steps.length ?? 0);

  const done = job.status === 'succeeded' || job.status === 'failed';
  progressStage.textContent = job.stage || steps[step] || '处理中';

  // 结束了就说"共用"，不要还说"已等"。
  const timing = job.elapsedMs ? `${done ? '共用' : '已等'} ${formatElapsed(job.elapsedMs)}` : '';
  progressPercent.textContent = total
    ? `${done ? '全部完成' : `第 ${Math.min(step + 1, total)} / ${total} 步`}${timing ? ` · ${timing}` : ''}`
    : (timing || '—');

  // 进度条按"已完成的步骤"走，走到最后一步就停在那儿等着，不再假装还在爬。
  const ratio = total ? Math.min(1, step / total) : 0;
  progressBar.style.width = `${Math.round(ratio * 100)}%`;

  if (jobSteps) {
    jobSteps.innerHTML = steps.map((label, index) => {
      const state = index < step ? 'done' : index === step ? 'now' : 'wait';
      return `<span class="job-step ${state}">${escapeHtml(label)}</span>`;
    }).join('');
  }
}

/* ==========================================================================
   AI 层

   日志里大量提示词是"扩图，整体缩小"这种——没有光线、镜头、氛围任何视觉维度，
   而这正是反复重跑的原因（被重复提交的提示词失败率 50%，只提交一次的只有 5%）。
   所以两件事：写的时候提示缺什么，出图后告诉他模型把话理解成了什么。
   ========================================================================== */

// 每组只在提示词里都不含这些词时才建议，避免推荐用户已经写了的东西。
const ASSIST_DIMENSIONS = [
  { label: '电影感光线', probe: ['光', '灯', '光线', 'light', '逆光', '柔光'] },
  { label: '自然镜头视角', probe: ['镜头', 'mm', '广角', '长焦', '景深', 'lens'] },
  { label: '冷色调', probe: ['色调', '暖', '冷', '配色', '色彩', 'tone', 'color'] },
  { label: '高细节质感', probe: ['细节', '质感', '高清', '清晰', 'detail', '4k', '8k'] },
  { label: '浅景深', probe: ['景深', '虚化', 'bokeh', '焦'] },
  { label: '电影级构图', probe: ['构图', '视角', '俯视', '仰视', 'composition'] },
];

function renderAssist() {
  if (!assistRow) return;

  const text = promptInput.value.trim().toLowerCase();
  // 太短的时候还在打字，别急着插嘴。
  if (text.length < 6) {
    assistRow.hidden = true;
    return;
  }

  const missing = ASSIST_DIMENSIONS
    .filter((dim) => !dim.probe.some((word) => text.includes(word.toLowerCase())))
    .slice(0, 4);

  if (missing.length === 0) {
    assistRow.hidden = true;
    return;
  }

  assistRow.hidden = false;
  assistRow.innerHTML = `
    <span class="assist-label"><i>AI</i>建议补充</span>
    ${missing.map((dim) => `<button type="button" class="assist-chip">${escapeHtml(dim.label)}</button>`).join('')}
  `;
}

// 出图后展示模型的改写。只在确实不同时出现——448 张里 302 张不同，
// 但如果提示词本来就写得很细，模型可能原样返回，那就没什么可说的。
function renderRewrite(images) {
  if (!rewriteSlot) return;
  rewriteSlot.innerHTML = '';

  const revised = images?.find((image) => image.revisedPrompt)?.revisedPrompt?.trim();
  const original = (lastPrompt || '').trim();
  if (!revised || !original || revised === original) return;

  const card = document.createElement('div');
  card.className = 'rewrite';
  card.innerHTML = `
    <div class="rw-head">
      <span class="rw-icon">AI</span>
      <span class="rw-title">模型把你的提示词扩写了</span>
      <span class="rw-spacer"></span>
      <button type="button" class="rw-quiet" data-rw-toggle>展开全文</button>
    </div>
    <div class="rw-body">${escapeHtml(revised)}</div>
    <div class="rw-acts">
      <button type="button" class="rw-btn" data-rw-adopt>采纳这个版本</button>
      <button type="button" class="rw-quiet" data-rw-dismiss>保留我写的</button>
    </div>
  `;
  rewriteSlot.append(card);
}

promptInput.addEventListener('input', () => {
  clearTimeout(assistTimer);
  assistTimer = setTimeout(renderAssist, 400);
});

// 建议 chip 是追加，不是替换——替换会毁掉用户已经写的东西。
assistRow?.addEventListener('click', (event) => {
  const chip = event.target.closest('.assist-chip');
  if (!chip) return;
  appendPrompt(chip.textContent.trim());
  renderAssist();
});

rewriteSlot?.addEventListener('click', (event) => {
  if (event.target.closest('[data-rw-toggle]')) {
    const body = rewriteSlot.querySelector('.rw-body');
    const toggle = event.target.closest('[data-rw-toggle]');
    const open = body?.classList.toggle('open');
    toggle.textContent = open ? '收起' : '展开全文';
    return;
  }

  // 采纳 = 把模型的版本填回输入框，用户可以继续改。这才是把隐藏的
  // 服务端改写变成可用的东西。
  if (event.target.closest('[data-rw-adopt]')) {
    const body = rewriteSlot.querySelector('.rw-body');
    if (body) {
      promptInput.value = body.textContent.trim();
      promptInput.focus();
      renderAssist();
    }
    rewriteSlot.innerHTML = '';
    showSuccess('已采纳模型的版本，可以直接再生成一次。');
    return;
  }

  if (event.target.closest('[data-rw-dismiss]')) rewriteSlot.innerHTML = '';
});

function formatElapsed(ms) {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

// 顶部那行状态文字。同样不写百分比——写阶段和已等待时间。
function describeJobState(job) {
  const stage = job.stage || '处理中';
  if (!job.elapsedMs) return stage;
  const done = job.status === 'succeeded' || job.status === 'failed';
  return `${stage} · ${done ? '共用' : '已等'} ${formatElapsed(job.elapsedMs)}`;
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
  const providerType = document.querySelector('#keyProviderType')?.value || 'openai-images';
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
    body: JSON.stringify({ name: nameInput.value.trim(), baseURL, key, providerType }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    showError(payload.error || '添加 key 失败');
    return;
  }

  keyInput.value = '';
  nameInput.value = '';

  // The server probes on save. Saying "已添加" for a channel that cannot connect
  // is how 112 unusable-channel failures reached members instead of the admin.
  if (payload.probe?.ok) {
    showSuccess(`渠道已添加，连接正常（${payload.probe.message}）`);
  } else {
    showError(`渠道已保存，但连接检测失败：${payload.probe?.message || '未知原因'}。指派给成员前请先修好。`);
  }
  if (payload.probe?.providerTypeNote) {
    showError(payload.probe.providerTypeNote);
  }

  await loadStatus();
  if (payload.key?.id) testChannelSelect.value = payload.key.id;
}

async function loadStatus() {
  const status = await getJson('/api/status');
  currentStatus = status;
  isAdmin = Boolean(status.admin);

  // Mirror the server's answer so the badge survives a reload without a flash.
  // Admin is a role, not a stored identity, so it never overwrites the member id.
  if (status.clientId && status.clientId !== clientId) {
    clientId = status.clientId;
    if (!isAdmin) localStorage.setItem('image2StudioClientId', clientId);
  }
  clientBadgeSide.textContent = clientId;

  renderEngineSelector(status.engines || []);
  updateGenerateChannelSummary();
  const legacySection = document.querySelector('#legacyChannelAssign');
  if (legacySection) legacySection.hidden = Boolean(status.imageEnginesConfigured);
  const selectedEngineId = engineSelector?.querySelector('input[name="engine"]:checked')?.value;
  const selectedEngine = selectedEngineId && selectedEngineId !== 'auto'
    ? status.engines?.find((engine) => engine.id === selectedEngineId)
    : null;
  updateCapabilityControls(selectedEngine?.capabilities || status.capabilities || capabilities);

  // body.visitor drives .admin-only visibility. The admin panel is a drawer now,
  // so it stays closed until the gear is clicked rather than being shown by role.
  // loadStatus polls every 10s, so it has to respect an active member preview or
  // the preview would silently snap back to the admin view.
  document.body.classList.toggle('visitor', !isAdmin || previewingMember);
  resetClientButton.hidden = isAdmin;
  currentKeys = status.keys || [];
  applyAppearance(status.appearance);

  const engineModelRows = status.imageEnginesConfigured
    ? (status.engines || []).map((engine) => `
      <div class="status-item"><span>${escapeHtml(engine.label || engine.id)} 模型</span><span>${escapeHtml(engine.model || '未设置')}</span></div>
    `).join('')
    : `<div class="status-item"><span>默认挂载模型</span><span>${escapeHtml(status.defaultModel)}</span></div>`;
  statusCard.innerHTML = `
    <div class="status-item"><span>可用 API Key</span><span>${status.readyKeyCount} / ${status.keyCount}</span></div>
    <div class="status-item"><span>局域网地址</span><span>${escapeHtml(status.lanUrls?.[0] || '未检测到 IPv4')}</span></div>
    ${engineModelRows}
  `;

  roleBadge.textContent = isAdmin ? '管理员' : '成员';
  renderChannelPulse(status);

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

  keyList.querySelectorAll('[data-probe-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      await probeKey(button.dataset.probeKey, button);
    });
  });

  keyList.querySelectorAll('.key-provider-select').forEach((select) => {
    select.addEventListener('change', async () => {
      await updateKeyProviderType(select.dataset.id, select.value, select);
    });
  });
}

async function loadEngineConfig() {
  if (!engineList || !isAdmin) return;

  try {
    const response = await fetch('/api/admin/image-engines', { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '加载引擎配置失败');

    if (engineChannelsSelect) {
      engineChannelsSelect.innerHTML = currentKeys.map((key) => `
        <option value="${escapeAttr(key.id)}">${escapeHtml(key.name)} (${escapeHtml(key.providerType || 'openai-images')})</option>
      `).join('');
    }
    modelManagerEngines = data.engines || [];
    renderEngineList(modelManagerEngines);
    syncModelManagerTargets();
  } catch (error) {
    engineList.textContent = `加载引擎配置失败：${error.message}`;
    modelManagerEngines = [];
    syncModelManagerTargets();
  }
}

function renderEngineList(engines) {
  if (!engineList) return;
  if (!Array.isArray(engines) || engines.length === 0) {
    engineList.innerHTML = '<p class="dquiet">还没有引擎配置。点下方新增。</p>';
    return;
  }

  engineList.innerHTML = engines.map((engine) => `
    <div class="engine-item" data-id="${escapeAttr(engine.id)}">
      <span class="engine-name">${escapeHtml(engine.label || engine.id)}</span>
      <span class="engine-meta">${escapeHtml(engine.providerType || 'openai-images')} · ${escapeHtml(engine.model || '(未指定模型)')} · ${engine.channelIds?.length || 0} 个渠道</span>
      <span class="engine-badges">
        ${engine.memberEnabled ? '<span class="badge green">成员</span>' : ''}
        ${engine.autoEnabled ? '<span class="badge blue">自动</span>' : ''}
        ${engine.enabled ? '' : '<span class="badge gray">已禁用</span>'}
      </span>
      <button type="button" class="mini-btn engine-edit-btn" data-id="${escapeAttr(engine.id)}">编辑</button>
      <button type="button" class="mini-btn danger engine-delete-btn" data-id="${escapeAttr(engine.id)}">删除</button>
    </div>
  `).join('');

  engineList.querySelectorAll('.engine-edit-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const engine = engines.find((item) => item.id === button.dataset.id);
      if (!engine) return;
      document.querySelector('#engineId').value = engine.id;
      document.querySelector('#engineLabel').value = engine.label;
      document.querySelector('#engineProviderType').value = engine.providerType;
      document.querySelector('#engineModel').value = engine.model || '';
      document.querySelector('#enginePriority').value = engine.priority ?? 10;
      document.querySelector('#engineMemberEnabled').checked = engine.memberEnabled !== false;
      document.querySelector('#engineAutoEnabled').checked = engine.autoEnabled !== false;
      document.querySelector('#engineEnabled').checked = engine.enabled !== false;
      if (engineChannelsSelect) {
        Array.from(engineChannelsSelect.options).forEach((option) => {
          option.selected = (engine.channelIds || []).includes(option.value);
        });
      }
      document.querySelector('#engineAddPanel').open = true;
    });
  });

  engineList.querySelectorAll('.engine-delete-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm(`确认删除引擎 ${button.dataset.id}？`)) return;
      try {
        await saveEngineConfig(engines.filter((engine) => engine.id !== button.dataset.id));
      } catch (error) {
        showEngineNote(`删除失败: ${error.message}`, 'error');
      }
    });
  });
}

async function saveEngineConfig(engines) {
  engines = engines.map(({ channels, ...engine }) => engine);
  const response = await fetch('/api/admin/image-engines', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engines }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '保存失败');
  showEngineNote('引擎配置已保存');
  await loadEngineConfig();
  await loadStatus();
}

function showEngineNote(message, type = 'ok') {
  if (!engineSaveNote) return;
  engineSaveNote.textContent = message;
  engineSaveNote.className = `dquiet ${type === 'error' ? 'color-error' : ''}`;
  engineSaveNote.hidden = false;
  setTimeout(() => {
    engineSaveNote.hidden = true;
  }, 3000);
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

async function saveAppearance() {
  if (!isAdmin) return;

  const appearance = normalizeAppearance({
    brandName: appearanceNameInput?.value,
    brandIcon: appearanceIconInput?.value,
  });

  try {
    const payload = await postJson('/api/settings/appearance', appearance);
    applyAppearance(payload.appearance || appearance);
    showSuccess('页面品牌已保存。');
  } catch (error) {
    showError('保存页面品牌失败：' + error.message);
  }
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

const MEMBER_COMPOSER_HINT = '提交后可以关掉页面，任务在服务器上继续跑，回来会自动接上进度。';

function updateGenerateChannelSummary(channel = null) {
  if (!generateChannelSummary) return;

  // 成员（以及成员视角预览）不该看到渠道名和 Key 掩码。原来这里直接清空，
  // 结果成员反而丢了"可以关页面"这句最需要的提示。
  if (!isAdmin || previewingMember) {
    generateChannelSummary.textContent = MEMBER_COMPOSER_HINT;
    return;
  }

  if (currentStatus?.imageEnginesConfigured) {
    const selectedId = engineSelector?.querySelector('input[name="engine"]:checked')?.value || 'auto';
    const availableEngines = (currentStatus.engines || []).filter((engine) => engine.available !== false);

    if (selectedId === 'auto') {
      const route = availableEngines.map((engine) => engine.label).join(' → ') || '暂无可用引擎';
      generateChannelSummary.textContent = `本次生成使用：自动路由 · ${route}`;
      return;
    }

    const selectedEngine = availableEngines.find((engine) => engine.id === selectedId);
    const model = selectedEngine?.model || '后台配置模型';
    const channels = selectedEngine?.channels?.length
      ? selectedEngine.channels.map((item) => formatKeyLabel(item)).join(' / ')
      : '暂无可用渠道';
    generateChannelSummary.textContent = `本次生成使用：${selectedEngine?.label || selectedId} · ${model} · ${channels}`;
    return;
  }

  const label = channel ? formatKeyLabel(channel) : '未设置';
  generateChannelSummary.textContent = `本次生成使用：管理员生图渠道 · ${label}`;
}

function getGenerationChannelLogLabel() {
  if (!isAdmin) return '成员渠道：管理员预设渠道';

  if (currentStatus?.imageEnginesConfigured) {
    const selectedId = engineSelector?.querySelector('input[name="engine"]:checked')?.value || 'auto';
    const availableEngines = (currentStatus.engines || []).filter((engine) => engine.available !== false);
    if (selectedId === 'auto') {
      return `自动路由：${availableEngines.map((engine) => engine.label).join(' → ') || '暂无可用引擎'}`;
    }
    const selectedEngine = availableEngines.find((engine) => engine.id === selectedId);
    return `引擎：${selectedEngine?.label || selectedId} · ${selectedEngine?.model || '后台配置模型'}`;
  }

  const selected = currentKeys.find((key) => key.id === adminChannelSelect.value);
  return `管理员渠道：${formatKeyLabel(selected) || '未设置'}`;
}

function formatKeyLabel(key) {
  if (!key) return '';
  return [key.name, key.masked].filter(Boolean).join(' · ') || key.id || '';
}

// 成员的失败列表走独立接口：字段经过白名单裁剪（不含渠道名、Key 掩码、上游
// endpoint），并且带一句面向用户的说明和"该不该重试"。
async function loadMemberFailures() {
  if (isAdmin) return;

  try {
    const payload = await getJson('/api/failures');
    failedEvents = payload.failures || [];
  } catch {
    failedEvents = [];
  }

  if (failedCountBadge) {
    failedCountBadge.textContent = String(failedEvents.length);
    failedCountBadge.hidden = failedEvents.length === 0;
  }
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

    failedEvents = events.filter((event) => event.status === 'failed');
    if (failedCountBadge) {
      failedCountBadge.textContent = String(failedEvents.length);
      failedCountBadge.hidden = failedEvents.length === 0;
    }
    updateStatusLine(events);
  } catch (error) {
    auditLogs.innerHTML = `<p class="key-meta">读取审计日志失败：${escapeHtml(error.message)}</p>`;
  }
}

// 原来常驻左栏 2883px 的渠道监控，压成顶栏两个点。
function renderChannelPulse(status) {
  if (!channelPulse) return;

  if (!isAdmin) {
    channelPulse.innerHTML = '';
    return;
  }

  const channels = [status.userChannel, status.adminChannel].filter(Boolean);
  const seen = new Set();
  const unique = channels.filter((channel) => {
    if (seen.has(channel.id)) return false;
    seen.add(channel.id);
    return true;
  });

  channelPulse.innerHTML = unique.map((channel) => {
    const bad = !channel.enabled || channel.disabledByRuntime;
    const cooling = channel.coolingDown;
    const cls = bad ? 'dot bad' : cooling ? 'dot warn' : 'dot';
    const note = bad ? '不可用' : cooling ? `冷却 ${channel.cooldownRemainingSeconds}s` : '就绪';
    return `<span class="${cls}" title="${escapeAttr(`${channel.name || channel.id}：${note}`)}"></span><span>${escapeHtml(channel.name || channel.id)}</span>`;
  }).join('');
}

// 状态压成一行，只留会改变行为的信息。上一版做成 5 格仪表盘，首屏要读 28 个
// 文本单元才看到第一张图；管理员打开页面通常是想生图或扫一眼有没有出事。
function updateStatusLine(events) {
  if (!statusLine || !statusText || !statusDot) return;

  const today = new Date().toISOString().slice(0, 10);
  const todays = events.filter((event) => String(event.createdAt || '').startsWith(today));
  const failed = todays.filter((event) => event.status === 'failed');
  const charged = failed.filter((event) => event.maybeCharged).length;

  statusLine.hidden = false;

  if (failed.length === 0) {
    statusLine.classList.remove('warn');
    statusDot.className = 'sl-dot good';
    statusText.innerHTML = `一切正常 · 今日 ${todays.length} 次生成`;
    // 今天没有失败了，清掉关闭记录，下次有失败正常提示。
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      // 存不了就算了。
    }
    return;
  }

  // 关掉过、且之后没有新的失败 → 保持关闭（刷新后依然生效）。有新失败就重新出现。
  if (failed.length <= readDismissedFailures()) {
    statusLine.hidden = true;
    return;
  }

  statusLine.classList.add('warn');
  statusDot.className = 'sl-dot bad';
  statusText.innerHTML = `<b>今日 ${failed.length} 次生成失败</b>${charged ? `，其中 ${charged} 次可能已计费` : ''}。`;
  statusLine.dataset.failureCount = String(failed.length);
}

document.querySelector('#dismissStatus')?.addEventListener('click', () => {
  writeDismissedFailures(Number(statusLine?.dataset.failureCount || 0));
  if (statusLine) statusLine.hidden = true;
  showSuccess('已关闭这条提醒。再有新的失败会重新提示。');
});

async function loadHistory() {
  const payload = await getJson(isAdmin ? '/api/admin/history' : '/api/history');
  const history = payload.history || [];
  const users = payload.users || [];
  currentHistory = history;

  // 标题和条数现在由顶部筛选 tab + 分页信息承担，不再需要写标题栏。
  renderOwnerFilter();
  renderHistoryPage();
  renderArchiveList(users);
  renderMemberSidebar();
}

// The member column used to be a static "流程 1234" tutorial that never changed
// after the first visit. Their own recent prompts are worth more space than
// instructions they have already read.
function renderMemberSidebar() {
  if (isAdmin || !memberStats || !recentPrompts) return;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = currentHistory.filter((item) => Date.parse(item.createdAt || 0) >= weekAgo).length;
  const imageTotal = currentHistory.reduce((sum, item) => sum + (item.images?.length || 0), 0);

  memberStats.innerHTML = `
    <div class="status-item"><span>我的作品</span><span>${imageTotal} 张</span></div>
    <div class="status-item"><span>本周生成</span><span>${thisWeek} 次</span></div>
    <div class="status-item"><span>服务状态</span><span>就绪</span></div>
  `;

  // Distinct prompts only: consecutive tweaks of one idea would otherwise fill
  // the whole list with near-identical entries.
  const seen = new Set();
  const recent = [];
  for (const item of currentHistory) {
    const text = (item.prompt || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    recent.push(item);
    if (recent.length >= 5) break;
  }

  if (recent.length === 0) {
    recentPrompts.innerHTML = '<p class="key-meta">还没有记录。生成一张后，提示词会出现在这里方便复用。</p>';
    return;
  }

  recentPrompts.innerHTML = recent.map((item) => `
    <button type="button" class="recent-prompt" data-reuse="${escapeAttr(item.id)}">
      <strong>${escapeHtml(item.prompt.slice(0, 40))}</strong>
      <span>点击载入 · ${escapeHtml(formatRelativeTime(item.createdAt))}</span>
    </button>
  `).join('');

  recentPrompts.querySelectorAll('[data-reuse]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = currentHistory.find((historyItem) => historyItem.id === button.dataset.reuse);
      if (item) reuseHistoryItem(item);
    });
  });
}

function formatRelativeTime(value) {
  const timestamp = Date.parse(value || 0);
  if (!Number.isFinite(timestamp)) return '';

  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '昨天' : `${days} 天前`;
}

// Rendering the whole archive in one innerHTML mounted 744 <img> at once, which
// is why the thumbnails came back blank. Once the rail became a wrapping grid it
// also stretched the page past 32000px, so paging is structural, not a nicety.
// (HISTORY_PAGE_SIZE is declared near the top for temporal-dead-zone reasons.)

function filteredHistory() {
  let items = currentHistory;

  // 「我的」对管理员才有意义：成员的墙本来就只有自己的。
  if (historyScope === 'mine' && isAdmin) {
    items = items.filter((item) => item.ownerRole === 'admin' || item.ownerClientId === 'admin');
  }

  // 按成员筛选。预览成员视角时不生效——真实成员看不到别人的图，
  // 留着这个筛选会让预览失真。
  if (ownerFilterValue && isAdmin && !previewingMember) {
    items = items.filter((item) => (item.ownerClientId || 'default') === ownerFilterValue);
  }

  const query = historyQuery.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => `${item.prompt || ''} ${item.negativePrompt || ''}`.toLowerCase().includes(query));
}

// 下拉里带条数，因为分布很偏（448 / 131 / 78 / … / 1），没有数字很难定位。
function renderOwnerFilter() {
  if (!ownerFilter) return;

  if (!isAdmin) {
    ownerFilter.innerHTML = '<option value="">全部成员</option>';
    return;
  }

  const counts = new Map();
  for (const item of currentHistory) {
    const owner = item.ownerClientId || 'default';
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }

  const options = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  ownerFilter.innerHTML = `<option value="">全部成员（${currentHistory.length}）</option>`
    + options.map(([owner, count]) => {
      const label = owner === 'admin' ? '管理员' : owner;
      return `<option value="${escapeAttr(owner)}">${escapeHtml(label)} · ${count}</option>`;
    }).join('');

  // 重渲染后保持当前选择，否则每次轮询筛选都会被重置。
  ownerFilter.value = ownerFilterValue;
  if (clearOwnerFilterButton) clearOwnerFilterButton.hidden = !ownerFilterValue;
}

function setOwnerFilter(owner) {
  ownerFilterValue = owner || '';
  if (ownerFilter) ownerFilter.value = ownerFilterValue;
  if (clearOwnerFilterButton) clearOwnerFilterButton.hidden = !ownerFilterValue;
  historyPage = 0;
  renderHistoryPage();
}

ownerFilter?.addEventListener('change', () => setOwnerFilter(ownerFilter.value));
clearOwnerFilterButton?.addEventListener('click', () => {
  setOwnerFilter('');
  showSuccess('已显示全部成员的作品');
});

function renderHistoryPage() {
  // 失败 tab 走审计日志，不是历史记录——失败没有图片，历史里没有它们。
  const items = historyScope === 'failed' ? failedEvents : filteredHistory();
  const pageCount = Math.max(1, Math.ceil(items.length / HISTORY_PAGE_SIZE));
  historyPage = Math.min(Math.max(0, historyPage), pageCount - 1);

  const start = historyPage * HISTORY_PAGE_SIZE;
  const pageItems = items.slice(start, start + HISTORY_PAGE_SIZE);
  const render = historyScope === 'failed' ? renderFailedTile : renderHistoryItem;

  historyEl.innerHTML = pageItems.map(render).join('') || renderEmptyWall();

  if (historyPageInfo) {
    historyPageInfo.textContent = items.length
      ? `${items.length} 条 · ${historyPage + 1}/${pageCount}`
      : '0 条';
  }
  if (historyPrev) historyPrev.disabled = historyPage <= 0;
  if (historyNext) historyNext.disabled = historyPage >= pageCount - 1;
}

function renderEmptyWall() {
  if (historyQuery) {
    return '<div class="empty-wall"><strong>没有匹配的记录</strong><span>换个关键词试试。</span></div>';
  }
  if (historyScope === 'failed') {
    return '<div class="empty-wall"><strong>没有失败记录</strong><span>一切正常。</span></div>';
  }
  return '<div class="empty-wall"><strong>还没有作品</strong><span>在下面写一句提示词，按 Ctrl + Enter 开始。</span></div>';
}

// 失败图块：和图片同尺寸，但承载错误而不是图。36.5% 的活动是失败的，
// 之前在画廊形态里完全无处显示。
// 两种数据形态：管理员拿的是原始审计记录（有 error / clientId / channel），
// 成员拿的是 /api/failures 裁剪过的记录（有 reason.text 和 reason.retry，
// 没有渠道和上游信息）。
function renderFailedTile(event) {
  const when = formatDateTime(event.createdAt);
  const isMemberShape = Boolean(event.reason);

  const why = isMemberShape
    ? event.reason.text
    : (event.error || event.errorCode || '未知原因');

  // 成员那边明确告诉他"重试有没有用"——渠道挂了的时候重试一万次也不会成功，
  // 这正是 119 次疯点发生的原因。
  const canRetry = isMemberShape ? event.reason.retry : Boolean(event.prompt);
  const foot = isMemberShape
    ? (event.reason.retry ? '' : '<span class="fail-hint">重试不会成功</span>')
    : `<span class="fail-who">${escapeHtml(formatOwnerLabel(event.clientId || 'default', event.actorRole))}</span>`;

  return `
    <figure class="tile failed">
      <div class="fail-top">
        <span class="fail-badge">失败</span>
        ${event.maybeCharged ? '<span class="charged">可能已计费</span>' : ''}
        <span class="fail-when">${escapeHtml(when)}</span>
      </div>
      <div class="fail-body">
        <div class="fail-why">${escapeHtml(why)}</div>
        <div class="fail-prompt">${escapeHtml((event.prompt || '').slice(0, 80))}</div>
      </div>
      <div class="fail-foot">
        ${foot}
        ${canRetry && event.prompt ? `<button type="button" data-refail="${escapeAttr(event.id || '')}">重试</button>` : ''}
      </div>
    </figure>
  `;
}

// `users` was already being fetched here and thrown away. It is the list of
// archives that predate signed identities, so it doubles as the claim list.
function renderArchiveList(users) {
  if (!archiveList) return;

  if (!isAdmin || users.length === 0) {
    archiveList.innerHTML = '<p class="key-meta">暂无成员档案。</p>';
    return;
  }

  archiveList.innerHTML = users
    .slice()
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .map((user) => `
      <div class="archive-row">
        <div class="archive-meta">
          <strong>${escapeHtml(user.clientId)}</strong>
          <span>${Number(user.count || 0)} 条记录</span>
        </div>
        <button class="btn-outline quiet" type="button" data-claim-for="${escapeAttr(user.clientId)}">生成认领链接</button>
      </div>
    `)
    .join('');

  archiveList.querySelectorAll('[data-claim-for]').forEach((button) => {
    button.addEventListener('click', () => createClaimLink(button.dataset.claimFor, button));
  });
}

async function createClaimLink(targetClientId, button) {
  button.disabled = true;
  try {
    const result = await postJson('/api/client/adopt', { clientId: targetClientId });
    const row = button.closest('.archive-row');
    const existing = row.querySelector('.archive-link');
    existing?.remove();

    const box = document.createElement('div');
    box.className = 'archive-link';

    const field = document.createElement('input');
    field.className = 'styled-input compact';
    field.readOnly = true;
    field.value = result.claimUrl;
    field.setAttribute('aria-label', `${targetClientId} 的认领链接`);
    field.addEventListener('focus', () => field.select());

    const note = document.createElement('span');
    note.className = 'key-meta';
    note.textContent = `${result.expiresInMinutes} 分钟内有效，发给对应同事在自己浏览器打开。`;

    box.append(field, note);
    row.append(box);
    field.select();

    try {
      await navigator.clipboard.writeText(result.claimUrl);
      showSuccess('认领链接已复制到剪贴板');
    } catch {
      showSuccess('认领链接已生成，请手动复制');
    }
  } catch (error) {
    showError(`生成认领链接失败：${error.message}`);
  } finally {
    button.disabled = false;
  }
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

// 墙上的图块只有 222px，原图平均 2.3MB（748 张共 1712MB），一屏要下 46~216MB。
// /thumbs/ 走同一套归属校验，返回 480px JPEG（实测约 64KB，差 28 倍）。
// 只用于缩略图——灯箱和下载必须是原图。
function thumbUrl(url) {
  return url.startsWith('/outputs/') ? url.replace('/outputs/', '/thumbs/') : url;
}

function renderHistoryItem(item) {
  const image = item.images?.[0];
  const imageUrl = image?.url || '';
  const owner = formatOwnerLabel(item.ownerClientId || clientId, item.ownerRole);
  const imageCount = item.images?.length || 0;
  // 预览成员视角时也要藏掉归属标签，否则预览不保真——真实成员看不到别人的 id。
  const showOwner = isAdmin && !previewingMember;
  const ownerId = item.ownerClientId || 'default';
  const meta = [
    item.mode || '',
    imageCount > 1 ? `${imageCount} 张` : '',
  ].filter(Boolean).join(' · ');

  // figure, 不是 button：图块自己带动作按钮，而 <button> 里嵌 <button> 是非法
  // HTML，解析器会提前闭合外层，遮罩内容会溢出到图片下面变成裸文字。
  if (!imageUrl) {
    return `
    <figure class="tile" data-id="${escapeAttr(item.id)}">
      <div class="history-missing-image">无图片</div>
      <figcaption class="tile-veil">
        <span class="tile-prompt">${escapeHtml(item.prompt || '')}</span>
        <span class="tile-acts">
          <button type="button" data-reuse="${escapeAttr(item.id)}">复用参数</button>
          <button type="button" data-view-prompt="${escapeAttr(item.id)}">详情</button>
        </span>
      </figcaption>
    </figure>`;
  }

  return `
    <figure class="tile${item.deletedByMember ? ' member-deleted' : ''}" data-id="${escapeAttr(item.id)}">
      <button type="button" class="tile-open" data-lightbox="${escapeAttr(item.id)}" aria-label="放大查看：${escapeAttr((item.prompt || '').slice(0, 30))}"></button>
      <img src="${escapeAttr(thumbUrl(imageUrl))}" alt="${escapeAttr((item.prompt || '历史图片').slice(0, 60))}" loading="lazy" decoding="async" />
      ${meta ? `<span class="tile-owner">${escapeHtml(meta)}</span>` : ''}
      <figcaption class="tile-veil">
        <span class="tile-prompt">${escapeHtml(item.prompt || '')}</span>
        <span class="tile-acts">
          <button type="button" class="act-zoom" data-lightbox="${escapeAttr(item.id)}" data-tip="放大" aria-label="放大">⤢</button>
          <a href="${escapeAttr(imageUrl)}" download data-tip="下载" aria-label="下载">↓</a>
          <button type="button" class="again" data-again="${escapeAttr(item.id)}" data-tip="同参数再生成一张" aria-label="再来一张">↻</button>
          <button type="button" data-reuse="${escapeAttr(item.id)}" data-tip="改这张" aria-label="改这张">✎</button>
          <button type="button" data-view-prompt="${escapeAttr(item.id)}" data-tip="提示词详情" aria-label="提示词详情">≡</button>
          ${item.deletedByMember
            ? `<button type="button" class="act-restore" data-restore="${escapeAttr(item.id)}" data-tip="恢复" aria-label="恢复">↺</button>`
            : `<button type="button" class="act-del" data-del="${escapeAttr(item.id)}" data-tip="${isAdmin && !previewingMember ? '彻底删除' : '删除'}" aria-label="删除">🗑</button>`}
        </span>
        ${showOwner ? `<button type="button" class="act-owner" data-filter-owner="${escapeAttr(ownerId)}" title="只看这个成员的作品">${escapeHtml(owner)}</button>` : ''}
      </figcaption>
    </figure>
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
  activePromptSeed = String(item.seed || '');
  // 老记录没存 seed，没有可复用的东西就别摆一个点了没反应的按钮。
  if (promptSeedRow) {
    promptSeedRow.hidden = !activePromptSeed;
    if (promptSeedValue) promptSeedValue.textContent = activePromptSeed || '—';
  }
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
  // The dialog used to open without moving focus, so keyboard users stayed on the
  // page behind it and Tab walked the hidden content.
  lastFocusedBeforeModal = document.activeElement;
  copyPromptButton.focus();
}

function formatOwnerLabel(ownerId, ownerRole = '') {
  if (ownerRole === 'admin' || ownerId === 'admin') return '管理员';
  return `成员 ${ownerId || 'default'}`;
}

function closePromptModal() {
  promptModal.hidden = true;
  activePromptText = '';
  activePromptSeed = '';
  document.body.classList.remove('modal-open');
  if (lastFocusedBeforeModal?.isConnected) lastFocusedBeforeModal.focus();
  lastFocusedBeforeModal = null;
}

function renderGallery(images) {
  // 本次生成区默认收起，有结果才出现——空着占地方不如不显示。
  if (currentBlock) currentBlock.hidden = false;

  if (!images.length) {
    gallery.innerHTML = '<div class="empty-wall"><strong>没有返回图片</strong><span>可以在设置里查看运行日志。</span></div>';
    return;
  }

  // 整张图就是放大按钮——原来要去左下角点"放大预览"，而单张图时那个按钮
  // 离图能有 900px 远。
  gallery.innerHTML = images.map((image) => `
    <article class="image-card">
      <button type="button" class="tile-open" data-open="${escapeAttr(image.url)}" aria-label="放大查看"></button>
      <img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.revisedPrompt || lastPrompt || 'generated image')}" />
      <div class="image-actions">
        <button type="button" class="act-zoom" data-open="${escapeAttr(image.url)}">🔍 放大</button>
        <a class="primary-act" href="${escapeAttr(image.url)}" download>下载原图</a>
        <button type="button" data-again-current>再来一张</button>
      </div>
    </article>
  `).join('');

  gallery.querySelector('[data-again-current]')?.addEventListener('click', () => {
    generateForm.requestSubmit();
  });

  // 只存数据。事件在模块级委托一次——绑在这里的话，每次生成都会再加一对监听器，
  // 第 N 次生成后点一下图会触发 N 次。
  currentGalleryEntries = images.map((image) => ({
    url: image.url,
    caption: image.revisedPrompt || lastPrompt || '',
  }));
}

// 按卡片定位，不能按按钮序号：每张图有两个 data-open（整图点击层和「放大」按钮），
// 用按钮序号会让点第一张的放大按钮打开第二张。
function openCurrentGalleryAt(target) {
  if (currentGalleryEntries.length === 0) return;
  const cards = [...gallery.querySelectorAll('.image-card')];
  const index = cards.indexOf(target.closest('.image-card'));
  openLightbox(currentGalleryEntries, Math.max(0, index));
}

gallery.addEventListener('click', (event) => {
  // 点图片本身、隐形点击层、或明确的「放大」按钮，都能打开。
  const hit = event.target.closest('[data-open], .image-card img');
  if (hit) openCurrentGalleryAt(hit);
});

gallery.addEventListener('dblclick', (event) => {
  const card = event.target.closest('.image-card');
  if (card) openCurrentGalleryAt(card);
});

function openLightbox(items, index = 0) {
  if (!lightbox || items.length === 0) return;

  lightboxItems = items;
  lightboxIndex = Math.min(Math.max(0, index), items.length - 1);
  lastFocusedBeforeModal = document.activeElement;
  lightbox.hidden = false;
  document.body.classList.add('modal-open');
  renderLightbox();
  lightboxNext?.focus();
}

function normalizeAppearance(input = {}) {
  const brandName = String(input.brandName || '').trim().replace(/\s+/g, ' ').slice(0, 32) || DEFAULT_APPEARANCE.brandName;
  const brandIcon = [...String(input.brandIcon || '').trim().replace(/\s+/g, '')].slice(0, 2).join('') || DEFAULT_APPEARANCE.brandIcon;
  return { brandName, brandIcon };
}

function applyAppearance(input = {}) {
  const appearance = normalizeAppearance(input);
  if (brandName) brandName.textContent = appearance.brandName;
  if (brandIcon) brandIcon.textContent = appearance.brandIcon;
  document.title = appearance.brandName;

  if (appearanceNameInput && document.activeElement !== appearanceNameInput) appearanceNameInput.value = appearance.brandName;
  if (appearanceIconInput && document.activeElement !== appearanceIconInput) appearanceIconInput.value = appearance.brandIcon;

  updateFavicon(appearance.brandIcon);
}

function updateFavicon(label) {
  const safeLabel = escapeSvgText(label || DEFAULT_APPEARANCE.brandIcon);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#f6c96d"/><text x="32" y="39" font-size="20" text-anchor="middle" font-family="monospace" font-weight="900" fill="#080b10">' + safeLabel + '</text></svg>';
  const href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.href = href;
}

function escapeSvgText(value) {
  return String(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function resetLightboxZoom() {
  setLightboxZoom(1, 0, 0);
}

function nativeLightboxScale() {
  if (!lightboxImage?.naturalWidth || !lightboxImage?.clientWidth) return 1;
  const x = lightboxImage.naturalWidth / Math.max(1, lightboxImage.clientWidth);
  const y = lightboxImage.naturalHeight / Math.max(1, lightboxImage.clientHeight);
  return clamp(Math.max(x, y, 1), LIGHTBOX_MIN_SCALE, LIGHTBOX_MAX_SCALE);
}

function isLightboxZoomed() {
  return lightboxZoom.scale > 1.01;
}

function canPanLightbox(scale = lightboxZoom.scale) {
  if (!lightboxStage || !lightboxImage) return false;
  return lightboxImage.clientWidth * scale > lightboxStage.clientWidth || lightboxImage.clientHeight * scale > lightboxStage.clientHeight;
}

function setLightboxZoom(scale, x = lightboxZoom.x, y = lightboxZoom.y) {
  const nextScale = clamp(Number(scale) || 1, LIGHTBOX_MIN_SCALE, LIGHTBOX_MAX_SCALE);
  const next = clampLightboxPan(x, y, nextScale);
  lightboxZoom = { scale: nextScale, x: next.x, y: next.y };
  applyLightboxZoom();
}

function zoomLightboxBy(factor, origin = null) {
  const oldScale = lightboxZoom.scale;
  const nextScale = clamp(oldScale * factor, LIGHTBOX_MIN_SCALE, LIGHTBOX_MAX_SCALE);
  let nextX = lightboxZoom.x;
  let nextY = lightboxZoom.y;

  if (origin && lightboxStage) {
    const rect = lightboxStage.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = nextScale / oldScale;
    nextX -= (origin.x - centerX - lightboxZoom.x) * (ratio - 1);
    nextY -= (origin.y - centerY - lightboxZoom.y) * (ratio - 1);
  }

  setLightboxZoom(nextScale, nextX, nextY);
}

function clampLightboxPan(x, y, scale = lightboxZoom.scale) {
  if (!lightboxStage || !lightboxImage || !canPanLightbox(scale)) return { x: 0, y: 0 };
  const overflowX = Math.max(0, (lightboxImage.clientWidth * scale - lightboxStage.clientWidth) / 2);
  const overflowY = Math.max(0, (lightboxImage.clientHeight * scale - lightboxStage.clientHeight) / 2);
  return {
    x: clamp(x, -overflowX, overflowX),
    y: clamp(y, -overflowY, overflowY),
  };
}

function applyLightboxZoom() {
  if (!lightboxImage) return;
  lightboxImage.style.setProperty('--lightbox-scale', String(lightboxZoom.scale));
  lightboxImage.style.setProperty('--lightbox-x', lightboxZoom.x + 'px');
  lightboxImage.style.setProperty('--lightbox-y', lightboxZoom.y + 'px');
  lightboxStage?.classList.toggle('zoomed', canPanLightbox());

  if (lightboxZoomValue) {
    const native = nativeLightboxScale();
    lightboxZoomValue.textContent = Math.abs(lightboxZoom.scale - 1) < 0.02 && !lightboxZoom.x && !lightboxZoom.y
      ? '适配'
      : Math.round((lightboxZoom.scale / native) * 100) + '%';
  }
}

function handleLightboxWheel(event) {
  if (lightbox?.hidden) return;
  event.preventDefault();
  zoomLightboxBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX, y: event.clientY });
}

function startLightboxDrag(event) {
  lightboxDragMoved = false;
  if (!canPanLightbox() || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  lightboxDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: lightboxZoom.x,
    baseY: lightboxZoom.y,
  };
  lightboxStage?.setPointerCapture?.(event.pointerId);
  lightboxStage?.classList.add('dragging');
}

function moveLightboxDrag(event) {
  if (!lightboxDrag || lightboxDrag.pointerId !== event.pointerId) return;
  lightboxDragMoved = true;
  event.preventDefault();
  setLightboxZoom(
    lightboxZoom.scale,
    lightboxDrag.baseX + event.clientX - lightboxDrag.startX,
    lightboxDrag.baseY + event.clientY - lightboxDrag.startY,
  );
}

function endLightboxDrag(event) {
  if (!lightboxDrag || lightboxDrag.pointerId !== event.pointerId) return;
  lightboxDrag = null;
  lightboxStage?.classList.remove('dragging');
}

function handleLightboxStageClick(event) {
  // 拖拽结束后的 click 只负责清除抑制标志，避免松手时误关灯箱。
  if (lightboxDragMoved) {
    lightboxDragMoved = false;
    return;
  }

  if (lightboxImage && (event.target === lightboxImage || lightboxImage.contains(event.target))) return;
  closeLightbox();
}

function renderLightbox() {
  resetLightboxZoom();
  const item = lightboxItems[lightboxIndex];
  if (!item) return;

  lightboxImage.src = item.url;
  lightboxImage.alt = item.caption || '生成结果预览';
  lightboxCaption.textContent = (item.caption || '').slice(0, 90);
  lightboxDownload.href = item.url;

  const many = lightboxItems.length > 1;
  lightboxCounter.textContent = many ? `${lightboxIndex + 1} / ${lightboxItems.length}` : '';
  lightboxPrev.hidden = !many;
  lightboxNext.hidden = !many;
}

function stepLightbox(delta) {
  if (lightboxItems.length < 2) return;
  lightboxIndex = (lightboxIndex + delta + lightboxItems.length) % lightboxItems.length;
  renderLightbox();
}

function closeLightbox() {
  if (!lightbox || lightbox.hidden) return;
  lightbox.hidden = true;
  resetLightboxZoom();
  lightboxImage.src = '';
  document.body.classList.remove('modal-open');
  // Return focus where it was, or the trigger button is lost to keyboard users.
  if (lastFocusedBeforeModal?.isConnected) lastFocusedBeforeModal.focus();
  lastFocusedBeforeModal = null;
}

function renderKey(key) {
  const bad = !key.enabled || key.disabledByRuntime;
  const cooling = key.coolingDown;
  const status = bad ? '不可用' : cooling ? `冷却 ${key.cooldownRemainingSeconds}s` : '就绪';
  const badgeClass = bad ? 'bad' : cooling ? '' : 'ok';
  const canToggle = key.source === 'file';
  const providerType = key.providerType || 'openai-images';

  return `
    <article class="key-item">
      <div class="key-top">
        <strong>${escapeHtml(key.name)}</strong>
        <span class="badge ${badgeClass}">${status}</span>
      </div>
      <div class="key-meta">
        <div>${escapeHtml(key.masked)} · ${escapeHtml(key.source)}</div>
        <div>${escapeHtml(key.baseURL || '')}</div>
        <select class="pop-input key-provider-select" data-id="${escapeAttr(key.id)}" ${canToggle ? '' : 'disabled'}>
          <option value="openai-images" ${providerType === 'openai-images' ? 'selected' : ''}>openai-images</option>
          <option value="gemini-native" ${providerType === 'gemini-native' ? 'selected' : ''}>gemini-native</option>
        </select>
        <div>成功 ${key.successes} · 失败 ${key.failures}</div>
        ${key.lastError ? `<div>最近错误：${escapeHtml(key.lastError)}</div>` : ''}
        ${renderProbeLine(key.probe)}
      </div>
      <div class="key-actions">
        ${canToggle ? `<button class="btn-outline" type="button" data-probe-key="${escapeAttr(key.id)}">检测连接</button>` : ''}
        ${canToggle ? `<button class="btn-outline" type="button" data-toggle-key="${escapeAttr(key.id)}" data-enabled="${String(key.enabled)}">${key.enabled ? '停用' : '启用'}</button>` : ''}
        <button class="btn-outline" type="button" data-delete-key="${escapeAttr(key.id)}" data-source="${escapeAttr(key.source)}">删除</button>
      </div>
    </article>
  `;
}

async function updateKeyProviderType(id, providerType, select) {
  select.disabled = true;
  try {
    const response = await apiFetch(`/api/keys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerType }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '修改渠道协议失败');

    if (payload.key?.probe?.ok) {
      showSuccess(`渠道协议已改为 ${providerType}，连接正常`);
    } else {
      showError(`协议已改为 ${providerType}，但连接检测失败：${payload.key?.probe?.message || '未知原因'}`);
    }
  } catch (error) {
    showError(`修改渠道协议失败：${error.message}`);
  }
  await loadStatus();
}

// 25 failures in the audit log are flagged maybeCharged: the upstream connection
// dropped after the request went out, so money may be gone with nothing to show.
// They were only findable by grepping the log by hand.
async function loadCharged() {
  if (!chargedSummary || !chargedList) return;

  if (!isAdmin) {
    chargedSummary.innerHTML = '';
    chargedList.innerHTML = '';
    return;
  }

  try {
    renderCharged(await getJson('/api/admin/charged'));
  } catch (error) {
    chargedSummary.innerHTML = `<p class="key-meta">读取失败：${escapeHtml(error.message)}</p>`;
    chargedList.innerHTML = '';
  }
}

function renderCharged(report) {
  const open = report.openCount || 0;

  chargedSummary.innerHTML = `
    <div class="charged-stat">
      <span class="charged-open ${open > 0 ? 'alert' : ''}">${open}</span>
      <span class="key-meta">待核对 · 共 ${report.total || 0} 条，已核对 ${report.reconciledCount || 0}</span>
    </div>
    ${report.byUser?.length ? `<p class="key-meta">${report.byUser.map((u) => `${escapeHtml(u.clientId)} ${u.count} 条`).join(' · ')}</p>` : ''}
  `;

  // Only the outstanding ones are listed; a reconciled entry has been dealt with
  // and would just be noise.
  const pending = (report.items || []).filter((item) => !item.reconciled).slice(0, 12);

  if (pending.length === 0) {
    chargedList.innerHTML = '<p class="key-meta">没有待核对的记录。</p>';
    return;
  }

  chargedList.innerHTML = pending.map((item) => `
    <div class="charged-row">
      <div class="charged-meta">
        <strong>${escapeHtml(formatDateTime(item.createdAt))}</strong>
        <span>${escapeHtml(item.clientId)} · ${escapeHtml(item.model || '')}</span>
        <em>${escapeHtml((item.error || '').slice(0, 60))}</em>
      </div>
      <button class="btn-outline quiet" type="button" data-reconcile="${escapeAttr(item.id)}">标记已核对</button>
    </div>
  `).join('');

  chargedList.querySelectorAll('[data-reconcile]').forEach((button) => {
    button.addEventListener('click', () => reconcileCharged(button.dataset.reconcile, button));
  });
}

async function reconcileCharged(id, button) {
  button.disabled = true;
  try {
    renderCharged(await postJson('/api/admin/charged/reconcile', { id, reconciled: true }));
    showSuccess('已标记为已核对');
  } catch (error) {
    showError(`标记失败：${error.message}`);
    button.disabled = false;
  }
}

// 27% of recorded failures were configuration problems found by a member trying
// to generate. Showing the save-time verdict puts that in front of the admin.
// Function declarations (not const) so loadStatus can call these regardless of
// where they sit in the file.
function renderProbeLine(probe) {
  if (!probe) return '<div class="probe-line unknown">连接状态未知 · 点「检测连接」验证</div>';

  const when = probe.checkedAt ? formatDateTime(probe.checkedAt) : '';
  const cls = probe.ok ? 'ok' : 'bad';
  const mark = probe.ok ? '✓' : '✕';
  return `<div class="probe-line ${cls}">${mark} ${escapeHtml(probe.message || '')}${when ? ` · ${escapeHtml(when)}` : ''}</div>`;
}

async function probeKey(id, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '检测中…';

  try {
    const result = await postJson(`/api/keys/${encodeURIComponent(id)}/probe`);
    if (result.probe?.ok) {
      showSuccess(result.probe.message || '连接正常');
    } else {
      showError(`渠道不可用：${result.probe?.message || '未知原因'}`);
    }
    if (result.probe?.providerTypeNote) {
      showError(result.probe.providerTypeNote);
    }
    await loadStatus();
  } catch (error) {
    showError(`检测失败：${error.message}`);
    button.disabled = false;
    button.textContent = original;
  }
}

function updateModeUI() {
  const mode = new FormData(generateForm).get('mode');
  document.body.classList.toggle('image-mode', mode === 'image');

  // 参考图入口现在是提示条上的一个 chip，图生图模式下把它点亮提示必填。
  const refChip = document.querySelector('#refChip');
  if (refChip) {
    refChip.classList.toggle('needed', mode === 'image' && !inputImageDataUrl);
    refChip.textContent = inputImageDataUrl ? '✓ 参考图' : '+ 参考图';
  }
}

function renderInputPreview(file, dataUrl, originalLength = 0) {
  if (!file || !dataUrl) {
    inputPreview.innerHTML = '';
    return;
  }

  // Roughly the encoded byte count; enough to show the user the upload shrank.
  const sentKb = Math.round((dataUrl.length * 0.75) / 1024);
  const originalKb = originalLength ? Math.round((originalLength * 0.75) / 1024) : 0;
  const shrank = originalKb && sentKb < originalKb * 0.95;

  inputPreview.innerHTML = `
    <article>
      <img src="${escapeAttr(dataUrl)}" alt="参考图预览：${escapeAttr(file.name)}" />
      <p>${escapeHtml(file.name)} · ${shrank ? `${originalKb} KB → ${sentKb} KB` : `${sentKb} KB`}</p>
    </article>
  `;
}

// 重编码格式跟随源文件：照片一律转 PNG 会无损放大好几倍，白等上传时间。
// PNG 保持 PNG（可能有透明通道），JPEG/WebP 保持自己的有损格式。
function encodingFor(sourceType) {
  if (sourceType === 'image/png') return { type: 'image/png', quality: undefined };
  if (sourceType === 'image/webp') return { type: 'image/webp', quality: 0.9 };
  // 其余（jpeg、heic 转出来的、类型缺失）统一走 jpeg：参考图不需要无损。
  return { type: 'image/jpeg', quality: 0.9 };
}

// Downscales client-side before upload. Keeps the long edge at maxEdge and only
// returns the smaller of the two, so an already-small image is left untouched.
function downscaleDataUrl(dataUrl, maxEdge, sourceType = '') {
  return new Promise((resolve) => {
    const image = new Image();

    image.addEventListener('load', () => {
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      if (!longest || longest <= maxEdge) {
        resolve(dataUrl);
        return;
      }

      const scale = maxEdge / longest;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);

      const context = canvas.getContext('2d');
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      try {
        const { type, quality } = encodingFor(sourceType);
        const resized = canvas.toDataURL(type, quality);
        resolve(resized.length < dataUrl.length ? resized : dataUrl);
      } catch {
        // Tainted canvas or unsupported type: send the original rather than fail.
        resolve(dataUrl);
      }
    });

    // A decode failure should not block the upload; the server validates too.
    image.addEventListener('error', () => resolve(dataUrl));
    image.src = dataUrl;
  });
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
  return readJsonResponse(await apiFetch(url));
}

async function postJson(url, body = null) {
  return readJsonResponse(await apiFetch(url, {
    method: 'POST',
    ...(body === null ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }));
}

async function deleteJson(url) {
  return readJsonResponse(await apiFetch(url, { method: 'DELETE' }));
}

// Surface the server's own message. Throwing only the status code hid useful
// detail like "No member channel configured" from whoever needed to read it.
async function readJsonResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `请求失败：${response.status}`);
  }
  return payload ?? {};
}

// No X-Client-Id header any more: identity travels in the HttpOnly cookie the
// server issues. Sending a self-asserted id would only imply it still counted.
function apiFetch(url, options = {}) {
  return fetch(url, { ...options, credentials: 'same-origin' });
}


function addLog(message, isError = false) {
  const line = document.createElement('div');
  line.className = `log-line${isError ? ' error' : ''}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logs.prepend(line);
}

// addLog writes into #logs, which lives inside the admin panel and is hidden for
// members — so every validation and failure message was invisible to exactly the
// people who needed it. Toasts sit outside that subtree.
function showToast(message, variant = 'error') {
  addLog(message, variant === 'error');
  if (!toastRegion) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.setAttribute('role', variant === 'error' ? 'alert' : 'status');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-close';
  dismiss.setAttribute('aria-label', '关闭提示');
  dismiss.textContent = '×';

  const remove = () => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 200);
  };
  dismiss.addEventListener('click', remove);

  toast.append(text, dismiss);
  toastRegion.append(toast);
  setTimeout(remove, variant === 'error' ? 8000 : 4000);
}

function showError(message) {
  showToast(message, 'error');
}

function showSuccess(message) {
  showToast(message, 'success');
}

// Image-to-image can take 5-15 minutes. Now that jobs survive a restart, the
// remaining reason to babysit the tab is not knowing when it finished — so tell
// the user even if they are looking at something else.
const BASE_TITLE = document.title;
let titleBlinkTimer = null;

function announceCompletion(message) {
  showSuccess(message);

  if (!document.hidden) return;

  // Title blink works everywhere and needs no permission.
  let on = true;
  clearInterval(titleBlinkTimer);
  titleBlinkTimer = setInterval(() => {
    document.title = on ? `✅ ${message}` : BASE_TITLE;
    on = !on;
  }, 1200);

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('Image2 Studio', { body: message, tag: 'image2-job' });
    } catch {
      // Some browsers reject constructed notifications outside a SW; the title
      // blink already covers it.
    }
  }
}

function clearCompletionAnnouncement() {
  if (!titleBlinkTimer) return;
  clearInterval(titleBlinkTimer);
  titleBlinkTimer = null;
  document.title = BASE_TITLE;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clearCompletionAnnouncement();
});

// Asked for only when the user starts a generation, not on page load — an
// unprompted permission dialog on arrival is its own kind of rude.
function requestNotificationPermissionOnce() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('image2NotifyAsked')) return;
  localStorage.setItem('image2NotifyAsked', '1');
  Notification.requestPermission().catch(() => {});
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

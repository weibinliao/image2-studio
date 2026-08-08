// 身份合并脚本：把 data/identity-migrations.json 里已确认的「新ID→旧ID」配对
// 同步到旧账号（历史、图片、审计日志、任务、软删除记录）。
// 只处理带签名的 token 采集到的配对，只动映射里出现的目录，绝不碰其他用户数据。
// 用法：
//   node scripts/merge-identities.js --dry-run   # 只预览，不写任何数据
//   node scripts/merge-identities.js             # 真正执行（会先备份）
// 可重复执行：已合并的配对带 mergedAt 标记会被跳过；后来新采集到的配对下次再跑即可。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const USER_DIR = path.join(DATA_DIR, 'users');
const MIGRATIONS_FILE = path.join(DATA_DIR, 'identity-migrations.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit-log.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const DELETED_FILE = path.join(DATA_DIR, 'deleted-items.json');
const BACKUP_DIR = path.join(
  ROOT, '.local', 'identity-merge-backup',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

function isUserDir(name) {
  return /^user_[a-zA-Z0-9_-]+$/.test(name) && name !== 'user_default';
}

// 把条目里的 /outputs/<newId>/ 路径改写成 /outputs/<oldId>/
function rewriteHistoryImages(item, newId, oldId) {
  const prefix = `/outputs/${newId}/`;
  const images = Array.isArray(item.images) ? item.images.map((img) => {
    const next = { ...img };
    for (const key of ['url', 'localUrl']) {
      if (typeof next[key] === 'string' && next[key].startsWith(prefix)) {
        next[key] = next[key].replace(prefix, `/outputs/${oldId}/`);
      }
    }
    return next;
  }) : [];
  return { ...item, images };
}

function firstImageUrl(item) {
  const first = Array.isArray(item.images) ? item.images[0] : null;
  return (first && (first.localUrl || first.url)) || '';
}

// 合并历史：按 item.id 和首图 URL 去重，旧账号条目优先保留。
function mergeHistories(oldItems, newItems) {
  const byId = new Map();
  const byImage = new Map();
  for (const item of oldItems) {
    if (!item || !item.id) continue;
    byId.set(String(item.id), item);
    const url = firstImageUrl(item);
    if (url) byImage.set(url, String(item.id));
  }
  const added = [];
  for (const item of newItems) {
    if (!item || !item.id) continue;
    const idKey = String(item.id);
    const url = firstImageUrl(item);
    if (byId.has(idKey)) continue;
    if (url && byImage.has(url)) continue;
    byId.set(idKey, item);
    if (url) byImage.set(url, idKey);
    added.push(item);
  }
  return {
    merged: [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    added,
  };
}

async function dirExists(dir) {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

async function fileCount(dir) {
  try {
    return (await fs.readdir(dir)).length;
  } catch {
    return 0;
  }
}

// 审计时间线交叉验证：旧 ID 在新 ID 活跃期间不应有记录，否则说明来源可疑。
function auditOverlap(auditEvents, newId, oldId) {
  const newTimes = auditEvents
    .filter((e) => e.clientId === newId)
    .map((e) => String(e.createdAt || ''))
    .filter(Boolean)
    .sort();
  if (newTimes.length === 0) return 0;
  const start = newTimes[0];
  const end = newTimes[newTimes.length - 1];
  return auditEvents.filter((e) => e.clientId === oldId && e.createdAt >= start && e.createdAt <= end).length;
}

function log(line) {
  console.log(line);
}

// ---------- 主流程 ----------
const entries = (await readJson(MIGRATIONS_FILE, [])).filter((e) => e && e.newId && e.oldId);
const pending = entries.filter((e) => !e.mergedAt);
const done = entries.filter((e) => e.mergedAt);
log(`证据配对总数: ${entries.length}，已合并: ${done.length}，待处理: ${pending.length}`);
if (pending.length === 0) {
  log('没有待处理的配对。');
  process.exit(0);
}

const auditEvents = await readJson(AUDIT_LOG_FILE, []);
const jobs = await readJson(JOBS_FILE, []);
const deleted = await readJson(DELETED_FILE, {});
const backupFiles = [MIGRATIONS_FILE, AUDIT_LOG_FILE, JOBS_FILE, DELETED_FILE];
if (!dryRun) {
  for (const file of backupFiles) {
    try {
      const dest = path.join(BACKUP_DIR, path.basename(file));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(file, dest);
    } catch {
      // 文件不存在就跳过备份
    }
  }
  log(`已备份数据文件到: ${BACKUP_DIR}`);
}

let auditChanged = 0;
let jobsChanged = 0;
let deletedChanged = 0;
const pairSummaries = [];

for (const entry of pending) {
  const { newId, oldId } = entry;
  const summary = { newId, oldId, status: 'skipped', reason: '', historyAdded: 0, filesMoved: 0, filesCollided: 0, auditRewritten: 0 };

  if (!isUserDir(newId) || !isUserDir(oldId) || newId === oldId) {
    summary.reason = '非法 ID';
    pairSummaries.push(summary);
    continue;
  }
  const newDir = path.join(USER_DIR, newId);
  const oldDir = path.join(USER_DIR, oldId);
  if (!(await dirExists(newDir))) {
    summary.reason = '新ID目录不存在（可能已合并过）';
    pairSummaries.push(summary);
    continue;
  }
  if (!(await dirExists(oldDir))) {
    summary.reason = '旧ID目录不存在，跳过避免凭空建账号';
    pairSummaries.push(summary);
    continue;
  }

  const overlap = auditOverlap(auditEvents, newId, oldId);
  if (overlap > 0 && !force) {
    summary.reason = `审计时间线交叉 ${overlap} 条，来源存疑，跳过（--force 可强制）`;
    pairSummaries.push(summary);
    continue;
  }

  // 1) 历史合并（含图片路径改写）
  const oldItems = await readJson(path.join(oldDir, 'history.json'), []);
  const newItems = await readJson(path.join(newDir, 'history.json'), []);
  const rewritten = (Array.isArray(newItems) ? newItems : []).map((item) => rewriteHistoryImages(item, newId, oldId));
  const { merged, added } = mergeHistories(Array.isArray(oldItems) ? oldItems : [], rewritten);
  summary.historyAdded = added.length;

  // 2) 图片文件迁移
  const newOutDir = path.join(newDir, 'outputs');
  const oldOutDir = path.join(oldDir, 'outputs');
  const newFiles = (await fileCount(newOutDir)) ? await fs.readdir(newOutDir) : [];
  for (const name of newFiles) {
    const src = path.join(newOutDir, name);
    const dest = path.join(oldOutDir, name);
    if (await dirExists(dest)) {
      summary.filesCollided += 1;
      continue;
    }
    if (dryRun) {
      summary.filesMoved += 1;
    } else {
      await fs.mkdir(oldOutDir, { recursive: true });
      await fs.rename(src, dest);
      summary.filesMoved += 1;
    }
  }

  if (dryRun) {
    summary.status = 'ready';
    pairSummaries.push(summary);
    continue;
  }

  // 3) 写回历史
  await writeJsonAtomic(path.join(oldDir, 'history.json'), merged);

  // 4) 审计日志：clientId 与图片路径一起改写
  let pairAudit = 0;
  for (const event of auditEvents) {
    if (event.clientId === newId) {
      event.clientId = oldId;
      if (Array.isArray(event.images)) {
        for (const img of event.images) {
          for (const key of ['url', 'localUrl']) {
            if (typeof img[key] === 'string' && img[key].startsWith(`/outputs/${newId}/`)) {
              img[key] = img[key].replace(`/outputs/${newId}/`, `/outputs/${oldId}/`);
            }
          }
        }
      }
      pairAudit += 1;
    }
  }
  auditChanged += pairAudit;
  summary.auditRewritten = pairAudit;

  // 5) 任务归属
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      if (job && job.ownerId === newId) {
        job.ownerId = oldId;
        jobsChanged += 1;
      }
    }
  }

  // 6) 软删除记录归属
  for (const [itemId, mark] of Object.entries(deleted)) {
    if (mark && mark.by === newId) {
      mark.by = oldId;
      deletedChanged += 1;
    }
  }

  // 7) 标记已合并并归档新目录
  entry.mergedAt = new Date().toISOString();
  const archiveDir = path.join(BACKUP_DIR, newId);
  await fs.mkdir(path.dirname(archiveDir), { recursive: true });
  await fs.rename(newDir, archiveDir);

  summary.status = 'merged';
  pairSummaries.push(summary);
}

if (!dryRun && (auditChanged > 0)) {
  await writeJsonAtomic(AUDIT_LOG_FILE, auditEvents);
}
if (!dryRun && jobsChanged > 0) {
  await writeJsonAtomic(JOBS_FILE, jobs);
}
if (!dryRun && deletedChanged > 0) {
  await writeJsonAtomic(DELETED_FILE, deleted);
}
if (!dryRun) {
  await writeJsonAtomic(MIGRATIONS_FILE, entries);
}

log('');
log(dryRun ? '========== 干跑结果（未写任何数据） ==========' : '========== 合并结果 ==========');
for (const s of pairSummaries) {
  if (s.status === 'merged') {
    log(`[已合并] ${s.newId} → ${s.oldId}：新增历史 ${s.historyAdded} 条，迁移图片 ${s.filesMoved} 张，冲突跳过 ${s.filesCollided} 张，审计改写 ${s.auditRewritten} 条`);
  } else if (s.status === 'ready') {
    log(`[待执行] ${s.newId} → ${s.oldId}：将新增历史 ${s.historyAdded} 条，迁移图片 ${s.filesMoved} 张（冲突 ${s.filesCollided}）`);
  } else {
    log(`[跳过] ${s.newId} → ${s.oldId}：${s.reason}`);
  }
}
if (!dryRun) {
  log(`审计日志共改写 ${auditChanged} 条，任务改写 ${jobsChanged} 条，软删除改写 ${deletedChanged} 条`);
  log(`新ID目录已归档到: ${BACKUP_DIR}`);
  log('提示：请重启服务（npm stop && npm start）让任务与身份状态生效。');
}
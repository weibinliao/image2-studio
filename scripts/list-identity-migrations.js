// 只读查看已采集到的「新ID→旧ID」配对证据，不修改任何数据。
// 用法：npm run evidence
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_FILE = path.join(ROOT, 'data', 'identity-migrations.json');
const USER_DIR = path.join(ROOT, 'data', 'users');

async function historyCount(clientId) {
  try {
    const items = JSON.parse(await fs.readFile(path.join(USER_DIR, clientId, 'history.json'), 'utf8'));
    return Array.isArray(items) ? items.length : 0;
  } catch {
    return 0;
  }
}

async function outputCount(clientId) {
  try {
    const files = await fs.readdir(path.join(USER_DIR, clientId, 'outputs'));
    return files.length;
  } catch {
    return 0;
  }
}

let entries = [];
try {
  entries = JSON.parse(await fs.readFile(MIGRATIONS_FILE, 'utf8'));
} catch {
  // 采集文件还不存在。
}

if (!Array.isArray(entries) || entries.length === 0) {
  console.log('暂无采集到的新旧 ID 配对。等同事打开页面后，再运行 npm run evidence 查看。');
  process.exit(0);
}

console.log('新ID(现在) → 旧ID(以前) | 状态 | 首次发现 | 最近发现 | 次数 | 新数据量(条/图) | 旧数据量(条/图) | 冲突旧ID');
for (const e of entries) {
  const newCount = await historyCount(e.newId);
  const newOut = await outputCount(e.newId);
  const oldCount = await historyCount(e.oldId);
  const oldOut = await outputCount(e.oldId);
  const status = e.mergedAt
    ? `已合并@${e.mergedAt.slice(0, 19).replace('T', ' ')}`
    : '待同步';
  console.log(
    `${e.newId} → ${e.oldId} | ${status} | ${e.firstSeenAt} | ${e.lastSeenAt} | ${e.sightings} | ${newCount}/${newOut} | ${oldCount}/${oldOut} | ${(e.alsoSeen || []).join(',') || '-'}`
  );
}
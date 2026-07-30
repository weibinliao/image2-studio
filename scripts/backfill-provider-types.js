import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectProviderTypeValue } from '../image-providers.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_KEY_FILE = path.join(ROOT, 'data', 'keys.json');

export async function backfillProviderTypes(options = {}) {
  const keyFile = options.keyFile || DEFAULT_KEY_FILE;
  const detect = options.detect || detectProviderTypeValue;
  const logger = options.logger || console.log;
  const timestamp = options.timestamp || new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `${keyFile}.bak-${timestamp}`;

  const original = await fs.readFile(keyFile, 'utf8');
  await fs.copyFile(keyFile, backupFile);
  const records = JSON.parse(original);
  let changed = 0;

  for (const record of records) {
    const current = String(record.providerType || '').trim();
    if (current) {
      logger(`${record.name || record.id} -> ${current} (kept)`);
      continue;
    }

    const providerType = await detect(record);
    record.providerType = providerType;
    changed += 1;
    logger(`${record.name || record.id} -> ${providerType}`);
  }

  if (changed > 0) {
    await fs.writeFile(keyFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  }
  logger(`Backup: ${backupFile}`);
  logger(`Updated: ${changed}`);

  return { backupFile, changed, records };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  backfillProviderTypes().catch((error) => {
    console.error(`Backfill failed: ${error.message}`);
    process.exitCode = 1;
  });
}

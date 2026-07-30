// Audits which classes used in index.html / app.js have no rule in the loaded
// stylesheets. Written after finding that `.chips` had markup and a comment but
// no actual rule, so three prompt buttons rendered as bare text.
//
//   node scripts/check-missing-css.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const sources = [read('public/index.html'), read('public/app.js')];
const css = read('public/theme-canvas.css') + read('public/canvas-live.css');

// 只收合法的 CSS 标识符。之前会把模板字符串里的碎片（`.0` `.>` `.?`）当成
// class 报出来，假报警会让人习惯性忽略这个脚本的输出。
const VALID_CLASS = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

const used = new Set();
for (const src of sources) {
  for (const match of src.matchAll(/class=["']([^"']+)["']/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (VALID_CLASS.test(name)) used.add(name);
    }
  }
}

const missing = [...used]
  .filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`\\.${escaped}(?![a-zA-Z0-9_-])`).test(css);
  })
  .sort();

console.log(`用到的 class: ${used.size} 个`);
console.log(`没有 CSS 规则的: ${missing.length} 个`);
for (const name of missing) console.log(`  .${name}`);

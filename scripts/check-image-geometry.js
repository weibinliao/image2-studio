// 静态防线：拦住会让图片变形的 CSS 写法。
//
// 图片变形在这个项目里出现过两次，根因是同一类问题——CSS 悄悄改了图片几何：
//   1. <img> 带 width/height 属性，但 CSS 只设了 width 没设 height
//      → 属性被当成字面像素高度（299px 宽的图块渲染成 1536px 高）
//   2. flex 列容器默认 align-items:stretch 把图片横向拉满，同时 max-height 限高
//      → 1024×1536 的竖图被压成 672×670，比例从 0.667 变成 1.003
//
// 两次都是肉眼才发现的。规则很简单：任何给 img 同时约束两个方向的规则，
// 必须显式声明 object-fit，否则内容会被拉伸。
//
//   node scripts/check-image-geometry.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHEETS = ['public/theme-canvas.css', 'public/canvas-live.css'];

// 逐条解析 CSS 规则块，不用正则硬啃整个文件。
function parseRules(css) {
  const rules = [];
  // 去掉注释，避免注释里的示例代码被当成真规则
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;

    const decls = {};
    for (const part of match[2].split(';')) {
      const idx = part.indexOf(':');
      if (idx === -1) continue;
      decls[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    rules.push({ selector, decls });
  }
  return rules;
}

// 只关心作用到 <img> 的选择器
function targetsImage(selector) {
  return /(^|[\s,>+~])img(\b|[.:#[])/.test(selector) || /\bimg$/.test(selector);
}

const findings = [];

for (const sheet of SHEETS) {
  const css = fs.readFileSync(path.join(ROOT, sheet), 'utf8');

  for (const { selector, decls } of parseRules(css)) {
    if (!targetsImage(selector)) continue;

    const hasW = 'width' in decls || 'max-width' in decls;
    const hasH = 'height' in decls || 'max-height' in decls;
    const fit = decls['object-fit'];

    // 两个方向都被约束却没声明 object-fit → 内容会被拉伸
    if (hasW && hasH && !fit) {
      const wIsAuto = decls.width === 'auto';
      const hIsAuto = decls.height === 'auto';
      // width:auto 或 height:auto 说明留了一个方向自由，是安全的
      if (!wIsAuto && !hIsAuto) {
        findings.push({
          sheet,
          selector,
          why: '同时约束宽高但没有 object-fit，图片内容会被拉伸变形',
          detail: Object.entries(decls)
            .filter(([k]) => /^(width|height|max-width|max-height)$/.test(k))
            .map(([k, v]) => `${k}:${v}`)
            .join(' '),
        });
      }
    }
  }

  // flex/grid 容器里的图片：stretch 是默认值，会横向拉满
  for (const { selector, decls } of parseRules(css)) {
    if (!/flex|grid/.test(decls.display || '')) continue;
    if ((decls['flex-direction'] || '') !== 'column') continue;
    if ('align-items' in decls) continue;

    // 这个容器是列方向 flex 且没有设 align-items，如果里面有 img 就有拉伸风险
    const base = selector.split(',')[0].trim();
    const imgRule = parseRules(css).find((r) => r.selector.startsWith(base) && targetsImage(r.selector));
    if (imgRule) {
      findings.push({
        sheet,
        selector,
        why: '列方向 flex 容器未设 align-items，默认 stretch 会把内部图片横向拉满',
        detail: `display:${decls.display} flex-direction:column`,
      });
    }
  }
}

if (findings.length === 0) {
  console.log('图片几何检查通过：没有会导致变形的 CSS 写法。');
  process.exit(0);
}

console.error(`发现 ${findings.length} 处可能让图片变形的写法：\n`);
for (const f of findings) {
  console.error(`  ${f.sheet}`);
  console.error(`    选择器: ${f.selector}`);
  console.error(`    声明:   ${f.detail}`);
  console.error(`    问题:   ${f.why}\n`);
}
process.exit(1);

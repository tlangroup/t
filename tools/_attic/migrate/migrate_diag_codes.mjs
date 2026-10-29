#!/usr/bin/env node
// tools/migrate_diag_codes.mjs
// 将 src/*.tc 中诊断码字面量从旧语义名迁移为新机器码（双标识归一化的配套步骤）。
// 映射来自 tools/diag_defs.json（legacy -> code）。
// 特例：T_TYPE_MISMATCH 按文件分区 ——
//   codegen_c.tc -> T-CDE-E910（codegen 期 type_info）
//   其余文件                    -> T-SEM-E202（语义期）
// base.tc 的 >>> GEN:diagnostics <<< 块内的 g_dlegacy 数据是映射表本身，禁止改动，故跳过。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFS = path.join(ROOT, 'tools', 'diag_defs.json');
const SRC_DIR = path.join(ROOT, 'src');

const raw = JSON.parse(fs.readFileSync(DEFS, 'utf8'));
const map = {};
for (const d of raw.defs) {
  if (d.legacy) map[d.legacy] = d.code;
}
// 特例：T_TYPE_MISMATCH 不在通用映射里走（避免误标 codegen 为 SEM）
delete map['T_TYPE_MISMATCH'];

const FILES = [
  'lex.tc', 'parse.tc', 'sema.tc', 'codegen_c.tc',
  'base.tc', 'test.tc', '../lib/repl.tc', 'tc.tc',
];
const CODEGEN_FILES = new Set(['codegen_c.tc']);

const MARKER_RE = /\/\/ >>> GEN:diagnostics[\s\S]*?\/\/ <<< GEN:diagnostics <<</m;

function replaceOutsideGen(src, file) {
  // 抽取 GEN 块，分两段处理（块外做替换，块内原样保留）
  const m = src.match(MARKER_RE);
  let outsideBefore = src, outsideAfter = '', genBlock = '';
  if (m) {
    const start = m.index;
    const end = start + m[0].length;
    outsideBefore = src.slice(0, start);
    genBlock = src.slice(start, end);
    outsideAfter = src.slice(end);
  }
  let count = 0;
  const doReplace = (text) => {
    for (const [leg, code] of Object.entries(map)) {
      const pat = new RegExp('"' + leg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
      text = text.replace(pat, '"' + code + '"');
    }
    // T_TYPE_MISMATCH 分区处理
    const ttmPat = /"T_TYPE_MISMATCH"/g;
    const ttmTarget = CODEGEN_FILES.has(file) ? '"T-CDE-E910"' : '"T-SEM-E202"';
    text = text.replace(ttmPat, ttmTarget);
    return text;
  };
  const nb = doReplace(outsideBefore);
  const na = doReplace(outsideAfter);
  count = (outsideBefore !== nb ? 1 : 0) + (outsideAfter !== na ? 1 : 0); // 近似计数标记
  return { text: nb + genBlock + na, changed: nb !== outsideBefore || na !== outsideAfter };
}

let total = 0;
for (const f of FILES) {
  const p = path.join(SRC_DIR, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const { text, changed } = replaceOutsideGen(src, f);
  if (changed) {
    fs.writeFileSync(p, text);
    // 统计实际替换次数（粗略：数 legacy 字面量出现）
    let n = 0;
    for (const leg of Object.keys(map)) {
      const re = new RegExp('"' + leg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
      const before = src.match(re) || [];
      n += before.length;
    }
    const ttm = (src.match(/"T_TYPE_MISMATCH"/g) || []).length;
    console.log(`  migrated ${f}: ${n} legacy + ${ttm} T_TYPE_MISMATCH -> machine codes`);
    total += n + ttm;
  } else {
    console.log(`  ${f}: no changes`);
  }
}
console.log(`migrate_diag_codes: total ${total} literal sites rewritten`);

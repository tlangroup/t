#!/usr/bin/env node
// gen_xid.mjs — 从 unicode-xid 的 tables.rs 提取 XID_Start / XID_Continue 范围表，
// 输出为 tracked 的 src/xid_ranges.json（派生数据入库，构建无需联网）。
//
// 输入：src/xid_tables.rs  （来自 https://raw.githubusercontent.com/unicode-rs/unicode-xid/master/src/tables.rs，已入库）
// 输出：src/xid_ranges.json   { xid_start: [[lo,hi], ...], xid_cont: [[lo,hi], ...] }  十进制码点
//
// 范围表已是合并且有序的 [start,end] 闭区间（unicode-xid 已处理），直接转十进制即可。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src', 'xid_tables.rs');
const OUT = path.join(__dirname, '..', 'src', 'xid_ranges.json');

if (!fs.existsSync(SRC)) {
  console.error('missing', SRC, '— 需要 src/xid_tables.rs（unicode-xid 的 tables.rs）');
  process.exit(1);
}

const text = fs.readFileSync(SRC, 'utf8');
const lines = text.split('\n');

const codeRe = /\\u\{([0-9a-fA-F]+)\}/g;

let cur = null;             // 当前表名: 'xid_cont' | 'xid_start'
const tables = { xid_cont: [], xid_start: [] };

for (const line of lines) {
  const m = line.match(/static\s+(XID_\w+)_table/);
  if (m) {
    cur = m[1] === 'XID_Continue' ? 'xid_cont' : 'xid_start';
    continue;
  }
  if (line.includes('];')) { cur = null; continue; }
  if (cur === null) continue;
  const codes = [];
  let mm;
  codeRe.lastIndex = 0;
  while ((mm = codeRe.exec(line)) !== null) {
    codes.push(parseInt(mm[1], 16));
  }
  for (let k = 0; k + 1 < codes.length; k += 2) {
    tables[cur].push([codes[k], codes[k + 1]]);
  }
}

const out = {
  _source: 'unicode-rs/unicode-xid tables.rs (XID_Start/XID_Continue, derived from Unicode UCD DerivedXIDStart/Continue)',
  xid_start: tables.xid_start,
  xid_cont: tables.xid_cont,
};

// 自检：范围必须有序、闭区间、不重叠（宽松校验）
function checkSorted(name, arr) {
  let prev = -1;
  for (const [lo, hi] of arr) {
    if (lo > hi) throw new Error(`${name}: lo>hi at [${lo},${hi}]`);
    if (lo <= prev) throw new Error(`${name}: unsorted/overlap at [${lo},${hi}] prev=${prev}`);
    prev = hi;
  }
}
checkSorted('xid_start', out.xid_start);
checkSorted('xid_cont', out.xid_cont);

// underscore (0x5F) 必须在两家表里（XID_Continue 含，XID_Start 不含；t 额外允许 _ 作起始）
const hasUnder = out.xid_cont.some(([lo, hi]) => lo <= 0x5f && 0x5f <= hi);
if (!hasUnder) throw new Error('xid_cont missing underscore U+005F');

fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
console.log(`wrote ${OUT}`);
console.log(`  xid_start ranges: ${out.xid_start.length}`);
console.log(`  xid_cont ranges: ${out.xid_cont.length}`);
console.log(`  ascii A-Z covered: ${out.xid_start.some(([lo, hi]) => lo <= 0x41 && 0x5a <= hi)}`);
console.log(`  ascii a-z covered: ${out.xid_start.some(([lo, hi]) => lo <= 0x61 && 0x7a <= hi)}`);
console.log(`  CJK 一 covered:    ${out.xid_start.some(([lo, hi]) => lo <= 0x4e00 && 0x4e00 <= hi)}`);

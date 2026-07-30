#!/usr/bin/env node
// tools/gen_ebnf.mjs
// 从 docs/reference.md 的 ```ebnf 代码块抽取文法 + 5 张机器可读数据表，
// 生成 build/ebnf.json（中间产物，不进 docs/，已被 .gitignore 忽略）。
//
// 数据表规则名（须在 reference.md 中出现）：
//   Keyword          -> 关键字字面量 -> token kind
//   BuiltinTable      -> 内建名 => 返回类型（多名字用 / 连接，生成 || 判别式）
//   DeriveTraitTable  -> @derive trait 名枚举
//   DiagnosticTable   -> 诊断码 -> 严重度
//   AnnotationTable   -> "@name" { spec, targets, repl }
//
// 其余 ebnf 块作为结构文法（rules）一并输出，供后续生成递归下降解析器使用。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(__dirname, '..', 'docs', 'reference.md');
const OUT = path.join(__dirname, '..', 'build', 'ebnf.json');

const md = fs.readFileSync(REF, 'utf8');

// 顶层分隔（尊重引号与 { } 括号，避免把字符串/记录内的分隔符误切）
function splitTop(s, sep) {
  const out = [];
  let depth = 0, q = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { q = !q; cur += c; continue; }
    if (q) { cur += c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// 去除 ebnf 行内注释，尊重引号，以免误删字面量中的 "//"（如 LineComment 的 "///" 记号）。
// ebnf 块内的注释统一只有两种形式（均不进入机器文法，由本函数剥离）：
//   - // 行注释
//   - /* */ 块注释
// 状态注记（⚠ spec-only / ✅ tote 等）一律写在上述注释内部，不单独成句。
function stripEbnfComments(s) {
  let out = '';
  let q = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') { q = !q; out += c; i++; continue; }
    if (!q && c === '/' && s[i + 1] === '/') break;                // // 行注释：丢弃本行剩余
    if (!q && c === '/' && s[i + 1] === '*') {                     // /* */ 块注释：跳到 */
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// 抽取所有 ebnf 块，解析为 { name, raw }
const rules = [];
const blockRe = /```ebnf\s*\n([\s\S]*?)```/g;
let bm;
while ((bm = blockRe.exec(md)) !== null) {
  const block = bm[1];
  const lines = block.split('\n');
  let cur = null;
  for (const line of lines) {
    const sline = stripEbnfComments(line);
    const h = sline.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    // 头行：行首（可缩进）是 标识符 + 冒号，且该冒号前不是引号内容
    if (h && !sline.trim().startsWith('"')) {
      cur = { name: h[1], raw: sline + '\n' };
      rules.push(cur);
    } else if (cur) {
      cur.raw += sline + '\n';
    }
  }
}

function stripHeader(r) {
  return r.raw.replace(/^\s*[A-Za-z_]\w*\s*:/, '');
}
function altsOf(r) {
  return splitTop(stripHeader(r), '|').map((x) => x.trim()).filter(Boolean);
}

function parseRecord(s) {
  const out = {};
  for (const p of splitTop(s, ',')) {
    const t = p.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const TABLE_RULES = ['Keyword', 'BuiltinTable', 'DeriveTraitTable', 'DiagnosticTable', 'AnnotationTable'];

const tables = { keywords: [], builtins: [], derives: [], diagnostics: [], annotations: [] };
const dispatches = {};

for (const r of rules) {
  if (r.name === 'Keyword') {
    for (const a of altsOf(r)) {
      const m = a.match(/^"([^"]*)"\s*->\s*(\w+)$/);
      if (m) tables.keywords.push({ text: m[1], kind: m[2] });
    }
  } else if (r.name === 'BuiltinTable') {
    for (const a of altsOf(r)) {
      const m = a.match(/^(.+?)\s*=>\s*(.+)$/);
      if (!m) continue;
      const names = splitTop(m[1], '/').map((x) => {
        const mm = x.trim().match(/^"([^"]*)"$/);
        return mm ? mm[1] : x.trim();
      });
      const ret = m[2].trim();
      const cond = names.map((n) => `name == "${n}"`).join(' || ');
      tables.builtins.push({ cond, ret });
    }
  } else if (r.name === 'DeriveTraitTable') {
    for (const a of altsOf(r)) {
      const m = a.match(/^"([^"]*)"$/);
      if (m) tables.derives.push(m[1]);
    }
  } else if (r.name === 'DiagnosticTable') {
    for (const a of altsOf(r)) {
      const m = a.match(/^"([^"]*)"\s*->\s*(\w+)$/);
      if (m) tables.diagnostics.push({ code: m[1], sev: m[2] });
    }
  } else if (r.name === 'AnnotationTable') {
    for (const a of altsOf(r)) {
      const m = a.match(/^"([^"]*)"\s*\{([\s\S]*)\}$/);
      if (m) {
        const rec = parseRecord(m[2]);
        tables.annotations.push({
          name: m[1],
          spec: rec.spec || '',
          targets: rec.targets || '',
          repl: rec.repl || '',
        });
      }
    }
  } else if (r.name.endsWith('Dispatch')) {
    const key = r.name.slice(0, -'Dispatch'.length);
    dispatches[key] = [];
    for (const a of altsOf(r)) {
      const idx = a.indexOf('=>');
      if (idx < 0) continue;
      const m = a.slice(0, idx).trim();
      const call = a.slice(idx + 2).trim();
      if (m === '_') {
        dispatches[key].push({ matchKind: 'default', call });
      } else if (m.startsWith('Id(')) {
        let v = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')'));
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        dispatches[key].push({ matchKind: 'idval', matchVal: v, call });
      } else {
        dispatches[key].push({ matchKind: 'token', matchVal: m, call });
      }
    }
  }
}

const structural = rules
  .filter((r) => !TABLE_RULES.includes(r.name) && !r.name.endsWith('Dispatch'))
  .map((r) => ({ name: r.name, alts: altsOf(r) }));

// 并入 XID_Start / XID_Continue 范围表（来自 src/xid_ranges.json，由 tools/gen_xid.mjs 生成）
const XID = path.join(__dirname, '..', 'src', 'xid_ranges.json');
let xid = { xid_start: [], xid_cont: [] };
try {
  xid = JSON.parse(fs.readFileSync(XID, 'utf8'));
} catch (e) {
  console.warn('gen_ebnf: 未找到 src/xid_ranges.json，请先运行 tools/gen_xid.mjs');
}

const out = { ...tables, rules: structural, dispatches, xid_start: xid.xid_start, xid_continue: xid.xid_cont };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// 诊断输出
const counts = {
  keywords: tables.keywords.length,
  builtins: tables.builtins.length,
  derives: tables.derives.length,
  diagnostics: tables.diagnostics.length,
  annotations: tables.annotations.length,
  rules: structural.length,
  dispatchTables: Object.keys(dispatches).length,
  xid_start: (xid.xid_start || []).length,
  xid_continue: (xid.xid_cont || []).length,
};
console.log('gen_ebnf: wrote', OUT);
console.log('gen_ebnf: table counts =', JSON.stringify(counts));
console.log('gen_ebnf: dispatches =', JSON.stringify(dispatches, null, 2));

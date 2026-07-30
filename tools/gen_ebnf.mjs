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
// rules 段结构（M19 起）：
//   { name, status, alts: [{ text, status?, note? }] }
//   status ∈ "tote"（已实现）| "partial"（部分）| "spec-only"（仅设计）| "unspecified"
//   规则级 status = 头行注记 > 最近章节标题注记 > "unspecified"；
//   alt 级 status 来自行内注释注记（⚠/✅），覆盖规则级。parser 生成器只应消费 tote/partial。

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

// 拆分 ebnf 行为「代码 + 注释」，尊重引号，以免误删字面量中的 "//"（如 LineComment 的 "///" 记号）。
// ebnf 块内的注释统一只有两种形式（不进入机器文法，但其中的状态注记会被结构化抽取）：
//   - // 行注释
//   - /* */ 块注释
// 状态注记（⚠ spec-only / ✅ tote 等）一律写在上述注释内部，不单独成句；
// 由 parseStatusText 归一化为 rules 段的结构化 status 字段。
function splitCodeComment(s) {
  let code = '';
  let comment = '';
  let q = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') { q = !q; code += c; i++; continue; }
    if (!q && c === '/' && s[i + 1] === '/') {                     // // 行注释：本行剩余归注释
      comment += ' ' + s.slice(i + 2);
      break;
    }
    if (!q && c === '/' && s[i + 1] === '*') {                     // /* */ 块注释：跳到 */
      i += 2;
      const st = i;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      comment += ' ' + s.slice(st, i);
      i += 2;
      continue;
    }
    code += c;
    i++;
  }
  return { code, comment: comment.trim() };
}

function stripEbnfComments(s) {
  return splitCodeComment(s).code;
}

// 状态注记归一化：
//   ✅ tote            -> "tote"       （已实现）
//   ✅ tote（部分）     -> "partial"    （部分实现）
//   ⚠ spec-only ...    -> "spec-only"  （仅 spec 设计目标）
// 返回 { status, note } 或 null（无注记）。note 保留原始注记文本供人类阅读。
function parseStatusText(s) {
  if (!s) return null;
  const hasWarn = s.includes('\u26a0');   // ⚠
  const hasOk = s.includes('\u2705');     // ✅
  if (!hasWarn && !hasOk) return null;
  let status;
  if (hasWarn) status = 'spec-only';
  else status = /部分|partial/.test(s) ? 'partial' : 'tote';
  const note = s.trim();
  return { status, note };
}

// 章节标题（##/###/####）中的状态注记：块内规则默认继承最近的上级章节状态。
const headings = [];
{
  const hre = /^#{2,4}\s+(.*)$/gm;
  let hm;
  while ((hm = hre.exec(md)) !== null) headings.push({ index: hm.index, st: parseStatusText(hm[1]) });
}
function sectionStatusAt(idx) {
  let best = null;
  for (const h of headings) {
    if (h.index < idx) best = h;
    else break;
  }
  return best ? best.st : null;
}

// 抽取所有 ebnf 块，解析为 { name, raw, sectionSt, lineSts }
// lineSts: [{ start, end, st }] — 每行代码在 raw 中的偏移区间与该行注释中的状态注记
const rules = [];
const blockRe = /```ebnf\s*\n([\s\S]*?)```/g;
let bm;
while ((bm = blockRe.exec(md)) !== null) {
  const block = bm[1];
  const secSt = sectionStatusAt(bm.index);
  const lines = block.split('\n');
  let cur = null;
  for (const line of lines) {
    const { code: sline, comment } = splitCodeComment(line);
    const lineSt = parseStatusText(comment);
    const h = sline.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    // 头行：行首（可缩进）是 标识符 + 冒号，且该冒号前不是引号内容
    if (h && !sline.trim().startsWith('"')) {
      cur = { name: h[1], raw: '', sectionSt: secSt, headSt: lineSt, lineSts: [] };
      cur.lineSts.push({ start: 0, end: sline.length + 1, st: lineSt });
      cur.raw = sline + '\n';
      rules.push(cur);
    } else if (cur) {
      cur.lineSts.push({ start: cur.raw.length, end: cur.raw.length + sline.length + 1, st: lineSt });
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

// 与 splitTop 同逻辑，但额外返回每段在输入中的 [start,end) 偏移，用于把 alt 映射回源行状态。
function splitTopWithPos(s, sep) {
  const out = [];
  let depth = 0, q = false, cur = '', curStart = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { q = !q; cur += c; continue; }
    if (q) { cur += c; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push({ text: cur, start: curStart, end: i });
      cur = '';
      i += sep.length - 1;
      curStart = i + 1;
      continue;
    }
    cur += c;
  }
  out.push({ text: cur, start: curStart, end: s.length });
  return out;
}

// 结构化 alt：{ text, status?, note? }。status 取该 alt 覆盖行中第一个带注记的行。
function structuredAlts(r) {
  const body = stripHeader(r);
  const headerOfs = r.raw.length - body.length; // body 在 raw 中的起始偏移
  const alts = [];
  for (const seg of splitTopWithPos(body, '|')) {
    const text = seg.text.trim();
    if (!text) continue;
    // 用非空白实际内容的区间做行匹配，避免段尾/段首空白蹭到相邻行的注记（off-by-one）
    const lead = seg.text.length - seg.text.trimStart().length;
    const trail = seg.text.length - seg.text.trimEnd().length;
    const rs = seg.start + headerOfs + lead;
    const re = seg.end + headerOfs - trail;
    let st = null;
    for (const ls of r.lineSts) {
      if (ls.st && ls.start < re && ls.end > rs) { st = ls.st; break; }
    }
    const alt = { text };
    if (st) { alt.status = st.status; alt.note = st.note; }
    alts.push(alt);
  }
  return alts;
}

// 规则级 status：头行注记 > 章节标题注记 > 缺省 "unspecified"
function ruleStatus(r) {
  const st = r.headSt || r.sectionSt;
  return st ? st.status : 'unspecified';
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

// 结构文法：每条 rule 带结构化 status（"tote" | "partial" | "spec-only" | "unspecified"），
// 每个 alt 可带自己的 status/note（来自行内注释注记，覆盖规则级）。
// alts 保持字符串数组向后兼容？——否：正式升级为对象数组 {text, status?, note?}，
// 当前 rules 段尚无消费方（totter 只读 5 张表 + dispatches + xid），是安全窗口。
const structural = rules
  .filter((r) => !TABLE_RULES.includes(r.name) && !r.name.endsWith('Dispatch'))
  .map((r) => ({ name: r.name, status: ruleStatus(r), alts: structuredAlts(r) }));

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
const statusCounts = {};
for (const r of structural) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
let altAnnotated = 0;
for (const r of structural) for (const a of r.alts) if (a.status) altAnnotated++;

console.log('gen_ebnf: wrote', OUT);
console.log('gen_ebnf: table counts =', JSON.stringify(counts));
console.log('gen_ebnf: rule status =', JSON.stringify(statusCounts), '| alt-level annotations =', altAnnotated);
console.log('gen_ebnf: dispatches =', JSON.stringify(dispatches, null, 2));

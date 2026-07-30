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
      cur = { name: h[1], raw: '', rawFull: '', sectionSt: secSt, headSt: lineSt, lineSts: [] };
      cur.lineSts.push({ start: 0, end: sline.length + 1, st: lineSt });
      cur.raw = sline + '\n';
      cur.rawFull = line + '\n';
      rules.push(cur);
    } else if (cur) {
      cur.lineSts.push({ start: cur.raw.length, end: cur.raw.length + sline.length + 1, st: lineSt });
      cur.raw += sline + '\n';
      cur.rawFull += line + '\n';
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

const TABLE_RULES = ['Keyword', 'BuiltinTable', 'DeriveTraitTable', 'DiagnosticTable', 'AnnotationTable', 'NodeTable'];

const tables = { keywords: [], builtins: [], derives: [], diagnostics: [], annotations: [], nodes: [] };
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
  } else if (r.name === 'NodeTable') {
    // 解析 `// @node <name> [slot=type ...]` 注释行（行内代码为空，全部在注释中，故读 rawFull）。
    for (const line of r.rawFull.split('\n')) {
      const { comment } = splitCodeComment(line);
      const m = comment.match(/^@node\s+([A-Za-z_]\w*)\s*(.*)$/);
      if (!m) continue;
      const name = m[1];
      const slots = [];
      const slotRe = /([A-Za-z_]\w*)=([A-Za-z_]\w*)/g;
      let sm;
      while ((sm = slotRe.exec(m[2])) !== null) slots.push({ slot: sm[1], type: sm[2] });
      tables.nodes.push({ name, slots });
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

// ───────────── Parser grammar（数据驱动生成，M19）─────────────
// 解析 reference.md 的 `// @rule` 文法块，把每条规则的 body 解析成结构化 EBNF 树，
// 并计算每个节点的 FIRST(token-kind) 集合，存入 ebnf.json 的 `grammar` 段。
// totter 读取该段，发射 `parse_<rule>` 递归下降函数（模仿手写 parser 风格）。

const PUNCT = {
  '{': 'LBrace', '}': 'RBrace', '(': 'LParen', ')': 'RParen', ';': 'Semicolon',
  ',': 'Comma', ':': 'Colon', '::': 'DoubleColon', '[': 'LBracket', ']': 'RBracket',
  '@': 'At', '#': 'Hash', '?': 'Question', '<': 'LAngle', '>': 'RAngle', '.': 'Dot',
  '*': 'Star', '&': 'Amp', '|': 'Pipe', '+': 'Plus', '-': 'Minus', '/': 'Slash',
  '%': 'Percent', '=': 'Assign', '->': 'Arrow', '<=': 'Le', '>=': 'Ge', '==': 'Eq',
  '!=': 'Ne', '!': 'Bang', '~': 'Tilde',
};
const _kwMap = {};
for (const k of tables.keywords) _kwMap[k.text] = k.kind;
// 表达式运算符字面量 → 真实 token kind（覆盖 PUNCT 的结构映射；结构文法不使用这些字符）
// 含二元塔运算符与一元前缀运算符（!/-/~）。
const OPKIND = {
  '||': 'Or', '&&': 'And', '|': 'BitOr', '^': 'BitXor', '&': 'BitAnd',
  '==': 'Eq', '!=': 'NotEq', '<': 'Lt', '>': 'Gt', '<=': 'LtEq', '>=': 'GtEq',
  '<<': 'ShiftLeft', '>>': 'ShiftRight', '+': 'Plus', '-': 'Minus', '*': 'Star',
  '/': 'Slash', '%': 'Percent', '!': 'Not', '~': 'BitNot',
};
function kindOfLit(v) {
  if (OPKIND[v]) return OPKIND[v];
  if (_kwMap[v]) return _kwMap[v];
  if (PUNCT[v]) return PUNCT[v];
  return '???';
}
// body 非终结符 → parse_* 调用名（未列出的默认 parse_<name>）
const NT_CALL = { type: 'parse_type', anns: 'parse_annotations', case: 'parse_case' };
// 外部非终结符的 FIRST（未生成的既有函数）
const EXT_FIRST = { anns: ['At'], type: [] };

function tokenizeBody(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"') {
      let j = i + 1, str = '';
      while (j < s.length && s[j] !== '"') { str += s[j]; j++; }
      toks.push({ t: 'lit', v: str }); i = j + 1; continue;
    }
    if (c === '(' || c === ')' || c === '|' || c === '?' || c === '*' || c === '+') {
      toks.push({ t: c }); i++; continue;
    }
    let j = i, str = '';
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) { str += s[j]; j++; }
    if (str) { toks.push({ t: 'id', v: str }); i = j; continue; }
    i++;
  }
  return toks;
}

function parseEbnf(toks) {
  let p = 0;
  const peek = () => toks[p];
  function parseAlt() {
    const kids = [parseSeq()];
    while (peek() && peek().t === '|') { p++; kids.push(parseSeq()); }
    return kids.length === 1 ? kids[0] : { k: 'alt', kids };
  }
  function parseSeq() {
    const kids = [];
    while (peek() && peek().t !== '|' && peek().t !== ')') kids.push(parsePost());
    return kids.length === 1 ? kids[0] : { k: 'seq', kids };
  }
  function parsePost() {
    let node = parsePrimary();
    while (peek() && (peek().t === '?' || peek().t === '*' || peek().t === '+')) {
      const op = peek().t; p++;
      node = { k: op === '?' ? 'opt' : op === '*' ? 'star' : 'plus', kid: node };
    }
    return node;
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) return { k: 'empty' };
    if (tk.t === '(') { p++; const node = parseAlt(); if (peek() && peek().t === ')') p++; return { k: 'group', kid: node }; }
    if (tk.t === 'lit') { p++; return { k: 'lit', v: tk.v }; }
    if (tk.t === 'id') {
      p++;
      if (tk.v === 'Ident') return { k: 'id' };
      if (tk.v === 'Integer') return { k: 'int' };
      if (tk.v === 'Float' || tk.v === 'String') return { k: 'tok', v: tk.v }; // 命名终端：token kind 直接引用
      return { k: 'nt', v: tk.v };
    }
    p++; return { k: 'empty' };
  }
  return parseAlt();
}

function computeGrammar(rules) {
  const ruleFirst = {};
  for (const r of rules) ruleFirst[r.name] = [];
  const ruleTree = {};
  for (const r of rules) ruleTree[r.name] = parseEbnf(tokenizeBody(r.body));

  function firstOf(node) {
    if (node._first) return node._first;
    const f = [];
    const set = (arr) => { for (const x of arr) if (!f.includes(x)) f.push(x); };
    switch (node.k) {
      case 'lit': node.kind = kindOfLit(node.v); set([node.kind]); break;
      case 'id': set(['Identifier']); break;
      case 'int': set(['Integer']); break;
      case 'tok': node.kind = node.v; set([node.v]); break;
      case 'nt': {
        const nm = node.v;
        node.call = NT_CALL[nm] || ('parse_' + nm);
        if (ruleFirst[nm] && ruleFirst[nm].length) set(ruleFirst[nm]);
        else if (EXT_FIRST[nm]) set(EXT_FIRST[nm]);
        break;
      }
      case 'group': case 'opt': case 'star': case 'plus': set(firstOf(node.kid)); break;
      case 'seq': {
        // 完整递归标注所有子节点（确保 call/kind/first 都被计算），返回值再按 nullable 截断
        for (const kid of node.kids) firstOf(kid);
        const f2 = [];
        const add = (a) => { for (const x of a) if (!f2.includes(x)) f2.push(x); };
        for (const kid of node.kids) {
          add(firstOf(kid));
          if (!nullable(kid)) break;
        }
        for (const x of f2) if (!f.includes(x)) f.push(x);
        break;
      }
      case 'alt': for (const kid of node.kids) set(firstOf(kid)); break;
      case 'empty': break;
    }
    node._first = f;
    return f;
  }
  function nullable(node) {
    if (node._null !== undefined) return node._null;
    let n = false;
    switch (node.k) {
      case 'lit': case 'id': case 'int': case 'tok': n = false; break;
      case 'nt': n = !!(ruleFirst[node.v] && ruleFirst[node.v].length === 0 && EXT_FIRST[node.v] && EXT_FIRST[node.v].length === 0); break;
      case 'opt': case 'star': n = true; break;
      case 'plus': n = false; break;
      case 'group': n = nullable(node.kid); break;
      case 'seq': n = node.kids.every(nullable); break;
      case 'alt': n = node.kids.some(nullable); break;
      case 'empty': n = true; break;
    }
    node._null = n;
    return n;
  }

  let changed = true, it = 0;
  while (changed && it < 30) {
    changed = false; it++;
    for (const r of rules) {
      const f = firstOf(ruleTree[r.name]);
      if (JSON.stringify(f) !== JSON.stringify(ruleFirst[r.name])) { ruleFirst[r.name] = f; changed = true; }
    }
  }
  // 定点收敛后，用最终 ruleFirst 重算所有节点的 first（清除早期缓存的陈旧值）
  function clearCache(node) {
    if (!node) return;
    node._first = undefined;
    if (node.kids) node.kids.forEach(clearCache);
    if (node.kid) clearCache(node.kid);
  }
  for (const r of rules) clearCache(ruleTree[r.name]);
  for (const r of rules) firstOf(ruleTree[r.name]);
  for (const r of rules) r.tree = serialize(ruleTree[r.name]);
  return rules;
}

function serialize(node) {
  if (!node) return node;
  const o = { k: node.k };
  if (node.v !== undefined) o.v = node.v;
  if (node.kind !== undefined) o.kind = node.kind;
  if (node.call !== undefined) o.call = node.call;
  if (node._first) o.first = node._first;
  if (node.kids) o.kids = node.kids.map(serialize);
  if (node.kid) o.kid = serialize(node.kid);
  return o;
}

function parseParserGrammar(md) {
  const out = [];
  const re = /\/\/\s*@rule\s+(\w+)\s+params=\(([^)]*)\)\s+ret=(\w+)\s+node=(\w+)\s+eatFirst=(\w+)(?:\s+fold=(\w+))?/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const name = m[1], params = m[2].trim(), ret = m[3], node = m[4], eatFirst = m[5] === 'true';
    const after = md.slice(m.index);
    const brm = after.match(new RegExp('^[\\t ]*' + name + '[\\t ]*::[\\t ]*(.*)$', 'm'));
    const body = brm ? brm[1].trim() : '';
    let construct = [];
    if (brm) {
      const rest = md.slice(m.index + brm.index + brm[0].length);
      const cb = rest.match(/\{([\s\S]*?)\}/);
      if (cb) for (const line of cb[1].split('\n')) {
        const t = line.trim(); if (!t) continue;
        const eq = t.indexOf('='); if (eq < 0) continue;
        construct.push({ field: t.slice(0, eq).trim(), expr: t.slice(eq + 1).trim() });
      }
    }
    out.push({ name, params, ret, node, eatFirst, fold: m[6] || '', body, construct });
  }
  return out;
}

let grammar = parseParserGrammar(md);
if (grammar.length) grammar = computeGrammar(grammar);

const out = { ...tables, rules: structural, dispatches, grammar, xid_start: xid.xid_start, xid_continue: xid.xid_cont };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// 诊断输出
const counts = {
  keywords: tables.keywords.length,
  builtins: tables.builtins.length,
  derives: tables.derives.length,
  diagnostics: tables.diagnostics.length,
  annotations: tables.annotations.length,
  nodes: tables.nodes.length,
  rules: structural.length,
  grammar: grammar.length,
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
if (grammar.length) {
  for (const r of grammar) {
    console.log('  grammar', r.name, '| params=(' + r.params + ') node=' + r.node + ' eatFirst=' + r.eatFirst + ' | tree=', JSON.stringify(r.tree));
  }
}
console.log('gen_ebnf: rule status =', JSON.stringify(statusCounts), '| alt-level annotations =', altAnnotated);
console.log('gen_ebnf: dispatches =', JSON.stringify(dispatches, null, 2));

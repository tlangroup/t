// 校验字符串拼接的实参个数：
//   * sb_catN(...) —— 编译器内部拼接 helper（基于 StringBuilder 实现），实参个数须严格 = N。
//   * catN(...)    —— 已移除的语言内建；编译器源码中不应再出现，出现即报错。
//
// 注意：调用可能跨行书写，故整源扫描而非逐行匹配（逐行版会因括号未闭合而静默漏检，
// 曾导致 5 实参的 sb_cat6 混入发射器，读到栈上垃圾产出脏 IR / 撑爆 arena）。
import fs from 'node:fs';

const file = process.argv[2] || 'src/tc.tc';
const src = fs.readFileSync(file, 'utf8');
let bad = 0;

// 去掉行注释（保留字符串内的 `//` 与换行，维持行号不变）
function stripLineComments(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += s[++i] ?? ''; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

// 统计实参个数：从 '(' 起配对括号，记录 depth==1 的逗号数（+1）。跨行有效。
function countArgs(s, openIdx) {
  let depth = 0, args = 1, j = openIdx;
  let closed = false;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === '"') {
      j++;
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; j++; }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { closed = true; break; } }
    else if (ch === ',' && depth === 1) args++;
  }
  return { args, closed };
}

const clean = stripLineComments(src);
const lineOf = (idx) => clean.slice(0, idx).split('\n').length;
const snippet = (idx) => {
  const end = clean.indexOf('\n', idx);
  return clean.slice(idx, end < 0 ? clean.length : end).trim().slice(0, 110);
};

const checks = [
  { re: /\bsb_cat([2-9])\(/g, kind: 'internal' }, // 内部 helper，须严格 = N
  { re: /\bcat([2-9])\(/g,    kind: 'removed' },  // 已移除内建，出现即错
];

for (const c of checks) {
  const re = new RegExp(c.re.source, 'g');
  let m;
  while ((m = re.exec(clean)) !== null) {
    const want = Number(m[1]);
    const ln = lineOf(m.index);
    if (c.kind === 'removed') {
      bad++;
      console.log(`L${ln}: cat${want} 已被移除（应改用 StringBuilder）；${snippet(m.index)}`);
      continue;
    }
    const { args, closed } = countArgs(clean, m.index + m[0].length - 1);
    if (!closed) {
      bad++;
      console.log(`L${ln}: sb_cat${want} 括号未闭合，无法核对实参 -> ${snippet(m.index)}`);
      continue;
    }
    if (args !== want) {
      bad++;
      console.log(`L${ln}: sb_cat${want} 收到 ${args} 个实参 -> ${snippet(m.index)}`);
    }
  }
}
console.log(bad === 0 ? 'OK: sb_catN 实参个数全部匹配，且无残留 catN' : `发现 ${bad} 处问题`);

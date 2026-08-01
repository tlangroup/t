// 校验字符串拼接的实参个数：
//   * sb_catN(...) —— 编译器内部拼接 helper（基于 StringBuilder 实现），实参个数须严格 = N。
//   * catN(...)    —— 已移除的语言内建；编译器源码中不应再出现，出现即报错。
import fs from 'node:fs';

const file = process.argv[2] || 'src/tc.tc';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let bad = 0;

// 统计实参个数：从 '(' 起配对括号，记录 depth==1 的逗号数（+1）。
function countArgs(l, openIdx) {
  let depth = 0, args = 1, j = openIdx;
  let closed = false;
  for (; j < l.length; j++) {
    const ch = l[j];
    if (ch === '"') {
      j++;
      while (j < l.length && l[j] !== '"') { if (l[j] === '\\') j++; j++; }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { closed = true; break; } }
    else if (ch === ',' && depth === 1) args++;
  }
  return { args, closed };
}

const checks = [
  { re: /\bsb_cat([2-9])\(/g, kind: 'internal' }, // 内部 helper，须严格 = N
  { re: /\bcat([2-9])\(/g,    kind: 'removed' },   // 已移除内建，出现即错
];

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  for (const c of checks) {
    const re = new RegExp(c.re.source, 'g');
    let m;
    while ((m = re.exec(l)) !== null) {
      const want = Number(m[1]);
      if (c.kind === 'removed') {
        bad++;
        console.log(`L${i + 1}: cat${want} 已被移除（应改用 StringBuilder）；${l.trim().slice(0, 110)}`);
        continue;
      }
      const { args, closed } = countArgs(l, m.index + m[0].length - 1);
      if (closed && args !== want) {
        bad++;
        console.log(`L${i + 1}: sb_cat${want} 收到 ${args} 个实参 -> ${l.trim().slice(0, 110)}`);
      }
    }
  }
}
console.log(bad === 0 ? 'OK: sb_catN 实参个数全部匹配，且无残留 catN' : `发现 ${bad} 处问题`);

// 校验 catN(...) 的实参个数严格等于 N。
// 背景：t 的 catN 是定参内建，多写/少写实参在某些路径下不会立刻报错，
// 而是发射出残缺字符串（M29 踩坑：cat6 只给 4 个实参）。
import fs from 'node:fs';

const file = process.argv[2] || 'src/tote.tc';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
let bad = 0;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const re = /\bcat([2-9])\(/g;
  let m;
  while ((m = re.exec(l)) !== null) {
    const want = Number(m[1]);
    let j = m.index + m[0].length - 1; // 指向 '('
    let depth = 0, args = 1, closed = false;
    for (; j < l.length; j++) {
      const ch = l[j];
      if (ch === '"') {                      // 跳过字符串字面量
        j++;
        while (j < l.length && l[j] !== '"') { if (l[j] === '\\') j++; j++; }
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { closed = true; break; } }
      else if (ch === ',' && depth === 1) args++;
    }
    if (closed && args !== want) {
      bad++;
      console.log(`L${i + 1}: cat${want} 收到 ${args} 个实参 -> ${l.trim().slice(0, 110)}`);
    }
  }
}
console.log(bad === 0 ? 'OK: catN 实参个数全部匹配' : `发现 ${bad} 处不匹配`);

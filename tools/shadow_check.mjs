// 扫描同一顶层函数内「同名局部变量声明为不同类型」的隐患。
// 背景：LLVM 后端的 fs 表按 (fn, var) 扁平记录且 fs_get 从后往前取，
// 同名不同型会让先声明处误判聚合性，导致漏 load / 错误取址（M29 踩坑）。
import fs from 'node:fs';

const file = process.argv[2] || 'src/tote.tc';
const only = process.argv.slice(3);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

const fnStart = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*::\s*func/;
const varDecl = /^\s*var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^=;]+?)\s*(?:=|;)/;

let cur = null;
const fns = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = fnStart.exec(lines[i]);
  if (m) { cur = m[1]; if (!fns.has(cur)) fns.set(cur, []); continue; }
  if (!cur) continue;
  const v = varDecl.exec(lines[i]);
  if (v) fns.get(cur).push({ name: v[1], ty: v[2].trim(), line: i + 1 });
}

let bad = 0;
for (const [fn, vars] of fns) {
  if (only.length && !only.includes(fn)) continue;
  const byName = new Map();
  for (const v of vars) {
    if (!byName.has(v.name)) byName.set(v.name, []);
    byName.get(v.name).push(v);
  }
  for (const [name, list] of byName) {
    const tys = [...new Set(list.map(x => x.ty))];
    if (tys.length > 1) {
      bad++;
      console.log(`${fn}: 变量 ${name} 有 ${tys.length} 种类型`);
      for (const x of list) console.log(`    L${x.line}  ${x.ty}`);
    }
  }
}
console.log(bad === 0 ? 'OK: 无同名不同型局部变量' : `发现 ${bad} 处隐患`);

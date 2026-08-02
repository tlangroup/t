// 扫描同一顶层函数内「同名局部变量声明为不同类型」的隐患。
// 背景：LLVM 后端的 fs 表按 (fn, var) 扁平记录且 fs_get 从后往前取，
// 同名不同型会让先声明处误判聚合性，导致漏 load / 错误取址（M29 踩坑）。
import fs from 'node:fs';

const file = process.argv[2] || 'src/tc.tc';
const only = process.argv.slice(3);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

// ── 防假绿：最小匹配数断言 ───────────────────────────────────────
// 本工具靠正则识别语法结构。一旦语法变更（如函数头写法改动）导致正则失配，
// 扫描样本会骤降甚至归零，于是"零样本 → 零隐患 → 打印 OK" —— 假绿。
// 故对样本量设下限；语法变更后若合法地低于阈值，请连同正则一起更新阈值。
// 阈值 ≈ 记录时实际值的 70%（2026-08-02: 474 函数 / 2683 var）。
const MIN_FNS = 330;
const MIN_VARS = 1880;

// 顶层函数头：并置式 `Name fn(` （`::`/`func` 已于 2026-08-01 移除）
const fnStart = /^(?:comptime\s+)?([\p{XID_Start}_][\p{XID_Continue}_]*)\s+fn\s*\(/u;
const varDecl = /^\s*var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^=;]+?)\s*(?:=|;)/;

let cur = null;
let nVars = 0;
const fns = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = fnStart.exec(lines[i]);
  if (m) { cur = m[1]; if (!fns.has(cur)) fns.set(cur, []); continue; }
  if (!cur) continue;
  const v = varDecl.exec(lines[i]);
  if (v) { fns.get(cur).push({ name: v[1], ty: v[2].trim(), line: i + 1 }); nVars++; }
}

// 只在扫描编译器主源文件（src/tc.tc）且未按函数过滤时校验样本量，
// 免得扫小文件时误报。
if (only.length === 0 && file.endsWith('tc.tc')) {
  const lo = [];
  if (fns.size < MIN_FNS) lo.push(`顶层函数 ${fns.size} < ${MIN_FNS}`);
  if (nVars < MIN_VARS) lo.push(`var 声明 ${nVars} < ${MIN_VARS}`);
  if (lo.length > 0) {
    console.error(`shadow_check: 正则失配嫌疑 —— ${lo.join('，')}`);
    console.error(`  ${file} 共 ${lines.length} 行，扫到的样本远少于预期。`);
    console.error('  多半是语法变更让正则不再匹配；请更新 fnStart/varDecl 与阈值常量。');
    process.exit(2);
  }
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
if (bad === 0) {
  console.log(`OK: 无同名不同型局部变量（扫描 ${fns.size} 个函数 / ${nVars} 处 var 声明）`);
  process.exit(0);
}
console.log(`发现 ${bad} 处隐患（扫描 ${fns.size} 个函数 / ${nVars} 处 var 声明）`);
process.exit(1);

// 扫描同一顶层函数内「同名局部变量声明为不同类型」的隐患。
// 背景：LLVM 后端的 fs 表按 (fn, var) 扁平记录且 fs_get 从后往前取，
// 同名不同型会让先声明处误判聚合性，导致漏 load / 错误取址（M29 踩坑）。
import fs from 'node:fs';
import { resolveSources, isFullCompiler } from './tc_sources.mjs';

// 编译器源码已按编译步骤拆分为多模块；不带参数（或指向入口 src/tc.tc）时扫描全部模块。
const files = resolveSources(process.argv[2]);
const only = process.argv.slice(3);

// ── 防假绿：最小匹配数断言 ───────────────────────────────────────
// 本工具靠正则识别语法结构。一旦语法变更（如函数头写法改动）导致正则失配，
// 扫描样本会骤降甚至归零，于是"零样本 → 零隐患 → 打印 OK" —— 假绿。
// 故对样本量设下限；语法变更后若合法地低于阈值，请连同正则一起更新阈值。
// 阈值 ≈ 记录时实际值的 70%（2026-08-02: 474 函数 / 2683 var）。
const MIN_FNS = 330;
const MIN_VARS = 1880;

// 顶层函数头：关键字领头 `fn name(` 与并置式 `name fn(` 两种文法（Stage 2 统一为前者）。
// 前缀修饰符 export / comptime / meta / pub 可出现在名字之前（两种文法都允许）。
// pub 为 2026-08-30 模块可见性重设计新增的声明前缀（取代 export 的可见性语义）。
// 旧文法名字在 group1，新文法名字在 group2。
const fnStart = /^(?:(?:export|comptime|meta|pub)\s+)*(?:(?:([\p{XID_Start}_][\p{XID_Continue}_]*)\s+fn)|fn\s+([\p{XID_Start}_][\p{XID_Continue}_]*))\s*\(/u;
const varDecl = /^\s*(?:(?:pub|export)\s+)?var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^=;]+?)\s*(?:=|;)/;

let nVars = 0;
let nLines = 0;
const fns = new Map();
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  nLines += lines.length;
  // 作用域按「文件 + 函数名」区分：拆分后不同模块可有同名 static 风格 helper，
  // 且报错需带文件名才能定位。
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = fnStart.exec(lines[i]);
    if (m) { cur = `${file}:${m[1] || m[2]}`; if (!fns.has(cur)) fns.set(cur, []); continue; }
    if (!cur) continue;
    const v = varDecl.exec(lines[i]);
    if (v) { fns.get(cur).push({ name: v[1], ty: v[2].trim(), line: i + 1 }); nVars++; }
  }
}

// 只在扫描完整编译器源码集且未按函数过滤时校验样本量，免得扫小文件时误报。
if (only.length === 0 && isFullCompiler(files)) {
  const lo = [];
  if (fns.size < MIN_FNS) lo.push(`顶层函数 ${fns.size} < ${MIN_FNS}`);
  if (nVars < MIN_VARS) lo.push(`var 声明 ${nVars} < ${MIN_VARS}`);
  if (lo.length > 0) {
    console.error(`shadow_check: 正则失配嫌疑 —— ${lo.join('，')}`);
    console.error(`  编译器源码集共 ${files.length} 个文件 / ${nLines} 行，扫到的样本远少于预期。`);
    console.error('  多半是语法变更让正则不再匹配；请更新 fnStart/varDecl 与阈值常量。');
    process.exit(2);
  }
}

let bad = 0;
for (const [fn, vars] of fns) {
  // fn 形如 `src/tc_sema.tc:check_expr`；--only 过滤按裸函数名匹配。
  if (only.length && !only.includes(fn.slice(fn.lastIndexOf(':') + 1))) continue;
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

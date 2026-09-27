// 校验编译器多模块拆分的 import DAG：靠前的模块不得引用靠后模块的顶层符号。
//
// 背景（2026-08-08 拆分单体 src/tc.tc 时踩的坑）：
//   * 语言禁止循环 import（T_IMPORT_CYCLE），模块图必须是 DAG。
//   * 跨模块调用要类型正确，**调用方必须 import 被调方**：否则 sema 找不到被调
//     函数签名，会把返回类型错判（如 bool 当成 i64）。症状是链接期 undefined
//     符号或 clang 报 IR 类型不匹配 —— 都远离真正的病灶，极难排查。
//   * 未定义的**变量**是硬错误，未定义的**函数**只降级为 `; UNSUPPORTED call`
//     警告并静默产出坏 IR。故不能只靠编译器报错兜底，需要本工具主动扫。
//
// 判据：对每个顶层符号，若存在「定义模块下标 > 引用模块下标」的引用，即为反向引用。
// 修法：把该符号搬到最早引用它的模块（tmp/fixdag.py 可自动迭代到不动点）。
import fs from 'node:fs';
import { TC_MODULES } from './tc_sources.mjs';

const IDX = new Map(TC_MODULES.map((m, i) => [m, i]));

// 把字符串字面量与注释抹成等长空白，保持行号与偏移不变。
function blank(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const q = c;
      out += ' '; i++;
      while (i < text.length) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        if (text[i] === q) { out += ' '; i++; break; }
        out += text[i] === '\n' ? '\n' : ' '; i++;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const DECLS = [
  ['fn',      /^(?:(?:export|comptime|meta|pub)\s+)*(?:(?:([A-Za-z_][A-Za-z_0-9]*)\s+fn)|fn\s+([A-Za-z_][A-Za-z_0-9]*))\b/],
  ['var',     /^(?:(?:pub|export)\s+)?var\s+([A-Za-z_][A-Za-z_0-9]*)\s*[:=]/],
  ['const',   /^(?:(?:pub|export)\s+)?const\s+([A-Za-z_][A-Za-z_0-9]*)\s*[:=]/],
  ['type',    /^(?:(?:pub|export)\s+)?(?:struct|enum|flag|variant|union)\s+([A-Za-z_][A-Za-z_0-9]*)\b/],
];

const cleaned = new Map();
for (const m of TC_MODULES) cleaned.set(m, blank(fs.readFileSync(m, 'utf8')).split('\n'));

// ① 收集顶层声明
const defs = new Map();   // name -> { mod, kind, line }
const dups = [];
for (const m of TC_MODULES) {
  const lines = cleaned.get(m);
  for (let i = 0; i < lines.length; i++) {
    for (const [kind, re] of DECLS) {
      const mo = re.exec(lines[i]);
      if (!mo) continue;
      const nm = mo[1] || mo[2];
      // 模块值别名 `const X = @import("src.X")` 是**导入**，不是本模块的符号定义：
      // 其实际符号定义在被导入模块内，且名称会与被导入模块里的局部变量（如 `var base`）
      // 撞名，被朴素的标识符扫描误判为「反向引用」。故从 defs 排除，与旧的 `:: *` /
      // `:: sel` 导入形态保持一致（旧形态下模块句柄名不进入顶层 defs）。
      if (kind === 'const' && /@import/.test(lines[i])) break;
      if (defs.has(nm)) dups.push([nm, defs.get(nm).mod, m]);
      else defs.set(nm, { mod: m, kind, line: i + 1 });
      break;
    }
  }
}

// ② 收集引用
const refs = new Map();   // name -> Map<mod, firstLine>
const IDENT = /[A-Za-z_][A-Za-z_0-9]*/g;
for (const m of TC_MODULES) {
  const lines = cleaned.get(m);
  for (let i = 0; i < lines.length; i++) {
    let mo;
    IDENT.lastIndex = 0;
    while ((mo = IDENT.exec(lines[i])) !== null) {
      const nm = mo[0];
      if (!defs.has(nm)) continue;
      if (!refs.has(nm)) refs.set(nm, new Map());
      const r = refs.get(nm);
      if (!r.has(m)) r.set(m, i + 1);
    }
  }
}

// ③ 找反向引用
const bad = [];
for (const [nm, d] of defs) {
  const r = refs.get(nm);
  if (!r) continue;
  let earliest = null;
  for (const u of r.keys()) {
    if (u === d.mod) continue;
    if (earliest === null || IDX.get(u) < IDX.get(earliest)) earliest = u;
  }
  if (earliest !== null && IDX.get(earliest) < IDX.get(d.mod)) {
    bad.push({ nm, ...d, target: earliest, useLine: r.get(earliest) });
  }
}

// ── 防假绿：符号量下限（正则失配会让样本归零而打印 OK）─────────────
const MIN_SYMS = 590;   // ≈ 记录时 848 的 70%（2026-08-08）
if (defs.size < MIN_SYMS) {
  console.error(`dagcheck: 正则失配嫌疑 —— 只扫到 ${defs.size} 个顶层符号，预期 >= ${MIN_SYMS}`);
  console.error('  多半是声明语法变更；请更新 DECLS 正则与阈值常量。');
  process.exit(2);
}

if (dups.length) {
  console.log(`发现 ${dups.length} 处重名顶层符号：`);
  for (const [nm, a, b] of dups) console.log(`  ${nm}: ${a} 与 ${b}`);
}

if (bad.length === 0 && dups.length === 0) {
  console.log(`OK: 模块 DAG 无反向引用（${TC_MODULES.length} 个模块 / ${defs.size} 个顶层符号）`);
  process.exit(0);
}

bad.sort((x, y) => (IDX.get(x.mod) - IDX.get(y.mod)) || x.nm.localeCompare(y.nm));
console.log(`发现 ${bad.length} 处反向引用（定义在后、却被更早的模块引用）：`);
for (const b of bad) {
  console.log(`  [${b.kind}] ${b.nm}  定义于 ${b.mod}:${b.line}  但 ${b.target}:${b.useLine} 已引用`);
  console.log(`        → 应把 ${b.nm} 搬到 ${b.target}`);
}
process.exit(1);

#!/usr/bin/env node
// Phase C 多进程 bootstrap 编排（§5.3）：
//   逐模块 build --lib 出 .tint 同目录的 .tlib（仅本模块图 + 极小接口 + 本模块 codegen），
//   末步 build 入口 src/tc.tc（T_TINT_DIR=out/mod）把全部 .tlib 链接成 tc.exe，
//   使单进程 build 峰值从 ~5.63GiB 降到每子进程 ~1.5GiB。
//
// 依赖图约束（关键）：
//   * 外部库（repl / std.rc.cst / std.mem / std.math）被多个内部模块 + 入口直接/间接导入；
//     必须【最先】预编译为 .tlib，否则内部模块在构建时会把外部库【内联】进自己的 .tlib，
//     最终入口链接时与外部库 .tlib 形成菱形重复符号 → 链接失败。故顺序 = 外部库 → 内部模块 → 入口。
//   * 内部模块间存在 src. 依赖，必须按拓扑序构建：被依赖模块先出 .tlib，
//     依赖方才能以「链接模式」extern 之（emit declare + 链接 .tlib）而不内联。
//
// 每模块 --lib 时设 g_lib_mod_idn = 完整 idn（如 src.base / std.rc.cst）、
// lib_alias = idn 末段（base / cst），与入口 import 重整 + 模块值自引用一致；
// per-module ginit 符号 = t_ginit_<idn>（如 t_ginit_src_base），入口 main 包装器声明 + 调用之。
//
// 用法：node tools/bootstrap_tc.mjs [--tc <编译器>] [--out <产物名>] [--skip-tint]
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import { join, dirname } from 'path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const TC = arg('--tc', join(ROOT, 'out/dbg/tc_phc.exe'));
const OUT_EXE = arg('--out', join(ROOT, 'out/dbg/tc_phc2.exe'));
const TINT_DIR = join(ROOT, 'out/mod');
const OUT_LIB = join(ROOT, 'out/lib');
const ENTRY = 'src/tc.tc';
const SKIP_TINT = args.includes('--skip-tint');

// 异步拉起 tc（与 build_std.mjs 一致，避免 Windows opp-lock EBUSY 误报）
function runTC(tcArgs, env) {
  return new Promise((resolve) => {
    const p = spawn(TC, tcArgs, { cwd: ROOT, windowsHide: true, env: { ...process.env, ...(env || {}) } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => { console.error(String(e)); resolve(false); });
    p.on('exit', (code) => {
      if (code !== 0) {
        // 打印诊断中的 error 行，便于定位
        const lines = out.split('\n').filter((l) => l.includes('"severity": "error"'));
        if (lines.length) console.error(lines.slice(0, 8).join('\n'));
      }
      resolve(code === 0);
    });
  });
}

// 1. 收集内部 src 模块（排除入口 tc 与 POC 测试 poclib）
const srcMods = readdirSync(join(ROOT, 'src'))
  .filter((f) => f.endsWith('.tc'))
  .map((f) => f.slice(0, -3))
  .filter((m) => m !== 'tc' && m !== 'poclib');

// 提取文件依赖的 src. 模块（stem）
const importRe = /@?import\(\s*"src\.([\w.]+)"/g;
function depsOf(file) {
  const src = readFileSync(file, 'utf8');
  const deps = new Set();
  let m;
  while ((m = importRe.exec(src))) deps.add(m[1]);
  return [...deps].filter((d) => srcMods.includes(d));
}

// 拓扑排序（Kahn）
function topoSort(names) {
  const indeg = {};
  names.forEach((n) => (indeg[n] = 0));
  const adj = {};
  names.forEach((n) => {
    adj[n] = depsOf(join(ROOT, 'src', n + '.tc'));
    adj[n].forEach((d) => (indeg[d]++));
  });
  const q = names.filter((n) => indeg[n] === 0);
  const out = [];
  while (q.length) {
    const n = q.shift();
    out.push(n);
    adj[n].forEach((d) => {
      indeg[d]--;
      if (indeg[d] === 0) q.push(d);
    });
  }
  if (out.length !== names.length) throw new Error('cycle or missing module among: ' + names.join(','));
  return out;
}

async function main() {
  console.log(`[bootstrap_tc] TC=${TC}\n  OUT_EXE=${OUT_EXE}\n  TINT_DIR=${TINT_DIR}`);

  // 2. 生成全部 .tint（接口文件）；落点须与 resolver 对齐：
  //    resolver 对 src.base 取 rel = dots_to_slashes = "src/base"，故 .tint 必须位于
  //    <TINT_DIR>/src/<m>.tint（与内部模块 .tlib 同级嵌套），否则入口链接时找不到接口。
  if (!SKIP_TINT) {
    console.log('\n=== generate .tint (nested out/mod/src/<m>.tint) ===');
    for (const m of srcMods) {
      const tint = join(TINT_DIR, 'src', m + '.tint');
      mkdirSync(dirname(tint), { recursive: true });
      try {
        execFileSync('python3', ['tools/gen_tint.py', `src/${m}.tc`, tint], { cwd: ROOT, stdio: 'pipe' });
        console.log(`  src.${m}.tint OK`);
      } catch (e) {
        console.error(`  src.${m}.tint FAIL`, String(e).slice(-300));
        process.exit(1);
      }
    }
  }

  // 3. 外部库预编译（必须最先：否则内部模块会把它们内联进自身 .tlib）
  //    mem / math 走既有 build_std 路径（out/lib/std/{mem,math}.tlib）；
  //    rc.cst / repl 依赖本编译器 Phase C 的 per-module ginit 分裂（旧版 §4.14.7 跳过 t.__ginit 会丢全局初值）。
  console.log('\n=== build external .tlib (first) ===');
  const extLibs = [
    { idn: 'std.mem', src: 'lib/std/mem.tc', out: 'out/lib/std/mem' },
    { idn: 'std.math', src: 'lib/std/math.tc', out: 'out/lib/std/math' },
    { idn: 'std.rc.cst', src: 'lib/std/rc/cst.tc', out: 'out/lib/std/rc/cst' },
  ];
  for (const e of extLibs) {
    const outp = join(ROOT, e.out);
    mkdirSync(dirname(outp), { recursive: true });
    const ok = await runTC(['build', '--lib', '--mod-id', e.idn, join(ROOT, e.src), '--output', outp]);
    console.log(`  ${e.idn}: ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) { console.error('[bootstrap_tc] 外部库失败，中止'); process.exit(1); }
  }

  // 4. 拓扑序逐模块 build --lib → .tlib（T_TINT_DIR 使依赖走接口文件 + 链接 .tlib，不内联）
  const order = topoSort(srcMods);
  console.log('\n=== topo order ===\n' + order.join(' '));
  console.log('\n=== build internal .tlib ===');
  for (const m of order) {
    const outp = join(TINT_DIR, 'src', m); // out/mod/src/<m>.tlib（与 resolver rel="src/<m>" 对齐）
    const ok = await runTC(
      ['build', '--lib', '--mod-id', `src.${m}`, join(ROOT, 'src', `${m}.tc`), '--output', outp],
      { T_TINT_DIR: TINT_DIR }
    );
    console.log(`  src.${m}: ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) { console.error(`[bootstrap_tc] 内部模块 src.${m} 失败，中止`); process.exit(1); }
  }

  // 4.5. repl 特殊处理：repl 是 lib/ 下的外部库，但它依赖内部 src.base/lex/parse/sema，
  //     故必须【在内部模块之后】构建；repl 仅被入口 src/tc.tc 导入，不破坏拓扑。
  //     其 .tlib 落在 out/lib/repl.tlib（在 g_lib_dirs 内），入口经 library resolve 链接。
  console.log('\n=== build repl.tlib (after internal modules) ===');
  {
    const e = { idn: 'repl', src: 'lib/repl.tc', out: 'out/lib/repl' };
    const outp = join(ROOT, e.out);
    mkdirSync(dirname(outp), { recursive: true });
    const ok = await runTC(
      ['build', '--lib', '--mod-id', e.idn, join(ROOT, e.src), '--output', outp],
      { T_TINT_DIR: TINT_DIR }
    );
    console.log(`  ${e.idn}: ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) { console.error('[bootstrap_tc] repl 失败，中止'); process.exit(1); }
  }

  // 5. 入口链接：T_TINT_DIR=out/mod 使 imports 走接口文件 + .tlib，单进程仅建入口图 + 本模块 codegen。
  console.log('\n=== build entry tc.exe ===');
  const ok = await runTC(['build', ENTRY, '--output', OUT_EXE], { T_TINT_DIR: TINT_DIR });
  if (!ok) { console.error('[bootstrap_tc] 入口失败，中止'); process.exit(1); }
  console.log(`\n[bootstrap_tc] 完成 ✅ → ${OUT_EXE}`);
  process.exit(0);
}
main();

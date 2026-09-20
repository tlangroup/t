#!/usr/bin/env node
// _diffpipe.mjs — 双轨对拍（v3 S-1 安全机制）
//
// 对同一份 examples/<name>.tc，分别走「旧轨」与「新轨」两条编译管线，
// 各自链接 + 实跑，比对运行输出。这是 v3 迁移的唯一客观正确性判据：
// 没有它，新管线的任何改动都等于盲改数万行。
//
//   旧轨（gold）: tc build --mode <mode> → <base>.exe           （现状 LLVM 后端，维持自举不动点）
//   新轨（待测）: tc emit-tir-ll --mode <mode> → .tir.ll → clang -c → link t_runtime.lib → .exe
//   比对        : new_out vs old_out（双轨一致）；new_out vs expected（对金标准正确）
//
// 准绳（继承 pipeline-implementation-route.md §5.4）：
//   「通过」= 链接 + 运行 + 输出比对一致。clang -c 成功 / .ll 生成成功 / md5 稳定均不算通过。
//
// 用法:
//   node tools/_diffpipe.mjs                       # 全部带 expected 的示例（dbg）
//   node tools/_diffpipe.mjs --only match_demo,adt_shape
//   node tools/_diffpipe.mjs --mode rls
//   node tools/_diffpipe.mjs --jobs 4
//   node tools/_diffpipe.mjs --strict              # 任一不一致则 exit 1（未来硬门禁用）
//   node tools/_diffpipe.mjs --no-old              # 仅新轨 vs expected（省去旧轨重建，快）
//
// 退出码：默认 0（纯报告，交给 gate 判 warn/fail）；--strict 时不一致则 1。
//
// 并行安全：每用例产物落在 out/<mode>/diffpipe/{old,new}/<name>.* 下，目录由用例名唯一确定，
// 互不覆盖；故用例间可安全并行（区别于 run_examples 早期共目录踩踏问题）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus } from "node:os";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const pExecFile = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const EX = join(ROOT, "examples");

{
  const s = ensureMsvcEnv();
  if (s) console.error(`[env] ${s}`);
}

// ── 参数 ─────────────────────────────────────────────────────────
let mode = "dbg";
let compiler = null;
let only = null;
let jobs = Math.min(4, Math.max(1, cpus().length));
let strict = false;
let noOld = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--mode") mode = argv[++i];
  else if (argv[i] === "--compiler") compiler = argv[++i];
  else if (argv[i] === "--only") only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  else if (argv[i] === "--jobs") jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
  else if (argv[i] === "--strict") strict = true;
  else if (argv[i] === "--no-old") noOld = true;
  else { console.error(`_diffpipe: 未知参数 ${argv[i]}；可用：--mode --compiler --only --jobs --strict --no-old`); process.exit(2); }
}
if (mode !== "dbg" && mode !== "rls") { console.error(`_diffpipe: invalid --mode '${mode}' (expected dbg|rls)`); process.exit(2); }
if (!compiler) compiler = join(ROOT, "out", mode === "rls" ? "rls" : "dbg", "tc.exe");
compiler = resolve(ROOT, compiler);
if (!existsSync(compiler)) { console.error(`_diffpipe: compiler not found: ${compiler}`); process.exit(2); }

// 已知失败用例名单（与 ir_snapshot.mjs / run_examples.mjs 的 KNOWN_FAILING 保持一致）：
// 后端 bug 修好后从名单移除，恢复双轨对拍 / 快照 / 示例门禁覆盖。
// tile_demo 的 Tile 元素错当成 i64 当 ptr 存的后端 bug 已修复
// （src/tir_to_ll.tc 瓦片 binop 聚合类型探测从 inst.st 回退到 inst.args[0].st），
// 已从名单移除，恢复双轨对拍覆盖。
const KNOWN_FAILING = new Set();

function findClang() {
  for (const c of ["C:\\Program Files\\LLVM\\bin\\clang.exe", "C:\\Program Files (x86)\\LLVM\\bin\\clang.exe", "clang"]) if (existsSync(c)) return c;
  return "clang";
}
const CLANG = findClang();
const RTLIB = join(ROOT, "out", mode, "deps", "t_runtime.lib");
// 缺库不能静默：否则每个用例都只表现为 "link failed"，69 例全红却看不出是同一个
// 基础设施原因（曾因此误判为「TIR 新轨 0/69 全错」）。显式致命退出并给出修复命令。
if (!existsSync(RTLIB)) {
    console.error(`_diffpipe: FATAL 运行时静态库缺失: ${RTLIB}\n_diffpipe: 先执行 node tools/build_runtime.mjs 再重跑`);
    process.exit(2);
}
const OLD = join(ROOT, "out", mode, "diffpipe", "old");
const NEW = join(ROOT, "out", mode, "diffpipe", "new");
mkdirSync(OLD, { recursive: true });
mkdirSync(NEW, { recursive: true });
const COPT = mode === "rls" ? "-O2" : "-O0";

async function sh(cmd, args, opts = {}) {
  try {
    const { stdout } = await pExecFile(cmd, args, { cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts });
    return { ok: true, out: stdout, err: Buffer.alloc(0), code: 0 };
  } catch (e) {
    return { ok: false, out: e.stdout ?? Buffer.alloc(0), err: e.stderr ?? Buffer.alloc(0), code: typeof e.code === "number" ? e.code : -1 };
  }
}
const norm = (b) => b.toString("utf8").replace(/\r\n/g, "\n");
const tailErr = (b) => norm(b ?? Buffer.alloc(0)).trim().split("\n").slice(-3).join(" | ");

// ── 收集用例 ─────────────────────────────────────────────────────
let names = readdirSync(EX)
  .filter((f) => f.endsWith(".expected.txt"))
  .map((f) => f.slice(0, -".expected.txt".length))
  .filter((n) => existsSync(join(EX, `${n}.tc`)))
  .sort();
if (only) names = names.filter((n) => only.includes(n));
if (names.length === 0) { console.error("_diffpipe: no examples with .expected.txt found"); process.exit(2); }

console.log(
  `_diffpipe: compiler=${compiler.replace(ROOT + "\\", "")} mode=${mode} ` +
  `cases=${names.length} jobs=${jobs}${noOld ? " (no-old)" : ""}\n`
);

// ── 单用例：旧轨 → new 轨 → 对拍 ────────────────────────────────
async function runCase(name) {
  if (KNOWN_FAILING.has(name)) {
    return { name, problems: [], skipped: true, oldOut: null, newOut: null, expected: "" };
  }
  const src = join("examples", `${name}.tc`);
  const expected = norm(readFileSync(join(EX, `${name}.expected.txt`)));
  const problems = [];
  let oldOut = null;
  let newOut = null;

  // ① 旧轨（gold）：tc build → exe → run
  if (!noOld) {
    const ob = join(OLD, name);
    const o = await sh(compiler, ["build", src, "--mode", mode, "--output", ob]);
    if (!o.ok) {
      problems.push(`old build failed (exit ${o.code}): ${tailErr(o.err)}`);
    } else {
      const exe = `${ob}.exe`;
      if (!existsSync(exe)) problems.push("old exe missing");
      else {
        const r = await sh(exe, []);
        oldOut = norm(r.out);
        if (oldOut !== expected) problems.push("old output != expected");
      }
    }
  }

  // ② 新轨（待测）：tc emit-tir-ll → .tir.ll → clang -c → link t_runtime.lib(+导入 .tlib) → .exe → run
  const nb = join(NEW, name);
  const ll = `${nb}.tir.ll`;
  const obj = `${nb}.o`;
  const exe = `${nb}.exe`;
  const e = await sh(compiler, ["emit-tir-ll", src, "--mode", mode, "--output", nb, "--link-deps"]);
  // 从 stdout 解析编译器解析到的外部链接库（.tlib/.tlibd），与 tc build 的 g_ext_link 一致并入链接。
  const linkDeps = norm(e.out).split("\n").map((s) => s.trim())
    .filter((s) => s.endsWith(".tlib") || s.endsWith(".tlibd"));
  if (!e.ok) {
    problems.push(`emit-tir-ll failed (exit ${e.code}): ${tailErr(e.err)}`);
  } else {
    const c = await sh(CLANG, ["-c", COPT, "-o", obj, ll]);
    if (!c.ok) { problems.push(`clang -c failed (exit ${c.code}): ${tailErr(c.err)}`); }
    else {
      const l = await sh(CLANG, ["-o", exe, obj, ...linkDeps, RTLIB, "-Wl,-subsystem:console"]);
      if (!l.ok) {
        const undefs = norm(l.err).split("\n").filter((s) => s.includes("undefined symbol:")).map((s) => s.replace(/.*undefined symbol: /, "").trim());
        problems.push(`link failed (exit ${l.code}): ${undefs.slice(0, 6).join(", ")}${undefs.length > 6 ? ` (+${undefs.length - 6} more)` : ""}`);
      } else {
        const r = await sh(exe, []);
        newOut = norm(r.out);
        if (newOut !== expected) problems.push("new output != expected");
      }
    }
  }

  // ③ 双轨一致（仅在两轨都有输出时比较）
  if (oldOut !== null && newOut !== null && oldOut !== newOut) problems.push("new output != old output");

  return { name, problems, oldOut, newOut, expected, skipped: false };
}

// ── 并发池 ───────────────────────────────────────────────────────
let done = 0;
const results = [];
const queue = names.slice();
async function worker() {
  for (;;) {
    const i = queue.shift();
    if (i === undefined) break;
    const r = await runCase(i);
    done++;
    let tag, suffix;
    if (r.skipped) {
      tag = "SKIP";
      suffix = "  — known-failing (KNOWN_FAILING)";
    } else {
      tag = r.problems.length === 0 ? "OK  " : "DIFF";
      suffix = r.problems.length === 0 ? "" : `  — ${r.problems.join("; ")}`;
    }
    console.log(`  [${String(done).padStart(2)}/${names.length}] ${tag}  ${r.name}${suffix}`);
    results.push(r);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, worker));

// ── 汇总 ─────────────────────────────────────────────────────────
const failures = results.filter((r) => r.problems.length > 0);
const skipped = results.filter((r) => r.skipped).length;
const pass = results.length - failures.length - skipped;
const both = results.filter((r) => r.oldOut !== null && r.newOut !== null);
const parity = both.filter((r) => r.oldOut === r.newOut).length;
const oldOk = results.filter((r) => r.oldOut !== null && r.oldOut === r.expected).length;
const newOk = results.filter((r) => r.newOut !== null && r.newOut === r.expected).length;

if (failures.length > 0) {
  console.log("");
  for (const f of failures) {
    console.log(`── ${f.name} ─────────────────────────────`);
    console.log(`expected:\n${JSON.stringify(f.expected)}`);
    if (f.oldOut !== null) console.log(`old     :\n${JSON.stringify(f.oldOut)}`);
    if (f.newOut !== null) console.log(`new     :\n${JSON.stringify(f.newOut)}`);
  }
  console.log("");
}
console.log(
  `_diffpipe: ${pass}/${results.length} 用例零问题（跳过 ${skipped} 已知失败）| ` +
  `旧轨正确 ${oldOk}/${results.length} | 新轨正确 ${newOk}/${results.length} | ` +
  `双轨一致 ${parity}/${both.length}（共 ${both.length} 例两轨均有输出）`
);
process.exit(strict && failures.length > 0 ? 1 : 0);

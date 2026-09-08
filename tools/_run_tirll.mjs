#!/usr/bin/env node
// _run_tirll.mjs — emit-tir-ll 端到端语义验证（临时 harness，不提交）
// 对每个存在 examples/<name>.expected.txt 的示例：
//   tc emit-tir-ll -> .tir.ll -> clang -c -> .o -> clang 链接 t_runtime.lib -> .exe -> 实跑 -> 比对 expected
// 用法:
//   node tools/_run_tirll.mjs                      # 全部带 expected 的示例
//   node tools/_run_tirll.mjs --only match_demo,adt_shape
//   node tools/_run_tirll.mjs --mode rls
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

let mode = "dbg";
let compiler = null;
let only = null;
let jobs = Math.min(8, Math.max(1, cpus().length));
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--mode") mode = argv[++i];
  else if (argv[i] === "--compiler") compiler = argv[++i];
  else if (argv[i] === "--only") only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  else if (argv[i] === "--jobs") jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
}
if (!compiler) compiler = join(ROOT, "out", mode === "rls" ? "rls" : "dbg", "tc.exe");
compiler = resolve(ROOT, compiler);
if (!existsSync(compiler)) { console.error(`_run_tirll: compiler not found: ${compiler}`); process.exit(2); }

function findClang() {
  for (const c of ["C:\\Program Files\\LLVM\\bin\\clang.exe", "C:\\Program Files (x86)\\LLVM\\bin\\clang.exe", "clang"]) if (existsSync(c)) return c;
  return "clang";
}
const CLANG = findClang();
const RTLIB = join(ROOT, "out", mode, "deps", "t_runtime.lib");
const OUTDIR = join(ROOT, "out", mode, "tirll");
mkdirSync(OUTDIR, { recursive: true });
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

let names = readdirSync(EX)
  .filter((f) => f.endsWith(".expected.txt"))
  .map((f) => f.slice(0, -".expected.txt".length))
  .filter((n) => existsSync(join(EX, `${n}.tc`)))
  .sort();
if (only) names = names.filter((n) => only.includes(n));

console.log(`_run_tirll: compiler=${compiler.replace(ROOT + "\\", "")} mode=${mode} cases=${names.length} jobs=${jobs}\n`);

async function runCase(name) {
  const src = join("examples", `${name}.tc`);
  const expected = norm(readFileSync(join(EX, `${name}.expected.txt`)));
  const base = join(OUTDIR, name);
  const ll = `${base}.tir.ll`;
  const obj = `${base}.o`;
  const exe = `${base}.exe`;
  const problems = [];

  const e = await sh(compiler, ["emit-tir-ll", src, "--mode", mode, "--output", base]);
  if (!e.ok) { problems.push(`emit-tir-ll failed (exit ${e.code}): ${tailErr(e.err)}`); return { name, problems }; }
  const c = await sh(CLANG, ["-c", COPT, "-o", obj, ll]);
  if (!c.ok) { problems.push(`clang -c failed (exit ${c.code}): ${tailErr(c.err)}`); return { name, problems }; }
  const l = await sh(CLANG, ["-o", exe, obj, RTLIB, "-Wl,-subsystem:console"]);
  if (!l.ok) {
    const undefs = norm(l.err).split("\n").filter((s) => s.includes("undefined symbol:")).map((s) => s.replace(/.*undefined symbol: /, "").trim());
    problems.push(`link failed (exit ${l.code}): ${undefs.slice(0, 6).join(", ")}${undefs.length > 6 ? ` (+${undefs.length - 6} more)` : ""}`);
    return { name, problems, undefs };
  }
  const r = await sh(exe, []);
  const out = norm(r.out);
  if (out !== expected) problems.push("output != expected");
  return { name, problems, out, expected };
}

let done = 0;
const results = [];
const queue = names.slice();
async function worker() {
  for (;;) {
    const i = queue.shift();
    if (i === undefined) break;
    const r = await runCase(i);
    done++;
    const tag = r.problems.length === 0 ? "PASS" : "FAIL";
    const suffix = r.problems.length === 0 ? "" : `  — ${r.problems.join("; ")}`;
    console.log(`  [${String(done).padStart(2)}/${names.length}] ${tag}  ${r.name}${suffix}`);
    results.push(r);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, worker));

const failures = results.filter((r) => r.problems.length > 0);
const pass = results.length - failures.length;
if (failures.length > 0) {
  console.log("");
  for (const f of failures) {
    console.log(`── ${f.name} ─────────────────────────────`);
    console.log(`expected:\n${JSON.stringify(f.expected)}`);
    if (f.out !== undefined) console.log(`got     :\n${JSON.stringify(f.out)}`);
    if (f.undefs !== undefined && f.undefs.length) console.log(`undefs  : ${f.undefs.join(", ")}`);
  }
}
console.log(`\n_run_tirll: ${pass} passed, ${failures.length} failed (of ${names.length})`);
process.exit(failures.length === 0 ? 0 : 1);

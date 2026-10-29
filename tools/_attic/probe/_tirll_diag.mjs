#!/usr/bin/env node
// _tirll_diag.mjs — emit-tir-ll 全量 clang 错误诊断（临时，不提交）
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus } from "node:os";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const pExecFile = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const EX = join(ROOT, "examples");
{ const s = ensureMsvcEnv(); if (s) console.error(`[env] ${s}`); }
let mode = "dbg";
let compiler = join(ROOT, "out", "dbg", "tc.exe");
let only = null;
let jobs = Math.min(8, Math.max(1, cpus().length));
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--mode") mode = argv[++i];
  else if (argv[i] === "--only") only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
}
const CLANG = (() => { for (const c of ["C:\\Program Files\\LLVM\\bin\\clang.exe", "clang"]) if (existsSync(c)) return c; return "clang"; })();
const RTLIB = join(ROOT, "out", mode, "deps", "t_runtime.lib");
const OUTDIR = join(ROOT, "out", mode, "tirll");
mkdirSync(OUTDIR, { recursive: true });
const COPT = mode === "rls" ? "-O2" : "-O0";

async function sh(cmd, args) {
  try { const { stdout, stderr } = await pExecFile(cmd, args, { cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, windowsHide: true }); return { ok: true, out: stdout, err: stderr, code: 0 }; }
  catch (e) { return { ok: false, out: e.stdout ?? Buffer.alloc(0), err: e.stderr ?? Buffer.alloc(0), code: typeof e.code === "number" ? e.code : -1 }; }
}
const norm = (b) => b.toString("utf8").replace(/\r\n/g, "\n");

let names = readdirSync(EX).filter((f) => f.endsWith(".expected.txt")).map((f) => f.slice(0, -".expected.txt".length)).filter((n) => existsSync(join(EX, `${n}.tc`))).sort();
if (only) names = names.filter((n) => only.includes(n));

async function runCase(name) {
  const src = join("examples", `${name}.tc`);
  const base = join(OUTDIR, name);
  const ll = `${base}.tir.ll`;
  const e = await sh(compiler, ["emit-tir-ll", src, "--mode", mode, "--output", base]);
  if (!e.ok) return { name, stage: "emit", msg: norm(e.err) };
  const c = await sh(CLANG, ["-c", COPT, "-o", `${base}.o`, ll]);
  if (!c.ok) return { name, stage: "clang", msg: norm(c.err) };
  const l = await sh(CLANG, ["-o", `${base}.exe`, `${base}.o`, RTLIB, "-Wl,-subsystem:console"]);
  if (!l.ok) return { name, stage: "link", msg: norm(l.err) };
  const r = await sh(`${base}.exe`, []);
  const expected = norm(readFileSync(join(EX, `${name}.expected.txt`)));
  if (norm(r.out) !== expected) return { name, stage: "run", msg: `out!=expected\n--- got ---\n${norm(r.out)}\n--- exp ---\n${expected}` };
  return { name, stage: "ok" };
}

const results = await Promise.all(names.map(runCase));
for (const r of results) {
  if (r.stage === "ok") continue;
  console.log(`\n===== ${r.name} [${r.stage}] =====`);
  console.log(r.msg);
}
const fails = results.filter((r) => r.stage !== "ok");
console.log(`\nDIAG: ${results.length - fails.length} ok, ${fails.length} fail`);
console.log("stages:", fails.map((f) => `${f.name}:${f.stage}`).join(" "));

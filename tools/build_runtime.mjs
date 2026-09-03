#!/usr/bin/env node
// tools/build_runtime.mjs
// 预编译 runtime C 为静态库，供 tote build/run 链接（契合 out/<mode>/deps 约定）：
//   out/dbg/deps/t_runtime.lib  (-Od，调试)
//   out/rls/deps/t_runtime.lib  (-O2，发布优化)
//
// 用法：node tools/build_runtime.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(".");

function findClang() {
  const candidates = ["clang", "C:\\Program Files\\LLVM\\bin\\clang.exe"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "pipe" });
      return c;
    } catch {}
  }
  return null;
}

const clang = findClang();
if (!clang) { console.error("build_runtime: clang not found"); process.exit(2); }
const clangDir = dirname(clang);
const ar = join(clangDir, "llvm-ar.exe");
if (!existsSync(ar)) { console.error("build_runtime: llvm-ar not found"); process.exit(2); }

const modes = [
  { name: "dbg", opt: "-O0" },
  { name: "rls", opt: "-O2" },
];

// fdlibm 回落源码（若存在）：WASM / 无系统 libm 目标编译进 t_runtime.lib，
// 由 t_math_* 包装按符号名链接到 fdlibm 而非系统 libm。目录为空则回落系统 libm。
const fdDir = join(ROOT, "runtime", "fdlibm");
const fdSources = [];
if (existsSync(fdDir)) {
  for (const f of readdirSync(fdDir)) {
    if (f.endsWith(".c")) { fdSources.push(join(fdDir, f)); }
  }
}
if (fdSources.length > 0) {
  console.log(`build_runtime: fdlibm drop-in: ${fdSources.length} source(s) found`);
}

for (const m of modes) {
  const depsDir = join(ROOT, "out", m.name, "deps");
  mkdirSync(depsDir, { recursive: true });
  const obj1 = join(depsDir, "t_runtime.obj");
  const obj2 = join(depsDir, "t_shim_ll.obj");
  const obj3 = join(depsDir, "t_runtime_gpu.obj");
  const lib = join(depsDir, "t_runtime.lib");
  console.log(`build_runtime: [${m.name}] ${clang} ${m.opt}`);
  execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-o", obj1, join(ROOT, "runtime", "t_runtime.c")], { cwd: ROOT, stdio: "inherit" });
  execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-o", obj2, join(ROOT, "runtime", "t_shim_ll.c")], { cwd: ROOT, stdio: "inherit" });
  execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-o", obj3, join(ROOT, "runtime", "t_runtime_gpu.c")], { cwd: ROOT, stdio: "inherit" });
  const archObjs = [obj1, obj2, obj3];
  for (const src of fdSources) {
    const o = join(depsDir, "fdlibm_" + fdSources.indexOf(src) + ".obj");
    execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-D_IEEE_LIBM", "-D__STDC__", "-o", o, src], { cwd: ROOT, stdio: "inherit" });
    archObjs.push(o);
  }
  execFileSync(ar, ["rcs", lib, ...archObjs], { cwd: ROOT, stdio: "inherit" });
  console.log(`build_runtime: wrote ${lib}`);
}
console.log("build_runtime: done");

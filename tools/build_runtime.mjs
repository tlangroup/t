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
import { findClang, clangVersion, resolveAr } from "./toolchain.mjs";

const ROOT = resolve(".");

// 工具链发现收口到 toolchain.mjs（与 gate / tc.exe 同一规则）。
const clangResolved = findClang();
const clang = clangResolved.path;
const clangDir = clangResolved.via === "path" ? "." : dirname(clang);
if (clangVersion(clang) === "unknown") { console.error("build_runtime: clang not found"); process.exit(2); }
// 回落规则（clang 同目录 → PATH）已由 toolchain.resolveAr 统一处理；
// 旧实现在此因 dirname(".") 拼出不存在路径而误报 llvm-ar，现已消除。
const ar = resolveAr(clangDir);
if (ar === "ar") {
    // 最后回落裸 "ar"：验证确实可用，否则明确报错（而非带着无效 ar 继续）
    try { execFileSync(ar, ["--version"], { stdio: "pipe", windowsHide: true }); }
    catch { console.error("build_runtime: ar not found (llvm-ar / llvm-lib / ar 均不可用)"); process.exit(2); }
}

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

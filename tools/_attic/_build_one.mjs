#!/usr/bin/env node
// temp build helper: compile an already-emitted tc.c into an exe.
//
// ⚠ 2026-09-26 改：runtime 不再以源码形式参与编译。t_runtime.c 现在依赖 4 个
//   vendored 第三方库（mimalloc / fdlibm / imath / Ryu），单独编译它既缺
//   -I mimalloc/include 也缺那 100 个 .obj。改为 clang 编 tc.c + 链接预编译的
//   out/dbg/deps/t_runtime.lib（tools/build_runtime.mjs 产物）。MSVC cl 不再需要。
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { findClang } from "./toolchain.mjs";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const ROOT = resolve(".");
const { path: CLANG } = findClang();
ensureMsvcEnv();   // 注入 LIB/INCLUDE，使 clang 能找到系统头与导入库
const RUNTIME_LIB = join(ROOT, "out", "dbg", "deps", "t_runtime.lib");

const outDir = join(ROOT, "out", "dbg", process.argv[2] || "tc-new");
const cFile = join(outDir, (process.argv[3] || "tc") + ".c");
try {
  const out = execFileSync(CLANG, [
    "-std=c11", "-O0",
    `-I${join(ROOT, "runtime")}`, `-I${outDir}`,
    cFile,
    RUNTIME_LIB,
    "-o", join(outDir, "tc.exe"),
    "-Wl,-subsystem:console", "-Wl,/STACK:268435456", "-Wl,/LARGEADDRESSAWARE",
  ], { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  console.log(out);
} catch (e) {
  console.error("CLANG FAILED. stdout:\n", (e.stdout || "").toString());
  console.error("CLANG FAILED. stderr:\n", (e.stderr || "").toString());
  process.exit(1);
}
console.log("built", join(outDir, "tc.exe"));

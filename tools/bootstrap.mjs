#!/usr/bin/env node
// bootstrap.mjs — M10 三轮自编译不动点验证 (bootstrap.md)
//
// 轮次:
//   gen0: tc0 (TypeScript)      compile src/tc.tc → C_a; clang+预编译 t_runtime.lib → tc1.exe
//   gen1: tc1.exe                compile src/tc.tc → C_b; clang+预编译 t_runtime.lib → tc2.exe
//   gen2: tc2.exe                compile src/tc.tc → C_c; clang+预编译 t_runtime.lib → tc3.exe
// 判定: C_a ≡ C_b ≡ C_c (逐字节)。成立 ⇒ 自举不动点 (Stage 2)。
//
// 用法: node tools/bootstrap.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findClang } from "./toolchain.mjs";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const SRC = join(ROOT, "src", "tc.tc");
const RUNTIME = join(ROOT, "runtime");

// ── C 后端编译/链接 ──────────────────────────────────────────────
// ⚠ 2026-09-26 改：runtime 不再以源码形式参与编译。t_runtime.c 现在依赖 4 个
//   vendored 第三方库（mimalloc / fdlibm / imath / Ryu），单独编译它既缺
//   -I mimalloc/include 也缺那 100 个 .obj。统一改为「clang 编 tc.c + 链接预编译的
//   out/<mode>/deps/t_runtime.lib」（tools/build_runtime.mjs 产物），与
//   run_examples.mjs / gate.mjs 的 cself 步一致。MSVC cl 不再是必需工具链。
const { path: CLANG } = findClang();
ensureMsvcEnv();   // 注入 LIB/INCLUDE，使 clang 能找到系统头与导入库
const RUNTIME_LIB = join(ROOT, "out", "dbg", "deps", "t_runtime.lib");

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], ...opts });
}

function compileC(outDir, exeName) {
    // 关键修复：自举种子（tc1/tc2/tc3）默认继承 Windows 1MB 栈，
    // 而编译器自身超大源在 sema 的「类型推断/解析」环（infer_expr → resolve_ti →
    // ti_equal → infer_expr）会做数千层深递归，在 1MB 下 STATUS_STACK_OVERFLOW(127)。
    // C 后端产品被 clang -O2 编译时 TCO 能折叠尾递归不溢出，但 -O0 不 TCO ⇒ 必须
    // 显式放大栈。与 tc.tc:683（build 产物）/ gate.mjs:287（cself 产品）的 /STACK 一致。
    run(CLANG, [
        "-std=c11", "-O0",
        `-I${RUNTIME}`, `-I${outDir}`,
        join(outDir, "tc.c"),
        RUNTIME_LIB,
        "-o", join(outDir, exeName),
        "-Wl,-subsystem:console", "-Wl,/STACK:268435456", "-Wl,/LARGEADDRESSAWARE",
    ]);
    return join(outDir, exeName);
}

function emitWith(compilerArgv, outDir) {
    mkdirSync(outDir, { recursive: true });
    const [file, ...pre] = compilerArgv;
    run(file, [...pre, "compile", SRC, "--emit-c", "--output", outDir], {
        shell: process.platform === "win32" && file === "npx",
    });
    return {
        h: readFileSync(join(outDir, "tc.h")),
        c: readFileSync(join(outDir, "tc.c")),
    };
}

function eq(a, b) { return a.h.equals(b.h) && a.c.equals(b.c); }

// ── gen0: tc0 ────────────────────────────────────────────────────
console.log("gen0: tc0 (TypeScript) → C_a → tc1.exe");
const dir0 = join(ROOT, "out", "bootstrap", "gen0");
const Ca = emitWith(["npx", "tsx", "tc0/index.ts"], dir0);
const tc1exe = compileC(dir0, "tc1.exe");

// ── gen1: tc1.exe ────────────────────────────────────────────────
console.log("gen1: tc1.exe → C_b → tc2.exe");
const dir1 = join(ROOT, "out", "bootstrap", "gen1");
const Cb = emitWith([tc1exe], dir1);
const tc2exe = compileC(dir1, "tc2.exe");

// ── gen2: tc2.exe ────────────────────────────────────────────────
console.log("gen2: tc2.exe → C_c → tc3.exe");
const dir2 = join(ROOT, "out", "bootstrap", "gen2");
const Cc = emitWith([tc2exe], dir2);
compileC(dir2, "tc3.exe");

// ── 判定 ─────────────────────────────────────────────────────────
console.log("");
const ab = eq(Ca, Cb), bc = eq(Cb, Cc);
console.log(`C_a ≡ C_b : ${ab ? "OK" : "DIFF"}`);
console.log(`C_b ≡ C_c : ${bc ? "OK" : "DIFF"}`);
if (ab && bc) {
    console.log("\nBOOTSTRAP FIXPOINT REACHED — tc0/tc1/tc2 产出逐字节一致 (Stage 2 达成)");
    process.exit(0);
}
console.log("\nbootstrap: fixpoint NOT reached");
process.exit(1);

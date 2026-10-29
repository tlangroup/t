// S5 自举闭环验证：tmir-c 后端编译整个编译器 → 运行其 emit-ll → 与 LLVM 后端 emit-ll 逐字节比对。
//
// 流程：
//   ① 用当前编译器（LLVM 后端，out/dbg/tc_new.exe）以 --backend tmir-c 编译 src/tc.tc
//      → build 内部走 tmir-c 代码生成 + clang 链接，产出 C 自举编译器 <dir>/tc.exe
//   ② 运行 C 自举编译器：tc.exe emit-ll src/tc.tc → C 后端发射的 IR
//   ③ 运行 LLVM 编译器：tc_new.exe emit-ll src/tc.tc → LLVM 后端发射的 IR（参考）
//   ④ 比对两份 .ll 的 md5：须全同（C↔LLVM 发射逐字节一致），证明 C 后端无 miscompile。
//
// ⚠ 注意：务必用 build --backend tmir-c（tmir-c 后端），不要用 compile --emit-c
//   （compile 走 legacy codegen_c.tc，非 S5 目标后端）。

import { ensureMsvcEnv } from "./msvc_env.mjs";
import { findClang } from "./toolchain.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const s = ensureMsvcEnv();
console.log("[env]", s);
const CLANG = findClang().path;
console.log("[clang]", CLANG);

const exe = join(ROOT, "out", "dbg", "tc_new.exe");
const dir = join(ROOT, "out", "dbg", "cself_test");
mkdirSync(dir, { recursive: true });
const cexe = join(dir, "tc.exe");
const irC = join(ROOT, "out", "dbg", "cself_ir");
const irL = join(ROOT, "out", "dbg", "g_ref");

function run(label, cmd, args, opts = {}) {
  console.log(`\n=== ${label} ===`);
  console.log(cmd, args.join(" "));
  try {
    const out = execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
    return 0;
  } catch (e) {
    console.error(`[FAIL] ${label}:`, e.message);
    if (e.stdout) process.stdout.write(e.stdout.toString());
    if (e.stderr) process.stderr.write(e.stderr.toString());
    return e.status ?? -1;
  }
}

// ① build --backend tmir-c（内部 clang 链接）→ 产出 C 自举编译器。
const e1 = run("build tmir-c", exe, [
  "build", "src/tc.tc", "--backend", "tmir-c", "--output", join(dir, "tc"), "--mode", "dbg",
], { env: { ...process.env, TC_CLANG: CLANG } });
if (e1 !== 0) { console.error("build tmir-c failed"); process.exit(1); }
if (!existsSync(cexe)) { console.error("C self compiler not produced:", cexe); process.exit(1); }

// ② C 产物运行 emit-ll（全项目最重工作），若 miscompile 遗留会在此崩溃/token 损坏。
const e3 = run("C-product emit-ll", cexe, ["emit-ll", "src/tc.tc", "--output", irC]);
if (e3 !== 0) { console.error("C product emit-ll failed (miscompile?)"); process.exit(3); }

// ③ LLVM 产物作参考。
const e4 = run("LLVM emit-ll", exe, ["emit-ll", "src/tc.tc", "--output", irL]);
if (e4 !== 0) { console.error("LLVM emit-ll failed"); process.exit(4); }

const m1 = createHash("md5").update(readFileSync(irC + ".ll")).digest("hex");
const m2 = createHash("md5").update(readFileSync(irL + ".ll")).digest("hex");
console.log("\n=== IR md5 ===");
console.log("C  product:", m1);
console.log("LLVM product:", m2);
if (m1 === m2) { console.log("MATCH ✅  C 后端自举产物与 LLVM 后端发射逐字节相同"); process.exit(0); }
else { console.error("MISMATCH ❌"); process.exit(5); }

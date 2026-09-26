#!/usr/bin/env node
// tools/build_runtime.mjs
// 预编译 runtime C 为静态库，供 tote build/run 链接（契合 out/<mode>/deps 约定）：
//   out/dbg/deps/t_runtime.lib  (-O0，调试)
//   out/rls/deps/t_runtime.lib  (-O2，发布优化)
//
// 归档组成（见 runtime/ 目录）：
//   t_runtime.c / t_shim_ll.c / t_runtime_gpu.c   —— t 运行时本体
//   fdlibm/*.c    —— 数学库（替代系统 libm；公开符号加 tfd_ 前缀避免与 CRT 撞名）
//   imath/imath.c —— 任意精度整数（大整数格式化）
//   ryu/*.c       —— 浮点 ↔ 字符串（最短往返 / 定点 / 科学计数）
//   mimalloc/src  —— 分配器（t_alloc / t_free 走 mi_malloc / mi_free）
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

// mimalloc 头文件：运行时本体（t_runtime.c 等）要 #include <mimalloc.h>，
// 故其 include 目录对**所有**编译单元可见，而不只是 mimalloc 自身。
const MI_INC = join(ROOT, "runtime", "mimalloc", "include");

// ── fdlibm 公开符号重命名 ────────────────────────────────────────
// fdlibm 的公开符号（sin/cos/pow/...）与系统 libm 同名。若直接编进归档，
// 链接器按库顺序解析虽通常不报错，但宿主 CRT 的 math.h 常把 sin/cos 声明成
// intrinsic / 内联，可能在编译期就绕开我们的实现。故统一用 -D 在预处理期
// 把公开名改写成 tfd_* —— 内部内核（__ieee754_* / __kernel_*）保持原名，
// 不受影响，也不与任何 CRT 符号相撞。
const FD_RENAME = [
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "exp", "log", "log10", "pow", "sqrt",
  "fmod", "fabs", "floor", "ceil", "expm1", "log1p",
  "hypot", "cbrt", "copysign", "nextafter", "remainder",
  "ldexp", "frexp", "modf", "rint", "scalb", "scalbn", "ilogb", "logb",
  "significand", "finite", "isnan",
  "erf", "erfc", "lgamma", "gamma", "j0", "j1", "jn", "y0", "y1", "yn",
  "signgam",       // glibc 亦有此全局量，一并改名
].map((n) => `${n}=tfd_${n}`);

// ── vendored 第三方库 ────────────────────────────────────────────
// 每项：name（obj 前缀）、files（相对 runtime/ 的源）、inc（额外 -I，相对 ROOT）、defs（-D）
const MIMALLOC_SRCS = [
  "mimalloc/src/alloc.c", "mimalloc/src/alloc-aligned.c", "mimalloc/src/alloc-posix.c",
  "mimalloc/src/arena.c", "mimalloc/src/bitmap.c", "mimalloc/src/heap.c",
  "mimalloc/src/init.c", "mimalloc/src/libc.c", "mimalloc/src/options.c",
  "mimalloc/src/os.c", "mimalloc/src/page.c", "mimalloc/src/random.c",
  "mimalloc/src/segment.c", "mimalloc/src/segment-map.c", "mimalloc/src/stats.c",
  "mimalloc/src/prim/prim.c",
];

const VENDOR = [
  {
    name: "mimalloc",
    files: MIMALLOC_SRCS,
    inc: [join(ROOT, "runtime", "mimalloc", "include")],
    defs: ["MI_STATIC_LIB=1"],
  },
  {
    name: "fdlibm",
    // 目录下全部 .c（s_matherr.c 提供 matherr，会与 CRT 冲突，排除）
    glob: "fdlibm",
    exclude: ["s_matherr.c"],
    defs: ["_IEEE_LIBM", "__STDC__", ...FD_RENAME],
    // ⚠ fdlibm 的 __HI(x)/__LO(x) 是 `*(int*)&x` 形式的类型双关（type punning），
    //   严格别名规则下是 UB：-O2 会让「先写 __HI 再读 x」被重排/优化掉。
    //   必须关掉严格别名，否则发布态（-O2）结果可与调试态（-O0）不一致。
    flags: ["-fno-strict-aliasing"],
  },
  {
    name: "imath",
    files: ["imath/imath.c"],
    // imath 直接用裸 malloc/realloc/free。整体重定向到 mimalloc，保证
    // 「全运行时只有一套分配器」——否则两套堆各管各的，RSS 与碎片都不可控。
    // ⚠ -include 必须先注入 mimalloc.h：宏替换后调用的是 mi_*，没有声明会退化成
    //   隐式声明（C99 起是错误）。
    inc: [MI_INC],
    flags: ["-include", "mimalloc.h"],
    defs: ["malloc=mi_malloc", "realloc=mi_realloc", "free=mi_free"],
  },
  {
    name: "ryu",
    files: ["ryu/d2s.c", "ryu/d2fixed.c", "ryu/f2s.c"],
  },
];

// 展开 VENDOR 为 {objName, absPath, incArgs, defArgs}
function expandVendor() {
  const out = [];
  for (const v of VENDOR) {
    let files = [];
    if (v.glob) {
      const d = join(ROOT, "runtime", v.glob);
      if (!existsSync(d)) { continue; }
      for (const f of readdirSync(d)) {
        if (f.endsWith(".c") && !(v.exclude || []).includes(f)) { files.push(join(v.glob, f)); }
      }
    } else {
      files = v.files.slice();
    }
    files.sort();
    for (const rel of files) {
      const abs = join(ROOT, "runtime", rel);
      if (!existsSync(abs)) { console.warn(`build_runtime: skip missing ${rel}`); continue; }
      out.push({
        obj: `${v.name}_${rel.replace(/[\\/]/g, "_").replace(/\.c$/, "")}.obj`,
        abs,
        inc: (v.inc || []).flatMap((p) => ["-I", p]),
        def: (v.defs || []).map((d) => `-D${d}`),
        flags: (v.flags || []).slice(),
      });
    }
  }
  return out;
}

const vendorUnits = expandVendor();
for (const v of VENDOR) {
  const n = vendorUnits.filter((u) => u.obj.startsWith(v.name + "_")).length;
  console.log(`build_runtime: vendored ${v.name}: ${n} unit(s)`);
}

for (const m of modes) {
  const depsDir = join(ROOT, "out", m.name, "deps");
  mkdirSync(depsDir, { recursive: true });
  const obj1 = join(depsDir, "t_runtime.obj");
  const obj2 = join(depsDir, "t_shim_ll.obj");
  const obj3 = join(depsDir, "t_runtime_gpu.obj");
  const lib = join(depsDir, "t_runtime.lib");
  console.log(`build_runtime: [${m.name}] ${clang} ${m.opt}`);
  execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-I", MI_INC, "-o", obj1, join(ROOT, "runtime", "t_runtime.c")], { cwd: ROOT, stdio: "inherit" });
  execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-I", MI_INC, "-o", obj2, join(ROOT, "runtime", "t_shim_ll.c")], { cwd: ROOT, stdio: "inherit" });
  execFileSync(clang, ["-c", m.opt, "-I", join(ROOT, "runtime"), "-I", MI_INC, "-o", obj3, join(ROOT, "runtime", "t_runtime_gpu.c")], { cwd: ROOT, stdio: "inherit" });
  const archObjs = [obj1, obj2, obj3];
  for (const u of vendorUnits) {
    const o = join(depsDir, u.obj);
    execFileSync(clang, ["-c", m.opt, ...u.flags, "-I", join(ROOT, "runtime"), ...u.inc, ...u.def, "-o", o, u.abs], { cwd: ROOT, stdio: "inherit" });
    archObjs.push(o);
  }
  execFileSync(ar, ["rcs", lib, ...archObjs], { cwd: ROOT, stdio: "inherit" });
  console.log(`build_runtime: wrote ${lib}`);
}
console.log("build_runtime: done");

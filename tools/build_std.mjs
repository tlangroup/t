// tools/build_std.mjs —— 预编译 std 库为 .tlib / .tlibd
//
// 这是「解决 tc 与 std 相互依赖」的构建期关键步骤：
//   * std（lib/std/{mem,math}.tc）只依赖语言内建 + 运行时，对 tc 无语义依赖；
//   * 但 std 由 tc 编译。为让任意消费方（含后续代的 tc 自身）能链接 std，
//     须先用「现有可用编译器」把 std 预编译为 .tlib，再供消费方以链接模式 import。
//   * 该步骤必须在「消费方（example / 后续代 tc）编译」之前执行 —— 构建期循环由此斩断。
//
// 用法：
//   node tools/build_std.mjs                # 用 out/dbg/tc.exe
//   node tools/build_std.mjs --tc <path>    # 指定编译器（gate 传入 BASE_TC）
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

let TC = join(ROOT, "out", "dbg", "tc.exe");
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--tc" && argv[i + 1]) { TC = argv[i + 1]; i++; }
}
if (!existsSync(TC)) {
  console.error(`[build_std] 编译器不存在: ${TC}`);
  process.exit(2);
}

// std 模块以「点分层级」导入（import(std.mem) / import(std.math) / import(std.rc.cst)）。
// 编译器解析归档时按 dots_to_slashes 把 std.mem 映射为 out/lib/std/mem.tlib、
// std.rc.cst 映射为 out/lib/std/rc/cst.tlib，故预编译产物必须落在嵌套路径
// out/lib/std/<a>/<b>.tlib（而非旧的扁平 out/lib/<mod>.tlib）。
// MODULES 用「点分逻辑名」，由 dots_to_slashes 同时推出源路径与产物路径：
//   "rc.cst" → 源 lib/std/rc/cst.tc，产物 out/lib/std/rc/cst.tlib
//
// ⚠ 目前**只预编译无全局状态**的模块（mem / math）。`rc.cst` 暂时**不**列入，原因见
//   docs/compiler/cst-design-v2.md §4.14.7（实测证据）：
//     1) `--lib` 库模式**不发射运行时 shim 声明**（`tll_alloc` 等由
//        ll_emit_main_wrapper 在 `g_has_main` 时才发）→ 库里一旦用到堆分配即
//        "use of undefined value '@tll_alloc'" 链接失败；
//     2) 更致命：库模式**跳过 `t.__ginit`**，而带初始化器的全局（含 `const`）
//        在 LLVM 侧一律发成 `zeroinitializer`、真值全靠 `t.__ginit` 运行期回填 →
//        库被链接后全局**永久为零**且**不报错**（静默错编）。
//   故 `.tlib` 的适用面 = 「纯函数 + 编译期常量，零初始化全局」。在编译器侧
//   补上「库模式 shim 声明」+「全局静态初始化器发射」之前，rc.cst 走**源码内联**导入
//   （无 .tlib 时编译器自动内联，已由 gate L1 15/0 验证）。
const MODULES = ["mem", "math"];
const OUT_DIR = join(ROOT, "out", "lib", "std");
const MOD_EXT = [".tlib", ".tlibd", ".tlib.exports.json", ".tlibd.exports.json", ".ll"];

// dots_to_slashes：点分逻辑名 → 目录分段数组（用于拼源路径与产物路径）。
function mod_parts(mod) { return mod.split("."); }

// 清理上一版遗留的扁平产物，避免混淆（解析器只查嵌套路径，旧的不会被命中，但留着是脏数据）。
for (const mod of MODULES) {
  const parts = mod_parts(mod);
  const leaf = parts[parts.length - 1];
  const nest = join(OUT_DIR, ...parts.slice(0, -1));
  for (const ext of MOD_EXT) {
    for (const base of [join(ROOT, "out", "lib", `${leaf}${ext}`), join(nest, `${leaf}${ext}`)]) {
      if (existsSync(base)) { try { rmSync(base); } catch (_) {} }
    }
  }
}

// 用异步 spawn（与 gate.mjs 主流程一致）—— 同步 spawnSync 在本沙箱会因
// Windows  opportunistic lock（Defender 扫描 freshly-built .exe）返回 EBUSY，
// 导致 boot_std 步误报失败；异步 spawn 走 libuv 不同代码路径，可正常拉起。
function buildOne(mod, debug) {
  return new Promise((resolve) => {
    const parts = mod_parts(mod);
    const leaf = parts[parts.length - 1];
    const src = join(ROOT, "lib", "std", ...parts.slice(0, -1), `${leaf}.tc`);
    // --output 为前缀（不带扩展名）；build --lib 会写出 <prefix>.tlib / <prefix>.ll。
    const outp = join(OUT_DIR, ...parts);
    // 嵌套模块（如 rc/cst）的父目录可能尚不存在，编译器不会自动创建，先补齐。
    mkdirSync(dirname(outp), { recursive: true });
    const cargs = ["build", "--lib", src, "--output", outp];
    if (debug) cargs.push("--debug");
    const p = spawn(TC, cargs, { cwd: ROOT, windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => {
      console.log(`[build_std] ${mod}${debug ? " (debug .tlibd)" : " (.tlib)"}: FAIL`);
      console.log(String(e));
      resolve(false);
    });
    p.on("exit", (code) => {
      const ok = code === 0;
      console.log(`[build_std] ${mod}${debug ? " (debug .tlibd)" : " (.tlib)"}: ${ok ? "OK" : "FAIL"}`);
      if (!ok) console.log(out);
      resolve(ok);
    });
  });
}

let allOk = true;
for (const mod of MODULES) {
  allOk = (await buildOne(mod, false)) && allOk; // 发布态 .tlib
  allOk = (await buildOne(mod, true)) && allOk;  // 调试态 .tlibd
}
console.log(allOk ? "[build_std] 全部就绪 ✅" : "[build_std] 存在失败 ❌");
process.exit(allOk ? 0 : 1);

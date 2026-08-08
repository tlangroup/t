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
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { existsSync, rmSync } from "node:fs";
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

// std 模块以「点分层级」导入（import(std.mem) / import(std.math)）。
// 编译器解析归档时按 dots_to_slashes 把 std.mem 映射为 out/lib/std/mem.tlib，
// 故预编译产物必须落在嵌套路径 out/lib/std/<mod>.tlib（而非旧的扁平 out/lib/<mod>.tlib）。
const MODULES = ["mem", "math"];
const OUT_DIR = join(ROOT, "out", "lib", "std");

// 清理上一版遗留的扁平产物，避免混淆（解析器只查嵌套路径，旧的不会被命中，但留着是脏数据）。
for (const mod of MODULES) {
  for (const ext of [".tlib", ".tlibd", ".tlib.exports.json", ".tlibd.exports.json", ".ll"]) {
    for (const base of [join(ROOT, "out", "lib", `${mod}${ext}`), join(OUT_DIR, `${mod}${ext}`)]) {
      if (existsSync(base)) { try { rmSync(base); } catch (_) {} }
    }
  }
}

function buildOne(mod, debug) {
  const src = join(ROOT, "lib", "std", `${mod}.tc`);
  // --output 为前缀（不带扩展名）；build --lib 会写出 <prefix>.tlib / <prefix>.ll。
  const outp = join(OUT_DIR, mod);
  const cargs = ["build", "--lib", src, "--output", outp];
  if (debug) cargs.push("--debug");
  const r = spawnSync(TC, cargs, { cwd: ROOT, encoding: "utf8" });
  const ok = r.status === 0;
  const out = (r.stdout || "") + (r.stderr || "");
  console.log(`[build_std] ${mod}${debug ? " (debug .tlibd)" : " (.tlib)"}: ${ok ? "OK" : "FAIL"}`);
  if (!ok) console.log(out);
  return ok;
}

let allOk = true;
for (const mod of MODULES) {
  allOk = buildOne(mod, false) && allOk; // 发布态 .tlib
  allOk = buildOne(mod, true) && allOk;  // 调试态 .tlibd
}
console.log(allOk ? "[build_std] 全部就绪 ✅" : "[build_std] 存在失败 ❌");
process.exit(allOk ? 0 : 1);

#!/usr/bin/env node
// 单代自举构建助手：用指定编译器编译 src/tc.tc，产出 <out>.ll + <out>.exe。
// 用法: node tools/_build_gen.mjs <编译器路径> <输出前缀(无扩展名)>
// 与 tools/_build_tc.mjs 唯一差别是把「编译器 + 输出路径」参数化，供
// g1 → g2 → g3 不动点验证逐调用（避免每代重复注入 MSVC 环境）。
import { ensureMsvcEnv } from "./msvc_env.mjs";
import { execFileSync } from "node:child_process";

const s = ensureMsvcEnv();
const comp = process.argv[2];
const out = process.argv[3];
if (!comp || !out) {
    console.error("usage: node tools/_build_gen.mjs <compiler> <output-prefix>");
    process.exit(2);
}
console.error("[env]", s);
execFileSync(comp, ["build", "src/tc.tc", "--output", out, "--mode", "dbg"], { stdio: "inherit" });
console.error("[build] done ->", out);

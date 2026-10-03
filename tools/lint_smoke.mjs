#!/usr/bin/env node
// lint_smoke.mjs — `tc lint` 语料冒烟：锁死「零误报」不变量（S8 step3 / §0.16.13）
//
// lint 的核心质量属性不是「能报出多少」，而是**在既有语料上不误报** ——
// 一个刷屏的 linter 没人会看。本工具把 examples/ 全量跑一遍 lint 并断言
// **命中数为 0**，任一规则回归出误报即刻红。
//
// ⚠ 判据只看 examples/：**src/*.tc 的命中是真阳性**（空 if / 死代码，
// 见 §0.16.13「实测命中」），属清理 TODO，不是门禁断言对象 —— 否则
// 「清理死代码」会变成门禁的隐藏前置条件。
//
// 用法:
//   node tools/lint_smoke.mjs --compiler out/dbg/g1.exe
//   node tools/lint_smoke.mjs --compiler out/dbg/g1.exe --dir examples
//
// 退出码: 0 = 零命中；1 = 有命中（附前若干条）；2 = 用法/执行错误

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:");

function arg(name, def = "") {
    const i = process.argv.indexOf(name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const compiler = arg("--compiler", "");
const dir = arg("--dir", "examples");
if (compiler === "") {
    console.error("usage: node tools/lint_smoke.mjs --compiler <tc.exe> [--dir <dir>]");
    process.exit(2);
}

const files = readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".tc"))
    .sort();

let total = 0;
const shown = [];
for (const f of files) {
    let out = "";
    try {
        out = execFileSync(compiler, ["lint", join(dir, f)], {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 120000,
            maxBuffer: 64 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (e) {
        // 退出码可能是 --strict 命中或解析失败；输出仍要检视
        out = `${e.stdout || ""}${e.stderr || ""}`;
    }
    const hits = (out || "").split("\n").filter((l) => l.includes("T-LINT-W"));
    total += hits.length;
    for (const h of hits) {
        if (shown.length < 10) shown.push(h.replace(/\\/g, "/"));
    }
}

console.log(`lint_smoke: ${files.length} files in ${dir}/  findings=${total}`);
if (total > 0) {
    console.error(`FAIL: expected 0 findings on ${dir}/ (zero-false-positive invariant broken)`);
    for (const s of shown) console.error(`  ${s}`);
    process.exit(1);
}
console.log("OK: 0 findings (zero false positives)");
process.exit(0);

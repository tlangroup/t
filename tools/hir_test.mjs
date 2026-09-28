#!/usr/bin/env node
// hir_test.mjs — HIR AstGen 验证（ZIR 式 HIR · Stage A）
//
// 验证 emit-hir 对任意源：
//   ① 不崩溃（exit 0）          ② 产出非空文本
//   ③ 无未识别 op（文本出现 "invalid" 即说明某 op 漏登记 hir_op_name）
//   ④ 二进制 hir_to_bin / hir_from_bin 往返一致（文本逐字节相同）
//
//   ⑤ RAW 逃生舱归零（Stage B：sema 消费 HIR，RAW 会强制回落 CST 路径）
//
// 用法: node tools/hir_test.mjs [--compiler <path-to-tc.exe>] [--no-coverage]
// 退出码: 0 = 全绿, 1 = 存在失败。

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:")), "..");

function parseArgs(argv) {
    let compiler = join(ROOT, "out", "dbg", "tc.exe");
    let coverage = true;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--compiler" && i + 1 < argv.length) { compiler = resolve(argv[i + 1]); i++; }
        else if (argv[i] === "--no-coverage") { coverage = false; }
        else { console.error(`hir_test: unknown arg '${argv[i]}'`); process.exit(2); }
    }
    return { compiler, coverage };
}
const { compiler, coverage } = parseArgs(process.argv.slice(2));

function runTc(args) {
    return new Promise((res) => {
        const p = spawn(compiler, args, { cwd: ROOT, windowsHide: true });
        let out = "";
        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { out += d; });
        p.on("exit", (code) => res({ code: code ?? -1, out }));
        p.on("error", (e) => res({ code: -1, out: String(e) }));
    });
}

// ── 待测文件集 ────────────────────────────────────────────────
// hir_demo（回归样例）+ 编译器自身源码（最大、最复杂的真实源）+ 若干 examples。
import { readdirSync, existsSync } from "node:fs";
const FILES = [join(ROOT, "tests", "hir_probe", "hir_demo.tc")];
if (existsSync(join(ROOT, "src", "tc.tc"))) FILES.push(join(ROOT, "src", "tc.tc"));
const exDir = join(ROOT, "examples");
if (existsSync(exDir)) {
    const exs = readdirSync(exDir).filter((f) => f.endsWith(".tc")).sort().slice(0, 10);
    for (const f of exs) FILES.push(join(exDir, f));
}

// ── RAW 覆盖扫描集 ────────────────────────────────────────────
// Stage B 的硬前提：sema 的分派键来自 HIR 指令，任何 RAW 逃生舱都会让该节点
// 掉回 CST 路径（「消费 HIR」出现空洞）。故覆盖扫描**计入失败**。
// tests/*.tc 数量大（300+）且多为诊断用例，默认不扫（--full 打开）。
// ⚠ src/*.tc **不**单独扫：模块文件脱离 src/tc.tc 单独 emit-hir 时，
//   hir_to_text 的逐条字符串拼接会把编译器 arena 打爆（"arena: out of memory"）——
//   与 AstGen 无关（check 同文件正常）。编译器自身源码的覆盖由 src/tc.tc 代表。
const COV_DIRS = ["examples", "lib"];
const COV_FILES = [];
for (const d of COV_DIRS) {
    const dir = join(ROOT, d);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".tc")).sort()) COV_FILES.push(join(dir, f));
}
if (process.argv.includes("--full")) {
    const t = join(ROOT, "tests");
    if (existsSync(t)) for (const f of readdirSync(t).filter((f) => f.endsWith(".tc")).sort()) COV_FILES.push(join(t, f));
}

const roundTripFiles = [join(ROOT, "tests", "hir_probe", "hir_demo.tc")];
if (existsSync(join(ROOT, "src", "tc.tc"))) roundTripFiles.push(join(ROOT, "src", "tc.tc"));

let failures = 0;
const fails = [];

async function checkText(f) {
    const r = await runTc(["emit-hir", f]);
    const tag = f.replace(ROOT + (ROOT.endsWith("/") || ROOT.endsWith("\\") ? "" : "/"), "");
    if (r.code !== 0) {
        failures++; fails.push(`${tag}: exit ${r.code}`);
        console.log(`FAIL  ${tag}  (exit ${r.code})\n${r.out.split("\n").slice(-4).join("\n")}`);
        return;
    }
    const txt = r.out;
    if (txt.trim().length === 0) {
        failures++; fails.push(`${tag}: 空输出`);
        console.log(`FAIL  ${tag}  (空输出)`);
        return;
    }
    if (txt.includes("invalid")) {
        const n = (txt.match(/\binvalid\b/g) || []).length;
        failures++; fails.push(`${tag}: ${n} 处 invalid op`);
        console.log(`FAIL  ${tag}  (${n} 处未识别 op "invalid")`);
        return;
    }
    const nraw = rawCount(txt);
    if (nraw > 0) {
        failures++; fails.push(`${tag}: ${nraw} 处 RAW 逃生舱`);
        console.log(`FAIL  ${tag}  (${nraw} 处 RAW 逃生舱)`);
        return;
    }
    console.log(`ok    ${tag}  (${txt.split("\n").filter((l) => /^\d+:/.test(l)).length} insts, 0 raw 逃生舱)`);
}

async function checkRoundTrip(f) {
    const binPath = join(ROOT, "out", `_rt_${Date.now()}_${Math.floor(Math.random() * 1e6)}.hirbin`);
    const r1 = await runTc(["emit-hir", f, "--bin", "--output", binPath]);
    if (r1.code !== 0) {
        failures++; fails.push(`${f} (--bin 失败)`);
        console.log(`FAIL  roundtrip ${f}  (--bin exit ${r1.code})`);
        return;
    }
    const r2 = await runTc(["emit-hir", binPath, "--from-bin"]);
    // 清理临时二进制
    try { rmSync(binPath); } catch { /* ignore */ }
    const txtSrc = (await runTc(["emit-hir", f])).out;
    if (r2.code !== 0) {
        failures++; fails.push(`${f} (--from-bin 失败)`);
        console.log(`FAIL  roundtrip ${f}  (--from-bin exit ${r2.code})`);
        return;
    }
    if (r2.out !== txtSrc) {
        failures++; fails.push(`${f} (往返不一致)`);
        console.log(`FAIL  roundtrip ${f}  (文本与源不一致)`);
        return;
    }
    console.log(`ok    roundtrip ${f.replace(ROOT + "/", "")}  (二进制往返一致)`);
}

// RAW 逃生舱扫描：逐文件 emit-hir，统计 `:raw ` 指令数。
function rawCount(txt) {
    return (txt.match(/^\d+:raw /gm) || []).length;
}

async function checkCoverage(f) {
    const r = await runTc(["emit-hir", f]);
    const tag = f.replace(ROOT + (ROOT.endsWith("/") || ROOT.endsWith("\\") ? "" : "/"), "");
    if (r.code !== 0) {
        failures++; fails.push(`${tag}: emit-hir exit ${r.code}`);
        console.log(`FAIL  ${tag}  (emit-hir exit ${r.code})`);
        return 0;
    }
    const n = rawCount(r.out);
    if (n > 0) {
        const kinds = [...r.out.matchAll(/^\d+:raw .*?name=(\S+)/gm)].map((m) => m[1]);
        const uniq = [...new Set(kinds)].join(",");
        failures++; fails.push(`${tag}: ${n} 处 RAW 逃生舱 (${uniq})`);
        console.log(`FAIL  ${tag}  (${n} 处 RAW 逃生舱: ${uniq})`);
    }
    return n;
}

async function main() {
    console.log(`[hir_test] compiler = ${compiler}`);
    console.log(`[hir_test] 文本 AstGen 校验：${FILES.length} 文件`);
    for (const f of FILES) await checkText(f);
    console.log(`[hir_test] 二进制往返校验：${roundTripFiles.length} 文件`);
    for (const f of roundTripFiles) await checkRoundTrip(f);
    let rawTotal = 0;
    if (coverage) {
        console.log(`[hir_test] RAW 逃生舱覆盖扫描：${COV_FILES.length} 文件`);
        for (const f of COV_FILES) rawTotal = rawTotal + await checkCoverage(f);
        console.log(`[hir_test] RAW 合计 ${rawTotal} 处（要求 0：sema 才能全程消费 HIR）`);
    }

    console.log("");
    if (failures === 0) {
        console.log(`HIR TEST PASS — ${FILES.length} 文件文本校验 + ${roundTripFiles.length} 文件往返校验全绿`);
        process.exit(0);
    } else {
        console.log(`HIR TEST FAIL — ${failures} 项失败：`);
        for (const x of fails) console.log(`  - ${x}`);
        process.exit(1);
    }
}

main();

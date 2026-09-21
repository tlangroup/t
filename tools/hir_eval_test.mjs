#!/usr/bin/env node
// hir_eval_test.mjs — HIR 解释器（CTFE · Stage A'）验证
//
// 验证 `tc comptime-eval` 对 HIR 指令流的编译期求值正确性：
//   ① tests/hir_eval/basic.tc 全量顶层 const 求值，逐项比对预期值
//      （算术/位/比较/bool/unop/字符串/struct/数组/递归/while/for_each/cast）
//   ② tests/hir_eval/fact.tc --name F12 与真实后端 `tc run` 交叉对齐
//      （编译器自举后双轨一致，证明 HIR 解释器语义正确）
//
// 用法: node tools/hir_eval_test.mjs [--compiler <path-to-tc.exe>]
// 退出码: 0 = 全绿, 1 = 存在失败, 2 = 参数错误。

import { spawn } from "node:child_process";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:")), "..");

function parseArgs(argv) {
    let compiler = join(ROOT, "out", "dbg", "tc.exe");
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--compiler" && i + 1 < argv.length) { compiler = resolve(argv[i + 1]); i++; }
        else { console.error(`hir_eval_test: unknown arg '${argv[i]}'`); process.exit(2); }
    }
    return { compiler };
}
const { compiler } = parseArgs(process.argv.slice(2));

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

// ── basic.tc 预期值（与文档 hir-design.md §7 对齐，经解释器实跑确认）────
const EXPECT = {
    A: "14", B: "2", C: "1", D: "16", E: "15", F: "1",
    G: "true", H: "false", I: "-7", J: "-1", K: "true",
    S: "\"abcd\"", STR_EQ: "true",
    P: "{px=3, py=4}", PX: "3",
    ARR: "[1, 2, 3, 4]", ARR0: "1", ARRSUM: "10",
    F6: "720", F10: "3628800", FIB7: "13",
    SUM5: "15", ARRSUM2: "10", MX: "12",
    CAST1: "3.0", CAST2: "3",
};

function parseConsts(out) {
    const m = {};
    for (const line of out.split("\n")) {
        const t = line.trim();
        const mt = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (mt) m[mt[1]] = mt[2].trim();
        // 兼容 comptime-eval 单点求值的 "NAME = VAL" 形式（已 trim）
        else {
            const m2 = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*\S)\s*$/);
            if (m2) m[m2[1]] = m2[2].trim();
        }
    }
    return m;
}

let failures = 0;
const fails = [];

async function checkBasic() {
    const r = await runTc(["comptime-eval", join(ROOT, "tests", "hir_eval", "basic.tc")]);
    const tag = "tests/hir_eval/basic.tc";
    if (r.code !== 0) {
        failures++; fails.push(`${tag}: exit ${r.code}`);
        console.log(`FAIL  ${tag}  (exit ${r.code})\n${r.out.split("\n").slice(-6).join("\n")}`);
        return;
    }
    const got = parseConsts(r.out);
    let nOk = 0;
    for (const [k, v] of Object.entries(EXPECT)) {
        if (!(k in got)) {
            failures++; fails.push(`${tag}: 缺失 ${k}`);
            console.log(`FAIL  ${tag}  缺失 ${k}`);
            continue;
        }
        if (got[k] === v) { nOk++; }
        else {
            failures++; fails.push(`${tag}: ${k} = ${got[k]} (期望 ${v})`);
            console.log(`FAIL  ${tag}  ${k}: 得到 ${got[k]} 期望 ${v}`);
        }
    }
    // 反向：实跑产出但不在预期表里的（不应有 error/<none>）
    for (const [k, v] of Object.entries(got)) {
        if (!(k in EXPECT)) {
            if (v.startsWith("<") || v.startsWith(";")) {
                failures++; fails.push(`${tag}: 非预期占位 ${k}=${v}`);
                console.log(`FAIL  ${tag}  ${k} 非预期占位: ${v}`);
            }
        }
    }
    if (nOk === Object.keys(EXPECT).length) {
        console.log(`ok    ${tag}  (${nOk}/${Object.keys(EXPECT).length} 顶层 const 全绿)`);
    }
}

async function checkFact() {
    const tag = "tests/hir_eval/fact.tc";
    // ① 解释器单点求值
    const r = await runTc(["comptime-eval", join(ROOT, "tests", "hir_eval", "fact.tc"), "--name", "F12"]);
    if (r.code !== 0) {
        failures++; fails.push(`${tag}: comptime-eval exit ${r.code}`);
        console.log(`FAIL  ${tag} (comptime-eval exit ${r.code})\n${r.out.split("\n").slice(-4).join("\n")}`);
        return;
    }
    const got = parseConsts(r.out);
    if (got.F12 !== "479001600") {
        failures++; fails.push(`${tag}: F12 = ${got.F12} (期望 479001600)`);
        console.log(`FAIL  ${tag}  F12 = ${got.F12} 期望 479001600`);
        return;
    }
    // ② 与真实后端 `tc run` 交叉对齐
    const rb = await runTc(["run", join(ROOT, "tests", "hir_eval", "fact.tc")]);
    if (rb.code !== 0) {
        failures++; fails.push(`${tag}: tc run exit ${rb.code}`);
        console.log(`FAIL  ${tag} (tc run exit ${rb.code})\n${rb.out.split("\n").slice(-4).join("\n")}`);
        return;
    }
    if (!rb.out.includes("479001600")) {
        failures++; fails.push(`${tag}: tc run 输出未含 479001600`);
        console.log(`FAIL  ${tag}  tc run 输出未含 479001600: ${JSON.stringify(rb.out.split("\n").slice(-3).join("|"))}`);
        return;
    }
    console.log(`ok    ${tag}  (F12 = 479001600，与 tc run 后端一致)`);
}

async function main() {
    console.log(`[hir_eval_test] compiler = ${compiler}`);
    await checkBasic();
    await checkFact();

    console.log("");
    if (failures === 0) {
        console.log(`HIR EVAL TEST PASS — basic.tc 全量 + fact.tc 双轨对拍全绿`);
        process.exit(0);
    } else {
        console.log(`HIR EVAL TEST FAIL — ${failures} 项失败：`);
        for (const x of fails) console.log(`  - ${x}`);
        process.exit(1);
    }
}

main();

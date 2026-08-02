#!/usr/bin/env node
// difftest.mjs — M4 差分测试框架 (bootstrap.md)
//
// 用法:
//   node tools/difftest.mjs                          # 自校验: tc0 vs tc0 (验证确定性)
//   node tools/difftest.mjs --cand "out/dbg/tc.exe"    # tc0 vs tc
//   node tools/difftest.mjs --ref "<cmd>" --cand "<cmd>" [--samples <dir>]
//   node tools/difftest.mjs --ref out/dbg/tcn2.exe --cand out/dbg/tcn4.exe  # 自举代际对拍
//
// 判定: 对每个样例 × 每条命令, stdout / exit code 逐字节比对;
//       对 compile --emit-c, 比对生成的 .h/.c 文件内容 (不动点判据).
//
// 性能说明:
//   * tc0 参考实现默认**直调本地 tsx CLI**而非 `npx tsx`：npx 每次要重新解析包，
//     单次冷启动 2.4s vs 0.56s，27 次调用相差约 51 秒。
//   * 样例之间并行（--jobs，默认 8）。各样例的 emit-c 输出目录按样例名隔离，
//     stdout 类命令无落盘，故并行安全。
//
// XFAIL:
//   tc0 的 emitter 已随参考实现一同冻结，`compile --emit-c` 通道对新语法恒失败，
//   属既成基线而非回归。以 tc0 为 ref 时该通道自动标记 XFAIL（不计入失败），
//   可用 --strict 关闭、或用 --xfail <ch,...> 手工指定（通道名: lex/check/emit-c）。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { cpus } from "node:os";

const pExecFile = promisify(execFile);
const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

// ── tc0 参考实现的默认启动方式 ───────────────────────────────────
function defaultRefCmd() {
    const tsxCli = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(tsxCli)) return `node ${tsxCli} tc0/index.ts`;
    return "npx tsx tc0/index.ts"; // 兜底：未装依赖时仍可用
}

// ── CLI 参数 ─────────────────────────────────────────────────────
function parseArgs(argv) {
    const opts = {
        ref: null, cand: null, samples: join(ROOT, "tests", "samples"),
        verbose: false, tlex: null, tparse: null, tcheck: null,
        xfail: null, strict: false,
        jobs: Math.min(8, Math.max(1, cpus().length)),
    };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--ref") opts.ref = argv[++i];
        else if (argv[i] === "--cand") opts.cand = argv[++i];
        else if (argv[i] === "--samples") opts.samples = resolve(argv[++i]);
        else if (argv[i] === "--tlex") opts.tlex = resolve(argv[++i]);
        else if (argv[i] === "--tparse") opts.tparse = resolve(argv[++i]);
        else if (argv[i] === "--tcheck") opts.tcheck = resolve(argv[++i]);
        else if (argv[i] === "--xfail") opts.xfail = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
        else if (argv[i] === "--strict") opts.strict = true;
        else if (argv[i] === "--jobs") opts.jobs = Math.max(1, parseInt(argv[++i], 10) || 1);
        else if (argv[i] === "--verbose" || argv[i] === "-v") opts.verbose = true;
    }
    return opts;
}

// 命令串 → [file, args...]（简单空格切分，路径含空格时用 node 数组形式传入）
function splitCmd(cmd) {
    return cmd.trim().split(/\s+/);
}

const opts = parseArgs(process.argv.slice(2));
const REF = splitCmd(opts.ref ?? defaultRefCmd());
const CAND = opts.cand ? splitCmd(opts.cand) : REF;
const SELF_CHECK = !opts.cand;

// XFAIL 通道集合
const refIsTc0 = REF.join(" ").includes("tc0/");
let xfail = new Set();
if (!opts.strict) {
    if (opts.xfail) xfail = new Set(opts.xfail);
    else if (refIsTc0 && !SELF_CHECK) xfail = new Set(["emit-c"]);
}

// ── 执行一条编译器命令, 捕获 stdout+exit ─────────────────────────
async function runCompiler(cmdParts, args) {
    const [file, ...pre] = cmdParts;
    try {
        const { stdout } = await pExecFile(file, [...pre, ...args], {
            cwd: ROOT, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
            shell: process.platform === "win32" && (file === "npx" || file.endsWith(".cmd")),
        });
        return { code: 0, stdout };
    } catch (e) {
        return { code: typeof e.code === "number" ? e.code : -1, stdout: e.stdout ?? Buffer.alloc(0) };
    }
}

// ── 比较两份输出 ─────────────────────────────────────────────────
function diffBuffers(a, b) {
    if (a.equals(b)) return null;
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (i < len && a[i] === b[i]) i++;
    const ctx = (buf) => JSON.stringify(buf.slice(Math.max(0, i - 30), i + 30).toString("utf8"));
    return `first difference at byte ${i}:\n  ref : ${ctx(a)}\n  cand: ${ctx(b)}`;
}

// ── 测试矩阵 ─────────────────────────────────────────────────────
// stdout 类命令: 比 stdout + exit code
const STDOUT_CMDS = [
    { ch: "lex", mk: (f) => ["lex", f, "--json"] },
    { ch: "check", mk: (f) => ["check", f, "--json"] },
];

// emit 类命令: 比生成的 .h/.c 文件 (不动点判据 — 比 C 代码而非 exe)
function emitCmd(f, outDir) {
    return ["compile", f, "--emit-c", "--output", outDir];
}

// ── 并发池 ───────────────────────────────────────────────────────
async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = [];
    for (let w = 0; w < Math.min(limit, items.length); w++) {
        runners.push((async () => {
            for (;;) {
                const i = next++;
                if (i >= items.length) break;
                results[i] = await worker(items[i]);
            }
        })());
    }
    await Promise.all(runners);
    return results;
}

// ── 主流程 ───────────────────────────────────────────────────────
const samples = readdirSync(opts.samples).filter((f) => f.endsWith(".tc")).sort();
if (samples.length === 0) {
    console.error(`difftest: no .tc samples found in ${opts.samples}`);
    process.exit(2);
}
const jobs = Math.min(opts.jobs, samples.length);

console.log(`difftest: ${samples.length} samples, jobs=${jobs}`);
console.log(`  ref : ${REF.join(" ")}`);
console.log(`  cand: ${CAND.join(" ")}${SELF_CHECK ? "  (self-check mode: determinism only)" : ""}`);
if (xfail.size > 0) {
    console.log(`  xfail: ${[...xfail].join(", ")}  (tc0 emitter 已冻结，该通道恒失败属既成基线)`);
}
console.log("");

// 单个样例的全部通道
async function runSample(sample) {
    const filePath = join(opts.samples, sample);
    const rows = []; // { label, ch, err }

    // 1) stdout 类命令
    for (const { ch, mk } of STDOUT_CMDS) {
        const args = mk(filePath);
        const label = `${sample} :: tc ${args.join(" ")}`;
        const r1 = await runCompiler(REF, args);
        const r2 = await runCompiler(CAND, args);
        let err = null;
        if (r1.code !== r2.code) err = `exit code differs: ref=${r1.code} cand=${r2.code}`;
        else err = diffBuffers(r1.stdout, r2.stdout);
        rows.push({ label, ch, err });
    }

    // 2) emit-c 命令: 各自输出到独立目录, 比对文件集
    const base = basename(sample, ".tc");
    const dirRef = join(ROOT, "out", "difftest", "ref", base);
    const dirCand = join(ROOT, "out", "difftest", "cand", base);
    for (const d of [dirRef, dirCand]) mkdirSync(d, { recursive: true });
    const labelE = `${sample} :: tc compile --emit-c`;
    const e1 = await runCompiler(REF, emitCmd(filePath, join("out", "difftest", "ref", base)));
    const e2 = await runCompiler(CAND, emitCmd(filePath, join("out", "difftest", "cand", base)));
    let errE = null;
    if (e1.code !== e2.code) {
        errE = `exit code differs: ref=${e1.code} cand=${e2.code}`;
    } else if (e1.code === 0) {
        // 固定比对 <base>.h / <base>.c（emitter 输出文件名规则），避免删目录（沙箱限制）
        for (const ext of [".h", ".c"]) {
            const fr = join(dirRef, base + ext);
            const fc = join(dirCand, base + ext);
            if (!existsSync(fr) || !existsSync(fc)) { errE = `missing output file: ${base}${ext}`; break; }
            const d = diffBuffers(readFileSync(fr), readFileSync(fc));
            if (d) { errE = `${base}${ext}: ${d}`; break; }
        }
    }
    rows.push({ label: labelE, ch: "emit-c", err: errE });

    // 3) src lexer 对拍 (--tlex <exe>): tc0 `lex --json` vs 原生 tlex
    if (opts.tlex) {
        const label3 = `${sample} :: tlex vs tc0 lex --json`;
        const r1 = await runCompiler(REF, ["lex", filePath, "--json"]);
        const r2 = await runCompiler([opts.tlex], [filePath]);
        let err3 = null;
        if (r1.code !== r2.code) err3 = `exit code differs: ref=${r1.code} tlex=${r2.code}`;
        else err3 = diffBuffers(r1.stdout, r2.stdout);
        rows.push({ label: label3, ch: "tlex", err: err3 });
    }

    // 4) src parser 对拍 (--tparse <exe>): tc0 `parse` vs 原生 tparse
    if (opts.tparse) {
        const label4 = `${sample} :: tparse vs tc0 parse`;
        const r1 = await runCompiler(REF, ["parse", filePath]);
        const r2 = await runCompiler([opts.tparse], [filePath]);
        let err4 = null;
        if (r1.code !== r2.code) err4 = `exit code differs: ref=${r1.code} tparse=${r2.code}`;
        else err4 = diffBuffers(r1.stdout, r2.stdout);
        rows.push({ label: label4, ch: "tparse", err: err4 });
    }

    // 5) src checker 对拍 (--tcheck <exe>): tc0 `check --json` vs 原生 tcheck
    if (opts.tcheck) {
        const label5 = `${sample} :: tcheck vs tc0 check --json`;
        const r1 = await runCompiler(REF, ["check", filePath, "--json"]);
        const r2 = await runCompiler([opts.tcheck], [filePath]);
        let err5 = null;
        if (r1.code !== r2.code) err5 = `exit code differs: ref=${r1.code} tcheck=${r2.code}`;
        else err5 = diffBuffers(r1.stdout, r2.stdout);
        rows.push({ label: label5, ch: "tcheck", err: err5 });
    }

    return rows;
}

const perSample = await runPool(samples, jobs, runSample);

let pass = 0, fail = 0, nXfail = 0, nXpass = 0;
const failures = [];
const xpasses = [];
for (const rows of perSample) {
    for (const { label, ch, err } of rows) {
        const expectFail = xfail.has(ch);
        if (err) {
            if (expectFail) { nXfail++; if (opts.verbose) console.log(`  XFAIL ${label}`); }
            else { fail++; failures.push({ label, err }); console.log(`  FAIL  ${label}`); }
        } else {
            if (expectFail) { nXpass++; xpasses.push(label); console.log(`  XPASS ${label}`); }
            else { pass++; if (opts.verbose) console.log(`  ok    ${label}`); }
        }
    }
}

console.log("");
const parts = [`${pass} passed`, `${fail} failed`];
if (nXfail > 0) parts.push(`${nXfail} xfail`);
if (nXpass > 0) parts.push(`${nXpass} xpass`);
console.log(`difftest result: ${parts.join(", ")}`);

if (nXpass > 0) {
    console.log("\n─── XPASS（预期失败却通过了，可考虑移除 xfail 标记）───");
    for (const l of xpasses) console.log(`  ${l}`);
}
if (failures.length > 0) {
    console.log("\n─── failure details ───");
    for (const { label, err } of failures) {
        console.log(`\n[${label}]\n${err}`);
    }
    process.exit(1);
}
process.exit(0);

#!/usr/bin/env node
// difftest.mjs — M4 差分测试框架 (bootstrap.md)
//
// 用法:
//   node tools/difftest.mjs                          # 自校验: tc0 vs tc0 (验证确定性)
//   node tools/difftest.mjs --cand "build/tc1.exe"   # tc0 vs tc1
//   node tools/difftest.mjs --ref "<cmd>" --cand "<cmd>" [--samples <dir>]
//
// 判定: 对每个样例 × 每条命令, stdout / exit code 逐字节比对;
//       对 compile --emit-c, 比对生成的 .h/.c 文件内容 (不动点判据).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

// ── CLI 参数 ─────────────────────────────────────────────────────
function parseArgs(argv) {
    const opts = { ref: null, cand: null, samples: join(ROOT, "tests", "samples"), verbose: false, tlex: null, tparse: null, tcheck: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--ref") opts.ref = argv[++i];
        else if (argv[i] === "--cand") opts.cand = argv[++i];
        else if (argv[i] === "--samples") opts.samples = resolve(argv[++i]);
        else if (argv[i] === "--tlex") opts.tlex = resolve(argv[++i]);
        else if (argv[i] === "--tparse") opts.tparse = resolve(argv[++i]);
        else if (argv[i] === "--tcheck") opts.tcheck = resolve(argv[++i]);
        else if (argv[i] === "--verbose" || argv[i] === "-v") opts.verbose = true;
    }
    return opts;
}

// 命令串 → [file, args...]（简单空格切分，路径含空格时用 node 数组形式传入）
function splitCmd(cmd) {
    return cmd.trim().split(/\s+/);
}

const opts = parseArgs(process.argv.slice(2));
const REF = splitCmd(opts.ref ?? "npx tsx src/index.ts");
const CAND = opts.cand ? splitCmd(opts.cand) : REF;
const SELF_CHECK = !opts.cand;

// ── 执行一条编译器命令, 捕获 stdout+exit ─────────────────────────
function runCompiler(cmdParts, args) {
    const [file, ...pre] = cmdParts;
    try {
        const stdout = execFileSync(file, [...pre, ...args], {
            cwd: ROOT, encoding: "buffer", stdio: ["pipe", "pipe", "pipe"],
            shell: process.platform === "win32" && (file === "npx" || file.endsWith(".cmd")),
        });
        return { code: 0, stdout };
    } catch (e) {
        return { code: e.status ?? -1, stdout: e.stdout ?? Buffer.alloc(0) };
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
    (f) => ["lex", f, "--json"],
    (f) => ["check", f, "--json"],
];

// emit 类命令: 比生成的 .h/.c 文件 (不动点判据 — 比 C 代码而非 exe)
function emitCmd(f, outDir) {
    return ["compile", f, "--emit-c", "--output", outDir];
}

// ── 主流程 ───────────────────────────────────────────────────────
const samples = readdirSync(opts.samples).filter((f) => f.endsWith(".tc")).sort();
if (samples.length === 0) {
    console.error(`difftest: no .tc samples found in ${opts.samples}`);
    process.exit(2);
}

console.log(`difftest: ${samples.length} samples`);
console.log(`  ref : ${REF.join(" ")}`);
console.log(`  cand: ${CAND.join(" ")}${SELF_CHECK ? "  (self-check mode: determinism only)" : ""}`);
console.log("");

let pass = 0, fail = 0;
const failures = [];

for (const sample of samples) {
    const filePath = join(opts.samples, sample);

    // 1) stdout 类命令
    for (const mk of STDOUT_CMDS) {
        const args = mk(filePath);
        const label = `${sample} :: tc ${args.join(" ")}`;
        const r1 = runCompiler(REF, args);
        const r2 = runCompiler(CAND, args);
        let err = null;
        if (r1.code !== r2.code) err = `exit code differs: ref=${r1.code} cand=${r2.code}`;
        else err = diffBuffers(r1.stdout, r2.stdout);
        if (err) { fail++; failures.push({ label, err }); console.log(`  FAIL  ${label}`); }
        else { pass++; if (opts.verbose) console.log(`  ok    ${label}`); }
    }

    // 2) emit-c 命令: 各自输出到独立目录, 比对文件集
    const base = basename(sample, ".tc");
    const dirRef = join(ROOT, "build", "difftest", "ref", base);
    const dirCand = join(ROOT, "build", "difftest", "cand", base);
    for (const d of [dirRef, dirCand]) mkdirSync(d, { recursive: true });
    const label = `${sample} :: tc compile --emit-c`;
    const e1 = runCompiler(REF, emitCmd(filePath, join("build", "difftest", "ref", base)));
    const e2 = runCompiler(CAND, emitCmd(filePath, join("build", "difftest", "cand", base)));
    let err = null;
    if (e1.code !== e2.code) {
        err = `exit code differs: ref=${e1.code} cand=${e2.code}`;
    } else if (e1.code === 0) {
        // 固定比对 <base>.h / <base>.c（emitter 输出文件名规则），避免删目录（沙箱限制）
        for (const ext of [".h", ".c"]) {
            const fr = join(dirRef, base + ext);
            const fc = join(dirCand, base + ext);
            if (!existsSync(fr) || !existsSync(fc)) { err = `missing output file: ${base}${ext}`; break; }
            const d = diffBuffers(readFileSync(fr), readFileSync(fc));
            if (d) { err = `${base}${ext}: ${d}`; break; }
        }
    }
    if (err) { fail++; failures.push({ label, err }); console.log(`  FAIL  ${label}`); }
    else { pass++; if (opts.verbose) console.log(`  ok    ${label}`); }

    // 3) selfhost lexer 对拍 (--tlex <exe>): tc0 `lex --json` vs 原生 tlex
    if (opts.tlex) {
        const label3 = `${sample} :: tlex vs tc0 lex --json`;
        const r1 = runCompiler(REF, ["lex", filePath, "--json"]);
        const r2 = runCompiler([opts.tlex], [filePath]);
        let err3 = null;
        if (r1.code !== r2.code) err3 = `exit code differs: ref=${r1.code} tlex=${r2.code}`;
        else err3 = diffBuffers(r1.stdout, r2.stdout);
        if (err3) { fail++; failures.push({ label: label3, err: err3 }); console.log(`  FAIL  ${label3}`); }
        else { pass++; if (opts.verbose) console.log(`  ok    ${label3}`); }
    }

    // 4) selfhost parser 对拍 (--tparse <exe>): tc0 `parse` vs 原生 tparse
    if (opts.tparse) {
        const label4 = `${sample} :: tparse vs tc0 parse`;
        const r1 = runCompiler(REF, ["parse", filePath]);
        const r2 = runCompiler([opts.tparse], [filePath]);
        let err4 = null;
        if (r1.code !== r2.code) err4 = `exit code differs: ref=${r1.code} tparse=${r2.code}`;
        else err4 = diffBuffers(r1.stdout, r2.stdout);
        if (err4) { fail++; failures.push({ label: label4, err: err4 }); console.log(`  FAIL  ${label4}`); }
        else { pass++; if (opts.verbose) console.log(`  ok    ${label4}`); }
    }

    // 5) selfhost checker 对拍 (--tcheck <exe>): tc0 `check --json` vs 原生 tcheck
    if (opts.tcheck) {
        const label5 = `${sample} :: tcheck vs tc0 check --json`;
        const r1 = runCompiler(REF, ["check", filePath, "--json"]);
        const r2 = runCompiler([opts.tcheck], [filePath]);
        let err5 = null;
        if (r1.code !== r2.code) err5 = `exit code differs: ref=${r1.code} tcheck=${r2.code}`;
        else err5 = diffBuffers(r1.stdout, r2.stdout);
        if (err5) { fail++; failures.push({ label: label5, err: err5 }); console.log(`  FAIL  ${label5}`); }
        else { pass++; if (opts.verbose) console.log(`  ok    ${label5}`); }
    }
}

console.log("");
console.log(`difftest result: ${pass} passed, ${fail} failed`);
if (failures.length > 0) {
    console.log("\n─── failure details ───");
    for (const { label, err } of failures) {
        console.log(`\n[${label}]\n${err}`);
    }
    process.exit(1);
}
process.exit(0);

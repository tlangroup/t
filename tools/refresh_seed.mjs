#!/usr/bin/env node
// tools/refresh_seed.mjs
// 刷新 CI / nightly 的自举种子编译器 ci/seed/tc.exe。
//
// 背景（2026-10-14，PR #3）：out/ 被 gitignore，仓库不随附编译器二进制，故
// ci/seed/tc.exe 随仓库提交，CI 用它把 src/tc.tc 自举成 g1 再跑门禁。
// 而 src 一旦引入新语法 / 改内建签名（自举契约变化），旧种子会当场失效：
// 典型症状是 src/tc.tc 解析期致命（解析器无错误恢复），gate 的「自举一代」
// 0.2s 就 FAIL 并 fail-fast 中止 —— 表现为「CI 莫名其妙全红」。
// 本脚本把「刷新种子」从手工 cp 收口为一条命令，并在写入前后各校验一次，
// 避免把一把编不出当前源码的编译器提交进去、把红灯再锁一轮。
//
// 用法：
//   node tools/refresh_seed.mjs                 # 用 out/dbg/tc.exe 刷新（默认校验）
//   node tools/refresh_seed.mjs --dry-run       # 只报告将要做什么，不写盘
//   node tools/refresh_seed.mjs --check         # 只体检现有种子是否仍能编当前 src
//   node tools/refresh_seed.mjs --src out/dbg/g4.exe
//   node tools/refresh_seed.mjs --no-verify     # 跳过 check 校验（仅搬运，不推荐）
//   node tools/refresh_seed.mjs --force         # 即便与现有种子同 md5 也重写
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

// ── 参数 ─────────────────────────────────────────────────────────
let src = join(ROOT, "out", "dbg", "tc.exe");
let dst = join(ROOT, "ci", "seed", "tc.exe");
let dryRun = false, verify = true, force = false, checkOnly = false;
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--no-verify") verify = false;
    else if (a === "--force") force = true;
    else if (a === "--check") checkOnly = true;
    else if (a === "--src") src = resolve(process.argv[++i]);
    else if (a === "--dst") dst = resolve(process.argv[++i]);
    else { console.error(`refresh_seed: unknown arg '${a}'`); process.exit(2); }
}

const rel = (p) => p.startsWith(ROOT) ? p.slice(ROOT.length + 1).replace(/\\/g, "/") : p;
const md5 = (p) => createHash("md5").update(readFileSync(p)).digest("hex");

// ── 用编译器体检：check src/tc.tc 必须 0 error ───────────────────
// 判据取 JSON summary.errors（不是顶层 errors 键）。解析期致命错会在这里以
// 「期待 RParen，实际读到 ::」之类的形态浮现 —— 正是种子过期的典型症状。
function checkCompiles(tcPath, timeoutMs = 10 * 60 * 1000) {
    return new Promise((res) => {
        const p = spawn(tcPath, ["check", join(ROOT, "src", "tc.tc")], { cwd: ROOT, windowsHide: true });
        let out = "", done = false;
        const finish = (r) => { if (done) return; done = true; clearTimeout(t); res(r); };
        const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* noop */ } finish({ code: -1, out, timeout: true }); }, timeoutMs);
        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { out += d; });
        p.on("error", (e) => finish({ code: -1, out: String(e && e.message || e), spawnError: true }));
        p.on("exit", (code) => finish({ code: code ?? -1, out }));
    });
}

// tc check 的 stdout 是完整 JSON（stderr 为空）。整体 parse；只有输出被别的
// 日志污染时才回退到「从第一个 { 起」再 parse。
// ⚠ 不能用 lastIndexOf("{")：那会切到末尾的 "summary": { 子对象，永远取不到 summary。
function parseCheck(out) {
    const t = (out || "").trim();
    const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    return tryParse(t) ?? (t.indexOf("{") >= 0 ? tryParse(t.slice(t.indexOf("{"))) : null);
}

function summarize(out) {
    const j = parseCheck(out);
    const s = j && j.summary;
    if (!s || typeof s.errors !== "number") return null;
    return { errors: s.errors, warnings: s.warnings ?? 0, total: s.total ?? 0 };
}

// 环境性 OOM —— 与「种子过期」是两种完全不同的失败，绝不能混为一谈。
// 实测（2026-10-14）：GitHub windows-latest runner 上单跑 `check src/tc.tc`
// 会因提交限制触 mimalloc OOM（error 1455 / unable to allocate memory，
// 输出 {"error":"runtime_fatal",...}），而同一环境的 `build` 却能通过 ——
// check 要多驻留并序列化全部诊断 JSON。OOM 说明「这一步判不了」，
// 不说明种子过期；此时必须放行（SKIP），否则会把好种子误杀、把 CI 搞红。
function isOom(out) {
    return /unable to allocate memory|cannot commit OS memory|out of memory|runtime_fatal|error:\s*1455/i.test(out || "");
}

// 首条 error 级诊断（warning 不算）；JSON 不可用时回退到文本尾部。
function firstError(out) {
    const j = parseCheck(out);
    if (j && Array.isArray(j.diagnostics)) {
        const e = j.diagnostics.find((d) => d && d.severity === "error");
        if (e) {
            const loc = e.location && e.location.file
                ? `${e.location.file}:${e.location.startLine}:${e.location.startCol} `
                : "";
            return `${loc}${e.code ?? ""} ${e.message ?? ""}`.trim();
        }
    }
    return (out || "").trim().split("\n").slice(-3).join(" | ").slice(0, 200);
}

const fail = (msg) => { console.error(`refresh_seed: ${msg}`); process.exit(1); };

// ── 模式 A：只体检现有种子 ───────────────────────────────────────
if (checkOnly) {
    if (!existsSync(dst)) fail(`种子不存在：${rel(dst)}`);
    console.log(`[seed] 体检 ${rel(dst)}  (md5 ${md5(dst).slice(0, 8)}…, ${statSync(dst).size} bytes)`);
    const r = await checkCompiles(dst);
    const s = summarize(r.out);
    if (r.timeout) {
        console.error(`[seed] FAIL：check src/tc.tc 超时（10min）`);
        process.exit(1);
    }
    if (isOom(r.out)) {
        // 判不了 ≠ 过期：放行，交由后续真正的自举步骤（build）下结论。
        console.warn(`[seed] SKIP：check 因环境内存不足失败（mimalloc / OS 提交限制），无法据此判定种子是否过期。`);
        console.warn(`       ${firstError(r.out).slice(0, 160)}`);
        console.warn(`       ⇒ 交由后续「自举一代 (build)」步骤判定；本机内存充足时可单独跑本命令复核。`);
        process.exit(0);
    }
    if (r.code !== 0 || !s || s.errors !== 0) {
        console.error(`[seed] FAIL：现有种子编不出当前 src/tc.tc`);
        console.error(`       ${s ? `${s.errors} error` : "无有效 JSON 输出"} — ${firstError(r.out)}`);
        console.error(`       ⇒ 种子已过期：本地跑 node tools/refresh_seed.mjs 刷新后重新提交。`);
        process.exit(1);
    }
    console.log(`[seed] OK：现有种子可编译 src/tc.tc（0 error / ${s.warnings} warnings）`);
    process.exit(0);
}

// ── 模式 B：刷新 ─────────────────────────────────────────────────
if (!existsSync(src)) fail(`源编译器不存在：${rel(src)}\n       先跑一次自举（node tools/bootstrap.mjs）或显式 --src 指定。`);

const srcMd5 = md5(src), srcSize = statSync(src).size;
console.log(`[seed] 源   ${rel(src)}  md5 ${srcMd5.slice(0, 8)}…  ${srcSize} bytes`);
if (existsSync(dst)) {
    console.log(`[seed] 现有 ${rel(dst)}  md5 ${md5(dst).slice(0, 8)}…  ${statSync(dst).size} bytes`);
} else {
    console.log(`[seed] 现有 ${rel(dst)}  （不存在，将新建）`);
}

// ① 写入前校验：源编译器必须能编当前源码，否则会把红灯锁死在仓库里。
if (verify) {
    process.stdout.write(`[seed] 校验源编译器（check src/tc.tc）… `);
    const r = await checkCompiles(src);
    const s = summarize(r.out);
    if (r.timeout) fail(`check 超时（10min），源编译器不可用`);
    if (isOom(r.out)) {
        console.error("SKIP（环境内存不足，非种子问题）");
        fail(`校验无法进行：check 触发 mimalloc / OS 提交限制 OOM。
       本机内存充足时可重试；确认要写入请加 --no-verify（不推荐）。`);
    }
    if (r.code !== 0 || !s || s.errors !== 0) {
        console.error("FAIL");
        console.error(`       ${s ? `${s.errors} error` : "无有效 JSON 输出"} — ${firstError(r.out)}`);
        fail(`源编译器编不出 src/tc.tc，拒绝写入种子`);
    }
    console.log(`OK（0 error / ${s.warnings} warnings）`);
}

if (existsSync(dst) && md5(dst) === srcMd5 && !force) {
    console.log(`[seed] 现有种子已是该二进制，无需刷新（加 --force 可强制重写）。`);
    process.exit(0);
}

if (dryRun) {
    console.log(`[seed] --dry-run：将把 ${rel(src)} 写入 ${rel(dst)}（未写盘）`);
    process.exit(0);
}

copyFileSync(src, dst);
console.log(`[seed] 已写入 ${rel(dst)}`);

// ② 写入后复验：确保落盘的种子就是能编当前源码的那把。
if (verify) {
    process.stdout.write(`[seed] 复验新种子（check src/tc.tc）… `);
    const r = await checkCompiles(dst);
    const s = summarize(r.out);
    if (r.timeout) fail(`复验超时（10min）`);
    if (r.code !== 0 || !s || s.errors !== 0) {
        console.error("FAIL");
        console.error(`       ${s ? `${s.errors} error` : "无有效 JSON 输出"} — ${firstError(r.out)}`);
        fail(`新种子不可用，请检查后重跑（${rel(dst)} 已被覆盖）`);
    }
    console.log(`OK（0 error / ${s.warnings} warnings）`);
}

console.log(`[seed] 完成：${rel(dst)}  md5 ${md5(dst).slice(0, 8)}…`);
console.log(`[seed] 下一步：git add ci/seed/tc.exe 并提交；CI / nightly 都以它为自举起点。`);
console.log(`[seed] 提示：最终判据是 CI 的「自举一代 (tc.exe → g1)」步骤 —— 本脚本只保证 check 通过。`);

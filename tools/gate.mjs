#!/usr/bin/env node
// gate.mjs — 分层门禁编排
//
// 把「每次都付全额」改成「按改动的实际影响面付费」。
//
//   L0  改语法后每次保存        ~10s   静态检查 + 一代自举 + 产物快照 + conformance
//   L1  提交前                  ~15s   L0 + 二代不动点 + 代际对拍 (+ 运行类门禁, 见下)
//   L2  里程碑 / 合并前        ~150s   L1 全量 + 四代不动点 + C 后端自举 + tc0 对拍
//                                     + rls + tote
//
// 核心判据（见 tools/ir_snapshot.mjs）：
//   若两个后端的发射产物与基线逐字节相同，则 clang 输入不变 ⇒ 运行结果必然相同，
//   于是 run_examples / difftest 代际对拍**可以合法跳过**。L1 默认利用这一点；
//   一旦快照出现差异，自动降级为全量运行验证。--full 可强制全跑。
//
// 用法:
//   node tools/gate.mjs            # 默认 L1
//   node tools/gate.mjs L0
//   node tools/gate.mjs L2
//   node tools/gate.mjs L1 --full  # 无视快照结论，强制跑运行类门禁
//   node tools/gate.mjs L2 --keep-going   # 不 fail-fast，跑完全部步骤
//
// 说明：各步骤之间**串行**执行（不同工具并行会争抢 out/ 产物导致假失败）；
//       工具内部的用例级并行由各工具自行处理。

import { spawn } from "node:child_process";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ensureMsvcEnv } from "./msvc_env.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));
const NODE = process.execPath;

// 自动探测并注入 MSVC/Windows SDK 的 LIB+INCLUDE（非交互 shell / CI 下常缺，
// 会导致 C 后端 clang 编译 #include 找不到头而假失败）。详见 tools/msvc_env.mjs。
{
    const s = ensureMsvcEnv();
    if (s) console.log(`[env] ${s}`);
}

// ── 参数 ─────────────────────────────────────────────────────────
let level = "L1";
let full = false;
let keepGoing = false;
let verbose = false;
for (const a of process.argv.slice(2)) {
    if (/^L[012]$/i.test(a)) level = a.toUpperCase();
    else if (a === "--full") full = true;
    else if (a === "--keep-going") keepGoing = true;
    else if (a === "--verbose" || a === "-v") verbose = true;
    else { console.error(`gate: unknown arg '${a}'`); process.exit(2); }
}
const LV = Number(level[1]);
// L2 是里程碑级兜底，不做任何基于快照的跳过推理 —— 即便推理成立，
// 在里程碑上多花十几秒换「全部结论都由实跑得出」也是划算的。
if (LV === 2) full = true;

const BASE_TC = join(ROOT, "out", "dbg", "tc.exe");
if (!existsSync(BASE_TC)) {
    console.error("gate: out/dbg/tc.exe 不存在，先跑一次 bootstrap");
    process.exit(2);
}

// ── 执行辅助 ─────────────────────────────────────────────────────
// 单步硬超时（毫秒）。最慢的一步是 run_examples 双后端（约 45s），留足余量。
const STEP_TIMEOUT_MS = Number(process.env.GATE_STEP_TIMEOUT_MS || 8 * 60 * 1000);
// 'exit' 之后再等 stdio 关闭的宽限期。子进程可能 spawn 了继承管道的孙进程
// （clang / lld），孙进程若不退出，'close' 永远不来 —— 只等 'close' 会让整个
// 门禁静默挂起（实测卡死 9 分钟无输出）。故以 'exit' 为准、'close' 仅用于收尾。
const DRAIN_MS = 3000;

function run(cmd, args) {
    return new Promise((res) => {
        const p = spawn(cmd, args, { cwd: ROOT, windowsHide: true });
        let out = "";
        let done = false;
        let drainTimer = null;
        const finish = (code, extra) => {
            if (done) return;
            done = true;
            if (drainTimer) clearTimeout(drainTimer);
            clearTimeout(hardTimer);
            res({ code, out: extra ? out + extra : out });
        };
        const hardTimer = setTimeout(() => {
            try { p.kill("SIGKILL"); } catch { /* 已退出 */ }
            finish(-1, `\n[gate] 步骤超时 ${STEP_TIMEOUT_MS / 1000}s，已强制终止\n`);
        }, STEP_TIMEOUT_MS);

        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { out += d; });
        // 进程本身已退出即可判定结果；再给 stdio 一点时间排空，超时就直接收工。
        p.on("exit", (code) => {
            drainTimer = setTimeout(() => finish(code ?? -1), DRAIN_MS);
        });
        p.on("close", (code) => finish(code ?? -1));
        p.on("error", (e) => finish(-1, String(e)));
    });
}
const node = (script, ...args) => run(NODE, [join("tools", script), ...args]);
const tc = (exe, ...args) => run(exe, args);

function md5(p) {
    return createHash("md5").update(readFileSync(p)).digest("hex");
}
function findClang() {
    for (const p of [
        "C:\\Program Files\\LLVM\\bin\\clang.exe",
        "C:\\Program Files (x86)\\LLVM\\bin\\clang.exe",
    ]) if (existsSync(p)) return p;
    return "clang";
}
const CLANG = findClang();
function lastLine(s, n = 1) {
    const ls = s.trimEnd().split("\n").filter((l) => l.trim());
    return ls.slice(-n).join(" / ").trim();
}

// ── 步骤定义 ─────────────────────────────────────────────────────
// 每个 step: { id, minLevel, name, run: async (ctx) => { ok, note, skip? } }
const ctx = { irClean: false };
const G1 = join("out", "dbg", "g1");   // 一代自举产物
const G2 = join("out", "dbg", "g2");
const G3 = join("out", "dbg", "g3");
const G4 = join("out", "dbg", "g4");
const GR = join("out", "rls", "gr");   // rls 编译器

const steps = [
    {
        id: "diagdef", lv: 0, name: "诊断注册表不变量 (gen_diag --check)",
        run: async () => {
            const r = await node("gen_diag.mjs", "--check");
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        id: "static", lv: 0, name: "静态检查 (catn + shadow + dag)",
        run: async () => {
            const a = await node("catn_check.mjs");
            if (a.code !== 0) return { ok: false, note: lastLine(a.out, 3) };
            const b = await node("shadow_check.mjs");
            if (b.code !== 0) return { ok: false, note: lastLine(b.out, 3) };
            // 模块拆分后新增：import DAG 不得有反向引用。未定义的**函数**只会降级为
            // `; UNSUPPORTED call` 警告并静默产出坏 IR，编译器自身兜不住，必须静态扫。
            const c = await node("dagcheck.mjs");
            if (c.code !== 0) return { ok: false, note: lastLine(c.out, 3) };
            return { ok: true, note: `${lastLine(a.out)} | ${lastLine(b.out)} | ${lastLine(c.out)}` };
        },
    },
    {
        id: "boot_std", lv: 0, name: "预编译 std 库 (.tlib)",
        run: async () => {
            const r = await node("build_std.mjs", "--tc", BASE_TC);
            if (r.code !== 0) return { ok: false, note: lastLine(r.out, 4) };
            return { ok: true, note: "lib/std/{mem,math}.tlib 已就绪" };
        },
    },
    {
        id: "boot1", lv: 0, name: "自举一代 (tc.exe → g1)",
        run: async () => {
            const r = await tc(BASE_TC, "build", "src/tc.tc", "--output", G1);
            if (r.code !== 0) return { ok: false, note: lastLine(r.out, 4) };
            return { ok: true, note: `g1.ll md5=${md5(join(ROOT, "out/dbg/g1.ll")).slice(0, 8)}` };
        },
    },
    {
        id: "snapshot", lv: 0, name: "产物快照比对 (ll + c 双后端)",
        run: async () => {
            const r = await node("ir_snapshot.mjs", "--compiler", `${G1}.exe`);
            ctx.irClean = r.code === 0;
            if (r.code !== 0) {
                // 快照有差异不等于错误：可能是本次改动的预期效果。
                // 此处不判失败，只记录，并让后续运行类门禁强制全跑。
                const diffs = r.out.split("\n").filter((l) => /^\s+(DIFF|NEW|GONE)/.test(l)).length;
                return { ok: true, warn: true, note: `${diffs} 处差异 → 运行类门禁将全量执行` };
            }
            return { ok: true, note: lastLine(r.out.split("⇒")[0], 1) };
        },
    },
    {
        id: "conform", lv: 0, name: "conformance (诊断)",
        run: async () => {
            const r = await node("conformance.mjs", "--compiler", `${G1}.exe`);
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        id: "unsup", lv: 0, name: "UNSUPPORTED 计数",
        run: async () => {
            const ll = join(ROOT, "out", "dbg", "g1.ll");
            if (!existsSync(ll)) return { ok: false, note: "g1.ll 缺失" };
            // 口径：仅统计行首（含缩进）的 `; UNSUPPORTED`，
            // 裸 grep 会命中编译器自身的诊断字符串常量而假阳性。
            const n = readFileSync(ll, "utf8").split("\n")
                .filter((l) => /^\s*; UNSUPPORTED/.test(l)).length;
            return { ok: n === 0, note: `${n} 处` };
        },
    },
    {
        id: "boot23", lv: 1, name: "自举不动点 (g2 == g3)",
        run: async () => {
            // 判据从**第二代**起算，而非 g1 == g2。
            // g1 由改动前的编译器编出，其 .ll 反映的是旧发射器；
            // 而 g1.exe 的行为已是新的。故一旦改动了 emitter，g1 != g2 是
            // 必然且正确的现象，不动点只可能在第二代之后达成。
            // （这正是项目笔记「三阶段自举 IR 逐字节 b==c==d」的含义。）
            const r2 = await tc(`${G1}.exe`, "build", "src/tc.tc", "--output", G2);
            if (r2.code !== 0) return { ok: false, note: `g2: ${lastLine(r2.out, 3)}` };
            const r3 = await tc(`${G2}.exe`, "build", "src/tc.tc", "--output", G3);
            if (r3.code !== 0) return { ok: false, note: `g3: ${lastLine(r3.out, 3)}` };
            const a = md5(join(ROOT, "out/dbg/g2.ll"));
            const b = md5(join(ROOT, "out/dbg/g3.ll"));
            const g1 = md5(join(ROOT, "out/dbg/g1.ll"));
            const drift = g1 === a ? "" : "（g1≠g2，符合改动了发射器的预期）";
            return {
                ok: a === b,
                note: a === b ? `不动点 ${a.slice(0, 8)} ${drift}` : `g2≠g3 (${a.slice(0, 8)} vs ${b.slice(0, 8)})`,
            };
        },
    },
    {
        id: "examples", lv: 1, name: "run_examples dbg (双后端, 并行)",
        run: async () => {
            if (ctx.irClean && !full) {
                return { ok: true, skip: true, note: "产物快照全同 ⇒ 运行结果必然一致" };
            }
            // 用已达不动点的那代（g3），而非 g1
            const r = await node("run_examples.mjs", "--compiler", `${G3}.exe`, "--jobs", "1");
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        id: "diffgen", lv: 1, name: "difftest 代际对拍 (g2 ↔ g3)",
        run: async () => {
            if (ctx.irClean && !full) {
                return { ok: true, skip: true, note: "产物快照全同 ⇒ 代际输出必然一致" };
            }
            // 同样取稳定后的两代：g1 由旧编译器发射，与之对拍会在改动
            // 发射器时产生必然差异，那不是回归。
            const r = await node("difftest.mjs", "--ref", `${G2}.exe`, "--cand", `${G3}.exe`);
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        id: "boot4", lv: 2, name: "自举四代不动点 (g2 == g3 == g4)",
        run: async () => {
            const r4 = await tc(`${G3}.exe`, "build", "src/tc.tc", "--output", G4);
            if (r4.code !== 0) return { ok: false, note: `g4: ${lastLine(r4.out, 3)}` };
            // 同 boot23：g1 不参与判据（它由改动前的编译器发射）。
            const ms = ["g2", "g3", "g4"].map((g) => md5(join(ROOT, `out/dbg/${g}.ll`)));
            const same = ms.every((m) => m === ms[0]);
            return { ok: same, note: same ? `g2==g3==g4 = ${ms[0].slice(0, 8)}` : `不一致: ${ms.map((m) => m.slice(0, 6)).join(" ")}` };
        },
    },
    {
        id: "cself", lv: 2, name: "C 后端自举 (tc.c → clang → conformance)",
        run: async () => {
            // 盲区补丁：C 后端长期只在示例上验证过，从未拿它编译过编译器自身。
            // 「定长数组全局无存储」的缺陷因此潜伏了很久 —— tc.tc 用了 6 个 [N]i64
            // 全局，C 后端把 [N]T 表示为 T* 却不分配缓冲，解析首个函数子句时写
            // g_fc_d[0] 就是写 NULL。conformance 只跑 check（不碰代码生成）、
            // 示例又都不用定长数组，两道门禁都照不到。这一步专门堵住它。
            const dir = join("out", "dbg", "cself");
            const e = await tc(`${G4}.exe`, "compile", "src/tc.tc", "--emit-c", "--output", dir);
            if (e.code !== 0) return { ok: false, note: `emit-c 失败: ${lastLine(e.out, 3)}` };
            const exe = join(ROOT, dir, "tc.exe");
            const cc = await run(CLANG, [
                "-O0", "-o", exe,
                join(ROOT, dir, "tc.c"), join(ROOT, "runtime", "t_runtime.c"),
                "-I", join(ROOT, "runtime"), "-I", join(ROOT, dir), "-Wl,-subsystem:console",
                // C 后端 -O0 自举产物递归处理编译器自身超大源时会超出 1MB 默认 Windows 栈；
                // LLVM 后端同档 -O0 不溢出（代码生成更省栈），故此处仅给验证用二进制放大栈即可，
                // 不改变任何发射产物（IR 与 LLVM 后端逐字节相同，已验证）。
                "-Wl,/STACK:268435456",
            ]);
            if (cc.code !== 0) return { ok: false, note: `clang 构建失败: ${lastLine(cc.out, 3)}` };
            // ① 跨后端等价：C 产物与 LLVM 产物对同一份源必须发射逐字节相同的 IR。
            //    这同时证明 C 产物「能跑」且「跑对」——它做的是全项目最重的一份工作。
            const a = await tc(exe, "emit-ll", "src/tc.tc", "--output", join("out", "dbg", "cself_ir"));
            if (a.code !== 0) return { ok: false, note: `C 自举产物运行失败 (exit ${a.code}) ${lastLine(a.out, 2)}` };
            const m1 = md5(join(ROOT, "out/dbg/cself_ir.ll"));
            const m2 = md5(join(ROOT, "out/dbg/g4.ll"));
            if (m1 !== m2) return { ok: false, note: `跨后端行为不一致: C=${m1.slice(0, 8)} vs LLVM=${m2.slice(0, 8)}` };
            // ② 再用 C 产物跑一遍 conformance，确认诊断层面也完全一致
            const cf = await node("conformance.mjs", "--compiler", exe);
            return { ok: cf.code === 0, note: `IR 与 LLVM 产物全同 (${m1.slice(0, 8)}); ${lastLine(cf.out)}` };
        },
    },
    {
        id: "difftc0", lv: 2, name: "difftest tc0 外部对拍",
        run: async () => {
            const r = await node("difftest.mjs", "--cand", `${G4}.exe`);
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        id: "rls", lv: 2, name: "rls 快速通道 (IR 比对 + 冒烟)",
        run: async () => {
            // 依据实测：--mode 只影响输出目录与 clang 优化档，前端零介入。
            // 故 rls 的独有覆盖只有「-O2 是否破坏编译器自身」，
            // 而这一条由「rls 编译器与 dbg 编译器发射的 IR 是否逐字节相同」完全覆盖，
            // 无需重跑全部示例（要多花 30s，且历史上从未独立抓到过问题）。
            // 判据直接拿两档编译器互比，不依赖 tests/ir_baseline.json，
            // 这样即便本次改动合法地改变了 IR，此步结论依然有效。
            const b = await tc(`${G4}.exe`, "build", "src/tc.tc", "--mode", "rls", "--output", GR);
            if (b.code !== 0) return { ok: false, note: `rls 编译器构建失败: ${lastLine(b.out, 3)}` };
            const ed = await tc(`${G4}.exe`, "emit-ll", "src/tc.tc", "--output", join("out", "dbg", "gcmp_d"));
            const er = await tc(`${GR}.exe`, "emit-ll", "src/tc.tc", "--output", join("out", "dbg", "gcmp_r"));
            if (ed.code !== 0 || er.code !== 0) return { ok: false, note: "emit-ll 失败" };
            const a = md5(join(ROOT, "out/dbg/gcmp_d.ll"));
            const c = md5(join(ROOT, "out/dbg/gcmp_r.ll"));
            if (a !== c) return { ok: false, note: `-O2 改变了编译器行为: ${a.slice(0, 8)} vs ${c.slice(0, 8)}` };
            // 冒烟：确认 -O2 产物真能跑起来并输出正确
            const smoke = await node("run_examples.mjs", "--compiler", `${GR}.exe`, "--mode", "rls",
                "--only", "closure_demo,closure_struct_demo,maps");
            return { ok: smoke.code === 0, note: `IR 与 dbg 全同 (${a.slice(0, 8)}); 冒烟 ${lastLine(smoke.out)}` };
        },
    },
    {
        id: "tote", lv: 2, name: "tote 构建冒烟",
        run: async () => {
            const b = await tc(`${G4}.exe`, "build", "src/tote.tc", "--output", join("out", "dbg", "gtote"));
            if (b.code !== 0) return { ok: false, note: lastLine(b.out, 3) };
            const h = await tc(join(ROOT, "out", "dbg", "gtote.exe"), "--help");
            return { ok: h.code === 0, note: "构建 + --help 正常" };
        },
    },
];

// ── 执行 ─────────────────────────────────────────────────────────
const active = steps.filter((s) => s.lv <= LV);
console.log(`gate ${level}: ${active.length} 个步骤${full ? " (--full)" : ""}\n`);

const T0 = Date.now();
const rows = [];
let failed = 0;

for (const s of active) {
    const t = Date.now();
    process.stdout.write(`  ▸ ${s.name} ... `);
    let r;
    try {
        r = await s.run();
    } catch (e) {
        r = { ok: false, note: `异常: ${e.message}` };
    }
    const dt = (Date.now() - t) / 1000;
    const tag = r.skip ? "SKIP" : r.ok ? (r.warn ? "WARN" : "PASS") : "FAIL";
    console.log(`${tag}  ${dt.toFixed(1)}s`);
    if (verbose || !r.ok || r.warn || r.skip) console.log(`      ${r.note}`);
    rows.push({ name: s.name, tag, dt, note: r.note });
    if (!r.ok) {
        failed++;
        if (!keepGoing) { console.log("\n  (fail-fast: 已中止后续步骤，加 --keep-going 可继续)"); break; }
    }
}

const total = (Date.now() - T0) / 1000;
console.log("");
console.log("─".repeat(66));
for (const r of rows) {
    console.log(`  ${r.tag.padEnd(5)} ${r.dt.toFixed(1).padStart(5)}s  ${r.name}`);
}
console.log("─".repeat(66));
const nSkip = rows.filter((r) => r.tag === "SKIP").length;
const nWarn = rows.filter((r) => r.tag === "WARN").length;
console.log(
    `gate ${level}: ${rows.filter((r) => r.tag === "PASS").length} passed, ${failed} failed` +
    `${nSkip ? `, ${nSkip} skipped` : ""}${nWarn ? `, ${nWarn} warn` : ""}  —  ${total.toFixed(1)}s`
);

if (failed === 0 && LV === 2) {
    console.log(`\n  四代自举产物在 out/dbg/g4.exe，确认无误后安装：`);
    console.log(`    cp out/dbg/g4.exe out/dbg/tc.exe && cp ${GR}.exe out/rls/tc.exe`);
}
if (nWarn > 0) {
    console.log(`\n  ⚠ 产物快照存在差异。若为本次改动的预期效果，重录基线：`);
    console.log(`    node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`);
}
process.exit(failed === 0 ? 0 : 1);

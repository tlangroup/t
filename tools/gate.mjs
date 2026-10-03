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
import { findClang, clangVersion, toolchainReport, TC_CLANG_ENV } from "./toolchain.mjs";

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

// T0：TIR 发射期校验器在门禁与自举路径上默认开启，且有错即 exit 3。
// 动机：结构体槽位错位一类的后端静默错编，在「发射那一刻」是完全可见的，
// 却要等到运行时 arena OOM / exit 127 才以无位置信号浮现（phase-1 的代价）。
// 校验器早已实现，但默认关闭、门禁从未开启 —— 等于不存在。
// tc 子进程（boot1/boot23/boot4/cself）继承 process.env，故此处一处设置全局生效。
// 显式设 T_TIR_VERIFY=0 可临时关闭（调试发射器本身时用）。
if (process.env.T_TIR_VERIFY === undefined) process.env.T_TIR_VERIFY = "fail";

const BASE_TC = join(ROOT, "out", "dbg", "tc.exe");
if (!existsSync(BASE_TC)) {
    console.error("gate: out/dbg/tc.exe 不存在，先跑一次 bootstrap");
    process.exit(2);
}

// ── 执行辅助 ─────────────────────────────────────────────────────
// 单步硬超时（毫秒）。最慢的一步是 run_examples 双后端（约 45s），留足余量。
// 单步硬超时（毫秒）。默认 8 分钟对绝大多数步骤足够；个别步骤（产物快照比对：--jobs 1
// 串行发射 95 目标 × ll/c/h/dev）实测约 10 分钟，用调用处传入的 timeoutMs 单独放宽，
// 而不是把全局默认值抬上去、连带削弱其它步骤的卡死保护。
const STEP_TIMEOUT_MS = Number(process.env.GATE_STEP_TIMEOUT_MS || 8 * 60 * 1000);
// 'exit' 之后再等 stdio 关闭的宽限期。子进程可能 spawn 了继承管道的孙进程
// （clang / lld），孙进程若不退出，'close' 永远不来 —— 只等 'close' 会让整个
// 门禁静默挂起（实测卡死 9 分钟无输出）。故以 'exit' 为准、'close' 仅用于收尾。
const DRAIN_MS = 3000;

function run(cmd, args, timeoutMs) {
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
        const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : STEP_TIMEOUT_MS;
        const hardTimer = setTimeout(() => {
            try { p.kill("SIGKILL"); } catch { /* 已退出 */ }
            finish(-1, `\n[gate] 步骤超时 ${limit / 1000}s，已强制终止\n`);
        }, limit);

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
// 末尾可传 { timeoutMs } 覆盖单步超时（产物快照步需要，见 snapshot 步骤注释）。
const node = (script, ...args) => {
    let ms = 0;
    if (args.length && typeof args[args.length - 1] === "object" && args[args.length - 1] !== null) {
        ms = Number(args.pop().timeoutMs) || 0;
    }
    return run(NODE, [join("tools", script), ...args], ms);
};
const tc = (exe, ...args) => run(exe, args);
// T0：真 LLVM IR verifier。本环境没有 opt / llvm-as，但 LLVM-C.dll 导出 LLVMVerifyModule
// 与 LLVMParseIRInContext，可由 ctypes 直接调用（tools/llvm_verify.py —— 零构建、不需要
// LLVM 头文件）。它比 clang 更严：实测 clang 会放过 `call i8 @f(i64 42)` 这类实参类型不符。
const PY = process.env.PY || "python";
const py = (script, ...args) => run(PY, [join("tools", script), ...args]);

function md5(p) {
    return createHash("md5").update(readFileSync(p)).digest("hex");
}
// 工具链发现收口到 toolchain.mjs（单一事实来源）。解析结果注入 process.env.TC_CLANG，
// 使本门禁 spawn 的所有 tc 子进程（build / run_examples / difftest / _diffpipe …）
// 继承同一 clang —— 「门禁用的 clang」与「编译器链接用的 clang」强一致（hermetic）。
const clangResolved = findClang();
const CLANG = clangResolved.path;
if (clangResolved.via === "env" || clangResolved.via === "fixed") {
    process.env[TC_CLANG_ENV] = CLANG;
}
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
        id: "toolchain", lv: 0, name: "工具链断言 (clang / node / python / MSVC)",
        run: async () => {
            // hermetic：门禁对外部工具链的依赖从「隐式回退 PATH」改为「显式发现 + 断言」。
            // 缺 clang 在此直接失败（而非深层 cself 步报含糊的 "clang link failed"）；
            // 仅靠 PATH 裸 clang 时告警（跨机器不确定）但允许继续（真实环境通常有固定安装）。
            const envClang = process.env[TC_CLANG_ENV];
            if (envClang && !existsSync(envClang)) {
                return { ok: false, note: `TC_CLANG=${envClang} 不存在（环境变量指向无效 clang）` };
            }
            const c = findClang();
            const v = clangVersion(c.path);
            // 让所有子进程继承本次解析到的 clang（固定结果，避免各步各自解析漂移）
            process.env[TC_CLANG_ENV] = c.path;
            if (v === "unknown") {
                if (c.via === "path") return { ok: false, note: "PATH 上找不到 clang —— C 后端链接不可用" };
                return { ok: false, note: `${c.path} 不可执行` };
            }
            const rep = toolchainReport();
            const pyTag = rep.python.version === "unknown"
                ? "python 缺失（llvm_verify 步将 SKIP，仅该步降级）"
                : `python ${rep.python.version}`;
            const clangTag = c.via === "path"
                ? `clang(PATH) ${v} —— 非固定路径，跨机器不确定`
                : `${c.path} ${v}`;
            return { ok: true, warn: c.via === "path", note: `${clangTag} | node ${rep.node.version} | ${pyTag} | ${rep.os}` };
        },
    },
    {
        id: "diagdef", lv: 0, name: "诊断注册表不变量 (gen_diag --check)",
        run: async () => {
            const r = await node("gen_diag.mjs", "--check");
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        // CST kind 枚举由 tools/cstgen.mjs 依 tools/cst_kinds.json 生成。
        // 手写 kind 表必然与源码实证漂移（实测原 86 项表漏了 19 个真实 kind），
        // 漂移的表现是「节点落到 unknown 分派臂」——不报错，最难查的一类。
        // 故把「生成物 == 清单」提升为门禁不变量（见 cst-design-v2 §0.10.1）。
        id: "cstkinds", lv: 0, name: "CST kind 清单一致性 (cstgen --check)",
        run: async () => {
            const r = await node("cstgen.mjs", "--check");
            return { ok: r.code === 0, note: lastLine(r.out, 2) };
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
        id: "irverify", lv: 0, name: "IR 静态审计 (调用签名 / 括号平衡)",
        run: async () => {
            // --strict：实参/签名类型不符同样计入失败。release 版 LLVM 不跑 verifier，
            // 这类问题在 -O0 静默通过、在 -O1/-O2 被优化器按 UB 处理（7eecbae 即属此类），
            // 症状是「-O0 对、-O2 错」，定位成本极高。文本层审计是环境无 opt/llvm-as 时的替代。
            const r = await node("ir_verify.mjs", "--strict", join(ROOT, "out", "dbg", "g1.ll"));
            const nerr = (r.out.match(/^\s+ERROR /gm) || []).length;
            const nwarn = (r.out.match(/^\s+WARN  /gm) || []).length;
            return { ok: r.code === 0 && nwarn === 0, note: nerr + " 处非法 IR, " + nwarn + " 处类型不符" };
        },
    },
    {
        id: "llvmverify", lv: 0, name: "LLVM IR verifier (LLVMVerifyModule)",
        run: async () => {
            // 与 irverify 互补而非替代：ir_verify 是文本层三方签名审计，专抓「实参类型
            // 与形参签名不符」；LLVMVerifyModule 抓结构性非法（未定义类型 / unsized
            // alloca / ret 类型不符等）。实测两者的覆盖并不重叠：
            //   - `call i8 @f(i64 42)`：ir_verify 抓到，LLVMVerifyModule 放过
            //   - `%X = type opaque` + `alloca %X`：LLVMVerifyModule 抓到，clang 也抓到
            // boot23 的 `_g2dbg.ll:25 alloca %base__Node: Cannot allocate unsized type`
            // 正属后者 —— 有了这一步，它会在发射当期失败，而不是十分钟后在自举二代崩。
            const r = await py("llvm_verify.py", join(ROOT, "out", "dbg", "g1.ll"));
            if (r.code === 2) return { ok: true, warn: true, note: "SKIP（本机无 LLVM-C.dll）" };
            if (r.code !== 0) {
                const first = (r.out.split("\n").find((l) => /error:/.test(l)) || "").trim();
                return { ok: false, note: first || "LLVM verifier 报告非法 IR" };
            }
            return { ok: true, note: lastLine(r.out, 1) };
        },
    },
    {
        id: "snapshot", lv: 0, name: "产物快照比对 (ll + c 双后端)",

        run: async () => {
// ⚠ --jobs 1 是为消除并行抖动（同一目标重复发射可能取到不同临时名），代价是串行慢：
//   95 目标 × ll/c/h/dev 实测约 10 分钟，远超 8 分钟默认单步超时 → 曾稳定假红（超时被
//   当成「快照有差异」上报）。此处单独放宽到 25 分钟；不放并行度，那会动摇快照的确定性前提。
const r = await node("ir_snapshot.mjs", "--compiler", `${G1}.exe`, "--jobs", "1", { timeoutMs: 25 * 60 * 1000 });
            ctx.irClean = r.code === 0;
            if (r.code !== 0) {
                // T0（修订·2026-09-19）：基线由 LLVM 自举产物 g1 录制
                //   `node tools/ir_snapshot.mjs --update --compiler out/dbg/g1.exe`
                // 快照比较 g1 自身 vs 该基线（LLVM-vs-LLVM）。
                // 理由：C 后端产物(tc.exe) 与 LLVM 自举产物(g1) 因良性跨后端非确定性
                //   （结构体按布局命名、const 实参临时名/求值序）逐字节不同但运行期等价，
                //   C==LLVM 逐字节的前提不成立 → 原 C-oracle 基线必然误报假差异。
                // 改 LLVM 自举基线后同源同后端→确定性→只剩真 emit/后端改动会现形。
                // 交叉后端正确性由 gate 的 run_examples 双后端对拍 + LLVM IR verifier 覆盖；
                // tile_demo 既有后端 bug（Tile 元素错当成 i64 当 ptr 存）已修复并从 KNOWN_FAILING
                // 移除，恢复快照 / 双轨对拍 / 示例门禁覆盖。
                const diffs = r.out.split("\n").filter((l) => /^\s+(DIFF|NEW|GONE)/.test(l)).length;
                // diffs==0 却 rc!=0 ⇒ 不是「发射偏差」，而是快照自身执行失败（某目标发射期
                // 被 TIR verifier 中止 / emit-c 报错 / 编译器中途崩溃）。必须透传尾部输出，
                // 否则门禁只报「0 处不符」误导定位（2026-09-19 实测：真实 ERROR 被报成 0 处）。
                if (diffs === 0) {
                    return { ok: false, note: lastLine(r.out, 3) };
                }
                return { ok: false, note: `${diffs} 处与 LLVM 自举基线不符 ⇒ emit/后端发射偏差` };
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
            // ⚠ 单步超时必须单独放宽：本步用 --jobs 1 串行跑 71 个用例 × 双后端
            // （LLVM build + C compile/clang/run），实测约 8.1 分钟，已顶破 8 分钟全局
            // STEP_TIMEOUT_MS（2026-09-23 新增第 71 个用例后首次撞上，症状是恰好 480.0s
            // 被杀、但手跑同命令 71/71 全绿 —— 是超时不是失败，极易误判为回归）。
            // 与 snapshot 步同一做法：调用处传 timeoutMs，不抬高全局默认值。
            const r = await node("run_examples.mjs", "--compiler", `${G3}.exe`, "--jobs", "1",
                { timeoutMs: 20 * 60 * 1000 });
            return { ok: r.code === 0, note: lastLine(r.out) };
        },
    },
    {
        // HIR（ZIR 槽位）AstGen 护栏：emit-hir 对任意源（含编译器自身 src/tc.tc）
        // 不崩溃、产出非空、无未识别 op，且二进制 hir_to_bin/hir_from_bin 往返一致。
        // 跑在 g1（刚自举出的含新 HIR 的编译器）上，验证自举产物内 HIR 通路。
        id: "hir", lv: 1, name: "HIR AstGen 验证 (emit-hir + 二进制往返)",
        run: async () => {
            const r = await node("hir_test.mjs", "--compiler", `${G1}.exe`);
            if (r.code !== 0) return { ok: false, note: lastLine(r.out, 6) };
            return { ok: true, note: lastLine(r.out, 2) };
        },
    },
    {
        // HIR 解释器（CTFE · Stage A'）护栏：comptime-eval 解释 HIR 指令流，
        // 与文档预期逐项对齐（basic.tc 全量顶层 const + fact.tc 与真实后端双轨对拍）。
        // 这是 Stage A' 的核心交付；自举产物 g1 内必须含正确解释器，否则本步 fail。
        // 不随 irClean 跳过：新解释器是独立改动面，每次提交都须重验。
        id: "hireval", lv: 1, name: "HIR 解释器验证 (comptime-eval CTFE)",
        run: async () => {
            const r = await node("hir_eval_test.mjs", "--compiler", `${G1}.exe`);
            if (r.code !== 0) return { ok: false, note: lastLine(r.out, 6) };
            return { ok: true, note: lastLine(r.out, 2) };
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
        // v3 S-1 安全机制：双轨对拍基线，冻结新管线退化。
        // T0：由 warn 提升为硬失败 —— 双轨不一致即新管线退化的直接证据，
        // 「只记录不阻断」会让退化无限累积，直到某天以 OOM 形式爆发。
        // 不随 irClean 跳过：对拍基线必须随每次提交累积，否则退化为一次性数字。
        id: "diffpipe", lv: 1, name: "双轨对拍 (旧轨 LLVM vs 新轨 TIR)",
        run: async () => {
            // 用本次待验证的编译器 g3（boot23 步已自举，含本期 R3 类别格语法），
            // 而非冻结的种子 tc.exe —— 种子 predate overload fn 语法，无法编译本期新增的
            // overload_type / overload_catchall 等示例，会误报双轨不一致。
            if (existsSync(`${G3}.exe`) === false) return { ok: false, note: "g3.exe 缺失：前置自举步骤未产出" };
            const r = await node("_diffpipe.mjs", "--mode", "dbg", "--jobs", "4", "--strict", "--compiler", `${G3}.exe`);
            const lines = r.out.split("\n").filter((l) => l.startsWith("_diffpipe:"));
            const summary = lines.length ? lines[lines.length - 1].replace(/^_diffpipe:\s*/, "") : lastLine(r.out, 2);
            return { ok: r.code === 0, note: summary };
        },
    },
    {
        id: "repl", lv: 1, name: "REPL 冒烟 (read_line 不触发 arena OOM)",
        // 轻量回归护栏：曾经 REPL 输入 `let a=3` 即报 arena OOM（read_line 内建漏配
        // sret 兼容的 tll_read_line 末位 out 指针 shim，16B %TStr 按值发射与 sret ABI 错位）。
        // 用最朴素的单行输入（算术 / let 声明 / 字符串拼接 / :quit）确认 read_line 不再 OOM、
        // 表达式能求值、退出码为 0。详见 tools/repl_test.mjs。
        run: async () => {
            const r = await node("repl_test.mjs", "--compiler", BASE_TC);
            return { ok: r.code === 0, note: lastLine(r.out, 3) };
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
        // G3 中端优化守卫：MIR 安全 pass（opt=1）与内联 pass（opt=2）必须经四轨
        // 双后端 differential 验证（LLVM/tmir-wasm/tmir-riscv/tmir-c 对 S1 子集值对拍一致）。
        // 这是 G3「优化不改变语义」的硬证据，也是双后端漂移在 mir 层的补位守卫。
        // 不随 irClean 跳过：MIR 优化与 IR 快照正交（快照为 opt=0），须每次提交独立重验。
        id: "miropt", lv: 2, name: "MIR 中端优化 differential (opt=1 安全 pass + opt=2 内联, m1 四轨)",
        run: async () => {
            const r1 = await py("m1_difftest.py", "--opt", "1", "--tc", `${G4}.exe`);
            if (r1.code !== 0) return { ok: false, note: `MIR opt=1 对拍失败: ${lastLine(r1.out, 5)}` };
            const r2 = await py("m1_difftest.py", "--opt", "2", "--tc", `${G4}.exe`);
            if (r2.code !== 0) return { ok: false, note: `MIR opt=2 内联对拍失败: ${lastLine(r2.out, 5)}` };
            return { ok: true, note: `opt=1/2 四轨全绿 (${lastLine(r1.out, 1)})` };
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
                // 运行时改为链接预编译 deps 库（含 vendored 第三方库），理由同 run_examples.mjs
                join(ROOT, dir, "tc.c"),
                "-I", join(ROOT, "runtime"), "-I", join(ROOT, dir), "-Wl,-subsystem:console",
                join(ROOT, "out", "dbg", "deps", "t_runtime.lib"),
                // C 后端 -O0 自举产物递归处理编译器自身超大源时会超出 1MB 默认 Windows 栈；
                // LLVM 后端同档 -O0 不溢出（代码生成更省栈），故此处仅给验证用二进制放大栈即可，
                // 不改变任何发射产物（IR 与 LLVM 后端逐字节相同，已验证）。
                "-Wl,/STACK:4294967296",
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
            // ⚠ note 必须带退出码：g4 崩溃（0xC0000005 / 139）时输出尾部停在
            //   "TIR-VERIFY: 0 error(s)"，只看最后几行会被读成「0 错误却判红」——
            //   这是门禁步骤自身的显示缺陷，曾掩盖了「g4 其实是旧产物、构建时崩溃」。
            //   退出码是唯一能区分「崩溃」与「编译错误」的信号，故一律带上。
            if (existsSync(join(ROOT, `${G4}.exe`)) === false) {
                return { ok: false, note: "g4.exe 缺失：前置自举步骤未产出，本步无从判定" };
            }
            const b = await tc(`${G4}.exe`, "build", "src/tote.tc", "--output", join("out", "dbg", "gtote"));
            if (b.code !== 0) return { ok: false, note: `build 退出码 ${b.code} | ${lastLine(b.out, 3)}` };
            const h = await tc(join(ROOT, "out", "dbg", "gtote.exe"), "--help");
            return { ok: h.code === 0, note: h.code === 0 ? "构建 + --help 正常" : `--help 退出码 ${h.code}` };
        },
    },
    {
        id: "lint_smoke", lv: 2, name: "tc lint 冒烟 (examples 零误报)",
        run: async () => {
            // S8 step3（§0.16.13）：lint 的核心质量属性是「**零误报**」—— 刷屏的 linter 没人看。
            // 本步锁死该不变量：任一规则在既有语料上回归出误报即刻红。
            // ⚠ 判据只覆盖 examples/：src/*.tc 的命中是**真阳性**（空 if / 死代码），
            //   属清理 TODO —— 若纳入断言，「先清死代码」会变成门禁的隐藏前置条件。
            if (existsSync(join(ROOT, `${G1}.exe`)) === false) {
                return { ok: false, note: "g1.exe 缺失：前置自举步骤未产出，本步无从判定" };
            }
            const r = await node("lint_smoke.mjs", "--compiler", `${G1}.exe`);
            return { ok: r.code === 0, note: lastLine(r.out, 2) };
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
    // 基线由 LLVM 自举产物 g1 录制（同源同后端，确定性）：快照是 LLVM-vs-LLVM 比对，
    // 良性跨后端噪声已消除；仅在 emit/后端真改动时现形。确认偏差符合预期后重录：
    console.log(`\n  ⚠ 产物快照存在差异。确认本次改动确实改变了发射语义后，用 LLVM 自举产物重录：`);
    console.log(`    node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update`);
}
process.exit(failed === 0 ? 0 : 1);

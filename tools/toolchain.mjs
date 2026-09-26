// toolchain.mjs — 工具链发现与溯源（T2 hermetic 化）
//
// 门禁 / 自举对外部工具链（clang / node / python / MSVC 环境）的依赖原本是隐式且散落的：
//   gate.mjs、build_runtime.mjs、src/tc.tc 各写一份 clang 探测逻辑，且都静默回退到
//   PATH 上的裸 "clang"。这违背「全绿」不变式的可复现性——换台机器或升级 clang，
//   门禁结论可能无声变化，且缺工具链时只在深层 cself 步报含糊的 "clang link failed"。
//
// 本模块把发现逻辑收口到一处，并提供「身份 + 版本」溯源，供：
//   - gate.mjs 的 toolchain 步显式断言工具链可用；
//   - ir_snapshot.mjs 的 provenance 记录（_meta 不参与 DIFF，仅审计）；
//   - build_runtime.mjs / tc.exe 复用同一发现规则，保证全链路一致。
//
// 约定：优先环境变量 TC_CLANG 覆盖（hermetic：门禁注入固定路径，所有 tc 调用继承），
//       其次标准安装路径，最后回落 PATH 上的裸 "clang"（标记 via:"path" 以示非确定性）。

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

export const TC_CLANG_ENV = "TC_CLANG";

// clang 候选安装路径（与 src/tc.tc 的探测保持一致，单一事实来源）。
const CLANG_CANDIDATES = [
    "C:\\Program Files\\LLVM\\bin\\clang.exe",
    "C:\\Program Files (x86)\\LLVM\\bin\\clang.exe",
];

// 探测 clang。返回 { path, via }，via ∈ {"env","fixed","path"}：
//   env   —— 来自 TC_CLANG 且文件存在；
//   fixed —— 命中标准安装路径；
//   path  —— 回退到 PATH 上的裸 "clang"（跨机器不确定，慎用）。
// 若 TC_CLANG 指向不存在的文件，则不采用它（回落固定/PATH），避免把无效路径传给子进程。
export function findClang() {
    const env = process.env[TC_CLANG_ENV];
    if (env && existsSync(env)) return { path: env, via: "env" };
    for (const p of CLANG_CANDIDATES) {
        if (existsSync(p)) return { path: p, via: "fixed" };
    }
    return { path: "clang", via: "path" };
}

// 解析 ar（llvm-ar / llvm-lib），供 build_runtime 归档用。回落：clang 同目录 → PATH。
export function resolveAr(clangDir) {
    const cands = [
        ...(clangDir && clangDir !== "." ? [joinSafe(clangDir, "llvm-ar.exe"), joinSafe(clangDir, "llvm-ar")] : []),
        "llvm-ar",
        "llvm-lib",
        "ar",
    ];
    for (const c of cands) {
        // ⚠ stdio:"pipe" 在 Git Bash / MSYS 下 spawn Windows 子进程会报 EBUSY
        // （实测 llvm-ar.exe --version：pipe → EBUSY，ignore → OK）。探测只需要
        // 「能否启动」，不需要读输出，故用 "ignore"。
        try { execFileSync(c, ["--version"], { stdio: "ignore", windowsHide: true }); return c; } catch {}
    }
    return "ar";
}

function joinSafe(dir, name) {
    // 简单拼接，避免引入 path 依赖的跨平台细节：Windows 用反斜杠。
    return dir.endsWith("\\") ? dir + name : dir + "\\" + name;
}

// clang 首行版本串；不可用返回 "unknown"。
export function clangVersion(clangPath) {
    try {
        const out = execFileSync(clangPath, ["--version"], {
            encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
        });
        const line = out.split("\n").find((l) => l.trim()) || "";
        return line.trim() || "unknown";
    } catch {
        return "unknown";
    }
}

export function nodeVersion() {
    return process.version; // 如 "v22.22.2"
}

export function pythonVersion() {
    const py = process.env.PY || "python";
    try {
        const out = execFileSync(py, ["--version"], {
            encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
        });
        return (out.trim() || "unknown").replace(/\r/g, "");
    } catch {
        return "unknown";
    }
}

export function osInfo() {
    return `${process.platform} ${process.arch}`;
}

// 汇总报告（gate toolchain 步与 ir_snapshot provenance 共用）。
export function toolchainReport() {
    const c = findClang();
    const clangDir = (c.via === "path") ? "." : dirname(c.path);
    return {
        clang: { path: c.path, via: c.via, version: c.via === "path" ? clangVersion(c.path) : clangVersion(c.path) },
        ar: resolveAr(clangDir),
        node: { version: nodeVersion(), path: process.execPath },
        python: { version: pythonVersion() },
        os: osInfo(),
    };
}

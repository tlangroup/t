// msvc_env.mjs — 自动探测并注入 MSVC / Windows SDK 的 LIB 与 INCLUDE 环境量。
//
// 背景：clang（LLVM）在 Windows 上编译 t 生成的 C 代码时需要系统头（<stdio.h> 等）
// 与链接库（libcmt / oldnames / ucrt 等）。这些默认由 vsvars 设置到 INCLUDE/LIB 环境量，
// 但本门禁常在非交互 shell / CI 中运行，环境量缺失会导致 C 后端 `c link failed`
// （#include 找不到头）。本模块让门禁自愈：探测后写入 process.env，子进程（clang）继承。
//
// 规则：
//   - 非 Windows 平台直接跳过（无 MSVC 概念）。
//   - 若 process.env.LIB 与 process.env.INCLUDE 均已非空，则尊重调用方/CI 已设的值，不覆盖。
//   - 可用 GATE_MSVC_LIB / GATE_MSVC_INCLUDE 强制覆盖（CI 指定特定工具链时）。
//   - 探测失败时仅返回警告串，不崩溃：门禁仍可运行，C 后端可能因缺头失败，但 LLVM 后端不受影响。

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// 列出 base 下匹配 /^\d/ 的版本子目录，按字符串倒序（"较新"在前）返回。
function versions(base) {
    try {
        return readdirSync(base)
            .filter((d) => /^\d/.test(d))
            .sort()
            .reverse();
    } catch {
        return [];
    }
}

function vsInstallPath() {
    // 优先 vswhere（最可靠）
    const vswhere = "C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe";
    if (existsSync(vswhere)) {
        try {
            const p = execFileSync(
                vswhere,
                ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
                { encoding: "utf8" }
            ).trim();
            if (p && existsSync(p)) return p;
        } catch {
            /* 回退到 glob */
        }
    }
    for (const ed of ["2022", "2019", "2017"]) {
        for (const sku of ["Community", "BuildTools", "Professional", "Enterprise"]) {
            const p = `C:\\Program Files\\Microsoft Visual Studio\\${ed}\\${sku}`;
            if (existsSync(p)) return p;
        }
    }
    return null;
}

// 返回人类可读状态串；若注入失败返回以 "WARN:" 开头的串。
export function ensureMsvcEnv() {
    if (process.platform !== "win32") return null;

    const overrideLib = process.env.GATE_MSVC_LIB;
    const overrideInc = process.env.GATE_MSVC_INCLUDE;
    if (process.env.LIB && process.env.INCLUDE && !overrideLib && !overrideInc) {
        return "env already set (LIB+INCLUDE present) — 跳过探测";
    }

    const vs = vsInstallPath();
    if (!vs) return "WARN: 未找到 VS 安装，C 后端可能找不到头/库";

    const msvcVers = versions(join(vs, "VC", "Tools", "MSVC"));
    if (msvcVers.length === 0) return "WARN: 未找到 MSVC 工具集";
    const msvc = join(vs, "VC", "Tools", "MSVC", msvcVers[0]);

    const kits = "C:\\Program Files (x86)\\Windows Kits\\10";
    const kitVers = versions(join(kits, "Include"));
    if (kitVers.length === 0) return "WARN: 未找到 Windows Kits";
    const kv = kitVers[0];

    const libCands = [
        join(msvc, "lib", "x64"),
        join(kits, "Lib", kv, "um", "x64"),
        join(kits, "Lib", kv, "ucrt", "x64"),
    ];
    const incCands = [
        join(msvc, "include"),
        join(kits, "Include", kv, "ucrt"),
        join(kits, "Include", kv, "um"),
        join(kits, "Include", kv, "shared"),
    ];

    const libStr = overrideLib || libCands.filter((p) => existsSync(p)).join(";");
    const incStr = overrideInc || incCands.filter((p) => existsSync(p)).join(";");
    if (!libStr || !incStr) return "WARN: 探测到的 LIB/INCLUDE 路径不完整";

    process.env.LIB = libStr;
    process.env.INCLUDE = incStr;
    return `已自动探测注入: MSVC ${msvcVers[0]}, WinKits ${kv}`;
}

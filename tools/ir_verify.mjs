// tools/ir_verify.mjs - LLVM IR 静态审计（T0：把"非法 IR"在门禁里变成硬失败）
//
// 背景：release 版 LLVM 不跑 verifier，非法 IR 会静默通过 -O0，却在 -O1/-O2
// 被优化器按 UB 处理（历史上 7eecbae 的多余 env 实参即属此类）——症状是
// "-O0 对、-O2 错"，定位成本极高。本工具在文本层做三方签名审计，把
// 「调用实参个数与 define/declare 不一致」在编译后立即报出。
//
// 用法: node tools/ir_verify.mjs <file.ll> [--strict] [--json]
// 退出码: 0 = 干净; 1 = 存在问题（--strict 时类型不符也计入）

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
let file = null;
let strict = false;
let asJson = false;
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--strict") strict = true;
    else if (argv[i] === "--json") asJson = true;
    else if (!argv[i].startsWith("--")) file = argv[i];
}
if (!file) {
    console.error("usage: node tools/ir_verify.mjs <file.ll> [--strict] [--json]");
    process.exit(2);
}
if (!existsSync(file)) {
    console.error("ir_verify: no such file: " + file);
    process.exit(2);
}

const ATTRS = /\b(noundef|nonnull|noalias|nocapture|readonly|writeonly|zeroext|signext|inalloca|immarg|returned|swiftself|swiftasync)\b/g;
const ATTRFN = /\b(sret|byval|elementtype|preallocated|dereferenceable_or_null|dereferenceable|captures|range)\s*\([^)]*\)/g;

function stripAttrs(s) {
    let t = String(s).replace(ATTRS, " ").replace(ATTRFN, " ");
    t = t.replace(/\balign\s+\d+/g, " ");
    return t.replace(/\s+/g, " ").trim();
}

function canon(t) {
    if (!t) return "";
    if (t.endsWith("*")) return "ptr";
    if (t === "ptr" || t.indexOf("ptr ") === 0) return "ptr";
    return t;
}

function typeOf(s) {
    const t = stripAttrs(s);
    if (!t) return "";
    let m = t.match(/^\[[^\]]*\]/);
    if (m) return m[0];
    m = t.match(/^\{[^}]*\}/);
    if (m) return m[0];
    return t.split(" ")[0];
}

function retTypeOf(s) {
    const t = stripAttrs(s);
    if (!t) return "";
    const m = t.match(/\[[^\]]*\]$/);
    if (m) return m[0];
    const p = t.split(" ");
    return p[p.length - 1];
}

function splitTop(s) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (ch === "," && depth === 0) {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

function grabArgs(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
            depth--;
            if (depth === 0) return text.slice(start + 1, i);
        }
    }
    return "";
}

function decomment(l) {
    let out = "";
    let inStr = false;
    for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c === '"') {
            inStr = !inStr;
            out += c;
            continue;
        }
        if (!inStr && c === ";") break;
        out += c;
    }
    return out;
}

const raw = readFileSync(file, "utf8");
const rawNoStr = raw.replace(/c"[^"]*"/g, 'c""');
const lines = raw.split(/\r?\n/);
const defs = new Map();
const decls = new Map();
const calls = [];

for (let i = 0; i < lines.length; i++) {
    const l = decomment(lines[i]).trim();
    let m = l.match(/^define\s+([^@]*?)@([A-Za-z0-9_.$]+)\s*\(/);
    if (m) {
        const at = l.indexOf("@" + m[2]) + m[2].length + 1;
        defs.set(m[2], { ret: retTypeOf(m[1]), params: splitTop(grabArgs(l, at)).map(typeOf) });
        continue;
    }
    m = l.match(/^declare\s+([^@]*?)@([A-Za-z0-9_.$]+)\s*\(/);
    if (m) {
        const at = l.indexOf("@" + m[2]) + m[2].length + 1;
        decls.set(m[2], { ret: retTypeOf(m[1]), params: splitTop(grabArgs(l, at)).map(typeOf) });
        continue;
    }
    // 全局/元数据行（以 @ 或 ! 开头）里的 "call" 只可能是字符串常量内容，跳过。
    if (l.startsWith("@") || l.startsWith("!")) continue;
    // 调用形态必须同时覆盖 `call ...` 与 `%x = call ...`
    const cre = /(?:^|[\s=])(?:tail\s+|musttail\s+|notail\s+)?call\s+([^@]*?)@([A-Za-z0-9_.$]+)\s*\(/g;
    let cm;
    while ((cm = cre.exec(l)) !== null) {
        const name = cm[2];
        const at = l.indexOf("@" + name, cm.index) + name.length + 1;
        const args = splitTop(grabArgs(l, at)).map(typeOf);
        calls.push({ name: name, ret: retTypeOf(cm[1]), args: args, line: i + 1 });
    }
}

const problems = [];
const warns = [];
const opens = (rawNoStr.match(/\{/g) || []).length;
const closes = (rawNoStr.match(/\}/g) || []).length;
if (opens !== closes) {
    problems.push({ code: "IRV001", msg: "大括号不平衡: { " + opens + " vs } " + closes });
}

for (const c of calls) {
    const sig = defs.get(c.name) || decls.get(c.name);
    if (!sig) {
        if (c.name.indexOf("llvm.") !== 0 && c.name.indexOf("__") !== 0) {
            warns.push({ code: "IRV010", msg: "第 " + c.line + " 行: 调用未声明的 @" + c.name });
        }
        continue;
    }
    if (sig.params.length !== c.args.length) {
        problems.push({
            code: "IRV002",
            msg:
                "第 " + c.line + " 行: @" + c.name + " 实参个数 " + c.args.length +
                " != 签名 " + sig.params.length +
                " (签名: " + sig.params.join(", ") + " | 实参: " + c.args.join(", ") + ")",
        });
        continue;
    }
    for (let k = 0; k < sig.params.length; k++) {
        const a = canon(c.args[k]);
        const b = canon(sig.params[k]);
        if (!a || !b) continue;
        if (a.indexOf("(") >= 0 || b.indexOf("(") >= 0) continue;
        if (a !== b) {
            warns.push({
                code: "IRV003",
                msg: "第 " + c.line + " 行: @" + c.name + " 第 " + (k + 1) + " 实参类型 " + a + " != 签名 " + b,
            });
        }
    }
}

const fail = problems.length > 0 || (strict && warns.length > 0);
if (asJson) {
    console.log(JSON.stringify({
        file: file,
        defines: defs.size,
        declares: decls.size,
        calls: calls.length,
        problems: problems,
        warns: warns,
        ok: !fail,
    }, null, 2));
} else {
    console.log("ir_verify: " + path.basename(file) + "  define=" + defs.size + " declare=" + decls.size + " call=" + calls.length);
    for (const p of problems) console.log("  ERROR " + p.code + ": " + p.msg);
    for (const w of warns.slice(0, 30)) console.log("  WARN  " + w.code + ": " + w.msg);
    if (warns.length > 30) console.log("  ... 另有 " + (warns.length - 30) + " 条 WARN");
    console.log(fail
        ? "ir_verify: FAIL (" + problems.length + " error, " + warns.length + " warn)"
        : "ir_verify: OK (" + warns.length + " warn)");
}
process.exit(fail ? 1 : 0);

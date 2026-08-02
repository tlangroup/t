#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// t 语言规范符合性套件 runner (M11 / Stage 3)
//
// 用例 = tests/conformance/**/*.tc，首部指令行声明期望：
//   // EXPECT: pass                            → check exit 0
//   // EXPECT: error T_CODE1[, T_CODE2 ...]    → check exit != 0 且各码均出现
//   // EXPECT: warning T_CODE1[, T_CODE2 ...]  → check exit 0 且各码均出现（警告不拦截）
//
// 用法:
//   node tools/conformance.mjs                     # 用稳定版 tc1.exe 跑
//   node tools/conformance.mjs --compiler <exe>    # 指定被测编译器
//   node tools/conformance.mjs --ref               # 附加 tc0(TS) 交叉比对
//                                                    (归一化路径后 stdout+exit 必须一致)
// ═══════════════════════════════════════════════════════════════
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONF_DIR = join(ROOT, "tests", "conformance");

const args = process.argv.slice(2);
let compiler = join(ROOT, "out", "dbg", "tc.exe");
let useRef = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--compiler") compiler = resolve(args[++i]);
  else if (args[i] === "--ref") useRef = true;
  else {
    // 未知参数必须硬失败：静默忽略会让 `--tc xxx` 这类笔误退回默认编译器，
    // 制造「测的不是你以为的那个二进制」式假绿/假红。
    console.error(`conformance: 未知参数 ${args[i]}；可用参数：--compiler <路径> | --ref`);
    process.exit(2);
  }
}

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (name.endsWith(".tc")) out.push(p);
  }
  return out;
}

function runCheck(cmdv, file, useShell) {
  try {
    const opts = { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    const stdout = useShell
      ? execSync([...cmdv, "check", `"${file}"`, "--json"].join(" "), opts)
      : execFileSync(cmdv[0], [...cmdv.slice(1), "check", file, "--json"], opts);
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout ?? "" };
  }
}

// 归一化：JSON 内的绝对路径 → 文件名（正/反斜杠、转义反斜杠均处理）
function normalize(s, file) {
  const base = file.replace(/\\/g, "/").split("/").pop();
  return s
    .replace(/"file": *"[^"]*"/g, `"file": "${base}"`)
    .replace(/\r\n/g, "\n");
}

const files = collect(CONF_DIR);
if (files.length === 0) { console.error("no conformance cases found"); process.exit(2); }

const refCmd = ["npx", "tsx", `"${join(ROOT, "tc0", "index.ts")}"`];
let passed = 0, failed = 0;
const failures = [];

for (const file of files) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  const src = readFileSync(file, "utf8");
  const m = src.match(/^\/\/ EXPECT: *(pass|(error|warning) +([A-Z0-9_, ]+))/m);
  if (!m) { failed++; failures.push(`${rel}: missing "// EXPECT:" directive`); continue; }
  const kind = m[2] ?? "pass"; // pass | error | warning
  const codes = kind === "pass" ? [] : m[3].split(",").map(s => s.trim()).filter(Boolean);

  const r = runCheck([compiler], file);
  let ok = true, why = "";

  const wantExit = kind === "error" ? "nonzero" : "zero";
  if (wantExit === "zero" && r.code !== 0) { ok = false; why = `expected exit 0, got ${r.code}`; }
  if (wantExit === "nonzero" && r.code === 0) { ok = false; why = "expected error, exit=0"; }
  for (const c of codes) {
    if (!r.stdout.includes(`"code": "${c}"`) && !r.stdout.includes(`"code":"${c}"`)) {
      ok = false; why += ` missing code ${c};`;
    }
  }

  if (ok && useRef) {
    const r0 = runCheck(refCmd, file, true);
    if (r0.code !== r.code) { ok = false; why = `ref exit=${r0.code} vs cand exit=${r.code}`; }
    else if (normalize(r0.stdout, file) !== normalize(r.stdout, file)) {
      ok = false; why = "ref/cand stdout differ (normalized)";
    }
  }

  if (ok) { passed++; console.log(`  ok   ${rel}`); }
  else { failed++; failures.push(`${rel}: ${why}`); console.log(`  FAIL ${rel}  ${why}`); }
}

console.log(`\nconformance: ${passed} passed, ${failed} failed, ${files.length} total${useRef ? " (with tc0 cross-check)" : ""}`);
if (failures.length) { console.log("\nfailures:"); for (const f of failures) console.log("  - " + f); }
process.exit(failed === 0 ? 0 : 1);

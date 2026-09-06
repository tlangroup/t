#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// 第三方算法正确性测试套件 runner
//
// 扫描 tests/third_party/qoder/*.tc，对每个文件执行 `tc run`（编译+运行），
// exit 0 = pass，non-zero = fail。
//
// 用法:
//   node tests/third_party/run.mjs                     # 跑全部
//   node tests/third_party/run.mjs --compiler <exe>    # 指定被测编译器
//   node tests/third_party/run.mjs --only algo_sort    # 只跑匹配的用例
// ═══════════════════════════════════════════════════════════════
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TC_DEFAULT = join(ROOT, "out", "dbg", "tc.exe");
const TEST_DIR = join(ROOT, "tests", "third_party", "qoder");

let compiler = TC_DEFAULT;
let filter = "";
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--compiler") compiler = resolve(process.argv[++i]);
  else if (process.argv[i] === "--only") filter = process.argv[++i];
  else {
    console.error(`run: 未知参数 ${process.argv[i]}；可用参数：--compiler <路径> | --only <名称>`);
    process.exit(2);
  }
}

let files = readdirSync(TEST_DIR)
  .filter(n => n.endsWith(".tc"))
  .sort();
if (filter) files = files.filter(n => n.includes(filter));
if (files.length === 0) { console.error("no test files found"); process.exit(2); }

let passed = 0, failed = 0;
const failures = [];

for (const name of files) {
  const file = join(TEST_DIR, name);
  const rel = `tests/third_party/qoder/${name}`;
  try {
    execFileSync(compiler, ["run", file], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    passed++;
    console.log(`  ok   ${rel}`);
  } catch (e) {
    failed++;
    const stderr = (e.stderr ?? "").slice(0, 500);
    const stdout = (e.stdout ?? "").slice(0, 500);
    const detail = stderr || stdout || `exit ${e.status ?? -1}`;
    failures.push(`${rel}: ${detail}`);
    console.log(`  FAIL ${rel}  exit=${e.status ?? -1}`);
    if (stderr) console.log(`       stderr: ${stderr.split("\n")[0]}`);
  }
}

console.log(`\nthird_party: ${passed} passed, ${failed} failed, ${files.length} total`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log(`  - ${f.split("\n")[0]}`);
}
process.exit(failed === 0 ? 0 : 1);

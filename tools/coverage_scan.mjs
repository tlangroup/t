// Temporary coverage analysis: which defined diagnostic codes are asserted
// by at least one conformance case? Emits per-category gaps.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFS = JSON.parse(readFileSync(join(ROOT, "tools", "diag_defs.json"), "utf8")).defs;
const CONF = join(ROOT, "tests", "conformance");

// canonical code -> def, plus alias (legacy) -> canonical
const byCode = new Map();
const aliasToCanon = new Map();
for (const d of DEFS) {
  byCode.set(d.code, d);
  if (d.legacy) aliasToCanon.set(d.legacy, d.code);
}

function collect(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (n.endsWith(".tc")) out.push(p);
  }
  return out;
}

// A case "covers" a code if its EXPECT names that code (new or legacy form).
const coveredCanon = new Set();
const files = collect(CONF);
let expectLines = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const m = src.match(/^\/\/ EXPECT: *(pass|(error|warning|build-error)(?: +([A-Za-z0-9_,\- ]+))?)/m);
  if (!m) continue;
  expectLines++;
  if (m[2] === "pass" || !m[3]) continue;
  for (const raw of m[3].split(",")) {
    const c = raw.trim();
    if (!c) continue;
    if (byCode.has(c)) coveredCanon.add(c);
    else if (aliasToCanon.has(c)) coveredCanon.add(aliasToCanon.get(c));
    else console.log(`  [warn] EXPECT names unknown code ${c} in ${f}`);
  }
}

// group by category
const catDefs = new Map();
for (const d of DEFS) {
  if (!catDefs.has(d.cat)) catDefs.set(d.cat, []);
  catDefs.get(d.cat).push(d);
}

console.log(`defined codes: ${DEFS.length}, cases with EXPECT: ${expectLines}`);
console.log(`covered canonical codes: ${coveredCanon.size}\n`);
console.log("=== per-category coverage ===");
let totalUncovered = 0;
for (const [cat, ds] of [...catDefs.entries()].sort()) {
  const cov = ds.filter(d => coveredCanon.has(d.code));
  const unc = ds.filter(d => !coveredCanon.has(d.code));
  totalUncovered += unc.length;
  const sevBreak = unc.map(d => d.sev[0]).join("");
  console.log(`${cat.padEnd(5)} ${cov.length}/${ds.length} covered` +
    (unc.length ? `  UNCOVERED[${sevBreak}]: ${unc.map(d => d.code).join(", ")}` : "  (all covered)"));
  for (const d of unc) console.log(`      - ${d.code} (${d.sev}) ${d.name}: ${d.message}`);
}
console.log(`\ntotal uncovered codes: ${totalUncovered}`);

#!/usr/bin/env node
// stage2_convert.mjs — LL(1) Stage 2 dialect migration helper.
//
// Rewrites old-dialect function declarations `name fn(...)` → `fn name(...)`
// (preserving inter-token whitespace). It is token-aware: a hand-written
// byte-exact tokenizer skips comments and string/char literals so that
// identifiers/keywords inside them are NEVER touched, and only a true
// `Identifier` token immediately followed (same line) by a `KwFunc` token is
// swapped — provided the surrounding context proves it is a declaration:
//
//   1. the identifier must NOT be a t keyword or `step` (agent step clause);
//   2. the byte immediately before the identifier (skipping indentation) must
//      be a declaration boundary: line-start / `{` `}` `;` `,` `(` , or a
//      declaration-prefix keyword (`export` / `comptime` / `meta`). This
//      rejects expression contexts such as `if cond fn(...)` / `return fn(...)`.
//   3. `fn` must be directly followed by `(` (a declaration always has a param
//      list), rejecting any stray `name fn` that is not a declaration.
//
// Byte offsets are computed directly from the raw buffer and the rewrite is
// applied on Buffer slices, so CRLF line endings and multi-byte UTF-8 (e.g.
// Chinese comments / CJK identifiers) are preserved verbatim.
//
// Idempotent: after one pass, declarations are `fn name`, whose adjacency is
// KwFunc→Identifier (not Identifier→KwFunc), so a second run is a no-op.
//
// Usage:
//   node tools/stage2_convert.mjs <file-or-dir> [<file-or-dir> ...]
//   (directories are walked recursively for .tc/.t, skipping out/ archive/
//    node_modules/ .git tc0/ seed/ runtime/ dist/)

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:"));

// t keywords (mirrors src/lex.tc init_keywords). If such a word sits directly
// before `fn` it is NEVER a function name — it is either a declaration prefix
// (export/comptime/meta) or an expression context (return/if/let/... + lambda).
const T_KEYWORDS = new Set([
  "struct", "enum", "flag", "union", "variant", "agent", "var", "const", "let",
  "comptime", "meta", "type", "if", "else", "match", "when", "for", "while", "break",
  "continue", "return", "true", "false", "null", "map", "import", "export", "as", "in",
  "defer", "void", "string", "StringBuilder", "auto", "any",
]);
// Agent `step fn(self: State)` clause: `step` is an identifier there and the
// old form must be kept.
const EXTRA_EXCLUDE = new Set(["step"]);
// Declaration-prefix keywords that may appear immediately before the name in the
// OLD form (`export name fn` / `comptime name fn` / `meta name fn`).
const PREFIX_KW = new Set(["export", "comptime", "meta"]);

const isIdStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95; // A-Za-z_
const isIdCont = (c) => isIdStart(c) || (c >= 48 && c <= 57); // + 0-9

// ── minimal t tokenizer (byte-exact) ────────────────────────────────────────
// Returns [{type:"Identifier"|"KwFunc"|"other", value, start, end, line}]
function tokenize(buf) {
  const n = buf.length;
  const toks = [];
  let i = 0;
  let line = 1;
  while (i < n) {
    const c = buf[i];
    if (c === 10) { line++; i++; continue; }            // \n
    if (c === 13) { i++; continue; }                    // \r (ignore, CRLF-safe)
    if (c === 32 || c === 9) { i++; continue; }        // space / tab
    if (c === 47 && i + 1 < n && buf[i + 1] === 47) {  // // line comment
      i += 2; while (i < n && buf[i] !== 10) i++;
      continue;
    }
    if (c === 47 && i + 1 < n && buf[i + 1] === 42) {  // /* block comment */
      i += 2;
      while (i + 1 < n && !(buf[i] === 42 && buf[i + 1] === 47)) {
        if (buf[i] === 10) line++;
        i++;
      }
      i += 2; continue;
    }
    if (c === 34) {                                     // "..." string (incl f"...")
      i++; while (i < n) {
        if (buf[i] === 92) { i += 2; continue; }        // escape
        if (buf[i] === 34) { i++; break; }
        if (buf[i] === 10) line++;
        i++;
      }
      continue;
    }
    if (c === 39) {                                     // '...' char literal
      i++; while (i < n) {
        if (buf[i] === 92) { i += 2; continue; }
        if (buf[i] === 39) { i++; break; }
        if (buf[i] === 10) line++;
        i++;
      }
      continue;
    }
    if (isIdStart(c)) {
      const s = i; i++;
      while (i < n && isIdCont(buf[i])) i++;
      const value = buf.toString("utf8", s, i);
      const type = value === "fn" ? "KwFunc" : "Identifier";
      toks.push({ type, value, start: s, end: i, line });
      continue;
    }
    i++; // any other single byte — opaque punctuation/number
  }
  return toks;
}

// Is the byte region just before `nameStart` a declaration start?
//   - line/file start, or `{` `}` `;` `,` `(` (after skipping spaces/tabs/CR)
//   - or an identifier that is a declaration-prefix keyword (export/comptime/meta)
// Everything else (another identifier = `if cond`, `=`, `:`, …) is rejected.
function isDeclStart(buf, nameStart) {
  let i = nameStart - 1;
  while (i >= 0 && (buf[i] === 32 || buf[i] === 9 || buf[i] === 13)) i--;
  if (i < 0) return true;
  const c = buf[i];
  if (c === 10) return true;                       // \n
  if (c === 123 || c === 125) return true;         // { }
  if (c === 59) return true;                       // ;
  if (c === 44) return true;                       // ,
  if (c === 40) return true;                       // (  (nested value-level named fn, rare)
  if (isIdCont(c)) {
    let j = i;
    while (j >= 0 && isIdCont(buf[j])) j--;
    const word = buf.toString("utf8", j + 1, i + 1);
    return PREFIX_KW.has(word);
  }
  return false;
}

// After `fn` (from b.end) there must be a `(` before any newline — declarations
// always carry a parameter list.
function declFollowsFn(buf, from) {
  let i = from;
  const n = buf.length;
  while (i < n) {
    const c = buf[i];
    if (c === 32 || c === 9 || c === 13) { i++; continue; }
    if (c === 10) return false;
    return c === 40; // '('
  }
  return false;
}

function convertFile(file) {
  const buf = readFileSync(file);
  const toks = tokenize(buf);
  const edits = []; // { start, end, repl }
  for (let k = 0; k + 1 < toks.length; k++) {
    const a = toks[k], b = toks[k + 1];
    if (a.type !== "Identifier" || b.type !== "KwFunc") continue;
    if (T_KEYWORDS.has(a.value) || EXTRA_EXCLUDE.has(a.value)) continue;
    if (a.line !== b.line) continue;                       // same-line only
    const ws = buf.toString("utf8", a.end, b.start);
    if (!/^\s*$/.test(ws)) continue;                      // only whitespace between
    if (!isDeclStart(buf, a.start)) continue;             // prefix/expression guard
    if (!declFollowsFn(buf, b.end)) continue;             // fn must be followed by (
    // defensive sanity slices (should always hold)
    if (buf.toString("utf8", a.start, a.end) !== a.value) continue;
    if (buf.toString("utf8", b.start, b.end) !== "fn") continue;
    edits.push({ start: a.start, end: b.end, repl: "fn" + ws + a.value });
  }
  if (edits.length === 0) return false;
  // Apply on raw Buffer slices — byte offsets, UTF-8/multibyte safe.
  edits.sort((x, y) => y.start - x.start);
  let result = buf;
  for (const e of edits) {
    result = Buffer.concat([
      result.slice(0, e.start),
      Buffer.from(e.repl, "utf8"),
      result.slice(e.end),
    ]);
  }
  writeFileSync(file, result);
  console.log(`  CONVERTED ${relative(ROOT, file)} (${edits.length} decls)`);
  return true;
}

function walk(dir, out) {
  for (const ent of readdirSync(dir)) {
    if (ent === "out" || ent === "archive" || ent === "node_modules" ||
        ent === ".git" || ent === "tc0" || ent === "seed" ||
        ent === "runtime" || ent === "dist") continue;
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tc|t)$/.test(ent)) out.push(p);
  }
}

const targets = process.argv.slice(2);
const files = [];
for (const t of targets) {
  const p = resolve(t);
  const st = statSync(p);
  if (st.isDirectory()) walk(p, files);
  else files.push(p);
}
files.sort();
let n = 0;
for (const f of files) {
  try { if (convertFile(f)) n++; }
  catch (e) { console.error(`  ERROR ${relative(ROOT, f)}: ${e.message}`); }
}
console.log(`\nstage2_convert: ${n} files rewritten, ${files.length} scanned.`);

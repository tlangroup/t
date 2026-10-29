#!/usr/bin/env node
// stage3_convert.mjs — 把名先行类型声明 `Name KW {...}` 统一为关键字领头 `KW Name {...}`
//
//   Name struct { ... }   ->  struct Name { ... }
//   Name enum : u32 { ... } -> enum Name : u32 { ... }
//   Name #soa struct @derive(...) { ... } -> struct #soa Name @derive(...) { ... }
//   Name union { ... } / Name flag [u8] { ... } / Name variant { ... } / Name agent { ... }
//
// 处理：注解前后缀（@anno(...) / export / comptime / meta）、#soa/#aos 重排、枚举底层类型 `: T`。
// 跳过非编译目录（docs/archive/out/...）；行级正则、保留 CRLF、幂等（关键字领头形式不会被二次匹配）。
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOTS = ["src", "gen", "lib", "examples", "tests"];
const TYPE_KW = "struct|enum|union|flag|variant|agent";
const re = new RegExp(
  "^(\\s*)" +                                                                  // 1: 前导空白
  "((?:@[\\w]+(?:\\([^()]*\\))?\\s+)*(?:export\\s+|comptime\\s+|meta\\s+)*)" +  // 2: 注解/前缀
  "([A-Za-z_]\\w*)" +                                                          // 3: 类型名
  "\\s+(#(?:soa|aos))?" +                                                      // 4: #soa/#aos（名↔关键字之间）
  "\\s*(" + TYPE_KW + ")\\b" +                                                 // 5: 关键字
  "([^{}]*?)" +                                                                // 6: 关键字与 { 之间的余部（注解 / :底层类型）
  "\\{",                                                                       // 紧跟 {
  "u"
);

let filesChanged = 0;
let declsChanged = 0;

function convertLine(line) {
  const t = line.trimStart();
  if (t.startsWith("//") || t.startsWith("/*")) return line;
  // 用 replace（而非从分组重建整行）：只替换 `Name KW ... {` 片段，
  // 保留 `{` 之后同行的剩余内容（单行结构体 `Name struct { x: i32; y: i32; }` 的 ` x: i32; y: i32; }`）。
  const replaced = line.replace(re, (m, ws, pre, name, soa, kw, mid) => {
    let out = ws + pre + kw;
    if (soa) out += " " + soa;
    out += " " + name + mid + "{";
    return out;
  });
  if (replaced !== line) declsChanged++;
  return replaced;
}

function walk(dir) {
  let ents;
  try { ents = readdirSync(dir); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      walk(p);
    } else if (/\.(tc|t)$/.test(e)) {
      let text;
      try { text = readFileSync(p, "utf8"); } catch { continue; }
      const lines = text.split("\n");
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const hasCR = raw.endsWith("\r");
        const content = hasCR ? raw.slice(0, -1) : raw;
        const nl = convertLine(content);
        if (nl !== content) {
          lines[i] = nl + (hasCR ? "\r" : "");
          changed = true;
        }
      }
      if (changed) {
        writeFileSync(p, lines.join("\n"));
        filesChanged++;
        console.log("changed: " + p);
      }
    }
  }
}

for (const r of ROOTS) walk(r);
console.log(`\nstage3 convert done: ${filesChanged} files, ${declsChanged} declarations rewritten`);

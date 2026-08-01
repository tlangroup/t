#!/usr/bin/env node
// temp build helper: compile an already-emitted tc.c + runtime into an exe via MSVC.
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
function findMsvc() {
  for (const vsRoot of ["C:\\Program Files\\Microsoft Visual Studio\\2022", "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022"]) {
    if (!existsSync(vsRoot)) continue;
    for (const edition of readdirSync(vsRoot)) {
      const msvcDir = join(vsRoot, edition, "VC", "Tools", "MSVC");
      if (!existsSync(msvcDir)) continue;
      for (const v of readdirSync(msvcDir).sort().reverse()) {
        const cl = join(msvcDir, v, "bin", "Hostx64", "x64", "cl.exe");
        if (!existsSync(cl)) continue;
        const kitsInc = "C:\\Program Files (x86)\\Windows Kits\\10\\Include";
        const kitsLib = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib";
        if (!existsSync(kitsInc)) continue;
        const sdk = readdirSync(kitsInc).sort().reverse()[0];
        const msvcHome = join(msvcDir, v);
        return {
          cl,
          env: { ...process.env,
            INCLUDE: [join(msvcHome, "include"), join(kitsInc, sdk, "ucrt"), join(kitsInc, sdk, "um"), join(kitsInc, sdk, "shared")].join(";"),
            LIB: [join(msvcHome, "lib", "x64"), join(kitsLib, sdk, "ucrt", "x64"), join(kitsLib, sdk, "um", "x64")].join(";") },
        };
      }
    }
  }
  return null;
}
const msvc = findMsvc();
if (!msvc) { console.error("MSVC not found"); process.exit(2); }
const outDir = join(ROOT, "out", "dbg", process.argv[2] || "tc-new");
const cFile = join(outDir, (process.argv[3] || "tc") + ".c");
try {
  const out = execFileSync(msvc.cl, [
    "/nologo", "/std:c11", "/utf-8", "/Od",
    `/I${join(ROOT, "runtime")}`, `/I${outDir}`,
    cFile, join(ROOT, "runtime", "t_runtime.c"),
    `/Fo${outDir}\\`, `/Fe${join(outDir, "tc.exe")}`,
  ], { cwd: ROOT, env: msvc.env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  console.log(out);
} catch (e) {
  console.error("CL FAILED. stdout:\n", (e.stdout || "").toString());
  console.error("CL FAILED. stderr:\n", (e.stderr || "").toString());
  process.exit(1);
}
console.log("built", join(outDir, "tc.exe"));

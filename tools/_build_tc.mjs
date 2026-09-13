import { ensureMsvcEnv } from "./msvc_env.mjs";
import { execFileSync } from "node:child_process";
const s = ensureMsvcEnv();
console.error("[env]", s);
execFileSync("out/dbg/tc.exe", ["build", "src/tc.tc", "--output", "out/dbg/tc_new", "--mode", "dbg"], { stdio: "inherit" });
console.error("[build] done");

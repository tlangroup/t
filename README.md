# t

> A **data-driven, ECS-oriented, AI-Agent-friendly** systems language with a **self-hosting compiler** —
> and a third dimension most languages lack: **extendime**.

[![Self-hosting](https://img.shields.io/badge/self--hosting-%E2%9C%93-brightgreen)](https://github.com/tlangroup/t)
[![Backends](https://img.shields.io/badge/backends-C11%20%7C%20LLVM%20IR-blue)](https://github.com/tlangroup/t)
[![extendime](https://img.shields.io/badge/extendime-%E2%9C%93-brightgreen)](https://github.com/tlangroup/tote)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Source files use the `.tc` extension and compile to **C11** or **LLVM IR**. The compiler (`tc`) is
written in `t` itself.

---

## 🕐 comptime · runtime · extendime — the three times of t

| time | when it happens | what you get to do |
|------|----------------|--------------------|
| **comptime** | during compilation | run real `t` code, fold constants, generate types via `comptime { }` |
| **runtime** | in the running program | the actual executable behavior |
| **extendime** | at build-config time | derive *your own `tc` variant* — extend the language itself |

Every language gives you `comptime` (code that runs while compiling) and `runtime` (code that runs in
the program). `t` adds **extendime**: the moment a project reshapes the *compiler itself* to gain new
syntax and semantics for its own domain — **without forking or mutating the root compiler**.

- Extensions are **derived, never modified**. Your variant is built on top of the root `tc`; the root
  stays pure and untouched.
- Therefore **hermeticity is structural**: dependencies are always compiled by the *root* `tc`, never
  by your variant. "Global feature leaks into dependencies" become **impossible by construction**.
- Net effect: **extendime lifts the expressive ceiling of the language** above "whatever its authors
  shipped." A project can grow `t` to fit its domain and still interoperate cleanly with everything else.

`extendime` is operationalized by [`tote`](https://github.com/tlangroup/tote) — `t`'s build/package
manager — via its `[compiler].extend` directive.

---

## ✨ Features

- 🧠 **Self-hosting** — the compiler is written in `t` and bootstraps to a verified fixed point
  (`g2 == g3 == g4` byte-identical), gated by `tools/gate.mjs` (L2).
- ⚙️ **Dual backend** — emit **C11** (portable, drop-in) or **LLVM IR** (optimized, native).
- 🪄 **comptime metaprogramming** — `comptime { }` blocks run real `t` code during compilation;
  `@compile_log` / `@compile_warning` / `@compile_error` drive compile-time introspection.
- 🤖 **AI-Agent friendly** — `tc check/lex --json` emit machine-readable diagnostics; the conformance
  suite is driven by `// EXPECT:` headers.
- 📦 **Reproducible runtime** — precompiled `t_runtime.lib` (arena / TStr / TSlice / TMap) with
  automatic source fallback.
- 🧩 **Modular compiler** — `src/tc.tc` plus layered `base / lex / parse / sema / codegen_c /
  codegen_ll` modules, organized by an import DAG with no cycles.

---

## 👀 A taste of t

```t
@import("std");

fn main() i32 @main {
    println("hello from t");
    return 0;
}
```

---

## 🚀 Quick start

```bash
# Compile & run (.tc -> LLVM IR -> exe; needs clang)
out/dbg/tc.exe run   app.tc
out/dbg/tc.exe build app.tc              # -> out/dbg/app.ll + app.exe
out/dbg/tc.exe emit-ll app.tc            # LLVM IR only

# Cargo-style examples
out/dbg/tc.exe run   --example hello
out/dbg/tc.exe build --example fib

# Compile to C11 instead of LLVM IR
out/dbg/tc.exe compile app.tc --emit-c --output out/dbg/app

# Type-check with JSON diagnostics (AI-Agent friendly)
out/dbg/tc.exe check app.tc --json
out/dbg/tc.exe lex   app.tc --json
```

Build flags (also forwarded by `tote`): `--mode dbg|rls` (default `dbg`; `rls` uses `-O2`),
`--clang <path>`, `--runtime <dir>`, `--output <prefix>`.

---

## 🔧 Building from source (bootstrap)

The repo ships prebuilt `tc.exe` in release artifacts. To build from source, the canonical pipeline is
(children in `docs/bootstrap.md`):

```bash
node tools/build_runtime.mjs                          # -> out/{dbg,rls}/deps/t_runtime.lib
out/dbg/tc.exe build src/tc.tc --output out/dbg/tc     # bootstrap a new tc with the previous one
out/dbg/tc.exe build src/tc.tc --mode rls --output out/rls/tc
```

The compiler is verified by `tools/gate.mjs` (self-host fixed point + conformance + dual-backend
runtime cross-check). See `docs/spec.md` for the language specification.

---

## 📁 Project layout

- `src/` — the compiler `tc.tc` and its layered modules (`base / lex / parse / sema / codegen_c /
  codegen_ll`); `tc.tc` is the entry + CLI dispatch.
- `examples/` — runnable samples (`tc run --example <name>`).
- `runtime/` — C runtime (arena / TStr / TSlice / TMap).
- `out/` — build artifacts (`dbg` / `rls` subtrees).
- `docs/spec.md` — language specification (source of truth); `docs/bootstrap.md` — bootstrap roadmap.
- `tools/` — `gate.mjs` (verification gate), `conformance.mjs`, `difftest.mjs`, `run_examples.mjs`,
  `build_runtime.mjs`, `dagcheck.mjs`, and more.
- `tests/` — conformance suite (`// EXPECT:` headers) and differential samples.

---

## 🌿 Related: [`tote`](https://github.com/tlangroup/tote)

`tote` is `t`'s cargo-shaped build/package manager and the home of **extendime**. It derives project
`tc` variants, caches them content-addressed, and wires them into compilation — all without touching
the root compiler. A project's `[compiler].extend` directive is the extendime declaration.

---

## 📚 Inspired by

ZeroLang, Karn, Zig, Rust, Erlang, Verse, Flix, MoonBit, Crystal.

---

## 📜 License

Licensed under **MIT**. (Add a `LICENSE` file at the repo root to make this explicit.)

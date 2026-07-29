# t Language Compiler - Project Notes

## Project Overview
- t is a data-driven, ECS-oriented, AI-Agent-friendly static type system language
- File extension: .tc
- Compiler implemented in TypeScript, transpiles to C
- Spec document: docs/spec.md

## Architecture
- `src/diagnostics/` — Dual-output diagnostic system (human + JSON)
- `src/lexer/` — Tokenizer
- `src/ast/` — AST node definitions + walker
- `src/parser/` — Recursive descent parser
- `src/types/` — Type system + type checker
- `src/annotations/` — Annotation registry + derive processor + test runner
- `src/flag/` — Flag/bitfield system with SlotInfo
- `src/comptime/` — CTFE engine + type_info introspection
- `src/codegen/` — AST JSON export + C code emitter
- `src/index.ts` — CLI entry point (tc command)

## Key Design Decisions
- Implementation language: TypeScript (static typing, good for compilers)
- Code generation strategy: Transpile to C, leverage existing C toolchains
- Parser: Recursive descent with precedence climbing for expressions
- Annotation system: Registry pattern for extensibility
- Flag system: Auto bit allocation with @offset override

## Build & Run
- `npx tsx src/index.ts check <file.tc>` — type check
- `npx tsx src/index.ts compile <file.tc> --emit-c --output build/` — generate C code
- `npx tsx src/index.ts build <file.tc> --output build/x` — .tc → C → native exe (MSVC cl)
- `npx tsx src/index.ts lex <file.tc> --json` — export token stream JSON
- `npx tsx src/index.ts test <file.tc>` — run @test cases
- `npx tsx src/index.ts ast <file.tc>` — export AST JSON
- `npx tsx src/index.ts type-info <file.tc> <TypeName>` — print type_info(T)
- `node tools/difftest.mjs [--tlex build/tlex/lexer.exe]` — byte-level diff testing

## Bootstrap (self-hosting) status
- Plan: docs/bootstrap.md (M1-M11). Done: M1 runtime, M2 tc0 gaps, M3 probe, M4 difftest, M5 lexer
- `runtime/t_runtime.{h,c}` — C runtime (arena/TStr/TSb/TSlice/TMap); MSVC needs /utf-8 + BOM
- C compiler: VS2022 cl.exe (14.37.32822, SDK 10.0.22621.0), set INCLUDE/LIB/Path manually
- `selfhost/lexer.tc` — t-language lexer, byte-identical to tc0 `lex --json` on all samples
- Determinism rules: line/col = UTF-8 byte count; stdout binary mode on Windows; sb_to_str copies
- t syntax notes: `Name :: struct { f: T; }` (semicolon fields); no else-if chains (nest instead)
- Next: M6-M9 port parser/checker/emitter to selfhost/*.tc → M10 fixpoint → M11 seal seed

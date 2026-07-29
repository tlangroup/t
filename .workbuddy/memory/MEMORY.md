# t Language Compiler - Project Notes

## Project Overview
- t is a data-driven, ECS-oriented, AI-Agent-friendly static type system language
- File extension: .tc
- Compiler implemented in TypeScript, transpiles to C
- Spec document: docs/spec.md

## Architecture
- `tc0/diagnostics/` — Dual-output diagnostic system (human + JSON)
- `tc0/lexer/` — Tokenizer
- `tc0/ast/` — AST node definitions + walker
- `tc0/parser/` — Recursive descent parser
- `tc0/types/` — Type system + type checker
- `tc0/annotations/` — Annotation registry + derive processor + test runner
- `tc0/flag/` — Flag/bitfield system with SlotInfo
- `tc0/comptime/` — CTFE engine + type_info introspection
- `tc0/codegen/` — AST JSON export + C code emitter
- `tc0/index.ts` — CLI entry point (tc command)

## Key Design Decisions
- Implementation language: TypeScript (static typing, good for compilers)
- Code generation strategy: Transpile to C, leverage existing C toolchains
- Parser: Recursive descent with precedence climbing for expressions
- Annotation system: Registry pattern for extensibility
- Flag system: Auto bit allocation with @offset override

## Build & Run
- `npx tsx tc0/index.ts check <file.tc>` — type check
- `npx tsx tc0/index.ts compile <file.tc> --emit-c --output build/` — generate C code
- `npx tsx tc0/index.ts build <file.tc> --output build/x` — .tc → C → native exe (MSVC cl)
- `npx tsx tc0/index.ts lex <file.tc> --json` — export token stream JSON
- `npx tsx tc0/index.ts test <file.tc>` — run @test cases
- `npx tsx tc0/index.ts ast <file.tc>` — export AST JSON
- `npx tsx tc0/index.ts type-info <file.tc> <TypeName>` — print type_info(T)
- `node tools/difftest.mjs [--tlex build/tlex/lexer.exe]` — byte-level diff testing

## Bootstrap status — ✅ COMPLETE (M1–M11, tag v1.0-selfhost, git repo initialized)
- **主实现 = src/tc1.tc**（~6300 行单文件，lex/check/compile 全命令）；稳定版: build/tc1/tc1/tc1.exe
- tc0 (TypeScript, tc0/) 已冻结；种子封存 seed/tc0/（信任根，永不删除）
- 验证三件套：`node tools/difftest.mjs --cand build/tc1/tc1/tc1.exe`（42 项逐字节）、`node tools/bootstrap.mjs`（三轮自编译不动点）、`node tools/conformance.mjs --ref`（tests/conformance 16 用例 + tc0 交叉）
- Stage 3 晋升规则：改 spec → 补 conformance 测试 → 改 tc1.tc → 套件+difftest → 不动点复验 → 晋升
- `runtime/t_runtime.{h,c}` — C runtime; MSVC 需 /utf-8 + 生成 C 带 BOM（.tc 源不能带 BOM）
- C compiler: VS2022 cl.exe (14.37.32822, SDK 10.0.22621.0)，PowerShell 里手动设 INCLUDE/LIB/Path
- Determinism: line/col = UTF-8 字节计数; stdout 二进制模式; sb_to_str 复制语义
- t 语法: `Name :: struct { f: T; }`；无 else-if 链；`append(s, call())` 会取临时量地址(C2102)，须先存局部变量
- 诊断怪癖：T_TYPE_UNKNOWN 从未发出（实报 T_TYPE_MISMATCH）；命名违规是 warning (exit 0)
- 技术债：Variant(G10)、CSV/JSON CTFE 导入、@soa、通用内存管理、优化后端

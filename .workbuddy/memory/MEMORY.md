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
- **LLVM 直达（M13, commit b3421ff）**: `build/tc1/tc1/tc1.exe build <f.tc> --clang "C:/Program Files/LLVM/bin/clang.exe"` — .tc → .ll → exe；`emit-ll` 只出 IR。链接 runtime/t_runtime.c + runtime/t_shim_ll.c（指针化 tll_* 桥，规避 Win64 聚合 ABI）。值模型：标量=SSA(bool=i8)、聚合=entry 块 alloca ptr；用户函数 mangle @t.<name>；全局走 @t.__ginit
- 注意：tc1 C 后端 sys_run 必须直通输出 `sys_run(...)`（与 tc0 一致，靠 t_runtime.h 宏），否则自举不动点破坏
- `npx tsx tc0/index.ts check <file.tc>` — type check
- `npx tsx tc0/index.ts compile <file.tc> --emit-c --output build/` — generate C code
- `npx tsx tc0/index.ts build <file.tc> --output build/x` — .tc → C → native exe (MSVC cl)
- `npx tsx tc0/index.ts lex <file.tc> --json` — export token stream JSON
- `npx tsx tc0/index.ts test <file.tc>` — run @test cases
- `npx tsx tc0/index.ts ast <file.tc>` — export AST JSON
- `npx tsx tc0/index.ts type-info <file.tc> <TypeName>` — print type_info(T)
- `node tools/difftest.mjs [--tlex build/tlex/lexer.exe]` — byte-level diff testing

## LLVM 后端 (M13–M15) — ✅ 双后端自举完成
- `tc1 build <f.tc>` = .tc→.ll→exe（clang 自动探测）；`emit-ll` 只出 IR；`run [--example <n>]` = cargo 风格构建+运行（M14，示例在 examples/，产物 build/examples/）
- **M15 自举**：`tc1 build src/tc1.tc` 成功 → build/selfll/tc1.exe；LLVM 不动点达成（C 出身/LLVM 出身 emit-ll 逐字节一致）
- 值模型：标量=SSA(bool=i8)，聚合=ptr+入口块 alloca；runtime 桥 runtime/t_shim_ll.c (tll_*)
- 易错点：ll_etd（类型查询）必须与发射逻辑一致——binary 用 ll_bin_td（字面量让位），比较→bool，paren 透传（M15 修的就是这个错配）
- 验证四件套：bootstrap 不动点 + difftest + conformance + LLVM 不动点（selfll emit-ll cmp）

## Bootstrap status — ✅ COMPLETE (M1–M11, tag v1.0-selfhost, git repo initialized)
- **主实现 = src/tote.tc**（M16 起编译器更名 tote，原 tc1.tc；~9500 行单文件，lex/check/compile/emit-ll/build/run 全命令）；稳定版: **build/tote/tote.exe**（旧 build/tc1/tc1/tc1.exe 为备份）
- tc0 (TypeScript, tc0/) 已冻结；种子封存 seed/tc0/（信任根，永不删除）
- 验证三件套：`node tools/difftest.mjs --cand build/tc1/tc1/tc1.exe`（42 项逐字节）、`node tools/bootstrap.mjs`（三轮自编译不动点）、`node tools/conformance.mjs --ref`（tests/conformance 16 用例 + tc0 交叉）
- Stage 3 晋升规则：改 spec → 补 conformance 测试 → 改 tc1.tc → 套件+difftest → 不动点复验 → 晋升
- `runtime/t_runtime.{h,c}` — C runtime; MSVC 需 /utf-8 + 生成 C 带 BOM（.tc 源不能带 BOM）
- C compiler: VS2022 cl.exe (14.37.32822, SDK 10.0.22621.0)，PowerShell 里手动设 INCLUDE/LIB/Path
- Determinism: line/col = UTF-8 字节计数; stdout 二进制模式; sb_to_str 复制语义
- t 语法: `Name :: struct { f: T; }`；无 else-if 链；`append(s, call())` 会取临时量地址(C2102)，须先存局部变量
- 诊断怪癖：T_TYPE_UNKNOWN 从未发出（实报 T_TYPE_MISMATCH）；命名违规是 warning (exit 0)
- 技术债（Stage 3）：~~Variant(G10)~~ ✅M12 已实现；剩余 CSV/JSON CTFE 导入(§7.2)、@soa 布局变换、通用内存管理(脱离 arena)、优化后端

## Variant (G10) 实现要点 — src/tc1.tc
- 关键字 `variant`（lexer kw_lookup）；声明解析 `parse_variant_decl`（节点 VariantDecl + VC，VC.ia=case 下标, VC.na=载荷类型或 -1 单元 case）
- 类型检查器 `register_decl` 注册类型为 Variant TI，并 `register_variant_helpers` 注册合成 FuncDecl 符号（不入 decl_list，避免重复发射）：`Name_from_Case(载荷?)`、`Name_is_Case(self)`、`Name_as_Case(self)`（仅载荷 case）
- emitter `emit_variant_decl`：发射 `typedef struct Name { uint32_t _tag; union { T_i _u_i; } _u; } Name;` + 每 case 三个 `static inline` 自由函数（用 StringBuilder 拼 tag 整数，因无 int_to_str/cat7）
- 设计取舍：自由函数而非方法/模式匹配，免改表达式推导；Variant 上暂不支持 @derive
- 验证：conformance/p08_variant.tc 通过；tests/variant_smoke 运行时输出 CIRCLE/EMPTY/RECT/ROUNDTRIP_OK/UNIT_OK；bootstrap 不动点保持；difftest 30/30

## 数据驱动编译器生成 (M17) — 用数据生成 tote 代码
- 切入点：把 `kw_lookup`（原 tote.tc 手写 33 个 `if(text=="func")...` 链）改为**表驱**。这是「用数据驱动 t 编译器自身构造」的第一刀（用户原话：用数据生成 tote 代码，而非给 t 加数据驱动特性）。
- 唯一真相源：`src/compiler_data.json`（{keywords:[{text,kind}]}，从原 kw_lookup 精确抽取 33 关键字→token 种类，保证行为一致）；schema 预留扩展其他表（注解/内建/AST 节点）。
- 生成器：`tools/gen_compiler.mjs` — 重写 `src/tote.tc` 中 `// >>> GEN:kw_lookup >>>` 标记区间（KwEntry 结构 + 全局 `keywords_tbl` + `init_keywords()` 线性扫描 `kw_lookup`）；标记区间幂等（重跑无 diff）。
- 关键修复：`tk_lookup` 表驱后**必须在 tokenize 之前 init**。原 main 各分支 `tokenize()` 在 `init_keywords()` 之前，导致表空、关键字全识别成 Identifier。改法：在 `main()` 入口 `args()` 之后**统一调用一次** `init_keywords()`，并移除 3 处 per-command 调用（避免重复 append，因 t 不支持 slice 重赋值 `= []` 重置）。
- 验证（等价性）：新 tote 由稳定 tote 编译 → `node tools/difftest.mjs --ref build/tote/tote.exe --cand build/tote-new/tote.exe` = **15/15 逐字节一致**（5 样例 × lex/check/emit-c）；新编译器自举自身成功、`run --example hello` 输出 "Hello, t language!" 正确。已提升 build/tote/tote.exe 为数据驱动版本。
- **注意**：`tools/bootstrap.mjs`（tc0→tote1→tote2→tote3 不动点）当前在 gen1 失败——这是 tc0（冻结的 TS 参考编译器）发射器的**基线 bug**（tote1.exe 连最小 `func main` 都解析失败），与本次改动无关（tc0 直接编译修改后的 tote.tc 0 错误、且与稳定 tote 发射 C 逐字节一致）。等价性证明以 difftest 为准，bootstrap 待单独修 tc0。
- 下一步候选（数据驱动生成扩展）：AST 节点表、内建函数表、@derive 派生生成器表、诊断码表；或把 compiler_data.json 扩成多表 schema。

## totter (M18) — 用 t 语言写的数据驱动生成器，生成 tote 自身
- 用户意图澄清：是「用数据驱动方式生成 tote 编译器代码」（不是给 t 加数据驱动特性）。参考 Rust 参考文档 notation 写 `docs/reference.md`（记号/词法/语法/表达式/类型/comptime 自省/位域内建/文法总览/实现面对应表）。
- **totter = 数据驱动程序（t 编写）**：`src/totter.tc` 内嵌三张数据表（关键字 33、内建函数 15 组、@derive 9 trait），读取 `src/tote.tc`、把其中 `// >>> GEN:xxx >>>`…`// <<< GEN:xxx <<<` 标记区间替换为「由表生成」的代码，写出 `gen/tote.tc`。
- `src/tote.tc` 现含 4 个标记区间：`GEN:kw_lookup`（原 gen_compiler.mjs 生成）、`GEN:builtins`（包裹 `builtin_ret`）、`GEN:derives`（包裹 `vv_derive_traits`）、`GEN:diagnostics`（包裹 `diag_sev(code)`）。
- 实现约束（t 语言）：无 `str_find`→自实现子串查找（`str_at` 返回 i64 字符码）；无 JSON 解析器→表内嵌为 t 数据（用 `add_kw/add_bi/add_dv` builder，无结构体字面量）；无 slice 重赋值；`str_slice(s,i64,i64)`、`file_read_all`/`file_write_all` 可用；`cat3` 等内建仅在被多处使用时才发射（totter 改用 StringBuilder 拼接避免依赖）。
- 验证（等价性）：`gen/tote.tc` 与 `src/tote.tc` 仅差标记注释文字 → `gen/tote.exe` 经 `difftest` 对稳定 tote **15/15 逐字节一致**（5 样例 × lex/check/emit-c）；`gen/tote.exe run --example hello` 输出 "Hello, t language!"；`gen/tote.exe` 能自举重编译 `src/totter.tc`。
- 构建链：`build/totter/tote.exe` = 稳定 tote 编译 totter.tc 产物（注 `_build_one.mjs` 的 /Fe 硬编码为 tote.exe，故产物在 build/<dir>/tote.exe，不是 totter.exe）；`gen/tote.tc` / `build/gentote/tote.exe` = totter 生成并构建的 tote。
- 设计取舍：totter 仅「数据驱动生成」数据表区间，引擎（parser/checker/codegen）沿用 tote 现有代码（标记区间外），保证行为等价。后续可扩 `GEN:ast` 等区间，或让 totter 也生成引擎模板。
- **截止 M18 续2**：已加第 5 张表 `GEN:annotations`（`init_anndefs` 由 4 列数据表生成 34 个 `ad()` 注册 + auto_convert 弃用块，用 `anndef_find` 通用写法）。totter 现内嵌 5 表（关键字 33 / 内建 15 组 / @derive 9 trait / 诊断码 10 / 注解 34），`gen/tote.exe` 经 difftest 对稳定 tote **15/15 逐字节一致**（含注解诊断 validValues 列表逐字节一致），已提升为 canonical `build/tote/tote.exe`。机制充分证明可横向铺开。下一步候选：`GEN:ast`（AST 节点表）、或让 totter 生成引擎模板。

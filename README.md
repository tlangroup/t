# t 语言

数据驱动、ECS 友好、AI-Agent 友好的静态类型语言。源文件后缀 `.tc`，编译到 C11 或 LLVM IR。

**当前状态：已自举（self-hosting）。** tag `v1.0-selfhost`：三轮自编译产出逐字节一致（不动点），
42 项差分测试 + 17 项符合性用例全部通过。

工具链分工（M38 起重构）：
- **`tc`** — 纯粹的**编译器**：负责 `lex / check / compile / emit-ll / build / run` 与链接（LLVM 或 C 后端）。源码 `src/tc.tc`，二进制 `out/<mode>/tc.exe`。
- **`tote`** — **包管理器与构建系统**：自身不实现编译器，而是把编译/链接委托给 `tc`；并负责包清单 `tote.toml`、`init` 脚手架与依赖登记（`install`）。源码 `src/tote.tc`，二进制 `out/<mode>/tote.exe`。
- **`totter`**（数据驱动生成器）— **已放弃（abandoned），保留不删除**：`src/totter.tc` 与冻结快照 `gen/tc.tc` 仍在仓库中，已退出 canonical 流水线，不再维护、不再重跑。

## 实现

| 实现 | 位置 | 状态 |
|------|------|------|
| **tc（编译器）** | `src/tc.tc`（t 语言编写，自宿主） | **活跃开发** — 一切语言演进发生在这里 |
| **tote（包管理器/构建系统）** | `src/tote.tc`（t 语言编写，自宿主） | **活跃开发** — 编译委托 tc，负责包与构建编排 |
| totter（数据驱动生成器） | `src/totter.tc` | **已放弃（保留）** — 不再参与构建流水线，不再维护 |
| tc0（种子） | `seed/tc0/`（TypeScript，冻结副本）；`tc0/`（工作副本，frozen） | **冻结** — 仅作参照实现与灾难恢复信任根，不再演进 |

稳定版：编译器 `out/rls/tc.exe`（发布优化）/ `out/dbg/tc.exe`（调试，由 `src/tc.tc` 编译而来）；包管理器/构建系统 `out/dbg/tote.exe`（由 `src/tote.tc` 编译而来，内部调用 `tc`）。

## 快速开始

```bash
# —— 编译器 tc：一步到可执行程序（LLVM 后端：.tc → .ll → exe，需 clang）——
out/dbg/tc.exe build app.tc               # 生成 out/dbg/app.ll + app.exe（调试）
out/dbg/tc.exe run app.tc                 # 构建并立即运行（透传退出码）
out/dbg/tc.exe emit-ll app.tc             # 只生成 LLVM IR

# cargo 风格 examples（源: examples/<name>.tc，产物: out/dbg/examples/<name>.exe）
out/dbg/tc.exe run --example hello        # 构建并运行示例
out/dbg/tc.exe build --example fib        # 只构建示例
out/dbg/tc.exe run --example nope         # 名字不存在 → 列出可用示例

# 用稳定版 tc 编译 .tc → C（传统 C 后端）
out/dbg/tc.exe compile app.tc --emit-c --output out/dbg/app

# 类型检查（JSON 诊断，AI-Agent 友好）
out/dbg/tc.exe check app.tc --json

# Token 流导出
out/dbg/tc.exe lex app.tc --json

# C → 原生 exe：MSVC（需 /std:c11 /utf-8）或 clang 链接 runtime/t_runtime.c

# —— 包管理器/构建系统 tote：把编译委托给 tc ——
out/dbg/tote.exe init                     # 生成 tote.toml 与 src/main.tc
out/dbg/tote.exe build                    # 取 tote.toml 的 entry，委托 tc 构建
out/dbg/tote.exe run                      # 取 tote.toml 的 entry，委托 tc 构建并运行
out/dbg/tote.exe install <pkg>            # 在 tote.toml 登记一个依赖
```

`tc` 的 `build`/`run` 可选 flags：`--mode dbg|rls`（缺省 `dbg`，决定输出目录 `out/dbg`/`out/rls` 与优化档：dbg 用 `-O0 -gcodeview` 并产出 `.pdb`，rls 用 `-O2`）、
`--clang <path>`（缺省探测 PATH 与 `C:\Program Files\LLVM\bin\clang.exe`）、
`--runtime <dir>`（缺省 `runtime`；亦作为 `t_runtime.lib` 的覆盖路径 `<dir>/t_runtime.lib`）、
`--output <前缀>`（缺省按 `--mode` 落入 `out/dbg`/`out/rls`）。
`tote` 会把以上 flag 原样转发给 `tc`。

种子编译器（tc0，参照用）：`npx tsx tc0/index.ts <check|compile|lex|build|test|ast|type-info> ...`

## 目录

- `src/` — 编译器 `tc.tc`（完整编译器，自宿主）、包管理器/构建系统 `tote.tc`（驱动，委托 tc）、生成器 `totter.tc`（已放弃，保留）；`lexer.tc`、`parser.tc`、`checker.tc`（历史分阶段模块）
- `examples/` — 示例代码（cargo 风格，`tc run --example <name>` 或 `tote run --example <name>` 直接运行）
- `seed/` — 种子编译器 tc0 冻结封存（永不删除，见 `seed/README.md`）
- `tc0/` — tc0 TypeScript 工作副本（frozen）
- `runtime/` — C 运行时（arena / TStr / TSb / TSlice / TMap）
- `out/` — 编译产物根目录（见下「构建产物 `out/`」）；`out/ebnf.json` 为 totter 生成器的中间数据（由 `tools/gen_ebnf.mjs` 从 `docs/reference.md` 抽取；totter 已放弃，该文件冻结）
- `gen/tc.tc` — 由旧 totter 生成的编译器拷贝（**冻结快照**，totter 放弃后不再更新）
- `docs/spec.md` — 语言规范（唯一事实来源）；`docs/bootstrap.md` — 自举路线图（M1–M11，已全部完成）
- `tests/samples/`、`tests/err_samples/` — 差分测试样例
- `tests/conformance/` — 规范符合性套件（指令头 `// EXPECT: pass|error|warning T_CODE...`）
- `tools/difftest.mjs` — tc0/tc 逐字节差分；`tools/conformance.mjs` — 符合性 runner；`tools/run_examples.mjs` — examples 运行时语义验证（LLVM/C 双后端交叉比对）；`tools/build_runtime.mjs` — 预编译 `deps/t_runtime.lib`；`tools/bootstrap.mjs` — 遗留三轮自编译（依赖已冻结的 tc0）

## 构建产物 `out/`

编译产物统一落在 `out/`，按构建配置分为 `dbg`（调试）与 `rls`（发布优化）两棵子树：

```
out/
├── dbg/                # 调试构建：clang -O0 -gcodeview
│   ├── deps/           # 依赖静态库（t_runtime.lib，由 tools/build_runtime.mjs 预编译）
│   ├── tc.exe          # 调试版编译器（缺省 --mode）
│   ├── tote.exe        # 调试版包管理器/构建系统（委托 tc）
│   ├── totter.exe      # 生成器（已放弃，保留，不再构建）
│   ├── *.obj / *.ll    # 中间目标文件 / LLVM IR
│   └── *.pdb           # debug 符号信息
├── rls/                # 发布优化构建：clang -O2
│   ├── deps/           # 依赖静态库（发布优化版）
│   ├── tc.exe          # 发布版编译器
│   ├── tote.exe        # 发布版包管理器/构建系统
│   └── archive/        # 发布归档文件
├── ebnf.json           # 生成器中间数据（totter 读取，已放弃）
└── difftest/ bootstrap/ examples/ …  # 各工具的中间/产物目录
```

- `--mode dbg`（缺省）→ 产物进 `out/dbg/`；`--mode rls` → 产物进 `out/rls/`。`--output` 仍可显式覆盖。
- `out/dbg/deps/t_runtime.lib` 与 `out/rls/deps/t_runtime.lib` 由 runtime 源码预编译，tc 的 `build`/`run` 直接链接该静态库（而非 runtime 源码直链）。tote 透传这一行为（最终由 tc 链接）。
- **开箱即用**：若对应 `deps/t_runtime.lib` 不存在，tc 自动回退为直接编译 `runtime/*.c` 源码，因此新项目无需先跑 `build_runtime.mjs` 也能构建。
- 输出目录会按需自动创建（`ensure_parent`），无需手工 `mkdir`。
- `--mode` 只接受 `dbg` / `rls`，非法值直接报错退出。
- 归档：晋升稳定版前 `cp` 备份到 `out/rls/archive/<name>_pre-<里程碑>.exe`。

### canonical 流水线（自举）

```bash
node tools/gen_ebnf.mjs                      # → out/ebnf.json
node tools/build_runtime.mjs                 # → out/{dbg,rls}/deps/t_runtime.lib
# 用上一稳定版（旧 tc）自举出新的 tc；随后全部用 tc 自身
out/dbg/tc.exe build src/tc.tc --output out/dbg/tc          # 调试版编译器 tc
out/dbg/tc.exe build src/tc.tc --mode rls --output out/rls/tc   # 发布版编译器 tc
# 包管理器/构建系统 tote：编译委托 tc
out/dbg/tc.exe build src/tote.tc --output out/dbg/tote      # 调试版 tote
out/dbg/tc.exe build src/tote.tc --mode rls --output out/rls/tote  # 发布版 tote
# （totter 已放弃：不再执行 out/dbg/tc.exe build src/totter.tc 与 cp gen/tc.tc src/tc.tc）
```

## 验证命令

```bash
# ① 差分测试（lex/check/compile 逐字节）：tc0 参照 vs 新 tc
node tools/difftest.mjs --cand out/dbg/tc.exe
# ② 符合性套件
node tools/conformance.mjs --compiler out/dbg/tc.exe
# ③ 两阶段自举：b 与 c 产出的 IR 必须逐字节相同
out/dbg/tc.exe   build src/tc.tc --output out/dbg/tc_b
out/dbg/tc_b.exe build src/tc.tc --output out/dbg/tc_c
cmp out/dbg/tc_b.ll out/dbg/tc_c.ll
# ④ 铁律守卫（catN 实参个数 / 同名局部变量类型）
node tools/catn_check.mjs src/tc.tc && node tools/shadow_check.mjs src/tc.tc
# ⑤ UNSUPPORTED call 基线（当前为 2）
grep -o "UNSUPPORTED call" out/dbg/tc.ll | wc -l
# ⑥ 运行时语义：examples 实跑，LLVM/C 双后端 + .expected.txt 三方比对
node tools/run_examples.mjs                                   # dbg
node tools/run_examples.mjs --compiler out/rls/tc.exe --mode rls
```

> `tools/bootstrap.mjs`（tc0 三轮自编译）与 `gen/tc.tc`（旧 totter 产物）为**遗留/冻结**内容：`tc0/` 已冻结，其 C 后端对
> `append(x, sb_to_str(...))` 会生成 `&t_sb_to_str(...)`（取临时量地址），MSVC 报 `C2102`。该失败为既有基线，不作为门禁。
> `totter` 生成器自 M38 起放弃，其 `src + gen` 仅作历史快照保留，不再重跑、不再维护。

## Stage 3 自迭代开发规则（版本晋升）

1. 任何语言新特性：先改 `docs/spec.md` → 补符合性测试 → 再改 `src/tc.tc`（编译器）或 `src/tote.tc`（构建/包），三步缺一不可。
2. 修改 `src/tc.tc` 后：用当前稳定版 tc 编译出新版 → 跑符合性套件 + difftest → 不动点复验 → 通过后晋升为稳定版。
3. `seed/` 目录与 `tc0/` 冻结不动；`tests/conformance/` 只增不删；`src/totter.tc` / `gen/tc.tc` 已放弃、冻结保留、不再演进。

## 历史命名

- 编译器自 M16 起更名为 **tote**（此前叫 tc1）；M38 起拆分为 **tc**（编译器）与 **tote**（包管理器/构建系统）两个独立工具。
- 自举文档 `docs/bootstrap.md` 中的 tc1/tc2/tc3 指自举代际，为历史术语，保持原样。


## 参考
### 编程语言
ZeroLang , Karn, zig, rust, erlang, Verse, Flix, MoonBit, Crystal, 
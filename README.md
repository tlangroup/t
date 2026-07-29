# t 语言

数据驱动、ECS 友好、AI-Agent 友好的静态类型语言。源文件后缀 `.tc`，编译到 C11。

**当前状态：已自举（self-hosting）。** tag `v1.0-selfhost`：三轮自编译产出逐字节一致（不动点），
42 项差分测试 + 16 项符合性用例全部通过。

## 实现

| 实现 | 位置 | 状态 |
|------|------|------|
| **tc1（主实现）** | `src/tc1.tc`（t 语言编写，自宿主） | **活跃开发** — 一切语言演进发生在这里 |
| tc0（种子） | `seed/tc0/`（TypeScript，冻结副本）；`tc0/`（工作副本，frozen） | **冻结** — 仅作参照实现与灾难恢复信任根，不再演进 |

稳定版编译器：`build/tc1/tc1/tc1.exe`（由 `src/tc1.tc` 编译而来）。

## 快速开始

```bash
# 用稳定版 tc1 编译 .tc → C
build/tc1/tc1/tc1.exe compile app.tc --emit-c --output build/app

# 类型检查（JSON 诊断，AI-Agent 友好）
build/tc1/tc1/tc1.exe check app.tc --json

# Token 流导出
build/tc1/tc1/tc1.exe lex app.tc --json

# C → 原生 exe：MSVC（需 /std:c11 /utf-8）链接 runtime/t_runtime.c
```

种子编译器（tc0，参照用）：`npx tsx tc0/index.ts <check|compile|lex|build|test|ast|type-info> ...`

## 目录

- `src/` — **主实现**：`tc1.tc`（完整编译器）、`lexer.tc`、`parser.tc`、`checker.tc`（历史分阶段模块）
- `seed/` — 种子编译器 tc0 冻结封存（永不删除，见 `seed/README.md`）
- `tc0/` — tc0 TypeScript 工作副本（frozen）
- `runtime/` — C 运行时（arena / TStr / TSb / TSlice / TMap）
- `docs/spec.md` — 语言规范（唯一事实来源）；`docs/bootstrap.md` — 自举路线图（M1–M11，已全部完成）
- `tests/samples/`、`tests/err_samples/` — 差分测试样例
- `tests/conformance/` — 规范符合性套件（指令头 `// EXPECT: pass|error|warning T_CODE...`）
- `tools/difftest.mjs` — tc0/tc1 逐字节差分；`tools/bootstrap.mjs` — 三轮自编译不动点验证；`tools/conformance.mjs` — 符合性 runner

## 验证命令

```bash
node tools/difftest.mjs --cand "build/tc1/tc1/tc1.exe"   # 42 项差分（lex/check/compile）
node tools/bootstrap.mjs                                  # 三轮自编译不动点 C_a≡C_b≡C_c
node tools/conformance.mjs --ref                          # 符合性套件 + tc0 交叉验证
```

## Stage 3 自迭代开发规则（版本晋升）

1. 任何语言新特性：先改 `docs/spec.md` → 补符合性测试 → 再改 `src/tc1.tc`，三步缺一不可。
2. 修改 `src/tc1.tc` 后：用当前稳定版编译出新版 → 跑符合性套件 + difftest → 不动点复验 → 通过后晋升为稳定版。
3. `seed/` 目录与 `tc0/` 冻结不动；`tests/conformance/` 只增不删。

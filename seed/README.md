# seed/ — 种子编译器封存（信任根）

本目录封存 **tc0**：t 语言的 TypeScript 种子编译器，于 v1.0-selfhost（自举不动点达成）时刻冻结。

> **永不删除。** 参照 *Reflections on Trusting Trust*（Ken Thompson, 1984）：保留一份独立实现的
> 种子编译器，是从零重建整条工具链、审计信任链的唯一途径。

## 内容

| 路径 | 说明 |
|------|------|
| `tc0/src/` | tc0 完整 TypeScript 源码（lexer/parser/checker/annotations/flag/comptime/codegen/CLI） |
| `tc0/dist/` | 冻结时刻的构建产物（`tc.cjs` 打包、`tc.js.exe` SEA 可执行） |
| `tc0/package.json` 等 | 冻结时刻的构建配置 |

## 从零重建（灾难恢复）

```bash
cd seed/tc0
npm install            # 或使用锁定的 node_modules
npx tsx src/index.ts compile ../../src/tc1.tc --emit-c --output out
# 用任意 C11 编译器（MSVC: cl /std:c11 /utf-8）编译 out/tc1.c + runtime/t_runtime.c → tc1.exe
# 再用 tc1.exe 自编译两轮，验证 C 产物逐字节不动点
```

不动点验证脚本：仓库根 `tools/bootstrap.mjs`。

## 冻结状态

- tc0 与 src/tc1.tc 在 42 项差分（lex/check/compile × tests/samples + tests/err_samples + src/）上逐字节一致。
- 三轮自编译 C_a ≡ C_b ≡ C_c（tools/bootstrap.mjs 判定 OK）。
- 本目录内容**只读**：任何语言演进只发生在 `src/`，规范演进只发生在 `docs/spec.md`。

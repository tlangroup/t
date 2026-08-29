# 审计报告：df5cd06-six-fixes → main 功能完整性

审计时间：2026-08-29
方法：两棵树（df5cd06-six-fixes 与 main）逐文件比对，叠加跨方言硬信号（文件集 / 诊断码 / @内建 / 函数名）与 conformance 门禁结果。

## 结论：main 已完整覆盖 df5 的全部功能，无遗漏缺口。

### 硬信号（跨方言可靠，均零差异）
| 信号 | df5 | main | 差异 |
|---|---|---|---|
| `src/` 文件集 | 13 文件 | 13 文件 | 完全一致 |
| `runtime/` 文件集 | 同 | 同 | 完全一致 |
| lib / `.tlib` 文件集 | 同 | 同 | 完全一致 |
| 诊断码 `T-XXX`（diag_defs.json） | 124 | 124 | **零差异**（df5 无 main 缺失的码） |
| `@`-内建标识符（sema.tc） | 23 | 23 | **零差异**（含 `@type_of`/`@type_val`/`@type_size`） |
| 分支独有文件 | — | — | **无**（两棵树文件集完全相同） |

### 软信号（行数差异，已判为方言而非功能）
- `src/*.tc` 行数差巨大（sema 2585、parse 599、codegen_ll 447、codegen_c 231…）。
  根因：df5 为旧方言（`name fn()` / `X struct`），main 为新方言（`fn name()` / `struct X`），且 `import(x :: *)` 语法不同。属语法重写，非功能增减。
- `tools/diag_defs.json` 26 行差异：仅 E214、E781 的**消息文本/顺序**调整，无新码。
- `tests/` 350 文件差异：main 已将 df5 用例改写为新方言（同名同 `EXPECT` 码），已计入 239/0 绿态。

### 函数名 diff 噪声已证伪
初检 `src/` 顶层函数名 df5 12 / main 2，疑似缺口。经核验均为**正则噪声**：
- `classify`/`push`/`mname` 在 sema.tc 两分支均为 0 命中（来自其它文件示例片段）；
- `foo fn(...)` 落在第 875 行**注释示例**；
- `step`/`foo`/`__range_fill`/`__import_N`/`__pipe_N`/`list_push` 两分支命中数相当（如 `list_push` 85 vs 71），main 同样存在。

### 真正缺口（df5 比 main 多、需重做的）已闭环
1. **P4 `@type_of`** —— 已移植：新增内建 + `p45_typeof` 用例。
2. **P5 comptime 闭包逃逸** —— 已移植：main 无 df5 的 CVal，按「节点即值」模型重设计
   （`mk_closure_capval` + `meta_eval` ident 返回 `__lambda__` 节点 + `meta_eval_closure_make` +
   `meta_fold_expr` 保 sb + codegen C/LLVM `closure_capval` 透明透传 + 顺修简写 lambda 捕获两处 bug）。

### 门禁结果
- `conformance`：**239 passed / 0 failed**（main 含 df5 全部重写用例）。
- `p60_comptime_closure_escape.tc` 直接 build+run 退出码 **0**（idf(9)==9, add10(5)==15, hi("X")=="hi", f(5)==17）。
- 提交 `b70f3fb`（P4+P5 源码 + D 类用例 + examples），已 push `origin/main`。

### 最终裁定
「在 main 重做 df5 全部功能」**已完成，无遗留缺口**。A(variant)/B(f-string)/C(ref)/D(comptime)/E(meta)/F(import)/G(other) 七类功能 main 均具备且 conformance 全绿；df5 真正多出的仅 P4/P5，现已移植并验证。

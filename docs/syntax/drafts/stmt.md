# 语法规则草稿 · 语句总览（Statements）  [DRAFT]

> 依据：`src/tc.tc` `parse_statement`（L5804–L5843，fold=disp 守卫式分发）+ `docs/reference.md` §3.3。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
Statement: IfStmt | ForStmt | WhileStmt | SwitchStmt | ReturnStmt
          | BreakStmt | ContinueStmt | DeferStmt | ComptimeStmt
          | BlockStmt | VarStmt | ConstStmt | ExprOrAssignStmt
```

> 各分支精确产生式见细分草稿：`stmt_control.md`（if/for/while/switch/return/break/continue）、
> `stmt_var.md`（local var/const + 赋值）。`DeferStmt`/`ComptimeStmt` 为预留构造（spec-only）。

## 2. Where（约束）

- `parse_statement` 为守卫式分发：引导关键字路由到对应解析函数，末尾兜底为 `parse_expr_or_assign_stmt`（表达式或赋值语句）。
- 语句以分号 `;` 结尾或包围于 `{}` 块（reference §3.3 核心）。
- 控制流条件 `( )` 包裹，体为 `Block`（参考 `parse_if_stmt` L5761）。

## 分发表（L5806–L5842）

| 引导 token | 目标 |
|---|---|
| `if` | parse_if_stmt |
| `for` | parse_for_stmt |
| `while` | parse_while_stmt |
| `switch` | parse_switch_stmt |
| `return` | parse_return_stmt |
| `break` | parse_break_stmt |
| `continue` | parse_continue_stmt |
| `defer` | parse_defer_stmt |
| `comptime` | parse_comptime_stmt |
| `{` | parse_block_stmt |
| `var` | parse_var_stmt |
| `const` | parse_const_stmt |
| 其他 | parse_expr_or_assign_stmt |

## 3. 与既有构造关系

- 表达式语句中的表达式文法见 `expr.md` 及其细分。
- `switch` 按 `match.md` 裁定为废弃构造（逐步由 `match` 取代）。
- 函数声明非语句，见 `decl_func.md`。

## 4. L-14 铁律校验预留

- 语句解析核心已实现（reference §3.3 ✅ tote 核心）。

## 5. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ✅ | 每种语句唯一引导关键字，无等价多写 |
| L-02 显式 | ✅ | 条件/体显式 |
| L-03 静态类型 | ✅ | 控制流条件静态检查 |
| L-14 铁律校验 | ✅ | 门禁覆盖 |

## 6. L-04 张力

无内部张力。`switch`（废弃）与 `match`（新）的过渡期重叠为跨草稿协作，单列于 `match.md` 与 `stmt_control.md §7`。

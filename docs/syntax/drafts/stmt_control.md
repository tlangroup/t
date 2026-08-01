# 语法规则草稿 · 控制流语句（Control-flow Statements）  [DRAFT]

> 依据：`src/tc.tc` `parse_if_stmt`/`parse_for_stmt`/`parse_while_stmt`/`parse_switch_stmt`/`parse_return_stmt`/`parse_break_stmt`/`parse_continue_stmt`（L5655–L5802）+ `docs/reference.md` §3.3。<br>
> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。

## 1. EBNF（§1 Notation）

```ebnf
IfStmt: "if" "(" Expr ")" Block ("else" (IfStmt | Block))?
ForStmt: "for" "(" (ForEach | ForC) ")"
ForEach: (Ident ("," Ident)? "in" Expr)
ForC: (Stmt? ";" Expr? ";" Expr?)
WhileStmt: "while" "(" Expr ")" Block
SwitchStmt: "switch" "(" Expr ")" "{" ("case" Expr ":" Stmt*)* ("default" ":" Stmt*)? "}"
ReturnStmt: "return" (Expr)? ";"
BreakStmt: "break" ";"
ContinueStmt: "continue" ";"
```

- `IfStmt` 的 `else if` 通过嵌套 `IfStmt` 实现（L5771 递归）。
- `ForEach`：`k in iterable` 或 `k, v in map`（peek 前瞻，`parse_for_stmt` L5714）。
- `ForC`：三段式 `init; cond; upd`，init 可为 `var`/`const`/`expr`。
- `SwitchStmt`：`case Expr:` 聚合，`default:` 收尾。

## 2. Where（约束）

- 条件 `Expr` 须为布尔；隐式布尔判定被拦截 `T_STMT_IMPLICIT_BOOL`（见 L-02 全行为显式）。
- `for k, v in m` 按**插入序**迭代 map 键（reference M30）。
- `switch` 仅作标量/枚举值分发，且按 `match.md` 裁定**废弃**（逐步被 `match` 取代）。

## 3. 示例

```t
if (x > 0) { println("pos"); } else if (x < 0) { println("neg"); } else { println("zero"); }

for (i in 0..10) { sum = sum + i; }
for (k, v in table) { println(k); }

while (running) { tick(); }

switch (code) {
case 0: ok();
default: fail();
}
```

## 4. 与既有构造关系

- 运算/比较表达式见 `expr_binary.md`。
- `switch` 与 `match` 的 enum 匹配分工见 `match.md`。
- `Range`（`0..10`）字面量若未实现则为普通表达式/内建，文法待补。

## 5. L-14 铁律校验预留

- 控制流语句已实现（reference §3.3 ✅ tote 核心）；`switch` 门禁仍覆盖但标记废弃。

## 6. 合规判据

| 法律 | 评级 | 依据 |
|---|---|---|
| L-04 唯一语义 | ⚠️ | `switch` 与 `match` 过渡期重叠（见 §7） |
| L-02 显式 | ✅ | 条件布尔显式、无隐式 |
| L-03 静态类型 | ✅ | 条件/迭代类型静态检查 |
| L-14 铁律校验 | ✅ | 门禁覆盖 |

## 7. L-04 张力（⚠️ 跨草稿）

- `switch` 仍保留为合法语句，但 `match.md` 裁定其废弃。过渡期内两种值分发写法并存，L-04 弱满足。
- 处置：待 `match` 规则采纳后，本草稿须将 `SwitchStmt` 标记 deprecated，并清理 examples/tests 现存 `switch`（见 `match.md` 并入动作）。

# 语法规则草稿：二元表达式与赋值（Binary & Assignment）

> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 采纳 → 并入 → 失效）。本草稿为 `expr.md`（表达式综合）的细分，其产生式并入后成为 `Expr` 的二元子项。
> **作用对象**：所有**二元运算符组合**与**顶层赋值**。一元前缀、后缀、字面量见各自细分草稿。
> **记号**：符合 `docs/reference.md` §1 Notation（`ProductionName: Syntax`；`|` 选择、`( )` 分组、`*`/`+` 重复、字面量 `"..."`、非终结符大写 / 终止符小写）。

---

## 1. EBNF

```ebnf
// 表达式总入口（顶层为赋值表达式，右结合）
Expr: AssignExpr

// 赋值（右结合，允许 a = b = c）
AssignExpr: OrExpr ("=" AssignExpr)?

// —— 二元运算符优先级塔（从低到高，全部左结合）——
OrExpr:    AndExpr ("||" AndExpr)*
AndExpr:   BitOrExpr ("&&" BitOrExpr)*
BitOrExpr: BitXorExpr ("|" BitXorExpr)*
BitXorExpr: BitAndExpr ("^" BitAndExpr)*
BitAndExpr: EqExpr ("&" EqExpr)*
EqExpr:    CmpExpr ("==" | "!=" CmpExpr)*
CmpExpr:   ShiftExpr ("<" | ">" | "<=" | ">=" ShiftExpr)*
ShiftExpr: AddExpr ("<<" | ">>" AddExpr)*
AddExpr:   MulExpr ("+" | "-" MulExpr)*
MulExpr:   UnaryExpr ("*" | "/" | "%" UnaryExpr)*
```

- 优先级塔顺序与 `src/tc.tc` 实现的 `parse_or → parse_and → parse_bitor → parse_bitxor → parse_bitand → parse_eq → parse_cmp → parse_shift → parse_add → parse_mul → parse_unary` 完全一致，不可调换。
- 词法记号：`||` `&&` `|` `^` `&` `==` `!=` `<` `>` `<=` `>=` `<<` `>>` `+` `-` `*` `/` `%` `=`（与 `parse_*` 中 `cur_t()` 判定一一对应）。

---

## 2. Where（编译期约束）

- **优先级塔固定（L-03 可预判）**：`||` 优先级最低、`*`/`/`/`%` 最高，顺序由 `tc.tc` 解析器层级硬编码，无歧义、无结合性隐式行为。
- **二元运算全部左结合（L-03 可预判）**：`a - b - c` 解析为 `(a - b) - c`；无右结合二元运算符（除赋值外）。
- **赋值右结合（L-02 显式 / L-03）**：`=` 右侧为 `AssignExpr`，允许链式 `a = b = c`；左侧须为可赋值目标（变量 / 可寻址字段 / 下标 / map 索引），由 checker 校验（见 `expr_postfix.md` 下标与 `expr_literal.md` 字段约束）。
- **无隐式类型提升 / 转换（L-02 显式）**：二元运算两侧须为兼容类型，隐式数值转换由 checker 报 `T_TYPE_IMPLICIT_CAST`；浮点 / 整数混运算须显式 `e as T`。
- **结果类型静态可定（L-03 静态类型）**：每个二元 / 赋值表达式的静态类型由 checker 推算，无运行时类型歧义。

---

## 3. Examples

```t
let a = 1 + 2 * 3;              // = 1 + (2*3)，优先级塔
let b = ~x << 4 | mask;        // 一元 ~（见 expr_unary.md）+ 移位 + 位或
let c = (a < b) && (b < c);    // 比较 + 逻辑与（短路）
let d = flag || default_val;   // 逻辑或（短路）
let x = y = 0;                 // 赋值右结合
```

---

## 4. 与既有构造的关系（L-04 论证）

| 表达式形式 | 能力 | 状态 |
|---|---|---|
| `AssignExpr` | `=` 右结合赋值 | ✅ 已实现（`tc.tc`） |
| `OrExpr` / `AndExpr` | `\|\|` / `&&` 逻辑（短路） | ✅ 已实现 |
| `BitOr/BitXor/BitAnd` | `\|` / `^` / `&` 位运算 | ✅ 已实现 |
| `EqExpr` | `==` / `!=` | ✅ 已实现 |
| `CmpExpr` | `<` `>` `<=` `>=` | ✅ 已实现 |
| `ShiftExpr` | `<<` `>>` | ✅ 已实现 |
| `Add` / `Mul` | `+` `-` / `*` `/` `%` | ✅ 已实现 |

- **短路语义唯一写法（L-04 ✅）**：逻辑 `&&` / `||` 仅一种短路求值写法，无等价多写。
- **优先级塔无歧义（L-04 ✅）**：固定 10 级优先级 + 全左结合，解析确定。

---

## 5. 法律验证预留（L-14 铁律校验法）

- 已实现二元 / 赋值表达式由 `tools/conformance.mjs` / `tools/difftest.mjs` / `tools/run_examples.mjs` 双后端交叉比对覆盖（`conformance` 33 passed 含表达式用例）。
- 编译器相关阶段：`parse_assign_expr` / `parse_or`…`parse_mul`；checker 中 `infer_expr` 负责类型判定与隐式转换拦截。

---

## 6. 合规判据（待并入 reference.md 后由法律检查代码）

| 法律 | 判据 | 当前代码状态 |
|---|---|---|
| L-04 唯一语义 | 优先级塔无歧义、逻辑运算单一短路写法 | ✅ 已实现无等价多写 |
| L-02 显式 | 无隐式类型提升；赋值目标显式 | ✅ 设计 + 代码满足 |
| L-03 静态类型 | 运算数 / 结果类型静态校验、优先级可预判 | ✅ checker 实现 |
| L-14 铁律校验 | 门禁覆盖已实现二元 / 赋值 | ✅ conformance/difftest 覆盖 |

---

## 7. L-04 张力

- **无内部等价多写张力**：本草稿基于 `tc.tc` 当前实现提取，二元运算与赋值均仅有唯一标准写法，满足 L-04「唯一确定语义」。
- **跨草稿接口（非冲突）**：`UnaryExpr` 由 `expr_unary.md` 规定、`PostfixExpr` 由 `expr_postfix.md` 规定、`PrimaryExpr` 由 `expr_literal.md` 规定；`MatchExpr` 由 `match.md` 草稿单独规定（L-15 待采纳）。一旦各草稿采纳并并入 `reference.md`，综合 `Expr` 入口由 `expr.md` 聚合。此属草稿间协作，不构成本草稿内部违宪。

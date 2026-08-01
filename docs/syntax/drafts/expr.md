# 语法规则草稿：表达式（Expression · 综合索引）

> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 采纳 → 并入 → 失效）。
> **作用对象**：t 语言所有**表达式**形式（值层面的组合与求值）；控制流 `if` / `for` / `while` / `switch` 为**语句**（非表达式），不在此列。
> **记号**：符合 `docs/reference.md` §1 Notation（`ProductionName: Syntax`）。

---

## 1. EBNF（总入口）

```ebnf
// 表达式总入口（顶层为赋值表达式，右结合）
Expr: AssignExpr

// AssignExpr 及以下二元 / 一元 / 后缀 / primary 全部定义于下列细分草稿：
//   expr_binary.md   —— AssignExpr, OrExpr … MulExpr（10 级优先级塔）
//   expr_unary.md    —— UnaryExpr（! / - / ~ 前缀）
//   expr_postfix.md  —— PostfixExpr（. [ ] ( ) as）
//   expr_literal.md  —— PrimaryExpr（整/浮/串/布尔/null/标识符/type_info/结构体/数组/map/分组）
```

- 完整产生式集合 = `expr_binary.md` ∪ `expr_unary.md` ∪ `expr_postfix.md` ∪ `expr_literal.md`，四者拼接即构成等价于此前的单一 `Expr` 文法。
- 词法记号与优先级塔顺序与 `src/tc.tc` 实现（`parse_expr` / `parse_assign_expr` / `parse_or`…`parse_mul` / `parse_unary` / `parse_postfix` / `parse_primary` 及胶水）完全一致。

---

## 2. 细分草稿清单（L-15 工作流）

| 细分草稿 | 涵盖产生式 | 四层评审结论 |
|---|---|---|
| `expr_binary.md` | `AssignExpr` + `OrExpr`…`MulExpr`（10 级优先级塔） | L-04 ✅ / L-02 ✅ / L-03 ✅ / L-14 ✅ |
| `expr_unary.md` | `UnaryExpr`（`!` / `-` / `~` 前缀，右结合可堆叠） | L-04 ✅ / L-02 ✅ / L-03 ✅ / L-14 ✅ |
| `expr_postfix.md` | `PostfixExpr`（`.` / `[ ]` / `( )` / `as`） | L-04 ✅ / L-02 ✅ / L-03 ✅ / L-14 ✅ |
| `expr_literal.md` | `PrimaryExpr`（全部字面量 + 标识符 + `type_info` + 分组） | L-04 ✅ / L-02 ✅ / L-03 ✅ / L-14 ✅ |

- 各细分草稿自带完整 §1 EBNF / §2 Where / §3 Examples / §4 关系 / §5 L-14 预留 / §6 合规判据 / §7 L-04 张力，本索引不再重复，以 L-15「单一规则单一草稿」为准。

---

## 3. Where（聚合约束）

- **优先级塔固定（L-03 可预判）**：`||` 最低、`*`/`/`/`%` 最高，全部左结合；赋值右结合；无结合性隐式行为。
- **全行为显式（L-02）**：`as` 显式转换、复合字面量显式构造、无隐式类型转换 / 隐式布尔 / 隐式分配。
- **静态类型安全（L-03）**：每个 `Expr` 的静态类型由 checker 推算，无运行时类型歧义；元素 / 字段 / 下标 / `type_info` 静态校验。
- **唯一写法（L-04）**：每种表达式仅一种标准写法（调用 `f(x)`、转换 `e as T`、下标 `e[i]`、结构体 `T{...}`），无等价多写变体。

---

## 4. 与既有构造的关系（L-04 论证）

- **控制流非表达式**：`if` / `for` / `while` / `switch` 在 `tc.tc` 中属**语句**（`parse_statement` 路由），不进入 `Expr` 产生式；`switch` 之废弃与 `MatchExpr` 之引入见 `match.md` 草稿（L-15 待采纳），采纳后本索引 `Expr` 须补 `MatchExpr` 分支。
- **单一写法（L-04 ✅）**：当前实现中表达式各形式均仅有唯一标准写法。

---

## 5. 法律验证预留（L-14 铁律校验法）

- 已实现表达式由 `conformance.mjs` / `difftest.mjs` / `run_examples.mjs` 双后端交叉比对覆盖（`conformance` 33 passed 含表达式用例）。
- `MatchExpr` 尚未覆盖门禁（见 `match.md` 草稿 §5）。

---

## 6. 合规判据（待并入 reference.md 后由法律检查代码）

| 法律 | 判据 | 当前代码状态 |
|---|---|---|
| L-04 唯一语义 | 每种表达式单一写法；优先级塔无歧义 | ✅ 已实现无等价多写 |
| L-02 显式 | `as` 显式转换；无隐式布尔 / 分配 | ✅ 设计 + 代码满足 |
| L-03 静态类型 | 元素 / 字段 / 下标 / `type_info` 类型静态校验 | ✅ checker 实现 |
| L-14 铁律校验 | 门禁覆盖已实现表达式 | ✅ conformance/difftest 覆盖（match 除外，见 match.md） |

---

## 7. L-04 张力

- **无内部等价多写张力**：本索引聚合的四份细分草稿均基于 `tc.tc` 当前实现提取，表达式各形式仅唯一标准写法，满足 L-04「唯一确定语义」。
- **跨草稿接口（非冲突）**：`MatchExpr` 由 `match.md` 草稿单独规定（L-15 待采纳）；一旦采纳并并入 `reference.md`，本索引 `Expr` 总入口须补 `MatchExpr` 分支、`switch` 语句按 match.md 裁定废弃。此属草稿间协作，不构成本草稿内部违宪。

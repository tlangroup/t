# 语法规则草稿：字面量与基本表达式（Literal & Primary）

> **状态：已并入 reference.md（失效）** —— 经 L-15 起草工作流于 2026-08-01 规则采纳（四法 L-04/L-02/L-03/L-14 评审 ✅/⚠️ 通过），原草稿仅作历史追溯，不再据以执行。权威载体：`docs/reference.md` §3.x。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 采纳 → 并入 → 失效）。本草稿为 `expr.md`（表达式综合）的细分，其产生式并入后成为 `Expr` 的 primary 子项。

> ⚠️ **权威指引（2026-09-25 补）**：本草稿为 2026-08-01 冻结快照，下列写法已过期，请以 `docs/reference.md` §3.4 为准：
> - **结构体字面量**：命名形式 `T{ .x = v, .y = w }` 与 `T{ x: v, y: w }` 并存；**前导点省略类型名** `.{ .x = v }` 须由上下文推断类型。
> - **元组字面量**（新增）：`.{ e1, e2, … }`（元素按位置，类型各自独立推断；匿名类型合成具名 struct `_Tup_…`）。
> - **元组类型**：`.{ T1, T2 }`（见 `types.md` 权威指引）。
> - 本草稿示例中的 `let x = …` 旧式绑定声明已废弃，当前为 `var x: T = …`（局部绑定返回 `unit`，非值）。
> - 元组 / 复合字面量的补齐（lub）语义见 `docs/everything-is-value-t.md`。
> **作用对象**：所有**字面量值**与**基本表达式**（primary）——整 / 浮 / 串 / 布尔 / null / 标识符 / type_info / 结构体 / 数组 / map / 括号分组。一元与后缀、二元见各自细分草稿。
> **记号**：符合 `docs/reference.md` §1 Notation。终止符 `integer` / `float` / `string` / `ident` 对应词法 token `Integer` / `Float` / `String` / `Identifier`。

---

## 1. EBNF

```ebnf
// —— 字面量与基本表达式（primary）——
PrimaryExpr:
    | IntLit
    | FloatLit
    | StrLit
    | BoolLit
    | NullLit
    | IdentExpr
    | TypeInfoExpr
    | StructLit
    | ArrayLit
    | MapLit
    | "(" Expr ")"            // 仅分组，非元组

IntLit:   integer            // 十进制；0x 前缀十六进制；0b 前缀二进制
FloatLit: float
StrLit:   string
BoolLit:  "true" | "false"
NullLit:  "null"
IdentExpr: ident

TypeInfoExpr: "type_info" "(" ident ")"      // 编译期类型信息内建

StructLit: ident "{" (ident ":" Expr ("," ident ":" Expr)*)? "}"

ArrayLit:  "[" (Expr ("," Expr)*)? "]"

MapLit:    "[" (Expr ":" Expr ("," Expr ":" Expr)*)? "]"   // 当首元素后跟 ":"
```

- 词法记号：`integer` `float` `string` `ident` `true` `false` `null` `type_info` `{` `}` `[` `]` `:` `,`（与 `parse_primary` / 胶水函数 `cur_t()` 判定一一对应）。
- `MapLit` 与 `ArrayLit` 共用 `[ ]`，由首元素后是否跟 `:` 歧义消除（`parse_array_lit` / `parse_map_lit` 用向前看 `>>>`），无二义。

---

## 2. Where（编译期约束）

- **元素类型一致（L-03 静态类型）**：`ArrayLit` 各元素须同类型；`MapLit` 的键、值分别须同类型（K/V）；由 checker 校验。
- **结构体字段匹配（L-03 静态类型）**：`StructLit` 字段名须匹配目标类型定义、数量与类型一致，由 checker 校验；字段顺序无关但名称须存在。
- **下标可索引（L-03 静态类型）**：`MapLit` / `ArrayLit` 在 `expr_postfix.md` 下标语境中由 checker 校验可索引性。
- **`type_info` 编译期解析（L-03 静态类型）**：`type_info(T)` 的参数为类型名标识符，编译期解析为 `TypeInfo*` 常量，无运行时行为。
- **无隐式分配（L-02 显式）**：字面量（数组 / map / 结构体）在源码层显式构造；其底层存储由编译器显式安排（无隐式堆分配语义，遵循 L-02 全行为显式原则）。
- **结果类型静态可定（L-03 静态类型）**：每个 `PrimaryExpr` 的静态类型由 checker 推算，无运行时类型歧义。

---

## 3. Examples

```t
// 标量字面量
let i = 0xFF;            // 十六进制整型
let j = 0b1010;          // 二进制整型
let f = 3.14;            // 浮点
let s = "hello";         // 字符串
let ok = true;           // 布尔
let p = null;            // null

// 复合字面量
let v = [1, 2, 3];                   // 数组字面量（元素同类型）
let m = ["a": 1, "b": 2];           // map 字面量（K/V 同类型）
let pt = Point{ x: 1, y: 2 };        // 结构体字面量（字段匹配）
let ti = type_info(Point);           // 编译期类型信息

// 分组（非元组）
let g = (a + b) * c;
```

---

## 4. 与既有构造的关系（L-04 论证）

| 表达式形式 | 操作数 / 能力 | 状态 |
|---|---|---|
| `IntLit` / `FloatLit` / `StrLit` / `BoolLit` / `NullLit` | 值常量 | ✅ 已实现（`tc.tc`） |
| `IdentExpr` | 变量 / 函数引用 | ✅ 已实现 |
| `TypeInfoExpr` | `type_info(T)` 编译期类型信息 | ✅ 已实现 |
| `StructLit` | `T{ f: v, … }` 结构体构造 | ✅ 已实现 |
| `ArrayLit` / `MapLit` | `[e,…]` / `[k:v,…]` 复合字面量 | ✅ 已实现 |
| `( Expr )` | 括号分组（非元组） | ✅ 已实现 |

- **单一构造写法（L-04 ✅）**：结构体 `T{...}`、数组 `[...]`、map `[k:v]`、type_info `type_info(T)` 均仅一种写法，无等价多写变体。

---

## 5. 法律验证预留（L-14 铁律校验法）

- 已实现字面量 / primary 由 `conformance.mjs` / `difftest.mjs` / `run_examples.mjs` 双后端交叉比对覆盖。
- 编译器相关阶段：`parse_primary` + 胶水 `parse_prim_*` / `parse_struct_lit` / `parse_array_lit` / `parse_map_lit`；checker 中 `infer_expr` 负责字面量类型判定。

---

## 6. 合规判据（待并入 reference.md 后由法律检查代码）

| 法律 | 判据 | 当前代码状态 |
|---|---|---|
| L-04 唯一语义 | 每种字面量 / primary 单一写法 | ✅ 已实现无等价多写 |
| L-02 显式 | 复合字面量显式构造、无隐式分配 | ✅ 设计 + 代码满足 |
| L-03 静态类型 | 元素 / 字段 / 下标 / `type_info` 类型静态校验 | ✅ checker 实现 |
| L-14 铁律校验 | 门禁覆盖已实现字面量 / primary | ✅ conformance/difftest 覆盖 |

---

## 7. L-04 张力

- **无内部等价多写张力**：本草稿基于 `tc.tc` 当前实现提取，字面量与 primary 均仅有唯一标准写法。
- **跨草稿接口（非冲突）**：`Expr`（分组）、`PostfixExpr` 由 `expr_postfix.md` 规定、`UnaryExpr` 由 `expr_unary.md` 规定、`MatchExpr` 由 `match.md` 草稿单独规定（L-15 待采纳）。此属草稿间协作，不构成本草稿内部违宪。

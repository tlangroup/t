# 语法规则草稿：match 表达式 与 函数子句模式匹配

> **状态**：草稿（DRAFT）—— 法律验证（L-04 / L-02 / L-03 / L-14）**已全部通过**（2026-08-01，编译器已实装 + 门禁已覆盖，详见 §5/§6）；**待用户「规则采纳」指令**方可并入 `docs/reference.md`，原草稿标记失效。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 采纳 → 并入 → 失效）。
> **作用对象**：所有值类型（标量 / `enum` / `variant`）的**统一模式分发**；**函数子句模式匹配**（多子句 `fn` 按参数模式分发）；**`when` 守卫**条件过滤；**`_ `通配占位**（不绑定变量）。既有 `switch` 已列入**废弃**，由本规则取代。
> **形态**：`match` 为表达式（各分支产生同类型值）；函数子句为声明级分发。
> **记号**：符合 `docs/reference.md` §1 Notation（`ProductionName: Syntax`；`|` 选择、`( )` 分组、`*`/`+` 重复、字面量 `"..."`、非终结符大写/终止符小写）。

---

## 1. EBNF

```ebnf
// —— match 表达式 ——
MatchExpr: "match" "(" Expr ")" "{" MatchArm+ "}"

MatchArm: MatchPat Guard? "=>" Expr (Newline | ",")

Guard: "when" Expr

MatchPat:
    | Literal                         // 标量 / 枚举值相等匹配
    | CaseName "(" PatBindList ")"   // 解构 enum / variant case 的 payload
    | CaseName                        // 单元 case（无 payload）
    | "_"                            // 通配占位：匹配任意值，不绑定变量

PatBindList: PatBind ("," PatBind)*

PatBind: Ident                        // 绑定第 i 个 payload 字段到变量

// —— 函数子句模式匹配（声明头与 reference.md §3.1 并置式一致；参数位允许模式）——
// 函数声明与函数子句共用同一 FuncDecl 产生式：声明头 = 并置式
// （FuncName "fn" (...) "->" Type FuncAnns? Block）；参数位为 ParamPattern，
// 其首选项 Ident ":" Type 与普通参数（name:type）完全等价，
// 故「普通函数声明」与「模式匹配函数子句」是同一语法的两种用法，无第二种声明写法（L-04 唯一语义）。
FuncDecl: FuncName "fn" "(" (ParamPattern ("," ParamPattern)*)? ")" "->" Type FuncAnns? Block

ParamPattern:
    | Ident ":" Type Guard?         // 普通参数（与 reference.md §3.1 的 name:type 形式一致）
    | Ident Guard?                  // 绑定参数（省略类型，由守卫/上下文推断），可带守卫
    | "_" Guard?                    // 通配占位，不绑定变量，可带守卫
    | Literal Guard?                // 字面量常量匹配
    | CaseName Guard?               // 单元 case
    | CaseName "(" PatBindList ")" Guard?  // 解构 case

ReturnType: "->" Type
```

- 新增词法记号：`KwMatch`（关键字 `match`）、`KwWhen`（关键字 `when`）、`"=>"`（arm 映射箭头）；函数声明复用 `decl_func.md` 的绑定式 `FuncDecl`，其 `->` 返回类型箭头已在该文法中定义。
- `Literal` 为字面量模式（整型 / 字符串等）；`CaseName` 为被匹配 `enum`/`variant` 的某个 case 标识符；`_` 为**非绑定通配**（见 §2）。

---

## 2. Where（编译期约束）

- **唯一分发构造（L-04 唯一语义）**：`match` 是所有值类型（标量 / `enum` / `variant`）进行模式分发的**唯一**表达式级语法；`switch` 已废弃，不再作为替代写法。
- **`_ `通配不绑定（L-02 显式）**：`_` 匹配任意值但**不引入任何变量绑定**，不可在 arm 体内引用；仅作占位。其与具名 `Ident` 绑定的唯一区别即"是否可引用"，无其他隐式行为。
- **`when` 守卫须布尔显式（L-02 显式）**：`Guard` 的 `Expr` 必须为布尔类型，**禁止隐式布尔判定**（复用 `T_STMT_IMPLICIT_BOOL` 检查，tc.tc:7336）；守卫失败则该 arm / 子句不参与匹配，继续下一候选。
- **穷尽性（L-03 显式）**：`match` 的 arms 必须覆盖所有可能值，或以 `_` 显式兜底，否则报 `T_MATCH_NONEXHAUSTIVE`（sum type 须覆盖全部 case；标量 / 非 sum type 须以 `_` 兜底，无隐式默认分支）。
- **结果类型统一（L-03 静态类型）**：各 `MatchArm` 的 `Expr` 必须推断为同一类型 `R`，`MatchExpr` 整体即 `R`；不一致报 `T_MATCH_ARM_TYPE`。
- **函数子句分发语义（语法糖）**：多个同 `FuncName`、同元数的 `FuncDecl` 构成子句组。`FuncDecl` 的参数位即 `ParamPattern`（其首选项 `Ident ":" Type` 与普通函数声明的 `name:type` 等价），故「普通函数声明」与「模式匹配子句」是同一 `FuncDecl` 语法的两种用法，不引入第二种声明写法（L-04 唯一语义）。调用时参数**从左到右**与各子句 `ParamPattern` 匹配；首个"全部参数模式匹配且 `when` 守卫均为真"的子句被选中执行；若无一匹配，报 `T_FUNC_NO_CLAUSE`（运行期 panic）。建议至少一条子句为不可反驳式（以 `_` 或裸 `Ident` 收尾），否则编译器告警 `T_FUNC_NO_IRREFUTABLE`。**函数子句为纯语法糖**：编译器在 AST lowering 阶段强制将所有多子句 `FuncName fn(...)` 脱糖（desugar）为内部 `match` 节点——`classify fn(pat when g) { B }` 展开为 `classify fn(__x) { match (__x) { pat when g => B } }`。`match` 为唯一语义真源，函数子句不引入独立语义。函数子句声明头与 `reference.md` §3.1 并置式 `FuncName fn(...) -> Ret` 一致，禁止重载。
- **绑定作用域（L-02 显式）**：`PatBind` / `Ident` 参数仅在其 arm / 子句作用域内可见，遮蔽同名外部变量，无隐式生命周期。

---

## 3. Examples

```t
// 标量相等 + 通配 + when 守卫
let x = 2;
let s = match (x) {
  0 => "zero"
  n when n > 0 => "positive"   // n 绑定且守卫过滤
  _ => "non-positive"
}

// variant 解构 + 穷尽
Shape variant { Circle(f64) Rect(f64, f64) }
let area = match (Shape.Circle(3.0)) {
  Circle(r) => 3.14159 * r * r
  Rect(w, h) => w * h
}

// 函数子句模式匹配 + 参数守卫（并置式声明，与 reference.md §3.1 一致）
classify fn(0) -> string { "zero" }
classify fn(n) when n > 0 -> string { "positive" }
classify fn(_) -> string { "non-positive" }
```

---

## 4. 与既有构造的关系（L-04 论证）

| 构造 | 操作数类型 | 能力 | 状态 |
|---|---|---|---|
| `switch` | 标量 / 整数 / 枚举值 | 值相等分发 | 🚫 已废弃（deprecated），由 `match` 取代 |
| `match`（表达式） | 所有值类型 | 相等 + 标签匹配 + payload 解构 + `when` 守卫 + 穷尽 | ⚠ spec-only |
| 函数子句 `FuncName fn(...)` | 参数列表（模式 + `when`） | 声明级多子句分发（**语法糖，lowering 脱糖为 match**；声明头与 `reference.md` §3.1 并置式一致，参数位为 `ParamPattern`） | ⚠ spec-only |

`switch` 废弃后，表达式级值分发仅余 `match` 一种写法。函数子句虽在源码层是另一种写法，但经用户裁定（§7）定义为 **`match` 的语法糖**，在 AST lowering 阶段强制脱糖为内部 `match` 节点，故语义真源唯一为 `match`，L-04 满足（单一语义真源）。

---

## 5. 法律验证（L-14 铁律校验法）—— 已实装并覆盖

编译器 `src/tc.tc` 已完成实装（2026-08-01），门禁覆盖如下：

| 门禁 | 覆盖项 | 结果 |
|---|---|---|
| `tools/run_examples.mjs` | `examples/match_demo.tc`（match 7 场景，18 行）、`examples/clause_demo.tc`（函数子句 7 场景，13 行）；C + LLVM 双后端各自比对 `.expected.txt` 并交叉比对 | 12/12 PASS（dbg + rls） |
| `tools/conformance.mjs` | `pass/p17_clause_ok.tc`；`fail/f17..f22`（`T_MATCH_NONEXHAUSTIVE` / `T_FUNC_CLAUSE_ARITY` / `_RET_TYPE` / `_NO_TYPE` / `_BIND_CONFLICT` / `_BODY`） | 40/40 PASS |
| 自举定点 | `tc → tc' → tc'' → tc'''` 三阶段 `.ll` 逐字节相同 | md5 全等，发射侧 `; UNSUPPORTED` 计数 0 |
| `catn_check` / `shadow_check` | 编译器自身铁律 | OK / OK |
| `difftest.mjs` | 与冻结的 tc0 参考实现比对 | 23 passed / 4 failed（均为既有 `println` vs `t_println` 冻结分歧，与本规则无关，同基线） |

实装要点：

- **词法**：`KwMatch` / `KwWhen` 关键字、`=>` token。
- **语法**：`parse_match_expr` / `parse_match_arm`；`parse_func_decl` 的参数位泛化为 `ParamPattern`（`_` 通配 / 字面量模式 / 裸绑定 / `name: Type`，可选 `when` 守卫），复用 `P` 节点的空闲字段（`ba`=通配、`nb`=字面量模式、`nc`=守卫）。
- **脱糖**：`desugar_func_clauses()` 在 `parse_unit` 末尾（check 之前）按函数名归组，把整组子句就地合并为单一 `FuncDecl`，体为 `return match (__p0) { ... };`；组内所有原子句节点 `kind` 改写为 `ClauseDead` 下线，对 register / check / 双后端发射的 `kind == "FuncDecl"` 分派不可见——**保证同一组只被诊断一次**，且畸形声明不会流入 check。
- **多参处理**：仅 #0 形参进入 `match` 被检查；#1 起的字面量模式与 `when` 守卫**折叠进该 arm 的守卫**（`__pN == lit && guard`，`&&` 串接）；因此 #1 起各子句必须绑定同一名字（否则 `T_FUNC_CLAUSE_BIND_CONFLICT`）。
- **类型推定**：形参类型优先取「某子句的显式 `name: Type`」，退而取「该位首个字面量模式的字面量类型」，均无则 `T_FUNC_CLAUSE_NO_TYPE`。
- **锚点**：合成的 `match` / arm / scrutinee 节点承接原子句锚点，故 `T_MATCH_NONEXHAUSTIVE` 等诊断能报出原始文件与行列。
- **惰性验证**：`src/tc.tc` 自身不使用子句语法，脱糖前后其自编译 IR 逐字节相同 —— 该通道对既有代码完全惰性。

遗留：`variant` 的 `CaseName(...)` 解构模式属前向依赖（variant 值构造尚未实现），v1 不含。

- **废弃 switch 的连带动作（待用户另行授权，属设计文件改动 / 红线②）**：在 `docs/reference.md` 将 `switch` 标记 deprecated；排查并更新 `examples/`、`tests/` 中现存 `switch` 用法。

---

## 6. 合规判据（待并入 reference.md 后由法律检查代码）

| 法律 | 判据 | 当前代码状态 |
|---|---|---|
| L-04 唯一语义 | switch 已废弃；match 为唯一表达式分发；函数子句定义为 match 的语法糖（lowering 脱糖为 match 节点），语义单一真源；函数子句声明形式已于 §7.2 与 `reference.md` §3.1 对齐（并置式 `FuncName fn(...)`，禁止重载） | ✅ 已实装：`desugar_func_clauses` 强制脱糖，原子句节点下线为 `ClauseDead`，`match` 为唯一发射路径 |
| L-02 显式 | `_` 不绑定；`when` 布尔显式；穷尽显式 | ✅ 已实装：`f17_clause_nonexhaustive` / `match_demo` 覆盖 |
| L-03 静态类型 | 分支同类型、穷尽 / 不可反驳编译期校验 | ✅ 已实装：`f19_clause_ret_type` / `f20_clause_no_type` / `T_MATCH_NONEXHAUSTIVE` 覆盖 |
| L-14 铁律校验 | 门禁覆盖 match 与函数子句 | ✅ 已覆盖：run_examples 12/12（双后端）、conformance 40/40、自举 IR 定点 |

---

## 7. L-04 张力裁定（已决）

**函数子句模式匹配 vs match 表达式**同一逻辑两种写法。用户裁定（2026-08-01）：**函数子句为语法糖**——编译器在 AST lowering 阶段强制把所有多子句 `fn` 脱糖展开为内部 `match` 节点，`match` 为唯一语义真源。因此源码层允许两种写法，但语义层单一真源，满足 L-04「唯一确定语义」。原候选 A/B/C 中采纳 **(B) desugar 方案**。

### 7.2 已决张力（✅ 已彻底消解）：函数子句声明形式 vs 函数声明

**裁定（2026-08-01，用户指令「match 的函数声明语法要与 decl_func.md 保持一致」+ 后续反馈「函数子句模式与函数声明的语法存在冲突」）**：本草稿的 `FuncDecl` 曾两度出现 L-04 声明层张力——

1. **自由式冲突（已消解）**：旧 `FuncDecl` 为自由式 `fn FuncName "(" ParamPatternList ")"`（关键字前置于名字），与 `decl_func.md` 当时的绑定式 `FuncName "::" "func" (...)` 冲突。
2. **参数层冲突（已消解，本次反馈所指）**：对齐时若把 `FuncDecl` 的参数位写成纯 `name:type`（`(Param ("," Param)*)?`），则模式子句（如 `classify fn(0)`、`classify fn(n) when n>0`、`classify fn(_)`）无法套用该产生式，且 `ParamPatternList` 成为**从未被引用的游离产生式**——即「函数子句模式」与「函数声明」语法互相排斥。

> **语法迁移注记（2026-08-01 后）**：上述历史裁定发生在 `::` 绑定算子存在、声明关键字为 `func` 的时期。其后 `::` 被移除、`func` 更名为 `fn`，声明形态统一为并置式 `Name fn(...)`（名字在前、关键字在后）。本节结论（声明头对齐 + 参数位泛化）不受影响，仅记号随之更新；本草稿正文所有产生式与示例均已同步为新形态。

**最终方案（声明头对齐 + 参数位泛化）**：

```
FuncDecl: FuncName "fn" "(" (ParamPattern ("," ParamPattern)*)? ")" "->" Type FuncAnns? Block

ParamPattern:
    | Ident ":" Type Guard?         // 与普通函数声明的 name:type 等价
    | Ident Guard? | "_" Guard? | Literal Guard? | CaseName Guard? | CaseName "(" PatBindList ")" Guard?
```

- **声明头**与 `reference.md` §3.1 完全一致（`FuncName "fn" (...) "->" Type FuncAnns? Block`、并置式无绑定符、`->` 箭头、禁止重载）；
- **参数位**统一为 `ParamPattern`，其首选项 `Ident ":" Type` 与普通参数（`name:type`）等价，故「普通函数声明」与「模式匹配函数子句」是**同一 `FuncDecl` 产生式的两种用法**，不再有第二种声明语法，L-04「唯一确定语义」满足；
- 游离的 `ParamPatternList` 产生式已删除（并入 `FuncDecl` 的内联 `(ParamPattern ("," ParamPattern)*)?`）。

因此「函数子句声明形式 vs 函数声明」的 ❌ 张力**已彻底消解**，L-04 满足。

**原阻挡已解除（2026-08-01）**：`match` / 函数子句的完整语义（词法 `KwMatch`/`KwWhen`、`=>` token、`MatchExpr` 节点、穷尽性 / `when` 守卫 / 脱糖、`check_match`、`C`/`LLVM` 双后端发射、`conformance`/`run_examples` 门禁覆盖）已在编译器 `src/tc.tc` 中**全部实装并通过门禁**（详见 §5）。四项法律判据 L-02 / L-03 / L-04 / L-14 现均为 ✅。

本草稿据 L-15 第5条仍维持 DRAFT 状态，**待用户下达「规则采纳」指令**后方可并入 `docs/reference.md`（§3.3/§3.4/§3.5），并同步标记本草稿失效。

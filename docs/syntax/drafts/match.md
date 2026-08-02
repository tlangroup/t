# 语法规则草稿：match 表达式 与 函数子句模式匹配

> **状态**：草稿（DRAFT）—— 法律验证（L-04 / L-03 / L-01 / L-02 / L-14）**已全部通过**；编译器已实装、门禁已覆盖（详见 §5）。**待用户「规则采纳」指令**方可并入 `docs/reference.md`，原草稿随即标记失效。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 法律验证 → 采纳 → 并入 → 失效）。
> **作用对象**：值的**统一模式分发** —— `match` 表达式（标量 / 字符串 / `enum`）、**函数子句模式匹配**（多子句 `fn` 按参数模式分发）、**`when` 守卫**条件过滤、**`_` 通配占位**（不绑定变量）。既有 `switch` 已**废弃并从 `reference.md` 移除**，由本规则取代。
> **形态**：`match` 为表达式（各臂产生同类型值）；函数子句为声明级分发，编译期脱糖为 `match`。
> **记号**：符合 `docs/reference.md` §1 Notation（`ProductionName: Syntax`；`|` 选择、`( )` 分组、`*`/`+` 重复、`?` 可选、字面量 `"..."`）。
>
> **本稿与实现的关系**：本次修订（2026-08-02）以**实测行为为准**逐条校订了 EBNF 与示例 —— 此前草稿中若干产生式和示例在真实编译器上无法通过。所有 §3 示例均已实际编译运行验证。

---

## 1. EBNF

```ebnf
// —— match 表达式 ——
MatchExpr: "match" "(" Expr ")" "{" MatchArm+ "}"

// 臂之间无需分隔符（换行即可）；尾随 "," 允许但非必需。
MatchArm: MatchPat Guard? "=>" Expr ","?

Guard: "when" Expr

MatchPat:
    | Literal        // 字面量相等匹配（整数 / 字符串）
    | CaseName       // enum 成员：裸写 `Red` 或限定写 `Color.Red`，两者等价
    | Ident          // 绑定：匹配任意值并绑定到该名字（首字母必须小写，见 §2 C2）
    | "_"            // 通配占位：匹配任意值，不绑定变量

CaseName: (EnumName ".")? UpperIdent

// —— 函数子句模式匹配 ——
// 声明头与 reference.md §3.1 并置式完全一致；差别仅在参数位允许模式。
// 注意：子句守卫写在**参数括号内**，紧跟该参数模式，而非括号之后。
FuncDecl: FuncName "fn" "(" (ParamPattern ("," ParamPattern)*)? ")" "->" Type FuncAnns? Block

ParamPattern:
    | Ident ":" Type      // 普通参数，与 reference.md §3.1 的 name:type 完全等价
    | Ident Guard?        // 绑定参数（省略类型，由同组其他子句 / 字面量推定）
    | "_"                 // 通配占位，不绑定变量
    | Literal             // 字面量常量匹配
```

- 新增词法记号：`KwMatch`（`match`）、`KwWhen`（`when`）、`"=>"`（臂映射箭头）。
- **`Newline` 不是终结符**：本语言词法不产生换行记号，臂的边界由 `=>` 表达式的自然结束确定。旧稿的 `(Newline | ",")` 是错误记法，已改为 `","?`。
- **守卫位置**：`match` 臂的守卫在 `MatchPat` 与 `=>` 之间（`n when n > 0 => ...`）；函数子句的守卫在**参数括号内**（`classify fn(n when n > 0) -> string`）。这是两处不同的位置，勿混。

---

## 2. Where（编译期约束）

- **唯一分发构造（L-04 唯一语义）**：`match` 是值分发的**唯一**表达式级语法；`switch` 已废弃，其词法记号 / 产生式 / 节点定义均已从 `reference.md` 移除。
- **`_` 通配不绑定（L-02 显式）**：`_` 匹配任意值但**不引入任何绑定**，不可在臂体内引用；与具名绑定的唯一区别即「是否可引用」，无其他隐式行为。
- **`when` 守卫须为 `bool`（L-02 显式）**：守卫表达式必须是 `bool` 类型，**禁止隐式布尔判定**，违者报 `T_STMT_IMPLICIT_BOOL`。判据为**白名单**：仅 `bool` 标量合法，`Unknown`（推断失败）放行以免级联噪声，其余一律拒绝 —— 含 `string` / `slice` / `struct` / `enum` / 函数值。守卫为假则该臂不参与匹配，继续下一候选。
- **穷尽性（L-03 显式）**：`match` 必须覆盖所有可能取值，否则报 `T_MATCH_NONEXHAUSTIVE`。满足下列**任一**即视为穷尽：
  1. 存在 `_` 通配臂（无守卫）；
  2. 存在裸标识符绑定臂（无守卫）—— 绑定匹配一切，等价兜底；
  3. **scrutinee 为 `enum` 且每个成员都被一条无守卫的 CaseName 臂覆盖**（A1 裁定，见 §7.3）。
  带守卫的臂**不计入**覆盖 —— 守卫可能为假，控制流仍会漏出。诊断消息会**指名列出**未覆盖的成员（如 `unhandled case(s) Color.Green, Color.Blue`）。
- **模式消歧：PascalCase 约定（C2 裁定，见 §7.4）**：模式位置的裸标识符按首字母大小写区分语义 —— **大写 = CaseName**（按值分发），**小写 = 绑定名**（匹配一切）。大写标识符若不是 scrutinee 所属 `enum` 的成员，报 `T_MATCH_UNKNOWN_CASE`；裸 CaseName 与限定写法 `Enum.Case` 完全等价。
- **结果类型统一（L-03 静态类型）**：各臂表达式须推断为同一类型 `R`，`MatchExpr` 整体即 `R`；不一致报 `T_MATCH_ARM_TYPE`。
- **函数子句分发语义（纯语法糖）**：多个同名同元数的 `FuncDecl` 构成子句组。调用时**从左到右**匹配各子句参数模式，首个「全部模式匹配且守卫为真」的子句被选中。编译器在 AST lowering 阶段**强制**把整组脱糖为单一 `FuncDecl`，其体即 `return match (__p0) { ... };` —— `match` 是唯一语义真源，函数子句不引入独立语义。子句组声明头与 `reference.md` §3.1 并置式一致，禁止重载。
- **绑定作用域（L-02 显式）**：模式绑定仅在其臂 / 子句作用域内可见，遮蔽同名外部变量，`match` 结束后外层不受影响，无隐式生命周期。

---

## 3. Examples

> 以下代码均已在 `out/dbg/tc.exe` 上实际编译运行通过。

```t
// ── ① 字面量模式 + 绑定 + 守卫 + 通配 ────────────────────────
sign_of fn(x: i64) -> string {
    return match (x) {
        0 => "zero"
        n when n > 0 => "positive"   // n 绑定，守卫过滤
        _ => "negative"
    };
}

// ── ② enum 分发：裸 CaseName，全覆盖故无需 `_` ───────────────
Color enum : u8 {
    Red,
    Green,
    Blue,
}

name_of fn(c: Color) -> string {
    return match (c) {
        Red => "red"
        Green => "green"
        Blue => "blue"
    };
}

// 限定写法等价
name_of2 fn(c: Color) -> string {
    return match (c) {
        Color.Red => "red"
        Color.Green => "green"
        Color.Blue => "blue"
    };
}

// ── ③ 大小写混用：CaseName 分发 + 小写绑定兜底 ───────────────
is_warm fn(c: Color) -> bool {
    return match (c) {
        Red => true
        other => false
    };
}

// ── ④ 字符串模式 ─────────────────────────────────────────────
lang_of fn(code: string) -> string {
    return match (code) {
        "zh" => "Chinese"
        "en" => "English"
        _ => "Unknown"
    };
}

// ── ⑤ 函数子句：守卫在括号内，体是完整 Block ─────────────────
classify fn(0)            -> string { return "zero"; }
classify fn(n when n > 0) -> string { return "positive"; }
classify fn(_)            -> string { return "negative"; }

// ── ⑥ 多参子句：首位走 match，其余位折叠进守卫 ───────────────
pick fn(1, k: i64) -> i64 { return k * 10; }
pick fn(2, k)      -> i64 { return k * 100; }
pick fn(m, k)      -> i64 { return m + k; }

// ── ⑦ 子句递归 ───────────────────────────────────────────────
fib fn(0)            -> i64 { return 0; }
fib fn(1)            -> i64 { return 1; }
fib fn(n when n > 1) -> i64 { return fib(n - 1) + fib(n - 2); }
fib fn(_)            -> i64 { return 0 - 1; }
```

---

## 4. 与既有构造的关系（L-04 论证）

| 构造 | 操作数类型 | 能力 | 状态 |
|---|---|---|---|
| `switch` | 标量 / 整数 / 枚举值 | 值相等分发 | 🚫 **已废弃并移除**（2026-08-01 从 `reference.md` 删除词法记号 / 产生式 / 节点定义） |
| `match`（表达式） | 标量 / 字符串 / `enum` | 相等 + CaseName 分发 + 绑定 + `when` 守卫 + 穷尽性 | ✅ 已实装 |
| 函数子句 `FuncName fn(...)` | 参数列表（模式 + `when`） | 声明级多子句分发（**纯语法糖**，lowering 脱糖为 match） | ✅ 已实装 |

`switch` 移除后，表达式级值分发仅余 `match` 一种写法。函数子句虽在源码层是另一种写法，但经用户裁定（§7.1）定义为 **`match` 的语法糖**，AST lowering 阶段强制脱糖，语义真源唯一，L-04 满足。

---

## 5. 法律验证（L-14 铁律校验法）—— 已实装并覆盖

| 门禁 | 覆盖项 | 结果 |
|---|---|---|
| `tools/run_examples.mjs` | `examples/match_demo.tc`（7 场景）、`examples/clause_demo.tc`（7 场景）；C + LLVM 双后端各自比对 `.expected.txt` 并交叉比对 | PASS（dbg 双后端） |
| `tools/conformance.mjs` | `pass/p17_clause_ok` `p21_match_enum_exhaustive` `p22_match_case_dispatch`；`fail/f17..f22`、`f30_guard_bool_nonscalar`、`f31_match_enum_missing_case`、`f32_match_unknown_case` | **55/55 PASS** |
| 自举不动点 | `tc → g2 → g3 → g4` 的 `.ll` 逐字节相同 | md5 全等 |
| `difftest.mjs` | 代际对拍 `g2 ↔ g3` 全通道 | PASS |
| `catn_check` / `shadow_check` | 编译器自身铁律 | OK / OK |
| `; UNSUPPORTED` 计数 | 发射侧未支持标记 | 0 |

实装要点：

- **词法**：`KwMatch` / `KwWhen` 关键字、`=>` token。
- **语法**：`parse_match_expr` / `parse_match_arm`；`parse_func_decl` 的参数位泛化为 `ParamPattern`，复用 `P` 节点空闲字段（`ba`=通配、`nb`=字面量模式、`nc`=守卫）。
- **脱糖**：`desugar_func_clauses()` 在 `parse_unit` 末尾（check 之前）按函数名归组，整组合并为单一 `FuncDecl`；组内原子句节点 `kind` 改写为 `ClauseDead` 下线，对 register / check / 双后端发射的 `kind == "FuncDecl"` 分派不可见 —— 保证同一组只被诊断一次，且畸形声明不会流入 check。
- **多参处理**：仅 #0 形参进入 `match`；#1 起的字面量模式与守卫**折叠进该臂的守卫**（`__pN == lit && guard`，`&&` 串接），故 #1 起各子句必须绑定同一名字（否则 `T_FUNC_CLAUSE_BIND_CONFLICT`）。
- **C2 改写**：checker 在遍历臂时就地把首字母大写的裸绑定改写为 `member` 模式节点（`Case` ⇒ `Enum.Case`），使 checker 与 C / LLVM 双后端**复用既有 member 路径、零改动**；改写后清空绑定名，故对 `infer_expr` 的重入天然幂等。
- **A1 覆盖分析**：`enum_all_cases_covered` / `enum_missing_cases` 遍历 `EnumDecl` 成员链，逐个查是否有无守卫的 member 臂覆盖。
- **锚点**：所有合成节点（match / arm / scrutinee / C2 改写的 member）均承接原节点 `ln`/`cl`/`tv`，故诊断能报出原始文件行列。
- **惰性验证**：`src/tc.tc` 自身不使用子句语法与 enum match，脱糖前后其自编译 IR 逐字节相同 —— 该通道对既有代码完全惰性。

---

## 6. 合规判据

| 法律 | 判据 | 状态 |
|---|---|---|
| L-04 唯一语义 | switch 已移除；match 为唯一表达式分发；函数子句脱糖为 match，语义单一真源 | ✅ `desugar_func_clauses` 强制脱糖，原子句下线为 `ClauseDead` |
| L-02 显式 | `_` 不绑定；`when` 须 bool（白名单判据）；穷尽显式；大小写决定模式语义 | ✅ `f30` / `f31` / `f32` 覆盖 |
| L-03 静态类型 | 臂同类型、穷尽性、CaseName 存在性均为编译期校验 | ✅ `T_MATCH_ARM_TYPE` / `T_MATCH_NONEXHAUSTIVE` / `T_MATCH_UNKNOWN_CASE` |
| L-14 铁律校验 | 门禁覆盖 match 与函数子句 | ✅ conformance 55/55、run_examples 双后端、四代自举不动点 |

### 6.1 待办（不阻塞采纳）

- **`variant` 解构模式** `CaseName(a, b)`：前向依赖 —— `variant` 值构造尚未实现，v1 不含。EBNF 中暂不列出该产生式，待 variant 落地后另起草稿增补。
- **非 enum scrutinee 的大写裸标识符**：当前仅在 scrutinee 为 `enum` 时做 CaseName 解析；标量 / 字符串 scrutinee 下的大写裸名仍按绑定处理（不报错）。待 variant 落地时统一收紧。
- **臂不可达检测**：`_` 或绑定臂之后的臂当前不报 unreachable 告警。

---

## 7. 设计裁定（已决）

### 7.1 函数子句 vs match 表达式（2026-08-01）

同一逻辑两种写法构成 L-04 张力。**裁定：函数子句为语法糖** —— 编译器在 AST lowering 阶段强制脱糖为 `match` 节点，`match` 为唯一语义真源。源码层允许两种写法，语义层单一真源，L-04 满足。原候选 A/B/C 中采纳 **(B) desugar 方案**。

### 7.2 函数子句声明形式 vs 函数声明（2026-08-01）

**裁定：声明头对齐 + 参数位泛化**。`FuncDecl` 声明头与 `reference.md` §3.1 完全一致（并置式 `FuncName fn(...) -> Ret`、禁止重载）；参数位统一为 `ParamPattern`，其首选项 `Ident ":" Type` 与普通参数等价。故「普通函数声明」与「模式匹配子句」是**同一产生式的两种用法**，不存在第二种声明语法，L-04 满足。游离的 `ParamPatternList` 产生式已删除。

> **记号迁移注记**：该裁定作出时 `::` 绑定算子尚存、声明关键字为 `func`。其后 `::` 移除、`func` 更名 `fn`，声明形态统一为并置式。结论不受影响，记号已同步。

### 7.3 穷尽性判据：是否强制 `_`（A1，2026-08-02）

**争点**：`enum` 全成员覆盖但无 `_` 时，算不算穷尽？

**裁定：补覆盖分析** —— enum 全 case 覆盖即视为穷尽，`_` 变为可选。

**理由**：若一律强制 `_`，给 enum 新增成员时，新成员会**静默落进兜底分支**，漏处理无从察觉。而在覆盖分析下，新增成员会让所有旧 `match` 立刻报错、强制回访每一处 —— 这正是穷尽性检查的核心价值。诊断消息指名列出缺失成员，使回访成本极低。

### 7.4 模式消歧：裸标识符是 CaseName 还是绑定（C2，2026-08-02）

**争点**：模式位置的裸标识符 `Red`，应解析为枚举成员还是绑定名？

**裁定：PascalCase 约定** —— 首字母大写即 CaseName，小写才是绑定。

**理由**：裁定前的实现把裸 `Red` 一律当作绑定，后果是它**匹配一切**、让后续所有臂不可达，且**零诊断静默通过** —— 实测 `match (c) { Red => "matched-Red" _ => "fell" }` 传入 `Green` 也返回 `"matched-Red"`。这是最难察觉的一类错误。PascalCase 约定与 t 语言既有命名规范（类型 / 枚举成员用 PascalCase，变量用 snake_case）一致，无需额外记忆负担。拼错 case 名时报 `T_MATCH_UNKNOWN_CASE` 并给出两条出路（改拼写 / 换小写名绑定）。

### 7.5 函数子句诊断码收敛（A4，2026-08-02）

**争点**：旧草稿要求「无匹配子句」运行期 panic 报 `T_FUNC_NO_CLAUSE`，并对缺少不可反驳子句告警 `T_FUNC_NO_IRREFUTABLE`；实现均未提供。

**裁定：删除这两个码，草案让步。**

**理由**：函数子句既已脱糖为 `match`，其穷尽性由 `T_MATCH_NONEXHAUSTIVE` 在**编译期**统一保证 —— 编译期已证穷尽，就不存在「无子句匹配」的运行期状态，`T_FUNC_NO_CLAUSE` 无从触发；`T_FUNC_NO_IRREFUTABLE` 亦被穷尽性检查完全覆盖。保留两个永不触发的诊断码违反 L-04 唯一语义（同一约束两套码）。

---

## 8. 采纳状态

本草稿据 L-15 第5条维持 **DRAFT**，**待用户下达「规则采纳」指令**后并入 `docs/reference.md`（§3.3 / §3.4 / §3.5），并同步标记本草稿失效。

四项法律判据 L-02 / L-03 / L-04 / L-14 现均为 ✅；§7 五项设计裁定全部已决；§6.1 三项待办均为增量能力，不构成采纳阻塞。

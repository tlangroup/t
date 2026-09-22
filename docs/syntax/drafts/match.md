# 语法规则草稿：match 表达式 与 函数子句模式匹配

> **状态**：草稿（DRAFT）—— 法律验证（L-04 / L-03 / L-01 / L-02 / L-14）**已全部通过**；编译器已实装、门禁已覆盖（详见 §5）。**待用户「规则采纳」指令**方可并入 `docs/reference.md`，原草稿随即标记失效。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 法律验证 → 采纳 → 并入 → 失效）。
> **作用对象**：值的**统一模式分发** —— `match` 表达式（标量 / 字符串 / `enum`）、**函数子句模式匹配**（多子句 `fn` 按参数模式分发）、**`when` 守卫**条件过滤、**`_` 通配占位**（不绑定变量）。既有 `switch` 已**废弃并从 `reference.md` 移除**，由本规则取代。
> **形态**：`match` 为表达式（各臂产生同类型值）；函数子句为声明级分发，编译期脱糖为 `match`。
> **记号**：符合 `docs/reference.md` §1 Notation（`ProductionName: Syntax`；`|` 选择、`( )` 分组、`*`/`+` 重复、`?` 可选、字面量 `"..."`）。
>
> **本稿与实现的关系**：本次修订（2026-08-02）以**实测行为为准**逐条校订了 EBNF 与示例 —— 此前草稿中若干产生式和示例在真实编译器上无法通过。所有 §3 示例均已实际编译运行验证。
> **语法基线复核（2026-09-23）**：其间语言发生过**语法迁移**，本稿原先使用的**并置式声明**（`FuncName fn(...) -> Ret`、`Color enum`）已被移除。本次已按现行编译器（`out/dbg/tc.exe`）重新实跑校订全部示例，详见 §7.6。
> ✅ **该缺陷已于同日修复**（LLVM 发射侧四处根因，见 §6.2），并新增 `examples/enum_match_dispatch.tc` 运行期用例补上门禁缺口；§3 的 ②③ 示例现已恢复「已验证」状态。

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
// 注意：子句守卫写在**参数括号内**，紧跟该参数模式，而非括号之后。
// ⚠ 现行语法（2026-09-23 实测）：并置式 `FuncName fn(...) -> Type` 已**移除**
//   （现报 T-PAR-E102），唯一合法形式为 `"fn" FuncName "(" ... ")" Type Block`
//   —— 即 `fn` 前置、返回类型前**无** `->`。
FuncDecl: "fn" FuncName "(" (ParamPattern ("," ParamPattern)*)? ")" Type FuncAnns? Block

ParamPattern:
    | Ident ":" Type      // 普通参数，与 reference.md §3.1 的 name:type 完全等价
    | Ident Guard?        // 绑定参数（省略类型，由同组其他子句 / 字面量推定）
    | "_"                 // 通配占位，不绑定变量
    | Literal             // 字面量常量匹配
```

- 新增词法记号：`KwMatch`（`match`）、`KwWhen`（`when`）、`"=>"`（臂映射箭头）。
- **`Newline` 不是终结符**：本语言词法不产生换行记号，臂的边界由 `=>` 表达式的自然结束确定。旧稿的 `(Newline | ",")` 是错误记法，已改为 `","?`。
- **守卫位置**：`match` 臂的守卫在 `MatchPat` 与 `=>` 之间（`n when n > 0 => ...`）；函数子句的守卫在**参数括号内**（`fn classify(n when n > 0) string`）。这是两处不同的位置，勿混。
- **子句体 / 臂体必须是单一表达式（2026-09-23 实测）**：子句体要脱糖为 match 臂，故只能是一条表达式；写成多条语句（如 `if (c) { return A; } else { return B; }`）报 **`T-FUN-E814`**。t 当前**既无 `if` 表达式、也无 Block 表达式** —— `return if (c) A else B;` 与 arm 写 `_ => { ...; return v; }` 均报 **`T-PAR-E101`**。故多步逻辑须提取为辅助函数，或改用 `when` 守卫 + 兜底臂。

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

> 以下代码均已以**现行语法**在 `out/dbg/tc.exe` 上实际编译运行通过（2026-09-23 复核，含 enum 示例 —— 运行期分派缺陷已于同日修复，见 §6.2）。
> ⚠ `unreachable` **不是** t 的内建，兜底一律写 `return 0 - 1;`。

```t
// ── ① 字面量模式 + 绑定 + 守卫 + 通配 ────────────────────────
fn sign_of(x: i64) string {
    return match (x) {
        0 => "zero"
        n when n > 0 => "positive"   // n 绑定，守卫过滤
        _ => "negative"
    };
}

// ── ② enum 分发：三种等价写法，全覆盖故无需 `_` ───────────────
// 三种写法均编译通过且运行分派正确（2026-09-23 修复后复核）
enum Color : u8 {
    Red,
    Green,
    Blue,
}

fn name_of(c: Color) string {          // 裸 CaseName
    return match (c) {
        Red => "red"
        Green => "green"
        Blue => "blue"
    };
}

fn name_of2(c: Color) string {         // 限定写法
    return match (c) {
        Color.Red => "red"
        Color.Green => "green"
        Color.Blue => "blue"
    };
}

fn name_of3(c: Color) string {         // 前导点写法
    return match (c) {
        .Red => "red"
        .Green => "green"
        .Blue => "blue"
    };
}

// ── ③ 大小写混用：CaseName 分发 + 小写绑定兜底 ───────────────
fn is_warm(c: Color) bool {
    return match (c) {
        Red => true
        other => false
    };
}

// ── ④ 字符串模式 ─────────────────────────────────────────────
fn lang_of(code: string) string {
    return match (code) {
        "zh" => "Chinese"
        "en" => "English"
        _ => "Unknown"
    };
}

// ── ⑤ 函数子句：守卫在括号内，体须单一表达式 ─────────────────
fn classify(0) string { return "zero"; }
fn classify(n when n > 0) string { return "positive"; }
fn classify(_) string { return "negative"; }

// ── ⑥ 多参子句：首位走 match，其余位折叠进守卫 ───────────────
fn pick(1, k: i64) i64 { return k * 10; }
fn pick(2, k) i64 { return k * 100; }
fn pick(m, k) i64 { return m + k; }

// ── ⑦ 子句递归 ───────────────────────────────────────────────
// ⚠ `when` 臂不计入穷尽性，故必须有 `_` 兜底，否则报 T-MAT-E742
fn fib(0) i64 { return 0; }
fn fib(1) i64 { return 1; }
fn fib(n when n > 1) i64 { return fib(n - 1) + fib(n - 2); }
fn fib(_) i64 { return 0 - 1; }
```

---

## 4. 与既有构造的关系（L-04 论证）

| 构造 | 操作数类型 | 能力 | 状态 |
|---|---|---|---|
| `switch` | 标量 / 整数 / 枚举值 | 值相等分发 | 🚫 **已废弃并移除**（2026-08-01 从 `reference.md` 删除词法记号 / 产生式 / 节点定义） |
| `match`（表达式） | 标量 / 字符串 / `enum` | 相等 + CaseName 分发 + 绑定 + `when` 守卫 + 穷尽性 | ✅ 已实装 |
| 函数子句 `fn FuncName(...)` | 参数列表（模式 + `when`） | 声明级多子句分发（**纯语法糖**，lowering 脱糖为 match） | ✅ 已实装 |

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
- ⚠ **原运行期覆盖缺口（2026-09-23 已补）**：上述门禁只保证「编译通过」+「**整数 / 字符串** scrutinee 的运行正确」。复核时发现 **enum scrutinee 的分派在运行期恒命中首臂**（§6.2）——`run_examples` 全仓无 enum 分派用例，conformance 的 `p21/p22` 只校验编译期行为，故该路径**完全未被门禁覆盖**。缺陷已修复，并新增 `examples/enum_match_dispatch.tc`（+ 期望输出）把该路径纳入双后端运行期对拍。

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
- **arm 体多语句**：依赖「Block / if 表达式化」这一当前不存在的语言能力（现 arm 体只能是单一表达式，见 §7.6）。

> 上述增量扩展统一登记在 `docs/syntax/drafts/match_extensions.md`（S1–S14：按难易分级的实现步骤与实现记录），本稿不重复展开。

---

### 6.2 已修运行期缺陷：enum scrutinee 恒命中首臂

> 2026-09-23 语法基线复核时由**实跑**发现；同日定位四处根因并修复，见下方记录。

**现象**：**enum scrutinee 的模式分派恒命中首臂** —— 与传入哪个成员无关，返回值永远是第一条 arm 的值。

**最小复现**：

```t
enum Expl : u8 { R = 1, G = 2, B = 3, }

fn pick(c: Expl) string {
    return match (c) {
        .R => "r"
        .G => "g"
        .B => "b"
    };
}
// 修复前：pick(Expl.R) / pick(Expl.G) / pick(Expl.B) 三者均返回 "r"
// 修复后：分别返回 "r" / "g" / "b"
```

**关键定性**：缺陷**只存在于 TIR→LLVM 轨**（`build` / `run` / `emit-ll` 的唯一主路径，旧轨 `codegen_ll` 已删除）；`tc compile` 的 C 后端产物从一开始就是**正确**的（`_tms1 == NoB_C` + `#define NoB_C 2`，手工 clang 编译运行输出全对）。故这是单后端错编，**不是**语义/前端问题。

**四处根因（均在 LLVM 发射侧，逐个剔除后逐层暴露下一层）**：

| # | 位置 | 根因 | 症状 |
|---|---|---|---|
| ① | `tir.tc` `tir_match_pattern_cond` | 引擎给**用户具名类型**一律登记 `cat=="named"`，而此处判 `tds[scr_td].cat == "enum"` → 恒假 → 条件返回空串 → **整条条件链被跳过**，函数入口退化成 `br label <首臂>` | 恒命中首臂 |
| ② | `tir.tc` 同函数 | `sema.enum_const_lookup` 返回的是 int **节点**，值在 `sa`（文本）、`ia` 存的是**进制**（恒为 10）；直接 `nodes[cn].ia` 取值 → 所有成员模式都拿到常量 `10` | 全部臂永假（①修好后才可见） |
| ③ | `tir_to_ll.tc` `ll_register_named_type` | 「`%T` 前缀 ⇒ 运行期结构」启发式把 `Two` / `TokKind` 这类**名字以大写 T 起头的用户类型**一并排除 → 不 emit `%Two = type i64` → 被 `ll_emit_opaque_defs` 兜底成 `type opaque` | clang: *invalid type for function argument* |
| ④ | `tir_to_ll.tc` `tir_to_ll_emit` 第 1 遍 | 具名类型登记原先只扫「返回值 + 形参」，**仅作局部变量的枚举**（`var lv: Level`）拿不到类型定义 | clang: *Cannot allocate unsized type* |

另修一处同类死代码：`tir_emit_cast` 里的 enum→i64 判定同样因写 `cat == "enum"` 而从未生效，导致 `c as i32` 发出多余的 `bitcast i64→i64` 而非正确的 `trunc`（`examples/enum_constval.tc` 的 IR 因此从 445 行降到 365 行，运行输出不变）。

**统一判据**：`cat=="enum"` 在 t 的 TypeDef 上基本不成立，除 `t_td_is_variant` 那样「named + 回查 `lex.decl_list` 的 EnumDecl」外无可靠判定。已新增 `tir.t_td_is_enum(td)` 与 `tir_to_ll.ll_is_user_named_type(name)` 两个 helper，与既有 `t_td_is_variant` / `t_variant_decl_of_name` 同构。

**为何门禁未拦住**：`run_examples` 全仓**无任何 enum 分派用例**（唯一的 `examples/enum_constval.tc` 只测成员常量值）；conformance 的 `p21_match_enum_exhaustive` / `p22_match_case_dispatch` 只校验**编译期**行为（是否报错），不校验运行期落臂。典型的「双后端 differential 全绿也有洞」。

**已补守卫生 gate**：新增 `examples/enum_match_dispatch.tc`（+ `.expected.txt`）作为常规门禁用例，覆盖四种根因 + 三种语法形态（裸 `Case` / `Color.Red` / `.Red`）+ 有无 backing + 自动编号/显式值 + 局部与内联 scrutinee + 绑定兜底臂 + `as i32` 窄化。已用修复**前**的编译器验证该用例确实失败（返回首臂 / 链接报错），确保它不是空跑。

**验证**（2026-09-23）：`run_examples` 71/71（双后端）、`conformance` 274/274、`hir_test` RAW=0、`hir_eval_test` 全绿、IR 基线已由 g1 重录（97 targets / 294 entries）。

---

## 7. 设计裁定（已决）

### 7.1 函数子句 vs match 表达式（2026-08-01）

同一逻辑两种写法构成 L-04 张力。**裁定：函数子句为语法糖** —— 编译器在 AST lowering 阶段强制脱糖为 `match` 节点，`match` 为唯一语义真源。源码层允许两种写法，语义层单一真源，L-04 满足。原候选 A/B/C 中采纳 **(B) desugar 方案**。

### 7.2 函数子句声明形式 vs 函数声明（2026-08-01）

**裁定：声明头对齐 + 参数位泛化**。`FuncDecl` 声明头与普通函数声明完全一致（禁止重载）；参数位统一为 `ParamPattern`，其首选项 `Ident ":" Type` 与普通参数等价。故「普通函数声明」与「模式匹配子句」是**同一产生式的两种用法**，不存在第二种声明语法，L-04 满足。游离的 `ParamPatternList` 产生式已删除。

> **记法勘误（2026-09-23）**：本裁定原以「并置式 `FuncName fn(...) -> Ret`」记述，那是当时的形态；其后语法**再次迁移为 `fn FuncName(...) Ret { }`**（返回类型前无 `->`），并置式报 `T-PAR-E102` 移除。本稿 §1 EBNF 与 §3 示例已按现行形态改定。
> **结论不受影响** —— 本裁定的要点是「同一产生式两种用法」，与声明头采用哪种记号无关；声明头随语言统一演进即可。

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

### 7.6 语法基线：文档一律以现行编译器实测为准（2026-09-23）

**争点**：本稿 §1 EBNF 与 §3 示例自 2026-08-02 起沿用**并置式声明**（`FuncName fn(...) -> Ret`、`Color enum : u8`）。语言其后发生过语法迁移，这些写法今日已全部非法 —— 照抄示例必然失败，而文档仍赫然写着「所有 §3 示例均已实际编译运行验证」，形成误导。

**裁定：以现行编译器（`out/dbg/tc.exe`）实测行为为准全面勘误本稿，并把「示例必须实跑」固化为硬约束。**

**理由**：错写的根因是把「当时验证过」当作永久有效，而语法会迁移。更关键的是 —— **编译通过不等于示例正确**：本次实跑意外暴露出 §6.2 的 enum 分派缺陷（三种语法形态都编译通过、却恒定返回首臂），这正是「只 `check` 不 `run`」发现不了的一类问题。故裁定本稿 §3 的示例准入为三重：**① 编译通过 ② 运行通过 ③ 输出符合预期**；任一条不满足，必须在文中显式标注失效范围，不得笼统称「已验证」。

实测基线（本稿据此校订）：

| 项 | 结论 |
|---|---|
| 函数声明唯一形式 | `fn FuncName(params) Ret { }`（返回类型前**无** `->`） |
| 并置式 `FuncName fn(...) -> Ret` | 已移除 → `T-PAR-E102` |
| enum 声明 | `enum Color : u8 { ... }`（`Color enum : u8` 已移除 → `T-PAR-E102`） |
| 子句体 / 臂体 | 必须是单一表达式 → 多语句报 `T-FUN-E814` |
| `if` 表达式 / Block 表达式 | **均不存在** → `T-PAR-E101` |
| `unreachable` | 非 t 内建，不存在；兜底惯例 `return 0 - 1;` |
| `when` 臂是否计入穷尽性 | 否；缺兜底 → `T-MAT-E742` |

> ⚠ 同类语法漂移亦存在于 `docs/reference.md` L2897 / L2108（仍记作 `Ident "fn" ...` 并置式），需另行勘误，本次未改。

---

## 8. 采纳状态

本草稿据 L-15 第5条维持 **DRAFT**，**待用户下达「规则采纳」指令**后并入 `docs/reference.md`（§3.3 / §3.4 / §3.5），并同步标记本草稿失效。

- 四项法律判据 L-02 / L-03 / L-04 / L-14：**✅ 均已满足**。
- §7 **六项**设计裁定全部已决（7.1–7.5 语义层，7.6 语法基线层）。
- §6.1 **四项**待办均为增量能力，不构成采纳阻塞。
- ✅ **§6.2 的 enum 分派缺陷已于 2026-09-23 修复**：它本属 LLVM 发射侧的实现缺陷（四处根因），不影响本规则的合法性（语法与静态语义原本就判定正确）。修复后 §3 的 ②③ 示例已可运行且输出正确，并入 `reference.md` 的示例准入三重条件（编译 / 运行 / 输出）全部满足。

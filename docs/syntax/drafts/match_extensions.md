# match 扩展功能设计（基于跨语言匹配用法调研）

> **状态**：草稿（DRAFT）—— 纯设计，尚未实装。**不阻塞** `match.md` 采纳。
> **依据**：IMA 知识库《Erlang 匹配（match）用法示例》（实为 Erlang + Rust / Zig / Go / Swift / Kotlin / Nim / Odin / Java 21 / GDScript 的跨语言匹配用法综述）+ `docs/reference.md` §3 + `docs/design.md` + `docs/syntax/drafts/match.md` / `decl_variant.md`。
> **作用对象**：在 `match.md` 已落地的「字面量 / enum CaseName / 绑定 / `_` 通配 / `when` 守卫 / 函数子句 / 穷尽性」之上，补齐跨语言调研暴露出的 **解构、或/范围、切片/映射、可失败绑定、comptime 求值** 五类缺口。
> **记号**：沿用 `docs/reference.md` §1 Notation；下游扩展语法用 `// +` 标注为「新增产生式」。

---

## 0. 调研来源与 t 现状基线

### 0.1 来源映射（哪些语言特性对应哪些 t 扩展）

| 来源语言特性（IMA 文档） | t 现状 | 本设计处置 |
|---|---|---|
| Erlang `X = 1` / `{Y,Z} = {2,3}` 单步绑定 | 仅 `match` 表达式级，无 `let` 级不可反驳解构 | → S12 `if let` / `let` 解构 |
| Erlang `fact(0); fact(N) when N>0` 子句 | ✅ 已实现（脱糖为 match） | 已覆盖 |
| Erlang `case {ok,V} of ...` / 匿名函数子句 | ✅ `match` + 函数子句 | 已覆盖 |
| Erlang `<<A:8, B:16, Rest/binary>>` 位串 | t 无位串类型 | 暂不做（out of scope） |
| Erlang `#person{name=N}` / `#{name := N}` 记录/映射 | struct 已存在；map 已存在 | → S7 map 模式 / S11 struct 字段模式 |
| Erlang `receive` / `try..catch` 模式 | 并发/异常设施未定 | 暂不做（out of scope，待并发模块） |
| Rust `Circle(r)` enum 解构 | variant case 已声明，解构未纳入 match | → **S9 variant 解构（旗舰）** |
| Rust `1 \| 2 \| 3` 或模式 / `1..=5` 范围 | 无 | → S1 或模式 / S2 范围模式 |
| Rust `x @ 1..=10` `@` 绑定 | 无 | → S3 `@` 绑定 |
| Rust `[first, .., last]` 切片模式 | 切片 `[]T` 已存在 | → S6 切片/数组模式 |
| Rust `Point { x, .. }` 嵌套 + `..` 忽略 | struct 已存在 | → S11 struct 字段模式 |
| Rust `if let` / `while let` / `let else` | 无 | → S12 可失败绑定降级 |
| Zig `.sat, .sun =>` 多值合并臂 | 无 | → S1（或模式涵盖） |
| Zig `200...299` 范围 / `\|r\|` 载荷捕获 | 范围无 / 载荷捕获 = variant 解构 | → S2 / S9 |
| Zig `blk:{}` 分支内标签块表达式 | t block 已可作表达式 | → S8（minor） |
| Zig `if (x) \|n\| else \|err\|` 错误联合 | variant 解构 + 守卫 | → S9 + S12 |
| Go `x.(type)` 类型 switch | variant 解构已能按 case 收窄 | 已由 S9 覆盖 |
| Swift `(let x, 0)` 元组 + `where` | tuple 未落地 / `when` 已有 | → S10 tuple / `when` 已覆盖 |
| Kotlin `1,2 ->` / `in 4..10` / `is String` | 多值=或模式 / 范围 / 类型=variant | → S1 / S2 / S9 |
| Nim `case kind of` 对象变体 | = enum/variant 匹配 | 已覆盖（enum）/ S9（variant） |
| Odin `switch v in value` 联合类型 | = variant 解构 | → S9 |
| Java 21 `case null` / `when` | `when` 已有 / `null` 模式 | `null` 待定（t 无原生 null 表达式） |
| GDScript `[var x, ..] when x>0` 数组解构+守卫 | → S6 + `when` | 已覆盖 |

### 0.2 t 现状（来自 `match.md`，已实装并通过门禁）

- 模式：`Literal`（整数/字符串相等）/ `CaseName`（enum 成员，裸写或 `Enum.Case`）/ `Ident`（绑定，snake_case）/ `_`（通配不绑定）。
- `when` 守卫（bool 白名单，含 `Unknown` 放行）。
- 函数子句 `FuncName fn(...)` 多子句 → `desugar_func_clauses()` 强制脱糖为单一 `match`，原子句下线为 `ClauseDead`。
- 穷尽性：`_` 通配 / 裸绑定 / enum 全 case 覆盖（三者任一即穷尽）；带守卫臂不计入覆盖。
- PascalCase 消歧：首字母大写 = CaseName，小写 = 绑定；C2 改写在 checker 内把绑定改写为 `member` 节点，双后端零改动复用既有 member 路径。

### 0.3 t 类型系统事实（决定依赖与难度）

| 类型 | 状态 | 对匹配扩展的意义 |
|---|---|---|
| `Scalar` / `[]T`(slice) / `[N]T`(定长数组) | ✅ | S6 切片/数组模式直接可用 |
| `struct`（具名字段） | ✅ | S11 struct 字段模式直接可用 |
| `enum`（值级，无载荷） | ✅ | 已支持 CaseName；S9 的载荷分支待 variant |
| `variant`（case + 可选载荷） | ⚠️ 声明已 GEN，值构造/解构未纳入 match | **S9 旗舰功能的前向依赖** |
| `map[K]V` | ✅（builtins + `map_lit` 节点） | S7 map 模式可用，语法待 map 字面量定稿对齐 |
| `union`（untagged） | ❌ 标记但未实装 | S9/S12 不涉及 untagged |
| `tuple` | ❌ 设计稿 #2 待落地 | **S10 tuple 解构的前向依赖** |
| `atom`（Sym32） | ❌ 设计稿 #3 待落地 | 暂不影响匹配扩展 |

### 0.4 当前语法基线（**实测校验**，2026-09-23）

> 以下均经 `out/dbg/tc.exe check/run` 实跑验证。凡与之冲突的历史文档（含 `match.md` §1/§3 的并置式写法）均按本节为准。

| 事实 | 实测证据 | 影响 |
|---|---|---|
| **函数声明唯一形式**是 `fn name(params) Ret { }` | `fib_match fn(0) i64 {}` 与 `fib_match fn(0) -> i64 {}` 均报 **`T-PAR-E102`**「must use the `fn name(...)` form; `fib_match fn(...)` is no longer supported」 | ⚠ **`match.md` §1 EBNF 与 §3 全部示例使用的是已被移除的语法**（其 §3「均已实际编译运行验证」系 2026-08-02 当时状态，此后语法迁移，示例今日已失效） |
| **子句体必须是单一表达式** | Statement 形式 `if (n>=2) { return A; } else { return B; }` 报 **`T-FUN-E814`**「clause body must be a single expression (it becomes a match arm)」 | 子句/臂体不能含多条语句；多步逻辑须提取为辅助函数或改用 `when` + 兜底臂 |
| **`if` 不是表达式** | `return if (c) A else B;` 报 **`T-PAR-E101`**「unexpected token in expression: if」 | 无 Rust 式 `if/else` 值表达式；`if let` 只能设计为语句形态（S12） |
| **Block 不是表达式** | arm 写 `_ => { var t: i64 = n*2; return t; }` 报 **`T-PAR-E101`**「unexpected token in expression: {」 | ⚠ **本稿 S8 原判「minor」作废** —— 多行 arm 体是独立前置语言特性，非既有能力 |
| **`unreachable` 不存在**（非内建） | `src/` 内无该 builtin 注册 | 不可作为兜底表达式；兜底沿用 `return 0 - 1;` 惯例 |
| **`when` 守卫臂不计入穷尽性** | 仅 `when` 守卫而无兜底臂报 **`T-MAT-E742`**「match is not exhaustive」 | 印证 `match.md` §2；`fib(n when n >= 2)` 必须补 `fib(_)` 兜底 |
| **子句组确为 match 糖** | `fn fib(0)`/`fn fib(1)`/`fn fib(n when n>=2)`/`fn fib(_)` 与手写 `match` 等价，`fib(10)` 双形态均输出 `55` | 用户论断经实测成立 ✅ |

---

## 1. 设计原则（对接 t 铁律）

- **L-04 单一语义真源**：所有新匹配形态（或/范围/`@`/切片/映射/variant/tuple/struct）**一律脱糖为既有 `match` 节点**，不引入独立语义、不加新发射路径。双后端（C / LLVM）继续复用既有 `member` / 比较路径。
- **L-03 静态类型 + 穷尽性**：每个新模式必须纳入既有穷尽性分析（或模式按「覆盖其全部备选」计；范围按区间并集计；变体按全 case 计）。
- **L-02 显式**：守卫 bool 白名单不变；绑定作用域仍仅限本 arm；新增语法不改变「无隐式布尔判定」。
- **L-14 铁律校验**：每个扩展配套 `conformance` fail/pass 用例 + `run_examples` 双后端对拍 + 自举不动点 md5 比对，参照 `match.md` §5 门禁矩阵。

---

## 2. 实现步骤（按难易程度）

> 难度分级依据：**依赖新类型 / 新语义** 的程度，而非代码行数。易=纯 match 语法/检查增强、零新类型；中=复用已有 slice/array/map/struct；难=依赖 variant/tuple 落地或引入可失败绑定新语义。

### 2.1 易 — 纯 match 语法/检查增强（零新类型，复用既有 emit）

#### S1 或模式 `1 | 2 | 3` 与多值合并臂
- **动机**：Rust `1|2|3`、Zig `.sat, .sun =>`、Kotlin `1, 2 ->`、GDScript `[1,2,3]:`。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | OrPat
  OrPat: MatchPat ("|" MatchPat)+        // + 同层多个模式共享一条 arm 体
  ```
- **语义**：`OrPat` 覆盖其全部备选模式的并集；穷尽性分析把每个备选分别计入。
- **脱糖**：sema 阶段把 `OrPat` 展开为 N 个内部候选（共享同一 arm 体 AST 节点引用），`match` 节点仍为单一真源；emit 复用比较链 / member 路径，零改动。
- **难度**：易。仅 parse + sema 展开 + 穷尽性计数三处小改。

#### S2 范围模式 `1..=5` / `1..5`
- **动机**：Rust `1..=5`、Zig `200...299`、Swift `90...100`、Kotlin `in 4..10`。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | RangePat
  RangePat: Expr "..=" Expr | Expr ".." Expr   // 含右端 / 右开
  ```
- **语义**：仅作用于整数标量 scrutinee；`..=` 两端包含、`..` 右开。`RangePat` 参与穷尽性（多个范围区间并集 + 点模式）。
- **脱糖（推荐）**：新增一等 `RangePat` 节点（而非直接降级为 `when` 守卫），使 (a) 穷尽性可静态分析重叠/缺口；(b) 后端可对密集范围生成 jump table。最简降级方案（过渡）：`n when n >= lo && n <= hi`，但会失去跳表优化与重叠诊断。
- **难度**：易。需新增 `..=`/`..` token（lex），与既有切片/`..` 用法冲突点需 lex 前瞻确认。

#### S3 `@` 绑定 `x @ pat`
- **动机**：Rust `x @ 1..=10`、Swift `case (let x, 0)` 的「绑定整体 + 匹配子形」。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | AsPat
  AsPat: Ident "@" MatchPat
  ```
- **语义**：先 `AsPat.name` 绑定 scrutinee 整体值，再对子模式 `pat` 做形状测试；`name` 作用域限本 arm。**消歧**：`@` 左侧必须是 snake_case 绑定名（与 PascalCase=CaseName 一致）。
- **脱糖**：emit 先 `let name = scrutinee;`，再跑子模式测试；复用既有绑定 + 子模式路径。
- **难度**：易。Node 新增 `AsPat(name, sub)`；sema 作用域 + C2 改写需识别。

#### S4 臂不可达检测
- **动机**：`match.md` §6.1 待办（臂不可达告警）。Rust 编译器对 `_` 之后的臂报 unreachable。
- **语义**：出现 `_` 通配臂或裸绑定臂（二者均不可反驳）后，其后的任何 arm 报 `T_MATCH_ARM_UNREACHABLE`（lint，非硬错，可用 `@allow` 关闭）。
- **难度**：易。纯 checker 遍历，无新节点、无 emit 改动。

#### S5 非 enum scrutinee 大写裸标识符收敛
- **动机**：`match.md` §6.1 待办。当前非 enum scrutinnee（标量/字符串）下大写裸名仍按绑定处理，易静默吞掉后续臂（同 C2 风险）。
- **语义**：scrutinee 为标量/字符串时，若模式位置出现 PascalCase 裸标识符且非任何已知 enum 成员，报 `T_MATCH_UPPER_BIND`（疑似拼错枚举成员）；默认 lint，待 variant 落地后随 S9 统一收紧为 error。
- **难度**：易。纯 checker 提示，复用 C2 判定框架。

### 2.2 中 — 复用已有 slice / array / map / struct 类型

#### S6 切片 / 定长数组模式 `[first, .., last]` / `[]` / `[x]`
- **动机**：Rust `[first, .., last]`、Swift 元组、GDScript `[var x, ..]`。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | SlicePat
  SlicePat: "[" (MatchPat ("," MatchPat)*)? ("," "..")? "]"   // `..` 表示吞掉中间任意长度
  ```
- **语义**：
  - `[]` 匹配空切片；`[x]` 匹配单元素；`[a, b]` 匹配定长；`[first, .., last]` 吞中间。
  - 对 `[N]T` 定长数组：元素数必须 == N，否则 `T_MATCH_SLICE_ARITY`。
  - 对 `[]T` 切片：`..` 出现时只校验首尾边界，长度任意；无 `..` 时长度必须等于元素数。
- **脱糖**：emit 生成 `len(s) == k && s[0] == p0 && ...`（切片需运行时长度检查；定长数组编译期已知可直接索引）。绑定元素复用既有绑定路径。
- **难度**：中。需新增 `SlicePat` 节点 + 长度/arity 校验 + 切片与定长两条 emit 分支。

#### S7 映射模式 `{ k := v }` 键绑定
- **动机**：Erlang `#{name := N}`（只匹配指定键、其余忽略）、`lists:keyfind` 内部 `{a, _}` 匹配。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | MapPat
  MapPat: "{" (MapFieldPat ("," MapFieldPat)*)? "}"   // + 语法待 map 字面量定稿后对齐
  MapFieldPat: Expr "=>" Ident | Expr ":=" Ident      // 键 => 绑定值；其余键忽略
  ```
- **语义**：对 `map[K]V` scrutinee，逐字段 `map_has(k) && (v = map_get(k))`；未列出的键不参与匹配（与 Erlang `:=` 一致）。穷尽性对 map **不适用**（map 无封闭成员集），故 map 模式 arm 之后必须仍有 `_` 或其他兜底（或 scrutinee 同时被其他模式覆盖）。
- **脱糖**：emit 复用 `map_has` / `map_get` builtin；绑定 `v` 复用既有绑定路径。
- **注**：map 模式字面量语法（`{}` vs map 构造字面量）需先确认 `map_lit` 实际写法后对齐，避免与 struct 字面量/`{}` 块冲突。
- **难度**：中。依赖确认 map 字面量 token；Node + 校验 + emit 复用 builtin。

#### S8 Block / if 表达式化 —— **前置能力（原判「minor」经实测绘销）**
- **动机**：Zig `blk: { ...; break :blk value }`、Rust 分支内多步计算、`if let` 的多行体。
- **⚠ 实测纠正（2026-09-23）**：本稿初版称「t `Block` 本身可作表达式，故多行 arm 体无需新语法」—— **该判断错误**。实测 t **既无 Block 作表达式、也无 if 作表达式**：arm 写 `_ => { var t: i64 = n * 2; return t; }` 报 `T-PAR-E101 unexpected token in expression: {`；`return if (c) A else B;` 报 `T-PAR-E101 unexpected token in expression: if`（见 §0.4）。
- **语义**：新增「Block 作表达式」（`{ stmt*; expr }` 产生值）与「if 作表达式」（`if (c) A else B` 产生值、两分支同类型）两项语言能力。二者落地后多行 arm 体自然可用，无需 `match` 侧改动。
- **难度**：**难**（语言级新增能力，牵涉 lex/parse/sema/双后端，非 match 局部增强）。由 2.2「易」上调为 2.3「难」。
- **前置性**：**S12（`if let` / `let else`）依赖本项** —— 无 Block 表达式则 `if let` 的多行体无法表达。开工顺序须置于 S12 之前。

### 2.3 难 — 依赖 variant / tuple 落地或引入可失败绑定新语义

#### S9 variant 解构 `CaseName(a, b)`（旗舰）
- **动机**：Rust `Shape::Circle(r)`、Erlang `case {ok,V} of`、Zig `|r|` 载荷捕获、Kotlin `is`、Odin `switch v in value`、Nim `case kind of`。
- **依赖**：variant 值构造（`Name_from_Case` / `Name_is_Case` / `Name_as_Case` 辅助，见 `decl_variant.md` §2）**必须先落地并纳入 match 门禁**（`decl_variant.md` §5 ❌ 执行缺口）。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | VariantPat
  VariantPat: CaseName "(" (MatchPat ("," MatchPat)*)? ")"   // 载荷按位置绑定
  ```
- **语义**：scrutinee 为某 `variant`；`CaseName` 必须是该 variant 的成员；载荷按位置依次匹配/绑定。enum（无载荷）的 `CaseName` 维持现状（圆括号可选/禁止）。穷尽性复用 S9 + enum 全 case 分析。
- **脱糖**：emit 生成 `Name_is_Case(s) && (a = Name_as_Case(s).field0; b = Name_as_Case(s).field1; ...)`；C2 改写把 `CaseName` 收敛为 member 路径，双后端零改动。嵌套（`.Circle(.Point{x,y})`）递归展开子模式。
- **难度**：难。前向依赖 variant 值构造；涉及 sema 成员归属校验、载荷位置绑定、嵌套展开、emit 三处（判别 + 取载荷 + 绑定）。是本次扩展的核心交付。
- **连带**：S5（大写裸标识符收敛）随本步统一收紧为 error。

#### S10 tuple 解构 `{add, A, B}`
- **动机**：Erlang `do_msg({add,A,B}) -> A+B`、Swift `(let x, 0)`、Rust tuple 解构。
- **依赖**：设计稿 #2 `tuple` 类型必须先落地（`design.md` L-64「当前 t 无 tuple 类型」）。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | TuplePat
  TuplePat: "{" MatchPat ("," MatchPat)+ "}"   // 与 map 模式语法冲突，需定界（见 S7 注）
  ```
- **语义**：scrutinee 为 tuple；元素数 == 模式数，否则 `T_MATCH_TUPLE_ARITY`；逐位置匹配/绑定。`_` 可跳过某位。
- **脱糖**：emit 按 tuple 字段偏移取元素 + 绑定；与 S6 定长数组模式共用「定长序列解构」emit 助手。
- **难度**：难。依赖 #2 tuple 类型；语法需与 map/struct 字面量消歧。

#### S11 struct 字段模式 `Point { x, y }`
- **动机**：Rust `Point { x, y }`、Erlang `#person{name=N}`、Swift 记录解构。
- **EBNF（新增）**：
  ```ebnf
  MatchPat: ... | StructPat
  StructPat: StructName "{" (StructFieldPat ("," StructFieldPat)*)? ("..")? "}"
  StructFieldPat: FieldName (":" MatchPat)?      // 省略 `:pat` 即绑定同名变量
  ```
- **语义**：scrutinee 为具名 struct；按字段名匹配/绑定；`..` 忽略未列字段（与 Rust `Point{x, ..}` 一致）。穷尽性对 struct 不适用（字段非封闭集），故 struct 模式 arm 后需兜底。
- **脱糖**：emit 按字段偏移取字段 + 绑定；嵌套 + `..` 递归。
- **难度**：中→难。struct 字段访问已存在，主要成本是字段名解析 + 与 S10 tuple 的 `{}` 消歧 + 嵌套展开。列入难级因语法歧义处理。

#### S12 `if let` / `while let` / `let else`（可失败绑定降级）
- **动机**：Rust `if let Some(x)` / `while let` / `let else`、Zig `if (x) |n| else |err|`。
- **依赖**：S9 variant 解构（`Some`/`Ok`/`Err` 即 variant case）+ S11 字段/元组模式，作为「可失败模式」的来源。
- **EBNF（新增）**：
  ```ebnf
  IfLet: "if" "let" MatchPat "=" Expr Block ("else" Block)?
  WhileLet: "while" "let" MatchPat "=" Expr Block
  LetElse: "let" MatchPat "=" Expr "else" Block   // else 必须 diverge（return/break/panic）
  ```
- **语义**：`if let pat = e` 脱糖为 `match (e) { pat => <then>, _ => <else> }`；`let else` 要求 else 分支 diverge（否则 `T_LET_ELSE_NON_DIVERGE`）。引入「不可反驳模式」分析：绑定臂/字面量/`_` 为不可反驳；variant case 为可反驳。
- **脱糖**：全部降级为 `match`，单一真源；`let` 级不可反驳模式（`let (a,b) = ...`）需 irrefutable 检查（失败即 `T_LET_IRREFUTABLE`）。
- **难度**：难。新增 irrefutable 分析 + 三种语句形态 + 与 `if`/`while` 解析消歧。

#### S13 函数参数解构 `fn dist(Point{x,y}: Point)`
- **动机**：Rust `fn dist(Point{x,y}: Point)`、Erlang 函数参数解构、Swift 参数模式。
- **依赖**：S9/S10/S11 的模式可作用于参数位。
- **EBNF（扩展 `match.md` §1 `ParamPattern`）**：
  ```ebnf
  ParamPattern: ... | TuplePat | StructPat | VariantPat   // 参数位允许嵌套模式
  ```
- **语义**：`ParamPattern` 泛化为任意 `MatchPat`（除 `when` 守卫仍限参数括号内）；多参时每个参数独立走 S9/S10/S11 解构，等价于把参数模式并入 `match` 多 scrutinee 分发（`match.md` §5 多参处理需从「仅 #0 进 match」升级为「每位独立 match 后 `&&` 串接」）。
- **难度**：难。复用 S9/S10/S11，但需扩展 `desugar_func_clauses` 多参折叠逻辑。

#### S14 comptime match 求值
- **动机**：Zig `switch (builtin.target.os.tag)` 编译期求值、Rust const match。
- **依赖**：t 已有 CTFE（`hir_eval.tc`）。需 `hir_eval` 认识 `match` 节点 + 新模式节点。
- **语义**：scrutinee 在 comptime 已知时，`match` 在 CTFE 阶段直接求值为常数，emit 直接产出常量（参照 `comptime_fold.tc`）。
- **难度**：难（前向）。需 `hir_eval` 新增各 `MatchPat` 节点的 const 求值分支；双后端 emit 不变（常量已折叠）。

---

## 3. 实现记录（实现的记录）

> 本表为「设计就绪度 + 实现方案 + 落地追踪」。所有条目当前均为 **设计就绪 / 未实装**；`触及文件` 与 `脱糖策略` 已给出具体落点，供后续按 S1→S14 顺序开工。

### 3.1 总览追踪表

| 编号 | 功能 | 难度 | 现状 | 前向依赖 | 触及文件 | 门禁/验证 |
|---|---|---|---|---|---|---|
| S1 | 或模式 `\|` | 易 | 设计就绪 | 无 | `lex.tc` / `parse.tc`(parse_match_arm) / `sema.tc`(展开+穷尽性) | conformance `pass/p_or` `fail/f_or_overlap`；run_examples 双后端 |
| S2 | 范围 `..=`/`..` | 易 | 已实现（本轮前已落地） | 无（lex 已确认 `..` token） | `lex.tc` / `parse.tc` / `sema.tc` / `codegen_c.tc`+`codegen_ll.tc`（RangePat） | `tests/conformance/pass/p48_range_ok.tc`；双后端 |
| S3 | `@` 绑定 | 易 | 设计就绪 | 无 | `parse.tc` / `sema.tc`(AsPat 作用域+C2) / 双后端 | conformance `pass/p_as`；双后端 |
| S4 | 臂不可达 | 易 | 设计就绪 | 无 | `sema.tc`（纯遍历） | conformance `fail/f_unreach`（`@allow` 关闭） |
| S5 | 大写裸标识符收敛 | 易 | 已实现（2026-09-23） | 已收紧为硬错 `T-MAT-E740`（与 C2 同级别） | `src/sema.tc`（C2 框架；`~5474` 裸大写名非合法 case → `diag_new("T-MAT-E740")`） | 实跑验证：大写裸名非合法 case 报 `T-MAT-E740`（UNKNOWN_CASE） |
| S6 | 切片/数组模式 | 中 | 已实现（2026-09-23） | 无 | `src/parse.tc`(parse_slice_pat) / `src/sema.tc`(validate_slice_pat + `[..]` 穷尽性) / `src/codegen_c.tc`+`src/tir.tc`(SlicePat) | conformance `pass/p_slice_pat` `fail/f_slice_arity`；双后端 `examples/match_slice.tc` |
| S7 | map 模式 | 中 | 设计就绪 | 待 map 字面量语法定稿 | `parse.tc` / `sema.tc` / 双后端(复用 map_get) | conformance `pass/p_map`；双后端 |
| S8 | Block/if 表达式化 | **难（前置）** | 设计就绪（初版误判为易，已实测纠偏） | 无 | `lex.tc` / `parse.tc` / `sema.tc` / 双后端（语言级新增） | conformance `pass/p_block_expr` `fail/f_block_type`；双后端 |
| S9 | **variant 解构** | 难 | 设计就绪 | **variant 值构造落地**（decl_variant §5 缺口） | `parse.tc` / `sema.tc`(成员归属+位置绑定) / `codegen_c.tc`+`codegen_ll.tc`(is/as+绑定) / `hir_eval.tc`(若含 S14) | conformance `pass/p_variant` `fail/f_variant_*`；双后端；自举 md5 |
| S10 | tuple 解构 | 难 | 设计就绪 | **#2 tuple 类型落地** | `parse.tc` / `sema.tc` / 双后端 | 依赖 #2 后补门禁 |
| S11 | struct 字段模式 | 中→难 | 设计就绪 | 与 S10 的 `{}` 消歧 | `parse.tc` / `sema.tc`(字段解析) / 双后端 | conformance `pass/p_struct`；双后端 |
| S12 | if/while let / let else | 难 | 设计就绪 | S9 + S11 | `parse.tc` / `sema.tc`(irrefutable) / 双后端 | conformance `pass/p_iflet` `fail/f_let_irref`；双后端 |
| S13 | 函数参数解构 | 难 | 设计就绪 | S9/S10/S11 | `parse.tc`(ParamPattern 泛化) / `sema.tc`(desugar 多参) / 双后端 | conformance `pass/p_clause_destructure`；双后端 |
| S14 | comptime match | 难 | 设计就绪 | CTFE 认识 match | `hir_eval.tc` / `comptime_fold.tc` | conformance `pass/p_comptime_match` |

### 3.2 统一实现要点（所有扩展共用）

- **节点命名**：新模式节点统一挂在 `parse.tc` 的 `P` 节点空闲字段扩展区，沿用 `match.md` §5 复用 `ba`/`nb`/`nc` 的约定，新形态加 `MatchPat` 子类型标记。
- **脱糖纪律（L-04）**：S1/S3/S6/S7/S9/S10/S11/S12/S13 一律在 sema / lowering 阶段降为既有 `match` 节点，保证双后端发射分派零新增；仅 S2（RangePat）与 S9（variant 判别/取载荷）需在 emit 侧按既有 `member` / 比较路径落代码，**不引入独立语义**。
- **穷尽性（L-03）**：S1 按备选并集计、S2 按区间并集计、S9 按 variant 全 case 计、S7/S11 对 map/struct **不适用**（需兜底臂）。
- **锚点继承**：所有合成/改写节点承接原节点 `ln`/`cl`/`tv`，诊断报原始行列（同 `match.md` §5）。
- **门禁矩阵（L-14）**：每个 S 落地时同步补 `tools/conformance.mjs` 的 pass/fail 用例 + `examples/` 双后端 demo + 四代自举不动点 md5 比对；复刻 `match.md` §5 的「55/55 + 双后端 + md5 全等」门槛。

### 3.3 开工顺序建议（按依赖拓扑）

```
易（无依赖，可立即开工）：S1 → S2 → S3 → S4 → S5
中（复用已有类型）：      S6 → S7 → S11（S11 与 S10 共享 {} 消歧，先定 S7 语法）
难（前向依赖）：          S9（等 variant 值构造）→ S10（等 #2 tuple）
                          → S8（Block/if 表达式化，**S12 的前置**）→ S12 → S13 → S14
```

- **最高杠杆**：先完成 S9（variant 解构）——它同时解锁 Go `type switch`、Odin 联合、Zig 载荷捕获、Kotlin `is` 等跨语言能力，是调研中最高频的诉求。
- **零风险快赢**：S1/S3/S4/S5/S8 不依赖任何未落地特性，可先行实装并通过门禁，快速扩大 match 表达力。

### 3.4 待决裁定（开工前需用户拍板）

1. **`..` token 冲突**（S2/S6）：t 既有 `..` 是否用于切片/区间？需在 `lex.tc` 确认 `..=`/`..` 与既有用法的歧义消解规则。
2. **map 字面量语法**（S7）：`map_lit` 实际写法未确认，`MapPat` 的 `{}` 必须与 struct 字面量/`{}` 块区分——需先定 map 构造语法。
3. **`{}` 三义消歧**（S7/S10/S11）：map 模式 / tuple 模式 / struct 字段模式三者都用 `{}`，必须靠 scrutinee 类型在 sema 阶段分流，裁定优先级（struct 名显式 > tuple 元素数 > map 键类型）。
4. **S5 收紧强度（已决，2026-09-23）**：非 enum 大写裸标识符已**升级为硬错 `T-MAT-E740`**（与 C2 同级别），不再静默当作绑定；未另立 `T_MATCH_UPPER_BIND` 码，复用既有 `T-MAT-E740`(UNKNOWN_CASE) 语义，enum 场景给出「unknown case」专用文案。

---

### 3.5 实现记录（S1–S6，2026-09-23 落地）

S1/S2/S3/S4/S5/S6 已脱离「设计就绪」状态，进入实装 + 门禁覆盖。

| 编号 | 现状 | 触及文件（实装落点） | 门禁/验证 |
|---|---|---|---|
| S1 | 已实现 | `src/parse.tc`（`parse_match_arm` 的 `"BitOr"` 循环）/ `src/sema.tc`（OrPat 展开为共享同一臂体 AST 的 N 个内部候选，穷尽性按备选并集计） | `examples/match_ext.tc`（双后端）、`tests/conformance/pass/p_or_pat.tc` |
| S2 | 已实现（本轮前已落地） | `src/parse.tc` / `src/sema.tc` / `src/tir.tc`（RangePat 降级为比较链） | `tests/conformance/pass/p48_range_ok.tc`、本稿 §0.4；`..` 全通配臂算穷尽 |
| S3 | 已实现 | `src/parse.tc`（AsPat `Ident @` 检测）/ `src/sema.tc`（绑定槽 + variant 载荷槽预声明）/ `src/tir.tc`（`g_expect_st` 注入函数返回 ST，修复 `__mres` 槽宽） | `examples/match_ext.tc`、`tests/conformance/pass/p_as_pat.tc`、`tests/conformance/pass/p_as_variant_pat.tc` |
| S4 | 已实现 | `src/sema.tc`（不可反驳臂后置 `m_dead`，后续臂发 `T-MAT-W744` 警告，不拦截编译） | `tests/conformance/fail/f_unreach_arm.tc` |
| S5 | 已实现 | `src/sema.tc`（C2 框架：裸大写名非 `enum`/`variant` 合法 case → `diag_new("T-MAT-E740")`；`enum` 场景给 unknown-case 文案） | 实跑验证：大写裸名非合法 case 报 `T-MAT-E740` |
| S6 | 已实现 | `src/parse.tc`(parse_slice_pat) / `src/sema.tc`(validate_slice_pat + `[..]` 穷尽性) / `src/codegen_c.tc`+`src/tir.tc`(SlicePat) | `examples/match_slice.tc`（双后端）、`tests/conformance/pass/p_slice_pat.tc`、`tests/conformance/fail/f_slice_arity.tc` |

**S3 触发的根因修复（值得记一笔）**：`match` 作为 `return` 值时，`infer_expr` 不把结果类型写回 `match_node.td`，而 `meta_eval_match` 对运行期 scrutinee 直接返回 `-1`；于是 `tir_emit_match` 退而用 `ST_NONE → i64` 作为 `__mres` 结果槽宽。当 match 返回 `string`/`struct` 时，链接期报 `defined with type 'i64' but expected '%TStr'`。`match_node.td` 方案不可行——t 的 TD 表 0 号是 `string`，`tir_expr_td` 的 `cached_td > 0` 缓存判据把 0 当作「未设置」而漏判。最终解法是 `return` 处理器在发射返回表达式前把函数返回 ST 写入全局 `g_expect_st`，`tir_emit_expr` 取 `est` 时优先消费该值并立即清零——既不污染子表达式、也不依赖 TD 索引。

**as-模式 variant 载荷绑定坑**：`c @ .Circle(r)` 同时有绑定名 `sa="c"` 与子模式 `conpat`；原 conpat 载荷槽预声明写在 `else if (arm.sa != "")` 分支里，被 `sa != ""` 短路跳过，导致 `r` 的本地槽缺失、body 提取 `tir_find_local_idx("r")` 返回 -1 而静默不写 → `r` 恒为 0。改为与绑定名分支**独立**的 `if`（非 `else if`）即修复，并补 `tests/conformance/pass/p_as_variant_pat.tc` 锁定该场景。（注：`leading_dot_to_conpat` 改写后须保留 `arm.sa` 绑定，否则 `c` 整体绑定丢失、报 T-SEM-E201——见 `T-MAT-E751` 废弃裸模式后的回归保护。）

**S6 两处根因（值得记一笔）**：
1. **parse_postfix 防贪婪漏 `LBracket`**：match 臂 body 解析时，`parse_postfix` 原有的防贪婪收手只处理前导 `.X`（`.X =>` 是下一臂模式，非 body 字段），漏掉了 `[...]`。于是 `[] => "zero" [x] => "one"` 这类「上一臂 body 后紧跟切片模式臂」会被贪成上一臂 body 的下标访问，下一臂的 `=>` 被孤立 → `T-PAR-E101 unexpected token in expression: =>`。修复为在 match-body 上下文对 `LBracket` 也做 `lbracket_is_next_arm_pattern()` 探测（扫描到配平 `]` 后紧跟 `=>`/`when` 即判定为下一臂切片模式，提前 `break`），与 `dot_is_next_arm_pattern` 完全同构。
2. **`validate_slice_pat` 越界 + cat/kind 混用**：切片模式在**推断期**校验，彼时 `sema.tds` 尚未填充，直接下标 `sema.tds[scr]` 会 `index_out_of_bounds`；须改用推断期可用的 `tis` 表（`tip_kind`/`tis[].elem`）。同时切片判定用 `tis[].kind == "Slice"`（大写），不是 `sema.tds[].cat == "slice"`（小写）——混用会误拒合法 `[]T` 切片。穷尽性方面：切片长度无有限穷尽集，故新增「`[..]` 全通配（仅 rest、无其它元素、无守卫）等价于 `_`」判定（`m_an.ba=true` + `m_irref`/`m_dead`），令后续臂触发 S4 `T-MAT-W744`；缺 `[..]`/`_` 收尾报 `T-MAT-E742`。

---

## 4. 与 `match.md` 的关系

- 本稿是 `match.md` 的**增量扩展**，不修改其已采纳的四条法律判据（L-02/L-03/L-04/L-14）与五项设计裁定（§7.1–§7.5）。
- `match.md` §6.1 三项待办中：**variant 解构** → 本稿 S9；**非 enum 大写裸标识符** → 本稿 S5；**臂不可达** → 本稿 S4。三者在此统一给出实现落点。
- 本稿采纳后，应回填 `match.md` §6.1 三项待办为「已设计 / 待实装」，并随各 S 落地逐步更新 §5 门禁矩阵。

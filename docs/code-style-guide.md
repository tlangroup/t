# T 语言代码书写指导（约束）

> **状态**：生效（2026-09-04 立；**2026-09-25 结构体/元组专项修订**）｜ 用途：本文件是「之后书写 T 代码」的硬约束。
> **依据**：`docs/constitution.md` 铁律（L-02 全行为显式 / L-03 静态类型 / L-04 唯一确定语义 / L-11 强制唯一格式）+ 实测 `out/dbg/tc.exe`（**2026-09-25 构建，含 `2a3c4b6` 元组/`.x=` 特性**；KI-002 复验另用 `2a3c4b6^` 改动前源码重建编译器对拍）。
> **与 `docs/reference.md` 的关系**：`reference.md` 是语义权威，但其中若干条目已落后于实际编译器（见 §6）。**本文件第 1 节的 ✅ 写法均经 `tc check` 实测通过，❌ 旧写法均实测报对应错误码**——以本文件为准。

---

## 0. 总纲：为什么只有一种写法

t 语言的设计宪法要求「同一逻辑仅一种标准写法」（L-04），且全行为显式（L-02）、静态类型（L-03）、编译器强制唯一格式（L-11）。基础功能现已就位，**探索期的旧语法已全部删除或迁移**，不要再回退到历史示例里出现的旧形式——即便某些旧写法曾在早期示例中存在。

本文件用 `✅ 新写法` / `❌ 旧写法（禁止）` 两栏对照，作为之后所有 T 代码的书写约束。

---

## 1. 强制写法对照表（核心约束）

| 类别 | ✅ 新写法（必须） | ❌ 旧写法（禁止 / 编译器报错） | 说明 |
|---|---|---|---|
| **变量声明** | `var x: T = e;` （局部 `var` **必须显式标类型**） | `var x = e;`（无标注 → `T-SEM-E202`） | 见 §3.1：`var` 局部推断未接通，必须标注；`let`/`const` 可推断 |
| **动态常量** | `let x = e;` | `auto x = e;`（已删除 → `T-PAR-E101`） | `let` 已接管 `auto` 的推断语义；`auto` 彻底移除 |
| **静态常量** | `const X: T = e;`（`X` 用 `UPPER_SNAKE`） | `const maxN`（→ `T-NAM-W402` 命名 lint） | 标注可选或显式；命名须大写蛇形 |
| **函数定义** | `fn name(p: T) Ret { ... }` | `func name(...)`（→ `T-PAR-E101`）／`fn name(...) -> Ret`（箭头已删） | 返回类型**并置**在参数表后，无 `->` 记号 |
| **类型转换** | `e as T` | `(T)(e)` 双括号强转／`e as T1 as T2` | 唯一显式转换，整条表达式**仅出现一次** |
| **匿名函数 / 闭包** | `fn (p: T) Ret { ... }` | `\|v\| ...` | 字面量靠「`fn` 前有无名字」区分声明/表达式；闭包按值捕获自动生成，无捕获就地降级 |
| **模块导入** | `@import("Path")`／`@import("Path" as M)`／`@import("Path" :: a, b as c)` | `import(Path)`／`import x;`／`import @x;`（→ `T-PAR-E102`） | 路径为**字符串字面量**；旧括号/裸名形式已删 |
| **库模块头** | `@module(pub)`（导出库）／`@module(internal)`（默认私有） | — | 入口文件用 `@main`，不用 `@module` |
| **可见性** | `pub fn/struct/enum ...`（配合 `@module(pub)`） | `export fn ...`（`export` 关键字已删） | 最终可见性 = 「模块属性 ∧ 声明 `pub`」合取 |
| **跨模块访问** | `mod.name`／`mod.Type`／`mod.Type{ f: v }` **全限定**（同包也要路径限定） | 裸名跨模块访问 | 强制路径限定（`T-MOD-E561` 错误）；引用外部类型/字面量必须带模块前缀 |
| **程序入口** | `@main fn main() i32 { ... }` | `fn main()` 无 `@main`／`export fn main` | 入口须 `@main` 注解 |
| **多路分支** | `match (scrutinee) { pat => expr, ... }` + `when` 守卫 + `_` 通配 | `switch/case/default`（已删除 → `T-PAR-E101`） | `match` 是唯一表达式级分发；穷尽性必查（`T-MATCH_NONEXHAUSTIVE`） |
| **enum 定义（整型枚举）** | `enum Color : u8 { Red = 1, Green = 2 }`（**名字在 `enum` 之后**；成员为具名编译期整型常量） | `Color enum : u8 { ... }`（→ `T-PAR-E102`） | 整型枚举：**无载荷**；tag 类型（如 `: u8`）可选，默认 `i32`；成员必须 `Color.Red` 限定引用。带载荷的和类型请用 `variant`（见下） |
| **enum 成员引用** | `Color.Red`（**必须限定**） | 裸 `Red`（→ `T-SEM-E201` 未定义） | 大小写消歧：大写 = CaseName，小写 = 绑定名 |
| **struct 定义** | `struct Pt { x: i64; y: i64; }`（具名字段以 `;` 分隔）／**元组结构体** `struct Pair { i64, string }`（位置字段以 `,` 分隔，自动命名 `_0`/`_1`） | `struct Pt { x: i64, y: i64 }`（具名字段误用 `,` → `T-PAR-E101`）／`struct Pt(i64, i64)`（括号式 → `T-PAR-E101`）／`Pt struct { … }`（旧并列式已删 → `T-PAR-E102`） | 一律**关键字领头** `struct Name { }`；位置字段**不带 `;`**（尾随 `;` → `T-PAR-E101`）。详见 `reference.md` §3.21 |
| **struct 字面量（具名）** | `Pt{ .x = 1, .y = 2 }`（推荐：字段名带前导点 + `=` 关联）／旧式 `Pt{ x: 1, y: 2 }`（仍接受，二者等价） | `Pt{ 1, 2 }`（具名类型的**位置式**字面量 → `T-PAR-E101`） | 两种字段关联式并存；位置式字面量**只对匿名元组 `.{…}` 成立**，具名类型必须写字段名 |
| **struct 字面量（匿名·前导点）** | `.{ .x = 1, .y = 2 }`（推荐）／`.{ x: 1, y: 2 }`（旧式 `:` 关联，仍接受） | `{ x: 1, y: 2 }`（裸 `{…}` 已删 → `T-PAR-E101`）／`.{ x = 1, y = 2 }`（**字段不带前导点**却用 `=` → `T-PAR-E101`） | 省略类型名，类型由上下文推断（返回值/参数/变量注解/赋值左值/嵌套字段）；二者字段均须带名，**不支持位置式** |
| **元组字面量（位置式）** | `.{1i64, "hi", true}`（前导点 + 位置元素 → 合成类型 `_Tup_i64stringbool`） | 嵌套 `.{1i64, .{2i64, 3i64}}`（元素位不接受前导点复合字面量 → `T-PAR-E101`） | 元素类型**各自独立推断**（不取首元素提升）：整数字面量按量级默认 `u8`，要 `i64` 须显式写 `1i64`。详见 `reference.md` §3.21 |
| **元组类型标注** | `var u: .{i64, string} = .{7i64, "yo"};`；亦可作形参/返回类型 `.{i64, string}` | `.{i64, .{i64, string}}`（嵌套前导点元组类型 → `T-PAR-E101`） | 匿名元组按元素类型合成具名 struct；**同构即同类型**。但匿名元组与具名 tuple struct（`struct Pair`）是**两个互不相干的类型**，不隐式转换（`T-SEM-E202`） |
| **元组 / struct 位置访问** | `t.0`／`t.1`（后缀整数字面量 ≡ 字段 `_N`）；具名访问 `t._0` 等价 | — | 具名元组 struct 亦可用 `p.0`（字段 `_0`）。访问不存在的字段报 `T_UNKNOWN_FIELD`（但**字面量里**写错字段名当前被静默丢弃，无诊断） |
| **struct + match** | `match (p) { Pt{ .x = 0, .y = 0 } => 1, _ => 0 }`（`.x=` 与旧式 `x:` 字面量模式均可；元组同理 `.{1i64, "a"} => …`） | 绑定模式 `Pt{ x: a, y: b }`（**不解构**：字段名后接小写标识符不被绑定，在臂体引用报 `T-SEM-E201`）／早期记录的匿名模式报错已解除 | ⚠ **LLVM 轨运行期错编**：字面量模式的字段值比较在 LLVM 后端恒为真 → 首臂无条件命中；C 后端正确。故**不要依赖 struct/元组字面量模式做运行期判别**（详见 §3 第 9 条与 `match.md` §6.3） |
| **variant 定义（和类型）** | `variant Shape { Circle(i64); Rect(i64, i64); Empty; }`（case 以 `;` 分隔） | `enum Shape { ... }` 带载荷（enum 无载荷 → 用 `variant`） | 代数数据类型；case 可带位置式载荷；递归载荷须指针 `*T`（值形态 → `T-VARIANT_RECURSIVE_VALUE`） |
| **variant 字面量（匿名字段）** | `.Circle(5)` / `Circle(5)` / `Rect(3, 4)` / `Empty`（按位置填载荷；前导点 `.` 或裸写均可） | — | 前导点 variant 构造器 `.Circle(5)` 现支持（`fb6eeaf`）——与 struct `.{...}`/enum `.Red` 一致「采用 `.` 开头」；旧式 `Shape_from_X` 仍兼容。**KI-001 已于 `fb6eeaf` 构建修复**（`Circle(5)` 双后端运行通过，无需再绕兼容构造器） |
| **variant + match** | `match (s) { .Circle(r) => r, .Rect(w, h) => w + h, .Empty => 0 }`（**必须**前导点 `.`；裸写 `Circle(r)` 已废弃并报 `T-MAT-E751`；限定 `Shape.Circle(r)` 仍可用） | — | case 解构绑定载荷到 `r`/`w`/`h`；前导点形式现支持（`fb6eeaf`）；穷尽性必查 |
| **match 分支分隔** | 各 `pat => expr` 以 `,` 或换行分隔 | `Circle(r) => r;`（`; 分隔` → `T-PAR-E101`） | `match` 体内分支不用 `;` 收尾 |
| **可选类型** | `?T`／`some(x)`／`unwrap(x)`／`is_some(x)`／`?` 字面量（none） | `Optional(Unknown)`／`T` 与 `?T` 隐式互转 | 显式构造/解包（L-02）；`unwrap` 非 `?T` → `T-SEM-E790` |
| **字符串插值** | `f"..."`／`f"{expr!j}"`（json）／`!s/!r/!a/!j/!p/!c` | 手写 `sb_append_*` 拼接（冗长、易错） | 解析期脱糖为 `format()`，双后端零特例 |
| **编译期求值** | `comptime { ... }` 块／`type_info(T)` | `meta` 关键字（`meta` 为保留字，禁作用户标识符） | compile-time 统一用 `comptime`；`meta` 已重命名为 `comptime` |
| **C 互操作导出** | `pub @c_export fn add(a: i64, b: i64) i64 { ... }` | — | 仅顶层、无捕获函数；生成 clean C 名 |
| **注解** | `@xxx`（名字小写 snake） | — | 注解名不符 → `T-NAM-W403` |
| **成员 / 内建** | `obj.field`（struct 字段）／自由函数 `len(s)`、`str_len(s)` | 方法语法 `s.len()`（不引入方法语法） | 数据第一：内建统一为自由函数，不造方法调用 |
| **管道** | `xs |> map(fn)`／`|->`／`|>?` | — | 统一管道算子（L0 最低优先级） |
| **区间** | `1..10`／`1..=10`／`a..`／`..` | — | Range 字面量 |
| **条件判断** | `if ((mask & F.x) != 0) { }` 显式比较 | `if (mask & F.x) { }` 隐式布尔（→ `T-STMT_IMPLICIT_BOOL`） | 所有条件位置（`if`/`while`/`for`/`when`）禁隐式布尔，仅 `bool` 合法 |

> 🚫 **禁止写法：匿名结构体字面量不存在「匿名+具名混合」形式，且永不支持。** 前导点 `.{…}` 只省略**类型名**，三种合法写法互斥、不可混排：
>
> | 写法 | 含义 | 状态 |
> |---|---|---|
> | `.{ .x = 0, .y = 0 }` | 具名字段（字段名**带前导点** + `=` 关联） | ✅ 推荐 |
> | `.{ x: 0, y: 0 }` | 具名字段（旧式 `:` 关联） | ✅ 接受（保自举不动点） |
> | `.{ 0i64, "a" }` | **位置元素元组字面量** | ✅ 新增（见 §1「元组字面量」行） |
>
> 以下写法一律报错，**不在支持计划内**，请勿使用：
> - ❌ `.{ x = 0, y = 0 }` —— 字段**不带前导点**却用 `=` 关联：现报 `T-SEM-E201`（被当作元组字面量，元素 `x` 是未定义标识符；旧构建曾报 `T-PAR-E101`）
> - ❌ `.{ 0, y: 0 }`、`.{ .x = 0, 1 }` —— 位置式与具名/id **混排**：报 `T-PAR-E101`
>
> 具名字段一律走前两种；需要按位置构造请用纯元组字面量。详见 §1 与 §6 对照。

---

> ⚠️ **后端状态注记（✅ 实测修订于 2026-09-25，验证基准 `out/dbg/tc.exe` · 含 `2a3c4b6`）**
>
> - **前导点语法 + 元组全部可用**：`.{…}` 具名字段 / `.x=` 关联式 / 元组字面量 `.{e1,e2}` / 元组类型 `.{T1,T2}` / 元组结构体位置字段 / `.N` 位置访问，均经 LLVM + C 双后端与 TIR 轨验证（`examples/tuple_demo.tc`，三轨输出逐字节一致，退出码 `32`）。
> - **KI-001 仍为 closed**：`Circle(5)` 直接 variant 字面量正常（输出 `5`）。
> - **🐞 KI-002 现为 open（LLVM 轨错编，非本次引入）**：struct/元组**字面量模式**的字段值比较在 **LLVM 后端恒为真** → 首臂无条件命中；**C 后端正确**。复现：`tests/known-issues/KI-002_struct_literal_pat.tc` 期望 `0`，`tc run`（LLVM）实测输出 `1`，同文件走 C 后端输出 `0`。已用改动前源码（`2a3c4b6^`）独立重建编译器复验，**同样输出 `1`**，故属既有缺陷而非元组特性引入。**不要依赖 struct/元组字面量模式做运行期判别**，改用字段访问 + 比较表达式（详见 §3 第 9 条、`docs/syntax/drafts/match.md` §6.3、`docs/compiler/known-issues.md`）。
> - 已解除的旧限制：匿名 `.{…}` 用于 match 模式**不再**报 `T-DOT-E101`（现可编译通过，但受上一条 LLVM 缺陷影响）。
> 书写与运行均以此为准。

## 2. 格式化与命名硬约束

- **语句以 `;` 结尾**；`if`/`for`/`while` **强制大括号**包裹，禁止单行省略。
- **禁用**：三元运算符 `?:`、`do-while`、`goto`；多优先级运算必须手动加括号。
- **命名 lint（`T-NAM-*`）**，属编译期告警，提交前应清零：
  - 类型 `PascalCase`（`T-NAM-W400`）
  - 变量 `snake_case`（`T-NAM-W401`）
  - 常量 `UPPER_SNAKE_CASE`（`T-NAM-W402`）
  - 注解 `lowercase_snake`（`T-NAM-W403`）
  - 标识符避免撞 C 关键字（`T-NAM-W404`）
- **强制唯一格式（L-11）**：不手工制造风格分歧；若项目提供格式化入口（如 `tc fmt`），提交前统一跑一遍。结构体字面量 `T{ f: v }`、数组 `[a, b]`、map `[k: v]` 均显式构造。

---

## 3. 反模式 / 静默错编陷阱（务必规避）

1. **局部 `var` 不标类型** → 当前编译器报 `T-SEM-E202`（推断未接通）。**始终写 `var x: T = e;`**。`let`/`const` 可省标注。
2. **闭包捕获 `for-each` 迭代变量** → 无初始化器、无法推断类型，报 `T_CLOSURE_CAPTURE`。先赋给带标注/带初始化器的局部再捕获。
3. **隐式布尔判定** → 旧实现对非标量静默漏过（读随机值），现已修复但仍是错误。条件必须显式比较（`==`/`!=`/`>`…）。
4. **具名函数调用少传参** → 旧实现静默读未初始化栈槽，可能瞬间耗尽 arena（`arena: out of memory`）。现统一实参校验：`T_CALL_ARITY` / `T_TYPE_MISMATCH`。
5. **访问未定义结构体字段** `p.zzz` → 旧实现静默退化为 `Unknown` 读 0；现报 `T_UNKNOWN_FIELD`。
6. **`unwrap` 传非 `?T`** → `T-SEM-E790`。构造必须 `some(x)`，取值必须 `unwrap(x)`/`is_some` 探测。
7. **`as` 链式 `e as T1 as T2`** → 不允许（`as` 整条仅一次）。需要多步转换就分步写中间变量。
8. **裸 `Red` / 裸跨模块名** → enum 成员必须 `Color.Red`；跨模块符号必须 `mod.name`（含同一包）。
9. **用 struct/元组字面量模式做运行期判别** → LLVM 后端**恒命中首臂**（字段值不被比较），C 后端却正确 ⇒ 同一份源码双后端结果不同（KI-002，open）。例如 `match (p) { Pt{ .x = 0, .y = 0 } => 1, _ => 0 }` 对 `Pt{ .x = 1, .y = 2 }`：LLVM 得 `1`，C 得 `0`。**改写为显式比较**：`if ((p.x == 0) && (p.y == 0)) { return 1; } return 0;`。同理，struct 字面量里写错字段名会被**静默丢弃**（无 `T_UNKNOWN_FIELD`），也要靠 `-Wall` 式人工核对。

---

## 4. 迁移速查（旧写法 → 新写法）

| 旧写法（禁止） | 新写法（必须） |
|---|---|
| `auto x = e;` | `let x = e;` |
| `(T)(e)` | `e as T` |
| `func name(...)` | `fn name(...)` |
| `fn name(...) -> Ret` | `fn name(...) Ret` |
| `switch (x) { ... }` | `match (x) { ... }` |
| `Color enum : u8 { ... }` | `enum Color : u8 { ... }` + 引用 `Color.Red` |
| `import(Path)` / `import x;` / `export fn` | `@import("Path")` + `pub fn`（+ 文件头 `@module(pub)`） |
| 裸跨模块名 `foo()` | `mod.foo()` |
| `meta ...` | `comptime ...` |
| `if (cond)` 隐式布尔 | `if (cond != 0)` / `if (cond == true)` 显式比较 |
| `var x = e;`（无标注） | `var x: T = e;` |

---

## 5. 最小可编译示例（新写法全集，已实测）

> ✅ 2026-09-25 双后端复核（基准 `out/dbg/tc.exe` · 含 `2a3c4b6`）：LLVM 轨与 C 轨输出**逐字节一致** —— `5 r 1 0 0 9 z 1 hiyo 5 7`。

```t
@import("std.math" as m2);

fn add(a: i64, b: i64) i64 { return a + b; }

// 整型枚举（无载荷）：成员可 Color.Red 限定 或 .Red 前导点
enum Color : u8 { Red, Green, Blue }
fn name(c: Color) string {
    return match (c) { .Red => "r", .Green => "g", .Blue => "b" };
}

// 结构体：具名字段定义（一律关键字领头 `struct Name { … }`）
struct Pt { x: i64; y: i64; }
// 匿名结构体字面量（前导点 + `.x=` 关联；类型由返回值推断）
fn origin() Pt { return .{ .x = 0i64, .y = 0i64 }; }
// 判别 struct 一律写显式比较 —— 字面量模式在 LLVM 轨恒命中首臂（KI-002）
fn at_origin(p: Pt) i64 {
    if ((p.x == 0) && (p.y == 0)) { return 1; }
    return 0;
}

// 元组结构体：位置字段自动命名 `_0`/`_1`，`,` 分隔且不带 `;`
struct Pair { i64, string }
// 匿名元组类型 `.{i64, string}` 可标注变量 / 形参 / 返回值
fn pair_sum(a: .{i64, string}, b: .{i64, string}) .{i64, string} {
    return .{a.0 + b.0, a.1 + b.1};
}

// 和类型 variant：前导点字面量 + 位置式解构（KI-001 已修复）
variant Shape { Circle(i64); Rect(i64, i64); Empty; }
fn area(s: Shape) i64 {
    return match (s) { .Circle(r) => r, .Rect(w, h) => w + h, .Empty => 0 };
}

@main fn main() i32 {
    var n: i64 = 7 as i64;          // var 必须标类型；转换用 as
    const MAX_N: i64 = 1024;        // 静态常量，大写蛇形；动态常量用 let 也须大写蛇形（T-NAM-W402）

    println(i2s(add(2, 3)));
    println(name(Color.Red));

    var pt: Pt = .{ .x = 1, .y = 2 };   // 匿名结构体字面量（`.x=` 关联）
    println(i2s(pt.x));
    println(i2s(origin().x + origin().y));
    println(i2s(at_origin(pt)));         // 显式比较，不依赖字面量模式

    var p: Pair = Pair{ ._0 = 9, ._1 = "z" };  // 具名元组 struct
    println(i2s(p._0));
    println(p.1);                               // `.N` 位置访问

    var t = .{1i64, "hi", true};                // 匿名元组字面量（元素类型各自独立推断）
    println(i2s(t.0));
    var s = pair_sum(.{1i64, "hi"}, .{7i64, "yo"});   // 元组作形参 / 返回值
    println(s.1);

    println(i2s(area(.Circle(5))));          // variant 前导点字面量（KI-001 已修复）
    println(i2s(area(.Rect(3, 4))));

    return 0;
}
```

---

## 6. 与 `reference.md` 的差异（本文件已校正）

`reference.md` 是语义权威。下表左侧是它曾落后于实际编译器的条目；其中 struct / 元组部分**已于 2026-09-25 同步回 `reference.md`**（新增 §3.21，并据编译器实测纠正 §3.1 / §3.4 / §3.5 / §5 的陈旧条目），两文件现行一致：

| 主题 | `reference.md` 旧表述 | 实际编译器（本文件约束） |
|---|---|---|
| `let` / `auto` | `auto` 为「当前唯一实装推断形式」，`let`「待实现」 | `auto` 已**删除**；`let` 为推断主形式 |
| 局部 `var` 标注 | 「局部声明类型标注可选（推断）」 | `var` 局部推断未接通，**必须显式标注**，否则 `T-SEM-E202` |
| **struct 声明序** | `Pt struct { … }` | **`struct Pt { … }`**（关键字领头），否则 `T-PAR-E102`（2026-09-25 已同步） |
| **struct 方法序** | `len fn(...) Ret { … }` | **`fn len(...) Ret { … }`**，否则 `T-PAR-E102`（2026-09-25 已同步） |
| **函数声明序** | `add fn(...) Ret { … }` | **`fn add(...) Ret { … }`**，否则 `T-PAR-E102`（2026-09-25 已同步） |
| enum 声明序 | `Color enum : u8 { ... }` | **`enum Color : u8 { ... }`**（名字后置），否则 `T-PAR-E102` |
| enum 成员引用 | 裸 `Red` 与 `Color.Red`「两者等价」 | 必须**限定** `Color.Red`，裸 `Red` 报 `T-SEM-E201`；另支持前导点 `.Red`（期望类型为 enum 时等价，`898de07`） |
| 匿名结构体字面量 | 裸 `{ x: 1, y: 2 }`（旧 auto-synth `__anon_N`） | **`.{ x: 1, y: 2 }`**（前导点，类型由上下文推断，`9224f06`） | 旧裸 `{..}` 已删除，不再合成匿名类型 |
| 枚举变体引用 | 仅 `Color.Red` 限定形式 | `Color.Red` **或** `.Red` 前导点（match 臂/赋值尤便） | `898de07` 支持前导点枚举变体 |
| **struct 字面量字段关联式** | 仅 `x: v` | 新增 **`.x = v`**（推荐）；`x: v` 仍接受（2026-09-25，`2a3c4b6`） |
| **元组**（类型 / 字面量 / 位置字段 / `.N` 访问） | 无此条目 | ✅ 已实装并写回 `reference.md` §3.21（`2a3c4b6`） |
| struct / 元组**字面量模式**的运行期 | 曾记「KI-002 已修复、双后端通过」 | ⚠ **LLVM 轨恒命中首臂**，C 轨正确 ⇒ KI-002 重新置 **open**；判别请写显式比较 |

其余条目（函数并置返回类型、无 `->`、无 `func`、`@import`/`pub`/`@module`、`match` 取代 `switch`、`as` 唯一转换、可选 `?T`、f-string `!j` 等）本文件与 `reference.md` 一致，仅在此重申为硬约束。

另：`struct`/`variant` 的字面量与 `.x=` 关联式、前导点 `.{…}` / `.Red` / `.Circle`、元组（§3.21）与 `match` 解构约束，为 2026-09-04～09-25 陆续补充；其中 struct/元组语法已于 2026-09-25 并入 `reference.md`。**KI-001 仍为 closed**；**KI-002 已重新置为 open**（LLVM 轨 struct/元组字面量模式恒命中首臂），已用改动前源码（`2a3c4b6^`）独立重建编译器复验证明属既有缺陷，证据与复现步骤见 §3 第 9 条与 `docs/compiler/known-issues.md`。

> 📌 遗留漂移（本次**未**处理，待专项清理）：`reference.md` 中仍有约 30 处示例代码使用已删除的并列式 `Name fn(...)` 声明（集中在 §3.6.3 comptime、§3.9 fid、§3.10 格式化内建、§3.12 agent、§3.15 管道）。这些例子在当前编译器上均会报 `T-PAR-E102`，属纯示例代码陈旧（非文法条目），建议作为「方言统一 Stage 2/3」的收尾专项统一替换。

---

## 7. 参考与权威源

- 语义权威：`docs/reference.md`（实施时以本文件 §6 校正项为先）。
- 设计宪法：`docs/constitution.md`（L-02 / L-03 / L-04 / L-11 为约束根基）。
- 语法规则法：`docs/laws/L-15_syntax_rules.md`。
- 本文件所有 ✅ 写法均经 `out/dbg/tc.exe` `check` / `run` 实测通过；❌ 旧写法均实测报对应错误码（见各栏括号）。
  - struct / variant 的「字面量 + `match` 解构」约束项：2026-09-04～09-05 补充，逐条 `tc check` 复核。
  - **元组 / `.x=` 关联式 / 位置字段（2026-09-25 复核，基准 `2a3c4b6` 构建）**：§1 各行、🚫 禁令表每一条、§3 第 9 条均逐条实测；§5 示例经 LLVM + C 双后端运行比对，输出逐字节一致（`5 r 1 0 0 9 z 1 hiyo 5 7`）。
  - KI-002 的 LLVM 错编结论经「双后端対拍 + 改动前编译器（`2a3c4b6^`）独立重建复验」双重确认。

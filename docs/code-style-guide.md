# T 语言代码书写指导（约束）

> **状态**：生效（2026-09-04）｜ 用途：本文件是「之后书写 T 代码」的硬约束。
> **依据**：`docs/constitution.md` 铁律（L-02 全行为显式 / L-03 静态类型 / L-04 唯一确定语义 / L-11 强制唯一格式）+ 实测 `out/dbg/tc.exe`（2026-09-05 02:19 构建，含 `fb6eeaf`）。
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
| **跨模块访问** | `mod.name`／`mod.Type`／`mod.Type{ f: v }` **全限定**（同包也要路径限定） | 裸名跨模块访问 | 强制路径限定（`T-MOD-W561` 建议）；引用外部类型/字面量必须带模块前缀 |
| **程序入口** | `@main fn main() i32 { ... }` | `fn main()` 无 `@main`／`export fn main` | 入口须 `@main` 注解 |
| **多路分支** | `match (scrutinee) { pat => expr, ... }` + `when` 守卫 + `_` 通配 | `switch/case/default`（已删除 → `T-PAR-E101`） | `match` 是唯一表达式级分发；穷尽性必查（`T-MATCH_NONEXHAUSTIVE`） |
| **enum 定义（整型枚举）** | `enum Color : u8 { Red = 1, Green = 2 }`（**名字在 `enum` 之后**；成员为具名编译期整型常量） | `Color enum : u8 { ... }`（→ `T-PAR-E102`） | 整型枚举：**无载荷**；tag 类型（如 `: u8`）可选，默认 `i32`；成员必须 `Color.Red` 限定引用。带载荷的和类型请用 `variant`（见下） |
| **enum 成员引用** | `Color.Red`（**必须限定**） | 裸 `Red`（→ `T-SEM-E201` 未定义） | 大小写消歧：大写 = CaseName，小写 = 绑定名 |
| **struct 定义** | `struct Pt { x: i64; y: i64; }`（字段以 `;` 分隔） | `struct Pt { x: i64, y: i64 }`（`;` 误用 `,` → `T-PAR-E101`） | 命名字段；元组式 `struct Pt(i64, i64)` 当前未支持 |
| **struct 字面量（具名）** | `let p = Pt{ x: 1, y: 2 };`（字段名 `,` 分隔） | `Pt{ 1, 2 }`（位置式 → `T-PAR-E101`） | 字面量须**具名字段**；位置式匿名（`Pt{1,2}`）当前未支持 |
| **struct 字面量（匿名·前导点）** | `.{ x: 1, y: 2 }`（省略类型名；字段仍以 `:` 关联，类型由上下文推断：返回值/参数/变量注解/赋值左值/嵌套字段） | `{ x: 1, y: 2 }`（裸 `{..}` 已删除 → `T-PAR-E101`）／`.{ x = 0, y = 0 }`（用 `=` 关联字段 → `T-PAR-E101`，**匿名+具名混合写法不支持且不计划支持**） | 前导点匿名结构体字面量（`9224f06`）；字段名关联统一用 `:`，**禁止 `=`**；类型须能从上下文唯一确定，否则显式标类型 |
| **struct + match** | `match (p) { Pt{ x: 0, y: 0 } => 1, _ => 0 }`（**具名字面量模式**，KI-002 已修复） | 绑定模式 `Pt{ x: a, y: b }`（→ `T-SEM-E201` 暂未支持）／匿名模式 `.{ x: 0, y: 0 }`（→ `T-DOT-E101`，前导点 struct 仅值语境） | struct 的 match 支持**具名字面量模式**比对（已双后端通过）；字段绑定解构未接通；匿名模式须用具名形式 |
| **variant 定义（和类型）** | `variant Shape { Circle(i64); Rect(i64, i64); Empty; }`（case 以 `;` 分隔） | `enum Shape { ... }` 带载荷（enum 无载荷 → 用 `variant`） | 代数数据类型；case 可带位置式载荷；递归载荷须指针 `*T`（值形态 → `T-VARIANT_RECURSIVE_VALUE`） |
| **variant 字面量（匿名字段）** | `.Circle(5)` / `Circle(5)` / `Rect(3, 4)` / `Empty`（按位置填载荷；前导点 `.` 或裸写均可） | — | 前导点 variant 构造器 `.Circle(5)` 现支持（`fb6eeaf`）——与 struct `.{...}`/enum `.Red` 一致「采用 `.` 开头」；旧式 `Shape_from_X` 仍兼容。**KI-001 已于 `fb6eeaf` 构建修复**（`Circle(5)` 双后端运行通过，无需再绕兼容构造器） |
| **variant + match** | `match (s) { .Circle(r) => r, .Rect(w, h) => w + h, .Empty => 0 }`（前导点 `.` / 裸写 `Circle(r)` / 限定 `Shape.Circle(r)` 三者均可） | — | case 解构绑定载荷到 `r`/`w`/`h`；前导点形式现支持（`fb6eeaf`）；穷尽性必查 |
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

> 🚫 **禁止写法：匿名结构体字面量不存在「匿名+具名混合」形式，且永不支持。** 前导点 `.{...}` 只省略**类型名**，字段仍须用 `:` 按名关联（与具名 `Pt{ x: 1, y: 2 }` 完全一致）。以下写法一律报 `T-PAR-E101`（编译器期待 `Colon`，读到 `=`），且**不在支持计划内**，请勿使用：
> - ❌ `.{ x = 0, y = 0 }` —— 用 `=` 关联字段
> - ❌ 任何「无类型名却用位置式 / 具名+位置混排」的混写形式（如 `.{ 0, y: 0 }`）
>
> 正确唯一写法：`.{ x: 0, y: 0 }`（字段名 `:` 关联）。详见 §1「struct 字面量（匿名·前导点）」行与 §6 对照。

---

> ⚠️ **后端状态注记（验证基准：`out/dbg/tc.exe` 2026-09-05 02:19 构建，含 `fb6eeaf`）**：前导点语法全部双后端验证通过（`out/dot_test.tc` 双后端一致输出 `3 4 25 0 11 22 1 4 red 11`）。**KI-001 / KI-002 已于本构建修复**（见 `docs/compiler/known-issues.md`）：`Circle(5)` 直接 variant 字面量与 `Pt{ x: 0, y: 0 }` 具名结构体模式 `tc run` 均正常（输出 `5` / `0`）。当前唯一残留限制：**匿名 `.{ x: 0, y: 0 }` 在 match 模式**仍报 `T-DOT-E101`（前导点 struct 仅支持值语境，模式须用具名 `Pt{...}`）。书写与运行均以此为准，无需再用兼容构造器 `Shape_from_X` 或字段访问 + `if` 规避。

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

```t
@import("std.math" as m2);

fn add(a: i64, b: i64) i64 { return a + b; }

// 整型枚举（无载荷）：成员可 Color.Red 限定 或 .Red 前导点
enum Color : u8 { Red, Green, Blue }
fn name(c: Color) string {
    return match (c) { .Red => "r", .Green => "g", .Blue => "b" };   // 前导点变体
}

// 结构体：具名字段定义
struct Pt { x: i64; y: i64; }
// 匿名结构体字面量（前导点，类型由返回值 Pt 推断）
fn origin() Pt { return .{ x: 0i64, y: 0i64 }; }
// match 具名字面量模式（KI-002 已修复，双后端通过）
fn at_origin(p: Pt) i64 {
    return match (p) { Pt{ x: 0, y: 0 } => 1, _ => 0 };
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

    var pt: Pt = .{ x: 1, y: 2 };   // 匿名结构体字面量（前导点）
    println(i2s(pt.x));
    println(i2s(origin().x + origin().y));
    println(i2s(at_origin(pt)));     // struct + match 具名字面量模式

    println(i2s(area(.Circle(5))));          // variant 前导点字面量（KI-001 已修复）
    println(i2s(area(.Rect(3, 4))));

    return 0;
}
```

---

## 6. 与 `reference.md` 的差异（本文件已校正）

`reference.md` 是语义权威，但下列条目已落后于实际编译器（本文件以实测为准）：

| 主题 | `reference.md` 旧表述 | 实际编译器（本文件约束） |
|---|---|---|
| `let` / `auto` | `auto` 为「当前唯一实装推断形式」，`let`「待实现」 | `auto` 已**删除**；`let` 为推断主形式 |
| 局部 `var` 标注 | 「局部声明类型标注可选（推断）」 | `var` 局部推断未接通，**必须显式标注**，否则 `T-SEM-E202` |
| enum 声明序 | `Color enum : u8 { ... }` | **`enum Color : u8 { ... }`**（名字后置），否则 `T-PAR-E102` |
| enum 成员引用 | 裸 `Red` 与 `Color.Red`「两者等价」 | 必须**限定** `Color.Red`，裸 `Red` 报 `T-SEM-E201`；另支持前导点 `.Red`（期望类型为 enum 时等价，`898de07`） |
| 匿名结构体字面量 | 裸 `{ x: 1, y: 2 }`（旧 auto-synth `__anon_N`） | **`.{ x: 1, y: 2 }`**（前导点，类型由上下文推断，`9224f06`） | 旧裸 `{..}` 已删除，不再合成匿名类型 |
| 枚举变体引用 | 仅 `Color.Red` 限定形式 | `Color.Red` **或** `.Red` 前导点（match 臂/赋值尤便） | `898de07` 支持前导点枚举变体 |

其余条目（函数并置返回类型、无 `->`、无 `func`、`@import`/`pub`/`@module`、`match` 取代 `switch`、`as` 唯一转换、可选 `?T`、f-string `!j` 等）本文件与 `reference.md` 一致，仅在此重申为硬约束。

另：`struct`/`variant` 的具名/匿名字段字面量、前导点 `.{...}` / `.Red` / `.Circle` 与 `match` 解构（§1 表相关行）为 2026-09-04～09-05 补充约束项，`reference.md` 尚未覆盖，以本文件 §1 为准。KI-001/KI-002 已于 `fb6eeaf` 构建修复（见 `docs/compiler/known-issues.md`）。

---

## 7. 参考与权威源

- 语义权威：`docs/reference.md`（实施时以本文件 §6 校正项为先）。
- 设计宪法：`docs/constitution.md`（L-02 / L-03 / L-04 / L-11 为约束根基）。
- 语法规则法：`docs/laws/L-15_syntax_rules.md`。
- 本文件所有 ✅ 写法均经 `out/dbg/tc.exe check` / `tc run` 实测通过（`fb6eeaf` 构建，2026-09-05 02:19）；❌ 旧写法均实测报对应错误码（见各栏括号）。struct / variant 的「字面量 + `match` 解构」约束项于 2026-09-04～09-05 补充，已逐条 `tc check` 复核（含 §5 示例 `tc run` 验收通过）。

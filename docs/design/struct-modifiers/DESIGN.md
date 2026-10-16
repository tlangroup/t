# struct 修饰词体系设计（layout / overload·extend / concept(duck) / #id 自定义修饰）

> 阶段：① 设计（全部 8 项决策已决；`concept` 命名已定；产出示例+测试审查件供 owner 核对理解冲突）
> 关联：积类型统一 epic 已落地的 `packed struct`；函数侧已有的 `overload fn` / `extend overload fn`（FuncDecl.ia∈{1,2} + tote extend 边）；tote「extend-time 派生变体」不变式。
> 目标：把 struct 修饰能力统一成一套正交、可组合的文法，并补齐 `extern` / `overload`+`extend`（跨模块扩展 + 尾部 `_` 锚点）/ `concept`（原 duck，约束类型）/ `#id`（自定义修饰词）。

---

## 1. 背景与现状盘点

当前 struct 声明头上已存在零散开关，来源分散：

- **布局（layout）维度**：`node_sb`(StructDecl) 已承载 `"default"`/`"packed"`/`"soa"`/`"aos"`/`"auto"`/`"extern"`。
  - `packed struct X` —— 位域打包（积类型统一 epic，关键字前缀，`parse.tc:2876`）。
  - `#soa`/`#aos`/`#auto`/`#extern` —— `#` 哈希注解（`parse.tc:2909`）；`KwAuto`/`KwExtern` 已是保留字。
  - **关键澄清（2026-10-16 再次修订）**：**默认布局（不写任何修饰）的内部标签是 `"auto"`，但 `auto`/`default` 均不是用户可见关键字**；用户可见的布局修饰关键字**只有 `packed` 与 `extern`**。`#extern` 升级为 `extern` 关键字（C-API 严格 C 规范）；`#auto` 因"默认布局内部即 auto 且无关键字"而**废弃**（其原 reorder 语义由编译器对默认布局内部处理，不暴露关键字）。
- **开放/扩展维度**：`overload`/`extend` 目前**只对函数**（`overload fn`/`extend overload fn`，`parse.tc:2769+`；sema 输出 extend 边供 tote）。struct 侧没有 → 本次新增。
- **注解系统**：`g_ad_name`（`sema.tc:15873`）注册约 40 个 `#` 属性（`repr`/`align`/`no_padding`/`bitpack`/`soa`/`aos`/...）。

---

## 2. 方案概述（已决稿）

### 2.1 统一文法

```
StructDecl   := [LayoutMod] [OpenMod] 'struct' Ident '{' Members '}'
ExtendStruct := 'extend' 'overload' 'struct' Ident '{' Members '}'   // 跨模块追加字段+方法
ConceptDecl  := 'concept' Ident '{' ReqMethods ReqFields '}'        // 约束类型（不可实例化）
LayoutMod    := 'packed' | 'extern'                 // 缺省=无修饰（默认布局，内部标签 "auto"，非关键字）；packed=位域打包; extern=C-API严格C规范(不支持overload)
OpenMod      := 'overload'                   // 标记 struct 可被 extend overload 扩展
CapMod       := '#' Ident                     // 自定义修饰词（第三方扩展，语义由用户扩展函数处理）
```

- **布局维度（LayoutMod）**：仅两个用户可见关键字 `packed`(位域打包) / `extern`(C-API 严格 C 规范)，二者**互斥**；**不写任何修饰 = 默认布局**（内部标签 `"auto"`，非关键字，编译器可对其内部做布局优化如重排，但不暴露关键字）。`packed` 成员支持**占位字段 `_:uN`**（如 `_:u2`）作为保留 N 位占位，走统一字段语法 `name: Type`（仅把名字写成 `_`，区别于具名字段 `name: uN`），不引入 `_:N` 裸数字专用语法。
- **开放维度（OpenMod）**：`overload` 标记 struct 为"可扩展组"；配套 `extend overload struct` 追加字段+方法（可跨模块）。
- **约束维度（ConceptDecl）**：`concept` 为**独立声明种类**（非 struct 修饰），定义函数约束+字段约束，用作类型约束 / 泛型边界，**不可实例化**。
- **自定义修饰（CapMod `#id`）**：第三方扩展修饰词，语义由用户扩展函数（插件/钩子）处理。
- **泛型（Generic）**：本次**仅实现 generic 函数语法** `fn f(T:HasName, x: T)`（类型参数前置为参数，`Name: RHS` 中 RHS 为 concept 即判定为类型参数，其后值参数/返回引用 `T`）；**generic struct 语法（`struct Box(T:HasName) { val: T; }`）本次不实现，保留为未来扩展**（"更大范围的泛型书写支持"不在本次范围）。结构体泛型效果可经「generic 函数 + 匿名结构体（`{x: T, ...}` / `.{T1, T2}`）」组合达成：用 generic 函数消费/产出匿名结构体并在边界做 concept 校验（匿名元组/结构体 t 已支持，见 `parse.tc:790` / `sema.tc:8349`）。
  - **泛型函数语法细则（已决，2026-10-16）**：① **类型参数/值参数靠 RHS 区分**——`Name: RHS` 中 RHS 为 concept 名 → 该参数是**类型参数**；RHS 为类型 → 该参数是**值参数**；**concept 名与 type 名强制不同名**（避免歧义）。② **类型参数须在使用前声明**（左到右解析），可出现在参数表任意位置（未必排第一）。③ **无约束类型参数**：`fn f(T, x: T)`（RHS 缺失的裸标识符参数）即无约束类型参数。④ **多约束/多类型参数的"类型运算符"本次不设计**，保留为未来扩展（如 `T: A & B` 之类由未来 type operator 承载）。⑤ **所有 concept 约束纯编译期**，零运行时开销（无 vtable / 无类型信息 / 无动态派发）。⑥ **类型实参走类型推断**（不引入显式类型实参语法；即便显式写出仍需类型正确性校验，本质仍是推断）。⑦ `fn f(c: HasName)` 之类把 concept 当值类型位置使用时，按①判为"c 是类型参数"（自洽，预期行为）。

### 2.2 各修饰词语义（已决）

| 修饰词 | 语义 | 落点 |
|---|---|---|
| （无修饰 = 默认布局） | 默认布局：不写任何布局关键字即默认；**内部标签 `node_sb="auto"`（非关键字，由旧 `"default"` 改名）**；**不再自动重排**——旧 `#auto` 优化重排已废弃（升级为关键字、无重排语义），用户结构体声明序=内存序、标准 C 布局。 | `node_sb="auto"` |
| `packed` | 位域顺序打包（现有）。成员仅整型，落在宿主整型；成员支持**占位字段 `_:uN`**（如 `_:u2`）作为保留 N 位占位，走统一字段语法 `name: Type`（名字用 `_`），区别于具名字段 `name: uN`。 | `node_sb="packed"` |
| `extern` | **C-API 严格 C 规范**：遵循标准 C struct 布局（声明序=内存序、标准 C 对齐/填充、C 兼容），用于 capi / C FFI；struct **仍有字段体**，可实例化。**专用于 C 兼容，因此不支持 `overload`/`extend`（与 OpenMod 互斥）**。由旧 `#extern` 注解升级为关键字，语义由"冗余标注"升级为"强制 C 规范"。 | `node_sb="extern"` |
| `overload`（配对 `extend`） | `overload struct X` 标记 X 为开放可扩展组；`extend overload struct X { 字段; 函数 }` 追加字段+方法（跨模块，复用函数 overload 机制 + tote extend 边）。编译器为 `overload` struct 合成**尾部 `_` 扩展锚点**，`extend overload` 字段接在其后。 | StructDecl 新 `ia` 角色码（0=普通 / 1=overload 组 / 2=extend 追加）+ 登记 extend 意图 |
| `concept`（原 `duck`） | 约束定义类型：不可实例化；可声明**函数约束 + 字段约束**；用作类型约束 / 泛型边界。语义后续扩展。 | 新 `ConceptDecl` 节点种类 + 约束检查器 |
| `#<id>` | 自定义（第三方扩展）修饰词；`id` 须先注册（内建 id 预注册 / `#modifier <id>` / tote 插件），未知 id 报错；语义由用户扩展函数处理。 | 修饰词注册表 + 语义钩子 |

### 2.3 与现有实现映射

- **布局**：`parse_struct_decl(name, anns, layout)`（`parse.tc:5089`）已把 `layout` 写入 `mk_StructDecl(name, layout, ...)`（`base.tc:3247`）的 `sb`。默认布局不写修饰，`node_sb` 记为 `"auto"`（非关键字）；`extern` 由"冗余标注"升级为"严格 C 规范"关键字；`packed` 沿用并新增**占位字段 `_:uN`** 解析（如 `_:u2` = 保留 2 位，走统一字段语法 `name: Type` 仅名字为 `_`，区别于具名字段 `name: uN`）。
- **overload/extend**：复用函数侧 `ia` 角色码思路与 `lex.g_extend_name`/`lex.g_extend_file` 登记 + `sema` extend 边（`sema.tc:11069`）；StructDecl 增加 `ia` 槽（0/1/2）区分普通/组/追加；`extend overload struct` 跨模块拼装同编译单元（同 `extend overload fn` 规则，否则报 `T-OVL-E980`）。
- **尾部 `_` 锚点**：`overload struct` 由编译器在字段链尾部合成保留字段 `_`（扩展锚）；`extend overload struct` 追加的字段排在 `_` 之后。
- **concept**：新增 `ConceptDecl` 节点种类（函数约束 + 字段约束子节点）；在类型相容 / 泛型边界处做"是否满足约束"校验。
- **`#id`**：复用 `#` 哈希分支（`parse.tc:2909`）但改为查**修饰词注册表**；未知 id 强制报错；语义钩子委托用户扩展函数。

---

## 3. 关键决策（含理由）

- **D1 默认布局 = 无关键字、内部标签 `auto`**（已决，2026-10-16 再次修订，推翻此前"auto/default 为关键字"的写法）：**不写任何布局修饰即默认布局**，`node_sb="auto"` 仅为编译器内部命名，**`auto`/`default` 均非用户可见关键字**；编译器可对该默认布局内部做优化（如重排）但不暴露关键字。用户可见的布局修饰关键字**仅 `packed` 与 `extern`**。
- **D2 `extern` = C-API 严格 C 规范**（已决，2026-10-16 修订，推翻原 B 方案的"仅标注不改 codegen"）：struct 仍有字段体、可实例化；遵循标准 C struct 布局（声明序=内存序、标准 C 对齐/填充、C 兼容），用于 capi / C FFI。语义由旧 `#extern`"冗余标注"升级为"强制 C 规范"（真正影响布局/对齐）。
- **D3 `extend`/`overload` 为配对关键词**（已决 + Q6 澄清）：`overload struct` 标记开放；`extend overload struct` 跨模块追加字段+方法，复用函数 overload 机制 + tote 边；编译器合成尾部 `_` 锚点。
- **D4 `#<id>` 统一为修饰词应用语法 + 注册表**（已决 A）：内建 id 预注册；未知 id 须先注册否则报错；语义由用户扩展函数处理。
- **D5 `duck` → 改名 `concept`（已决）**：原 `duck` 语义是"类似 interface 的约束类型（不可实例化、函数+字段约束、类型约束）"，`concept` 更贴合（对标 C++20 concepts）。**命名已定：`concept`**（用户 2026-10-16 拍板）。
  - **`@derive` 与 `trait` 已废弃**：不要再引用二者作为"现有机制"；`concept` 是面向未来的约束声明种类（编译期泛型边界，无运行时 vtable / 动态派发），不与任何现存机制并列。
- **D6 `overload struct` 实现跨模块扩展**（已决 Q6）：`overload` 标示该 struct 可被 extend；其他模块通过 `extend overload` 扩充字段与函数。
- **D7 落点不预新增侧表**（已决 Q7 澄清）：extend/overload 复用现有 `ia` 角色码思路；`#id` 语义由用户扩展函数处理；布局互斥在 parser 早期报错。
- **D8 `#extern` 转关键字，`#soa`/`#aos` 保留**（已决 Q8）：`#extern` 由 `extern` 关键字取代；`#soa`/`#aos` 属容器布局轴（SoA/AoS），与成员布局正交，保留。
- **D9 `extern` 不支持 `overload`/`extend`**（已决，2026-10-16 修订）：`extern` 专用于 C 语言兼容（capi / C FFI），其布局须严格稳定、不可被跨模块扩展破坏，故 `extern` 与 `OpenMod`(`overload`) **互斥**——`extern overload struct` / `overload extern struct` 均报"布局与开放修饰互斥"错误；只有非 `extern` 的普通 struct 才能 `overload`。
- **D10 泛型范围（已决，2026-10-16）**：本次**仅落地 generic 函数语法** `fn f(T:HasName, x: T)`；**generic struct 语法本次不实现**，保留为未来扩展（"更大范围的泛型书写支持"不在本次范围）。struct 泛型经由「generic 函数 + 匿名结构体（`{x:T,...}` / `.{T1,T2}`）」组合实现——即对匿名结构体类型做 generic 函数消费/产出 + concept 边界校验，达成与泛型 struct 等价的效果。
- **D11 泛型函数语法细则（已决，2026-10-16）**：① 类型参数/值参数靠 RHS 区分（RHS 为 concept→类型参数，为类型→值参数；concept 名与 type 名强制不同名）。② 类型参数须在使用前声明（左到右），可位于参数表任意位置。③ 无约束类型参数 `fn f(T, x: T)`（裸标识符参数）。④ 多约束/多类型参数"类型运算符"本次不设计（保留未来扩展）。⑤ 所有 concept 约束纯编译期、零运行时开销。⑥ 类型实参走类型推断（不引入显式类型实参语法）。⑦ concept 当值类型位置使用按①判为类型参数（自洽、预期行为）。其余 G1–G3/G5–G8 均按上述细则收口（G4、G5、G6、G7 用户明确，G1/G2/G3/G8 走推荐项）。

---

## 4. 待决项清单

| # | 项 | 问题 | 原因 | 影响 | 建议选项 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 默认布局 / `auto`/`default` 是否关键字 | — | — | — | **均非关键字**：不写修饰=默认布局，内部标签 `auto`（编译器内部可优化如重排，不暴露关键字）；用户可见布局关键字仅 `packed`/`extern` | **已决（2026-10-16 再次修订）** |
| 2 | `extern` 语义 | — | — | — | C-API 严格 C 规范（标准 C 布局，capi/FFI 兼容；有字段体） | **已决（2026-10-16 修订）** |
| 3 | `extend`/`overload` 机制 | — | — | — | 配对关键词 + 尾部 `_` 锚点 + 跨模块 extend overload | **已决（Q6）** |
| 4 | `#id` 机制 | — | — | — | 统一应用 + 注册表 + 用户扩展函数语义 | **已决（A）** |
| 5 | `duck` 改名 | 原 `duck` 语义=约束类型（interface-like），建议改名；叫什么？ | `duck` 表意弱，与"结构类型互赋"易混淆 | 决定新增声明种类的最终关键字 | `concept`（对标 C++20 concepts，约束类型） | **已决：`concept`** |
| 6 | `overload struct` 范围 | — | — | — | `overload` 标记开放；`extend overload` 跨模块追加字段+函数 | **已决（Q6）** |
| 7 | 修饰词落点 | — | — | — | 复用 `ia` 角色码 + 注册表；不预新增侧表 | **已决（Q7）** |
| 8 | 旧 `#` 注解兼容 | — | — | — | `#extern`→`extern` 关键字；`#soa`/`#aos` 保留；`#auto` 废弃（默认即 auto 且无关键字） | **已决（Q8）** |
| 9 | `extern` 与 `overload` 互斥 | — | — | — | `extern` 专用于 C 兼容，不支持 `overload`/`extend`，二者互斥报错 | **已决（2026-10-16 修订）** |
| 10 | generic struct 语法范围 | 用户只给了 generic 函数例子；generic struct（`struct Box(T:HasName){val:T;}`）是否同款？ | "更大范围的泛型书写"本次不实现、保留扩展 | 决定本次是否引入 generic struct 文法 | **本次不实现，保留为未来扩展**；struct 泛型经 generic 函数 + 匿名结构体实现 | **已决（2026-10-16）** |

---

## 5. 语法与示例（已决稿）

```t
// ── 布局：用户可见关键字仅 packed / extern；不写 = 默认布局（内部标签 auto，非关键字）──
struct Point { x: f64; y: f64; }              // 默认布局（不写修饰，内部标签 auto，编译器内部可做布局优化如重排）
packed struct Flags { a: u1; _:u2; b: u4; c: u9; } // 位域打包 + `_:u2` 占位字段保留 2 位（统一字段语法 name:Type，名字用 _，区别于具名 `b: u4`）
extern struct CStat { dev: i32; ino: u64; }     // C-API 严格 C 规范（标准 C 布局，capi/FFI 兼容；不支持 overload/extend）

// 注意：extern 专用于 C 兼容，布局须严格稳定，故与 overload 互斥（extern overload struct 报错）。

// ── 开放 / 跨模块扩展（overload + extend 配对）──
overload struct Entity { id: u64; pos: Vec3; _; }   // 开放 struct；编译器合成尾部 `_` 锚点
// 另一模块：
extend overload struct Entity {                       // 跨模块追加字段 + 方法
    tag: u32;
    fn describe(self) string { ... }
}

// ── 约束类型（concept：不可实例化、函数+字段约束、泛型边界）──
concept HasName {                                    // 不可实例化
    fn name(self) string;                             // 函数约束
    age: i64;                                         // 字段约束
}
fn greet(T:HasName, x: T) { ... }                     // 用作泛型边界 / 类型约束（类型参数 T 前置为「参数」并附 concept 约束，其后值参数 x: T 引用之）

// ── 本次泛型范围：仅实现 generic 函数语法；generic struct 语法（`struct Box(T:HasName){val:T;}`）本次不实现（保留扩展）──
// struct 泛型效果经「generic 函数 + 匿名结构体/元组」组合达成（t 已支持匿名元组类型 `.{T1,T2}` 与匿名结构体字面量）：
fn make_pair(T, a: T, b: T) .{T, T} {            // 匿名元组类型 `.{T, T}`（位置字段 _0/_1）由编译器合成具名 struct
    return .{a, b};
}
fn show_pair(T:HasName, p: .{name: T, age: i64}) string {  // 匿名结构体 + concept 边界（name 字段受 HasName 约束）
    return p.name + " age=" + int_to_str(p.age);
}
// （示意：exact 具名字段匿名结构体类型语法以 t 现有匿名元组/结构体支持为准；原则是 generic 函数 + 匿名结构体达成 struct 泛型效果）

// ── 自定义修饰词 ──
#serde                                              // 第三方注册的自定义修饰词（须先注册，否则报错）
struct Config { ... }
```

---

## 6. 与现有代码映射（实现提示，非本次交付）

- 解析：`parse.tc:2876`(`packed` 分支)、`parse.tc:2904`(`KwStruct` 分支) 扩展识别 `extern`/`overload` 上下文关键词；`extend overload struct` 复用 `parse.tc:2800` 的 `extend`→`overload` 桥；`#<id>` 复用 `#` 哈希分支（`parse.tc:2909`）改查注册表。
- 存储：`node_sb` 复用承载 layout；StructDecl 复用 `ia` 承载 overload 角色（0/1/2）。
- 消费：`mb_struct_layout_pass`(`sema.tc:14453`) 已按 `node_sb` 处理；`overload`/`extend` 复用 `lex.g_extend_*` + sema extend 边(`sema.tc:11069`)；`concept` 新增约束检查器；`#id` 走用户扩展函数钩子。

---

## 7. 示例与测试代码评审（设计审查件）

> 以下文件为**设计审查件（aspirational）**：当前 t 编译器尚未实现 `concept` / `overload struct` / `extend overload struct` / `extern` 关键字 / `#id` 注册表，故示例暂不可被现有编译器接受。实现完成后将搬入 `examples/` 并补 `.expected.txt` 接入 `run_examples`，测试矩阵转为 `tests/` 用例。

- **`EXAMPLES.tc`** —— 单文件 happy-path：布局（默认[内部标签 auto]/packed+占位`_:uN`/extern）+ `concept`（约束/泛型边界/不可实例化）+ `#id`（已注册）。
- **`EXAMPLES_extend_a.tc` / `EXAMPLES_extend_b.tc`** —— `overload struct` + `extend overload struct` 跨文件同单元合并（镜像 `examples/cross/overload_cross_a.tc`/`_b.tc`）。
- **`TESTS.md`** —— 测试矩阵（T1–T14）+ 显式「理解假设 / 潜在冲突点」，供 owner 逐条核对。

### 7.1 关键理解假设（owner 重点审查）
1. **`concept` 仅编译期约束**：无 vtable、无运行时接口值、无动态派发；只用于泛型边界（类型参数前置为参数 `T:HasName`，其后值参数/返回用 `T`）处的静态形状校验（方法签名 + 字段形状）。
2. **`concept` 满足 = 结构化（structural）**：具体类型拥有匹配的方法+字段即满足，无需显式 `impl`/`declare`。
3. **字段约束要求同名同类型**；方法约束要求同名同签名（接收者 `self`）。
4. **`overload struct` 尾部 `_` 锚点**：用户可显式写出占位，编译器保证其存在；`extend overload` 追加字段排在 `_` 之后。
5. **`extend overload struct` 要求同编译单元**（复用 `extend overload fn` 规则），单独编译报 `T-OVL-E980`。
6. **`#id` 仅"应用"修饰词**：编译器不解释语义，仅登记；真实语义由用户扩展函数（插件/钩子）消费；未知 id 强制报错（非静默忽略）。
7. **`extern struct` = C-API 严格 C 规范**：有字段体、可实例化；遵循标准 C struct 布局（声明序=内存序、标准 C 对齐/填充、C 兼容），用于 capi / C FFI。旧 `#extern` 升级为关键字且语义由"冗余标注"升级为"强制 C 规范"。
8. **默认布局 = 无关键字、内部标签 `auto`**：`auto`/`default` 均非用户可见关键字；不写修饰即默认布局，`node_sb="auto"` 仅为编译器内部命名，编译器可对其内部做优化（如重排）但不暴露关键字。用户可见的布局修饰关键字**仅 `packed`/`extern`**。
9. **packed 占位字段 `_:uN`**：`packed struct` 成员可用占位字段 `_:uN`（如 `_:u2`）保留 N 位占位，走统一字段语法 `name: Type`（名字用 `_`，区别于具名 `name: uN`）；不再引入 `_:N` 裸数字专用语法。
10. **`@derive` 与 `trait` 已废弃**：设计中不再引用二者；`concept` 是面向未来的约束机制。
11. **`extern` 不支持 `overload`/`extend`**：`extern` 专用于 C 兼容，布局须严格稳定，故与 `overload` 互斥（`extern overload struct` / `overload extern struct` 报错）；只有非 `extern` 的普通 struct 才能 `overload`。
12. **generic struct 语法本次不实现（保留扩展）**：本次仅实现 generic 函数语法 `fn f(T:HasName, x: T)`；generic struct 语法（`struct Box(T:HasName){val:T;}`）不在本次范围，保留为未来扩展；struct 泛型经「generic 函数 + 匿名结构体（`{x:T,...}` / `.{T1,T2}`）」组合达成。
13. **泛型函数语法细则（已决，2026-10-16）**：① 类型参数/值参数靠 RHS 区分（concept 名→类型参数，类型→值参数；二者强制不同名）；② 类型参数须使用前声明（可位于参数表任意位置）；③ 无约束类型参数 `fn f(T, x: T)`；④ 多约束/多类型参数"类型运算符"本次不设计（保留未来扩展）；⑤ 所有 concept 约束纯编译期、零运行时开销；⑥ 类型实参走类型推断（不引入显式类型实参语法）；⑦ concept 当值类型位置使用按①判为类型参数（自洽、预期行为）。详见 D11。

---

## 8. 偏离记录（编码阶段追加）

| 子任务 | 偏离描述 | 合理性 | 处置 |
|---|---|---|---|
| 布局维度（2026-10-16） | 默认布局内部标签由旧 `"default"` 改名为 `"auto"`；旧 `#auto` 用户重排被禁用（`mb_struct_layout_pass` 触发条件 `== "auto"` → `== "reorder"`，当前无产生点）。synthetic 结构体（`mb_make_struct(layout="auto")`）仍按内部逻辑重排，属内部优化、不影响用户语义。 | 契合「auto 为默认布局内部名、非关键字、无重排语义」裁定；改名不触发 IR 漂移（标签字符串不进发射产物），且 src/examples 无 `#auto` 用户结构体，自举不动点可保。 | 已实施；文档 §2.2 同步。 |
| 布局维度（2026-10-16） | `#extern` 注解被 `extern struct` 前缀关键字取代；`#auto` 注解废弃。注解分支仅保留 `#soa`/`#aos`（容器布局轴）。 | 设计已裁定 `#extern`→关键字、`#auto` 废弃；唯一使用者 `tests/conformance/pass/p40` 已同步改为 `extern struct` + 默认布局断言。 | 已实施；p40 已更新。 |
| 布局维度（2026-10-16） | `extern struct` 桥接实现用 `lex.cur_t()=="Identifier" && lex.cur_v()=="extern"` + `peek_t(1)=="KwStruct"` 守卫，而非 `KwExtern`（词法上 `extern` 非保留关键字，与 `packed` 同构）。 | 镜像 `packed` 桥的语境识别；peek 守卫确保仅对 `extern struct X` 生效，不误吞 `extern` 作普通标识符（如 `#extern` 注解场景）。 | 已实施（src/parse.tc）。 |
| 布局维度（2026-10-16） | `packed struct` 的 `@size_of`/`@offset_of` 元路径此前缺失：积类型统一 epic 只落地了 codegen + `check_packed_layout` 扁平池，未接 `mb_struct_size`/`mb_struct_field_offset`；`uN`/`iN` 位域字段 `node_ia==-1`，被 `mb_struct_size` 当普通字段对 `u1` 等调 `mb_scalar_size` 返回 -1 ⇒ `@size_of` 一律报 `T-MTA-E606`。 | 补 packed 分支：尺寸=容纳总位宽的最小宿主整型（`packed_host_bits`/`packed_host_name`，与 codegen 同源），偏移对 packed 统一返回 0（位域走 shift/mask，无字节偏移）。`_:uN` 占位字段（如 `_:u2`）即「名为 `_`、类型为 `uN` 的位域槽」，天然被位宽累加覆盖，无需额外语法。 | 已实施（src/sema.tc）；`_verify_layout.tc` 实测 `@size_of(Perm)==2` 且运行期字段读写正确。 |
| 开放维度（2026-10-16，Task #3） | `overload struct X` / `extend overload struct X` 文法落地：复用函数 overload 的 `ia` 角色码（1=组 / 2=追加）+ `lex.g_extend_name/g_extend_file` extend 意图登记；StructDecl 复用 `node_ia`。同名 `extend` 节点在 `run_check` 早期（mangle 之前、hir_build 之前）合并进 `overload` 组字段链并移出 decl_list，避免重复类型注册 / 重复发射。 | 合并逻辑与函数 overload 同构：同文件 / 跨文件同编译单元（resolve_modules 已把模块声明并入 decl_list）都能合并；单独编译（base 不在 decl_list）或 base 非 overload 组 ⇒ `T-OVL-E980`（复用函数 overload 报错码）。 | 已实施（src/parse.tc 两处桥 + src/sema.tc `mb_struct_extend_merge()`，并在 `run_check` 的 `resolve_modules()` 之后、`mangle_modules()` 之前调用）。 |
| 开放维度（2026-10-16，Task #3） | 尾部 `_` 锚点：`overload struct` 示例里的 `_;` 是纯语法标记（设计 §2.1/§2.2 的「编译器合成尾部 `_` 扩展锚点」），解析期直接跳过、不生成字段；extend 字段接在其后由合并期字段链拼接保证。 | 避免锚点占空间 / 干扰布局；与「extend 字段排在 base 字段之后」语义一致（合并即 base 字段链尾追加 ext 字段链）。 | 已实施（src/parse.tc `parse_struct_decl` 成员循环新增 `_` 锚点分支）。 |
| 开放维度（2026-10-16，Task #3） | `extern` 与 `overload` 互斥（D9）：`extern overload struct` 与 `overload extern struct` 均报 `T-PAR-E102`（"…mutually exclusive"）。`extern` 桥由「peek(1)==KwStruct 守卫」改为「消费 `extern` 后按下一 token 派发（KwStruct→extern struct / overload→互斥报错 / 其它→expected struct）」。 | 镜像设计 D9；`extern` 专用于 C 兼容、布局须严格稳定，故不支持 overload/extend。 | 已实施（src/parse.tc）；双向（extern overload / overload extern）均验证报错。 |
| 开放维度（2026-10-16，Task #3） | `emit_deps` 的 extend 边（REQ-EXT-1）扩展覆盖 struct：`FuncDecl` 匹配分支新增 `StructDecl && ia==1`（overload 组）亦可作被扩展者，按裸名 / `"<模块>__<名>"` 后缀匹配，跨单元 ⇒ 输出 `kind:"extend"` 边。 | 与函数 overload 的 extend 边机制一致，tote 增量缓存可识别 struct 跨单元扩展。 | 已实施（src/sema.tc `emit_deps`）。 |
| 约束维度（2026-10-16，Task #4a） | `concept` 约束类型**不新增 CST 节点种类**，复用 `StructDecl` 节点 + `node_sb="concept"` 标记（设计 §2.3 把 ConceptDecl 列为「提示性落点」，复用为更安全的等价实现，规避改动生成式 CST 表 `tools/cst_nodes.json`/`cstgen.mjs` 带来的自举风险）。成员即约束：字段约束走既有 `node.lb`（字段链）；方法约束以 `fn mname(self) T;`（`;` 结尾 → `parse_func_decl` 的 extern 前向声明形态、`body=-2`）存入 `node.la`（concept 不发射，故此注解槽复用为方法约束链，与注解互不冲突）。 | 复用 StructDecl 的字段/方法解析与代码路径，零新增节点种类、零生成文件改动，自举零风险；方法签名以 extern 前向形态天然承载「约束、无体」，与现有 `;` 结尾函数文法同构。 | 已实施（src/parse.tc `concept` 桥 + `parse_struct_decl` concept 模式；src/sema.tc `register_decl` 注册 `kind="concept"` + `resolve_ti` 拒绝实例化报 `T-CON-E100`；src/codegen_c.tc `emit_struct_decl` / src/tir.tc 跳过 `node_sb=="concept"`）。 |
| 约束维度（2026-10-16，Task #4a） | concept **不可实例化**：`resolve_ti` 的 `named` 分支命中 `kind=="concept"` 的符号即报 `T-CON-E100`（"concept … cannot be instantiated"）。 | 设计 D5「concept 不可实例化」；值类型位置引用 concept 名即报错（泛型边界 `T:HasName` 属约束位置，由 Task #4b 单独处理，不触发此报错）。 | 已实施（src/sema.tc `resolve_ti`），`tests/conformance/fail/f_concept_instantiate.tc` 验证。 |

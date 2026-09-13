# 数据声明设计（struct / enum / variant）—— T 编译管线

> 状态：设计规格 v0.1（2026-09-04）  
> 关联：`docs/compiler/hir-design.md`、`docs/compiler/mir-design.md`、`docs/compiler/tir-design.md`、`docs/compiler/backend-design.md`、`docs/compiler/compiler-pipeline-design.md`

## 0. 范围、定位与文档关系

本文是 `docs/compiler/` 分层设计体系&#x7684;**「声明层」规格**，专门描述**用户声明的数据类型**在管线各层（CST → HIR → mir → TIR → tmir → 后端）的形态与层间降级契约。

- **1覆盖范围**：`struct`（积类型）、`enum`（整数枚举）、`variant`（带载荷标签和类型 / 代数数据类型 ADT）。关联类型一并说明：`union`（C 兼容联合体，**无 tag**）、`flag` / `flag_set`（位标志）。
- **不覆盖**：标量 / 指针 / 切片 / 数组 / 字符串（各层通用文档）；闭包（见 `tir-design.md` 的 `%TClosure`）；函数类型（mir/TIR 的 `func`）；泛型参数化本身（见 `tir-design.md` §4.2.1 单态化归属）。
- **文档关系**：HIR 形态见 `hir-design.md`，mir 形态见 `mir-design.md`，TIR 形态见 `tir-design.md` §4/§5/§7，后端发射见 `backend-design.md`。本文只定义「声明」在各层的**形态**与**层间契约**，不重复各层通用机制。
- **一致性声索**：本文是 struct/enum/variant/union 在 TIR 层 TT 表项的**唯一权威**。它会纠正 `tir-design.md` §7 中两处与现状实现不符的条目（见 §9）。

## 1. 源语法与语义直觉

### 1.1 struct（积类型）

```t
struct Point { x: f64; y: f64; }
struct Packed @bitpack { a: u8; b: u8; }      // 位域布局
@derive(Clone, Copy, ToString) struct Foo { ... }
struct SoA @soa { ... }                         // #soa 布局（GPU 友好）
```

- 固定字段集合，每字段有**名 + 类型**。
- 可带字段注解（`@bitpack` 位域、`@soa`）与类型级注解（`@derive`）。

### 1.2 enum（整数枚举）

```t
enum Color : u8 { Red; Green; Blue; }
enum HttpStatus : i32 { Ok = 200; NotFound = 404; }
```

- **仅整数成员值**（auto-increment 或显式 `= N`）；**成员不带载荷**——带载荷的和类型用 `variant`。对位 Rust `#[repr(C)]` C-like enum。
- **匹配穷尽性**：enum 的 `match` 必须覆盖**每一个**成员（新增成员会让旧 `match` 立即报错，强制回访——这是穷尽性检查的价值）。

### 1.3 variant（ADT，真正的「和类型」）

```t
variant Shape {
  Circle(f64);          // 单载荷
  Rect(f64, f64);       // 多载荷（匿名 struct 载荷）
  Empty;                // 无载荷
}
```

- 每个 case 一个 **tag**（`uint32_t` / i32）+ 载荷（0 / 1 / 多字段）。
- **递归变体必须经指针/盒引用自身**：值自引用 → 无限大小，`sema.variant_check_recursion` 拒绝。
- 合成助手（sema `register_variant_helpers` 注册符号，`codegen` 落实现）：`Shape_from_Circle(f64) -> Shape`、`Shape_is_Circle(Shape) -> bool`、`Shape_as_Circle(Shape) -> f64`（多载荷为 `Shape_as_Rect(Shape) -> struct{...}`）。

### 1.4 union（C 兼容联合体，无 tag）

```t
union U { f: f64; i: i64; }
```

- 与 C `union` 同语义：所有成员共享存储，大小为最大成员对齐上取整，**无判别式**。
- 用途：FFI / 内存复用；安全性由用户保证（读取非写入成员属未定义行为）。

### 1.5 flag / flag_set（位标志）

```t
flag Perm : u8 { R; W; X }            // 每位一个标志
flag_set PermSet : u8 { R; W; X }     // 动态长度位域集合
```

- `flag`：整数位的命名子集（`1u << shift`）。
- `flag_set`：动态长度位域（`struct { uint8_t* data; size_t bit_count; byte_count; }`）。

## 2. 语义模型（sema 之后，TD/TI）

`TI` 的 `kind` ∈ {Scalar, Struct, Enum, Flag, FlagSet, Union, Variant, Func, Named, Unknown}。关键字段：

| 声明         | sema 后的类型信息                                                  |
| ---------- | ------------------------------------------------------------ |
| `struct`   | `fields: [(name, TD, ann)]`；布局由 mir 计算（§4）                   |
| `enum`     | `underlying: scalar`，`members: [(name, value)]`              |
| `variant`  | `cases: [(tag: u32, name, payload: [TD])]`，`recursive: bool` |
| `union`    | `members: [(name, TD)]`，`max_size`                           |
| `flag`     | `underlying`，`flags: [(name, shift, width)]`                 |
| `flag_set` | 动态长度位域                                                       |

声明符号注册（`sema` `sym_define`）：`StructDecl`/`EnumDecl`/`FlagDecl`/`FlagSetDecl`/`UnionDecl`/`VariantDecl` 各注册为 `type` 类符号，kind 如上。

## 3. HIR 形态（ZIR 槽位，untyped pre-sema）

- 声明以 **HIR 声明节点**表示，但**类型字段尚未解析**——字段 / 载荷类型以**名字引用**（如 `named "f64"`）而非 TD 索引。
- 这是 per-file 缓存锚点：HIR 声明只依赖本文件语法，不依赖其他文件的类型解析（见 `hir-design.md` §3.4）。
- 构造器 / 匹配助手在该层是**符号引用**（`@Shape_from_Circle`），sema 之后才解析成具体函数 / 内建。
- 伪代码示意：
  ```
  decl.variant "Shape" {
    case "Circle" [named "f64"];
    case "Rect"   [named "f64", named "f64"];
    case "Empty"  [];
  }
  decl.struct "Point" { field "x" named "f64"; field "y" named "f64"; }
  decl.enum "Color" : named "u8" { member "Red" 0; member "Green" 1; member "Blue" 2; }
  ```

## 4. mir 形态（typed CFG+SSA，布局真相源）

- 声明成为**带布局的类型**：字段偏移 / 对齐已按 `target_desc`（`target-desc-design.md`）的 ABI 规则算出。
- `struct`：有序 `(offset, size, align, field_name, ST)`；`@bitpack` 走位域布局。
- `enum`：底层标量 ST（如 `u8`）+ 成员值表；`repr` 由 `target_desc` 决定（默认最小可行宽度）。
- `variant`：`{ tag: <tagST 默认 i32>, payload: struct{max fields, padded to max size} }`；tag 宽度**默认 i32**（`@repr(u8/u16)` 可缩小，见 §11 决策 4），TIR 记录实际 tag ST；递归变体在此确认经 ptr 间接。
- `union`：最大成员 ST + 大小；无 tag。
- `flag`：底层标量 ST + 位域表。
- **匹配降级**：enum → `switch` 整型；variant → `switch` tag 后取 payload；struct → 字段解构。
- 中端优化（G3，`mir-design.md`）在此可见：字段访问偏移常量折叠、死字段消除（仅当类型未逃逸）。

## 5. TIR 形态（ABI 事实集中 TT，canonical 见 §9）

TT 表项（本文盖 `tir-design.md` §7）：

| 源声明             | TIR 表达（canonical）                                               |
| --------------- | --------------------------------------------------------------- |
| `struct(Name)`  | `%Name` = `struct{ f0: ST, ... }`（字段按 mir 偏移排序，已解算布局）           |
| `enum(Name)`    | **底层标量 ST**（如 `u8`）；成员值进常量表（不在 TT 结构里）                          |
| `union(Name)`   | `%uname` = `union{ f0: ST, ... }`（无 tag，最大成员共享存储）               |
| `variant(Name)` | `%vname` = `struct{ tag: <tagST 默认 i32>, payload: <max-payload ST blob> }`（tag 默认 i32，`@repr(u8/u16)` 可缩小，见 §11 决策 4） |
| `flag(Name)`    | 底层标量 ST                                                         |

- 字段访问在 TIR 是**偏移-based**（`getelementptr` / `struct_extract` 操作数来自 TT 偏移）。
- memory-first（见 `tir-design.md` §2.4）：聚合值存于 slot；构造 / 解构是 slot 上的 load / store / extract。

## 6. 层间降级契约

| 边                      | 动作                                                     |
| ---------------------- | ------------------------------------------------------ |
| CST → HIR              | 保留声明结构；类型字段转名字引用；注册声明符号                                |
| HIR → mir（sema + CTFE） | 解析名字 → TD；算布局（`target_desc`）；注册 variant 助手；递归检查        |
| mir → TIR              | 擦除源类型；ABI 事实落到 TT；字段 access → 偏移；match → `switch(tag)` |
| tmir → 后端               | 每后端把 TT 翻译成目标语法（`backend-design.md` 的 `BackendTraits`） |

声明符号（struct/enum/variant 名、variant 助手名）在 TIR 阶段为 `@` 符号，归属规则见 `tir-design.md` §4.2.1（定义点归属 + `linkonce_odr`）。

## 7. 后端发射（grounded in 实际代码）

### 7.1 C 后端（`src/codegen_c.tc`）

- **struct**：`typedef struct Name { <ctype> f; ... } Name;`。`@bitpack` → `: bits` 位域；`@soa` → `// #soa layout` 注释。字段依赖拓扑排序（`emit_struct_families_ordered`）以避免前向未定义（C 要求值内嵌字段前类型完整）。
- **enum**：`typedef <scalar> Name;` + `#define Name_Member value`（auto-increment：`emit_enum_decl` 维护 `auto_val`，显式 `= N` 覆盖）。
- **variant**：`typedef struct Name { uint32_t _tag; union { <payload> _uN; } _u; } Name;` + `static inline` 构造 / 判别 / 取载荷。递归变体先 `typedef struct Name Name;`（前向）使载荷里的 `<N>*` 可见。
  - 多载荷 case：`union { struct { T0 _f0; T1 _f1; ... } _uN; ... }`。
  - 单载荷 case：`union { T _uN; ... }`。
  - tag 为 `uint32_t`（**i32**，非 `i8`）。
- **union**：`typedef union Name { ... } Name;`（无 tag）。
- **flag**：`typedef <scalar> Name;` + `#define Name_bit (1u << shift)`，多比特段加 `_SHIFT` / `_MASK`。
- **flag_set**：`typedef struct Name { uint8_t* data; size_t bit_count; byte_count; } Name;`。

### 7.2 LLVM 后端（`src/codegen_ll.tc`）

- **struct**：`%st.Name = type { ... }`（`ll_named`：`kind=="struct" → %st.Name`）。
- **enum / flag**：底层标量（如 `i8`/`i32`）；成员常量进 TD / 符号表（`ll_named`：`kind=="enum"||"flag" → scalar_to_ll(underlying)`）。
- **variant**：`%vt.Name = type { i32, <payload struct> }`（`ll_variant_sty` 生成 payload 结构 `{T0,Ti...}`）；tag = `i32`；size = `8 + ll_variant_paymax`（保守 8 字节对齐上估，`ll_variant_paymax` 取各 case 最大载荷尺寸）。
- **union**：`%un.Name`（最大成员，`ll_union_max`）。
- 聚合值即其地址（ptr 表示），load / store 取字段。

### 7.3 其他后端（Cranelift / WASM / SPIR-V）

- 原则：struct → 对应后端 struct / aggregate；enum → 标量；variant → `{tag, blob}`；union → 后端 union / 最大成员。由 `backend-design.md` 的 `BackendTraits` 统一驱动，保证双（多）后端字节级一致。

## 8. match 降级（在这些类型上）

- **enum**：scrutinee 是标量 → `switch` 整数；穷尽性由 sema 兜底（缺成员即报错）。
- **variant**：`switch` on `_tag`；每个 case 体先 `extractvalue` / GEP 取 payload，再绑定模式变量（`Shape_as_Rect` 返回载荷 struct）。**穷尽性检查在 sema/mir 补齐**（§11 决策 7）：`match` 必须覆盖所有 case 或缺省 `_`，新增 case 让旧 match 立即报错。
- **struct**：字段模式 = 逐字段 `extract` + 递归 match；顶层解构 `let Point{x, y} = p`。
- **union**：C 兼容，无判别式；T 当前未提供 safe match（用户保证活跃成员）。

## 9. 与 `tir-design.md` §7 TT 表的修正（唯一权威）

当前 `tir-design.md` §7 有两处与现状实现 / 本文 canonical 不符，**本文盖之**：

| 类型        | `tir-design.md` §7 旧条目                       | 本文 canonical                                                  | 修正动作                                   |
| --------- | -------------------------------------------- | ------------------------------------------------------------- | -------------------------------------- |
| `union`   | `@uname` = `struct{tag i8, payload 最大成员 ST}` | 真实 C 兼容 union，**无 tag**，最大成员共享存储                              | 改 §7 为 `%uname` = `union{...}`，注明无 tag |
| `variant` | `@vname` = `struct{tag, data...}`（tag 未定宽度）  | tag = **i32 默认**（`uint32_t` / LLVM `i32`），`@repr(u8/u16)` 可缩小；payload = 最大载荷 blob；TIR 记实际 tag ST | 改 §7 tag 为「i32 默认 + @repr 可缩小」（§11 决策 4） |

> 差异来源：旧文档「示意」时用了 `i8`，但实现与 ABI（32 位 tag 的通用性、C 互操作、避免小 tag 溢出）选择 `i32`。TIR 落地时必须以本文为准。enum/flag 的「底层标量 ST」、struct 的「具名 `%Name`」两文档一致，无需改。

## 10. 跨语言对位

| 构造           | Rust                      | Swift                     | Zig             | C                |
| ------------ | ------------------------- | ------------------------- | --------------- | ---------------- |
| struct       | `struct`                  | `struct`                  | `struct`        | `struct`         |
| enum（整数）     | `#[repr(C)] enum`         | `enum`（rawValue）          | `enum`（int）     | `enum`（int）      |
| variant（ADT） | `enum E { A(T); B; }`     | `enum`（associated values） | `union`+tag（手写） | 手写（struct+union） |
| union        | `union`（unsafe）           | —                         | `extern union`  | `union`          |
| flag         | `bitflags!` / `enum : u8` | `OptionSet`               | —               | `#define`        |

T 的 `enum` ≈ 各语言整数枚举；T 的 `variant` ≈ Rust / Swift 的带载荷 enum（ADT）——这是 T 唯一真正的**和类型**。

## 11. 开放问题决策（已拍板，2026-09-04）

1. **匿名 struct / enum（内联类型）** —— **进入 mir + TIR，HIR 阶段以内联结构表达**。
   - 匿名 struct（类型位置：字段类型 / 返回值 / 局部变量类型）作为**结构类型**（structural，非名义），不分配具名 `@` 符号（避免污染命名空间、不进 `.tmi` 具名导出）。
   - mir 计算布局；TIR 用合成名 `%anon_<content-hash>`（结构等价 → 同一名，利于去重）。
   - **否决匿名 enum**（C 式 `enum { A, B }` 提升成员为常量）：保持具名，穷尽性检查依赖具名成员；若需暴露成员用具名 enum + `pub const`。
   - HIR 阶段匿名结构以内联结构描述（字段名 + 类型名引用）表示，不分配具名符号。

2. **泛型 struct / enum / variant（参数化）** —— **确认**：泛型声明在 TT 不占条目，只有单态化后的 concrete 实例占 `%Name_<键>` 条目。
   - mangled 名由 `instantiate_generic` 的键编码（见 `comptime-design.md` Phase E 的 `meta_val_key`）派生。
   - HIR 阶段泛型声明是模板（具名、字段含类型参数名引用）；mir 阶段每个实例独立算布局（类型参数已代入）；TIR 每个实例独立 `%Name_<键>`，归属定义点 + `linkonce_odr`（见 `tir-design.md` §4.2.1）。

3. **enum 是否支持 payload** —— **否决**。enum 保持 C-like 整数枚举（零成本、C 互操作、匹配为整型 `switch`）；带载荷的和类型统一用 `variant`。已隐含于 §1.2。

4. **variant tag 宽度** —— **默认 i32**（`uint32_t` / LLVM `i32`，通用性 + C 互操作 + 防溢出）；提供 `@repr(u8)` / `@repr(u16)` 属性用于 ≤255 / ≤65535 cases 的紧凑布局。**TIR 记录实际 tag ST（非硬编码 i32）**，mir 按 `@repr` 算 tag 宽度。已同步精修 §4 / §5 / §9。

5. **递归 variant 经 ptr** —— **要求用户显式写 `*T`**（当前语义锁定）。不隐式 `Box`/`Rc` 间接：t 无 GC / 所有权系统，隐式堆分配违反宪法第 3 条（全行为显式）与第 8 条（零未定义行为 / 无隐式内存分配）。mir 确认经 ptr 间接；TIR 载荷 ST 为 `ptr<ST>`。

6. **struct 字段重排** —— **默认保持声明序**（确定性 + C 互操作 + 与 `#[repr(C)]` 心智一致）。提供 `@layout(reorder)` 属性启用 mir 字段重排（减小 size，仅当类型不逃逸到 FFI）；`@bitpack` 已是显式位域。reorder 属 opt-in 优化 pass（见 `mir-design.md` G3）。

7. **variant match 穷尽性检查** —— **补齐**（已落实于 §8）。在 sema / mir 阶段对 `variant` 的 `match` 做穷尽性分析：必须覆盖所有 case 或缺省 `_`，新增 case 让旧 match 立即报错。variant 是真正的**和类型**，穷尽性是其核心价值（Rust 式）。

8. **空 struct / 单 case variant 的 ABI** —— **统一规则**：
   - **空 struct `struct {}`**：默认 **1 字节占位**（与 C++ / 多数 C ABI 一致，避 LLVM `alloca 0` 坑、数组退化）；`@repr(C_zero)` / `@repr(transparent)` 可选 0 字节。TIR size 默认 1。
   - **单 case variant（无载荷）**：大小 = **tag ST 宽度**（默认 i32 = 4B），无 payload blob，仍保留 tag 字段（与多 case 一致，匹配统一走 `switch(tag)`）。
   - **单 case 带载荷 variant**：tag + payload。
   - TIR 记录 mir 算出的实际 size（非固定值）。

> 注：原 §11 标题编号「11」与所列条目数（8）不一致，本文已按实际 8 项拍板并修正标题。

# `@type_info` 反射系统设计文档（v2 · Zig 0.16 对齐）

> 状态：设计稿 v2（相对 A-fix 路线 v1 的改版，参考 Zig 0.16 的 `@typeInfo` 设计）。
> 范围：当前仅 **struct 聚合类型**的运行时反射已落地（v1）；v2 引入 **comptime `type` 值 + `inline for`** 消费模型，对齐 Zig 0.16。
> 关联文档：`docs/compiler/comptime-design.md`、`docs/compiler/metafunction.md`、`docs/compiler/known-issues.md`。

---

## 0. 文档目的

v1（A-fix）已落地"运行时反射"（`TypeMeta`/`FieldInfo` + `ti_*`/`fi_*` 函数式 API）。本 v2 改版目标：**参考 Zig 0.16 的 `@typeInfo` 设计，把 `@type_info(T)` 的消费模型对齐为 comptime variant + 实际 `type` 值 + `inline for`**，同时保留 t 特有的运行时反射能力（字段名/偏移/tag 的运行时检视）。

本文回答：① Zig 0.16 参考设计精确形态；② t 如何在其上对齐；③ 需要 t 新增的语言能力前置；④ 与 v1 运行时层的衔接与迁移。

---

## 1. Zig 0.16 参考设计（精确）

来源：`ziglang.org/download/0.16.0/release-notes.html`、`ziglang.org/documentation/0.16.0`、`www.ziglang.in/learn/getting-started/zig-0-17`。

### 1.1 `@typeInfo` 返回 variant（Zig 称 tagged union）

```zig
pub fn @typeInfo(comptime T: type) std.builtin.Type
```
`std.builtin.Type` 是 **variant（Zig 称 tagged union；t 的对应构造是 `variant` 关键字）**，按类型种类分 arm（`Int`/`Float`/`Bool`/`Pointer`/`Slice`/`Array`/`Fn`/`Struct`/`Enum`/`Union`/`Optional`/…）。

### 1.2 `Struct` arm = 并行数组（⭐ 核心）

```zig
Struct = struct {
    layout: ContainerLayout,
    BackingInt: ?type,
    field_names: []const []const u8,        // 并行数组 ①：字段名
    field_types: *const [field_names.len]type, // ⭐ 并行数组 ②：实际类型值（comptime-only）
    field_attrs: *const [field_names.len]StructField.Attributes, // 并行数组 ③：默认値/对齐/is_comptime
};
```
- `field_types` 元素类型是 **`type` 本身**——编译期一等值，零运行时表示。
- 0.16.0 仍是 `fields: []StructField`（每元素含 `.name`/`.type`/`.default_value_ptr`/`.alignment`）；**0.17+ 把 `fields` 拆成 `field_names`/`field_types`/`field_attrs` 三个并行数组**（你引用的 `field_types: []const type` 即此形态）。本设计采用并行数组形态（与 0.17 一致，最贴近你的引用）。

### 1.3 消费模型：comptime `inline for`，无运行时反射

```zig
fn printStruct(out: *std.Io.Writer, value: anytype) !void {
    const T = @TypeOf(value);
    const info = @typeInfo(T).@"struct";
    inline for (info.field_names, info.field_types) |name, Field| {
        const v = @field(value, name);          // 编译期已知字段名
        if (comptime Field == []const u8) { ... } // Field 是真实 type，可 comptime 比较/分支
        else { ... }
    }
}
```
- `field_types[i]` 是 `type` 值，只能在 **comptime** 上下文使用（`inline for`、`@field`、`@TypeOf`、类型比较、泛型实例化）。
- **不存在运行时反射**：`type` 无运行时表示，不能存进变量在运行期查。

### 1.4 其他 kind 同样是并行数组

| kind | 并行数组 |
|------|----------|
| `Struct` | `field_names` / `field_types` / `field_attrs` |
| `Enum` | `field_names` / `field_values` / `mode` |
| `Union` | `field_names` / `field_types` / `field_attrs` |
| `Fn` | `param_types` / `param_attrs` / `ReturnType` |
| declarations | `decl_names` |

---

## 2. 已知设计前提（v2 修订）

| # | 裁定（v2 修订） | 来源 |
|---|----------------|------|
| P1 | `TypeInfo` / `StructInfo` 等是 **t 原生内建类型**（`base.tc` 同构定义，用户程序经 `resolve_type_desc` 解析为真实命名类型）。 | 沿袭 |
| P2 | `@type_info(T)` 是**编译期元函数**，返回 **comptime `TypeInfo` variant**（与 Zig `std.builtin.Type` 同构；t 用 `variant` 关键字表达该 variant，见 §4.1）。生成侧与 Zig 完全同；消费侧 t **额外**物化一份运行时派生数组（见 P3），故 t 同时具备 comptime 与 runtime 两种反射。 | 本轮改版 |
| P3 | `StructInfo` **并列共存**两套字段：**comptime `field_types: []type`**（Zig 0.16 对齐，实际类型值）+ **运行时派生数组** `field_names: []string` / `field_offsets: []i64` / `field_type_names: []string` / `field_tags: []i64`。早先"type 是 comptime-only 零运行时表示，A-fix 下不可行"的顾虑在此化解：`field_types` 是纯 comptime 值（零运行时表示），运行时字段**原样保留、并非被替换**。 | 本轮改版（化解 P3 旧裁定） |
| P4 | `ti_*` / `fi_*` 系列函数是**已废弃、暂时保留**的遗留 API（legacy shim），**不属于目标设计**；目标 API 是 `@type_info` 返回值的**字段投影 + `inline for`**。新设计与旧实现**相互独立**，清理留待后续独立任务。 | 上一轮裁定 |
| P5 | kind 枚举 **0..10 已定稿**：`Int=0, Float=1, Bool=2, Ptr=3, Slice=4, Array=5, Fn=6, Struct=7, Enum=8, Trait=9, Union=10`。 | `base.tc:5579`、`tir_to_ll.tc:5217` |

> **关键澄清（化解旧 P3）**：v1 担心"把 `type_name`/`type_size` 合并为 `@type: type` 不可行"——那是指"用 comptime `type` 替换运行时字符串/尺寸字段"。Zig 0.16 的做法是**增加** `field_types: []type`（comptime）而**保留** `field_names` 等运行时信息。v2 采用同一思路：`field_types` 与运行时数组**并列**，不互相替换。

---

## 3. 现状：as-built 代码地图（v1 已落地，保留供对照）

### 3.1 模块职责表

| 模块 | 反射相关职责 | 关键符号 / 行号 |
|------|--------------|-----------------|
| `src/base.tc` | 定义 `FieldInfo` / `TypeMeta` / `TypeInfo`（variant）+ 11 个访问函数 `ti_*`/`fi_*` | 定义 `5554–5592`；访问函数 `5594–5663` |
| `src/parse.tc` | `@type_info(T)` / `type_info(T)` → `typeinfo` 节点（`sa` = 类型名）；第 0 形参是类型 | `5338–5355`、`mb_arg_is_type` `5364–5373` |
| `src/sema.tc` | `@type_info` 元函数：建 `typeinfo` 节点、`type = ti_mk("TypeInfo")` | `13960–13980`；TI 表示 `ti_mk`/`ti_named` 等 `74–` |
| `src/hir.tc` | HIR 操作码 | `HIR_OP_TYPEINFO = 56` `79` |
| `src/tir.tc` | TIR 操作码 + 降级发射（后端据此合成 `@__ti_<T>`） | `TIR_OP_TYPEINFO = 62` `145`；发射 `3188–3190` |
| `src/tir_to_ll.tc` | LLVM 后端：注入 `%TypeMeta/%FieldInfo/%TypeInfo` typedef + 11 个 `TypeInfo_from_<Kind>` 构造器；合成 `@__ti_<T>` 全局；把 `ti_*`/`fi_*` **内联**为字节偏移读 | `ll_emit_ti_ctor_def` `5205`、`ll_emit_ti_global` `5102/5142`、`ll_emit_builtin` `1475`（内联 `1915/2020`） |
| `src/codegen_c.tc` | legacy C 后端：合成 `@__ti_<T>` 全局（`emit_type_info_c`）；自包含发 typedef + 11 构造器 + `ti_*`/`fi_*` 访问子（`c_ti_emit_support`） | `emit_type_info_c` `5183`、`c_ti_emit_support` `5149` |
| `runtime/t_runtime.lib` | 提供 `t_println` / `t_int_to_str` 等；**不含** `ti_*`/`fi_*`（已在后端内联） | — |
| `examples/` | 验证用例 | `tagid_typeinfo.tc`、`type_info_demo.tc` |

### 3.2 数据流（v1 运行时路径，仍保留为"运行时派生层"）

```
源码  type_info(Point)
  │  parse.tc  →  node "typeinfo", sa="Point"
  ▼
sema.tc  →  type = ti_mk("TypeInfo")
  ▼
tir.tc   →  TIR_OP_TYPEINFO(62)，args = "Point"
  ▼
┌─ LLVM 后端 ──────────────────────┐   ┌─ C 后端 ─────────────────────┐
│ @__ti_Point_meta : TypeMeta {…}  │   │ static TypeMeta __ti_Point={…};│
│ @__ti_Point_f    : [N x FieldInfo]│   │ static FieldInfo __ti_Point_f[];│
│ TypeInfo_from_Struct(&…_meta)    │   │ TypeInfo_from_Struct(&__ti_Point)│
└──────────────────────────────────┘   └────────────────────────────────┘
  ▼ 运行期（v1 运行时派生层，v2 继续保留）
var tp: TypeInfo = <构造出的运行时值>
ti_field_count(tp) / tp.meta.field_count / tp.meta.fields[i].tag   ← v1 函数式 / v2 字段投影
```

### 3.3 双后端内存布局契约（运行时派生层，gate 逐字节校验依据）

| 类型 | LLVM (`%…`) | C (`typedef`) |
|------|-------------|---------------|
| `TypeMeta` | `{ %TStr, i64, i64, i64, %TSlice }` | `{ TStr name; int64_t size; int64_t kind; int64_t field_count; TSlice fields; }` |
| `FieldInfo` | `{ %TStr, i64, %TStr, i64, i8, i64 }` | `{ TStr name; int64_t offset; TStr type_name; int64_t type_size; int8_t is_ptr; int64_t tag; }` |
| `TypeInfo` | `{ i64, ptr }` | `{ int64_t _tag; TypeMeta* _meta; }` |

⚠ 运行时派生层布局**不变**（v2 不改这部分）；新增的 comptime `field_types: []type` **不参与运行时布局**（见 §4.4）。

---

## 4. 目标设计 v2（Zig 0.16 对齐）

### 4.1 核心：`@type_info(T)` 返回 **comptime `TypeInfo` variant**

```t
// 编译期 variant（与 Zig std.builtin.Type 同构，Zig 称 tagged union）；t 用 `variant` 关键字表达该 variant，仅编译期可用
pub variant TypeInfo {
    Int(IntInfo);
    Float(FloatInfo);
    Bool;
    Ptr(PtrInfo);
    Slice(SliceInfo);
    Array(ArrayInfo);
    Fn(FnInfo);
    Struct(StructInfo);
    Enum(EnumInfo);
    Trait(TraitInfo);
    Union(UnionInfo);
}
```

> 选用 **variant**（而非 v1 的 struct `{kind, meta}`）以精确对齐 Zig 0.16 的 tagged-union 形态（t 的 `variant` 即其对应构造）。
>
> ⚠ **语法更正（2026-10-11 实测）**：t 的 variant arm 在 `match` 里用**裸名**，前导点形式 `.Circle(v)` 只用于**构造字面量** `Shape { .Circle(5) }`。
> 故本设计的 Zig 写法 `match (info) { .Struct(s) => … }` 落到 t 应写成 `match (info) { Struct(m) => … }`。
> 依据：`examples/adt_shape.tc`（`Circle(r) => 3 * r * r` vs `Shape { .Circle(5) }`）。

### 4.2 `StructInfo`：并行数组（⭐ 对齐 Zig 0.16 的核心）

```t
pub struct StructInfo {
    // ── 运行时派生数组（v1 已落地，原样保留）──
    field_names:      []string;   // 字段名（运行时可打印/检视）
    field_offsets:    []i64;      // 偏移
    field_type_names: []string;   // @typeName 字符串（运行时可打印）
    field_tags:       []i64;      // 显式 @N tag（tagid 特性）
    field_count:      i64;
    // ── ⭐ comptime 数组（Zig 0.16 field_types: []const type）──
    field_types:      []type;     // 实际类型值，仅编译期可用
}
```

- `field_types: []type` 是 **comptime-only 一等值数组**，零运行时表示。
- 其余字段是 **运行时派生数组**，由编译器从同一份 comptime 类型信息物化（v1 的 `@__ti_<T>` 全局即此物化结果）。
- 两者**索引对齐**（`field_types[i]` 对应 `field_names[i]`、`field_offsets[i]` 等）。

### 4.3 消费模型

**comptime（Zig 0.16 风格，**目标形态**）**——使用 `field_types` 实际类型值：
```t
// ⚠ 目标形态：**尚未可用**（依赖 §4.4 的 comptime `type` 一等值 + `inline for`）
// arm 名按 t 语法写成裸名 `Struct(s)`（见 §4.1 语法更正）
fn printStruct(comptime T: type) void {
    const info = @type_info(T);
    match (info) {
        Struct(s) => {
            inline for (s.field_names, s.field_types) |name: string, Ft: type| {
                if (comptime Ft == string) { /* 字符串分支，编译期定死 */ }
            }
        }
        _ => {}
    }
}
```

**runtime（t 扩展，**目标形态**）**——使用运行时派生数组（v1 能力，序列化 / tagid / 调试打印）：
```t
// ⚠ 同上，`s.field_names` / `s.field_offsets` / `s.field_tags` 依赖 §4.2 的 StructInfo 并行数组，
// 当前 as-built 载荷是 `*TypeMeta`，实测可用写法见 §4.7。
fn dumpRT(info: TypeInfo) void {
    match (info) {
        Struct(s) => {
            var i: i64 = 0;
            while (i < s.field_count) {
                println(s.field_names[i]);
                println(int_to_str(s.field_offsets[i]));
                println(int_to_str(s.field_tags[i]));
                i = i + 1;
            }
        }
        _ => {}
    }
}
```

> ⚠ **as-built（2026-10-11 校正）**：上面两组是**目标形态**；`field_types: []type` / comptime `type` 一等值 / `inline for` **尚未支持**（§4.4 门槛）。
> **当前实际可用**的是 §4.7 的 as-built 形态：`Struct(m)` 载荷为 `*TypeMeta`，可对 `m.name` / `m.size` / `m.kind` / `m.field_count` 做字段投影。

### 4.4 t 需要的语言能力前置（本改版的关键门槛）

| 能力 | 说明 | 现状 |
|------|------|------|
| **comptime `type` 一等值** | `type` 可作为值存入 struct/union 字段、作为 `inline for` 的迭代变量类型、参与 comptime 比较/泛型实例化 | t 当前**尚未支持**（v1 因此把 `FieldInfo` 退化为 `type_name`/`type_size` 字符串/尺寸） |
| **`inline for`** | 编译期展开 comptime-known 切片（尤其 `[]type`），每轮迭代的 `Ft` 是不同具体类型 | t 当前**尚未支持** |
| **variant payload 含 `[]type` 仅编译期可访问** | `info.Struct.field_types` 只在 comptime 上下文可取值；运行期访问报编译错（同 Zig） | 随上两项引入 |

> **后端影响极小**：comptime `field_types: []type` 在 **comptime 求值期**就被 `inline for` 消费并展开为具体代码，**不进入运行时数据布局**。后端只需继续物化**运行时派生数组**（`@__ti_<T>` 全局：names/offsets/type_names/tags）——这正是 v1 已做的事。因此 v2 的编译器改动集中在 **comptime 求值系统**（支持 `type` 值 + `inline for`），而非代码生成。

### 4.5 与遗留 `ti_*`/`fi_*` 的关系（deprecated, retained）

- `ti_*`/`fi_*` 是**已废弃、暂时保留**的遗留 API，**不在本设计范围**：本设计**不删除、不修改**它们。
- 新增的字段投影 + `inline for` 路径与 `ti_*`/`fi_*` **并行共存**：用户既可继续调用旧函数（过渡期兼容），也可直接用 `info.Struct.field_names` / `inline for (field_types)`。
- 后端对废弃 `ti_*`/`fi_*` 的内联/定义分支（`tir_to_ll.tc:1915/2020`、`codegen_c.tc` `c_ti_emit_support`）**维持现状、暂不动**；待新 API 稳定后，作为**独立清理任务**再移除。

### 4.6 Bool / 非聚合的 comptime 处理

`Bool` arm 无 payload（`variant TypeInfo { Bool; … }`），`match` 直接命中、无需 meta。`Enum`/`Union` 同理携带各自的并行数组（`Enum`: `field_names`+`field_values`；`Union`: `field_names`+`field_types`+`field_attrs`）。运行期仅聚合类型暴露 `field_*` 数组，非聚合在 `match` 的 `_` 分支处理。

### 4.7 ⭐ as-built（2026-10-11）：`TypeInfo` 作为**内建可 match 变体**

本节记录**当前已落地、经双后端 golden 验证**的真实形态（`examples/typeinfo_proj.tc`，双后端均输出 `4 / 7 / 40 / 100`，exit `4`），与目标形态（§4.2–§4.3）的差异在此钉死，避免后续读者按 §4.2 写代码落空。

#### 4.7.1 用户可见语法

```t
struct Point { x: i64 @ 1; y: i64 @ 2 = 42; z: i64 @ 3; label: string @ 4; }

var ti: TypeInfo = type_info(Point);                  // 无 `@`，是运行期内建，非 @type_info
var n:    i64 = match (ti) { Struct(m) => m.field_count  _ => -1 };   // 4
var kind: i64 = match (ti) { Struct(m) => m.kind         _ => -1 };   // 7  (Struct)
var size: i64 = match (ti) { Struct(m) => m.size         _ => -1 };   // 40 (sizeof(Point))
var k:    i64 = match (type_info(i64)) { Int(_) => 100  Struct(_) => 200  _ => -2 }; // 100
```

- **arm 名是裸名**（`Struct(m)`），不是 Zig 的 `.Struct(s)`——见 §4.1 语法更正。
- **载荷 `m` 的类型是 `*TypeMeta`**，不是 §4.2 的 `StructInfo`。可用字段：
  `name: string`、`size: i64`、`kind: i64`、`field_count: i64`、`fields: []FieldInfo`。
- `FieldInfo`：`name: string`、`offset: i64`、`type_name: string`、`type_size: i64`、`is_ptr: i8`、`tag: i64`。
- 指针接收者**自动解引用**：`m.field_count` 语义等于 C 的 `m->field_count`、LLVM 侧由后续 GEP 承接。
- `_` 兜底臂按 tag 真实分发，不是无条件命中首臂。

#### 4.7.2 注入模型（为何它不是普通 variant）

`TypeInfo` / `TypeMeta` / `FieldInfo` 由 `sema.ensure_reflection_builtins`（`src/sema.tc:1410`）登记在
**global_scope 符号表**，但**刻意不入 `lex.decl_list`**：

- 入 `decl_list` ⇒ 用户编译单元会重复定义 `%TypeInfo` / 出现 `UNKNOWN_TYPE: string`；
- 不入 `decl_list` ⇒ 所有**扫 `decl_list` 的下游逻辑都看不见它**，这正是本次修复的全部坑源。

由此产生的**三处必须显式补偿**：

| 位置 | 缺什么 | 修法 |
|------|--------|------|
| `t_td_is_variant`（`src/tir.tc`） | 只扫 `decl_list` 认不出注入变体 ⇒ `tir_st_of_td` 回落 `%TypeInfo` 值槽，而 `TIR_OP_TYPEINFO` 返回的是**指向 variant 数据的指针** ⇒ 变量槽存地址，后续 `load i64` 拿地址去比 tag ⇒ 条件恒假、全落 `_` 臂 | 在**唯一真相源** `t_td_is_variant` 里前置 `tir_is_reflection_variant(td)` 判定（下游 8 个调用点全部继承） |
| conpat 载荷 LOAD（`src/tir.tc`） | arm 载荷是 `*TypeMeta`（**指针值**）而非内联 blob ⇒ 需**两次**解引用；后端 `TIR_OP_LOAD` 的穿透解引用仅在 `pst(源槽) == "ptr<" + st + ">"` 时触发 | TypeInfo臂的 LOAD `st` 令为 `"ptr"`，使源槽 `st("ptr<ptr>")` 匹配成立 ⇒ 得到 `*(&payload)` = meta 指针 |
| `c_ti_emit_support`（`src/codegen_c.tc`） | 用户 TU 无 `TypeInfo` 的 `VariantDecl` ⇒ `emit_variant_decl` **不会**生成 `<V>_is_<C>` / `<V>_as_<C>`；且 `build_type_map` 扫不到 `TypeMeta` ⇒ `sf_*` 无其字段表 ⇒ match 结果槽退化 `void*` | 合成 11 个 `is_` + 10 个 `as_`（`Bool` 无载荷故不生成 `as_`），并按 `.h` typedef **逐字**向 `sf_*` 补登记 `TypeMeta`/`FieldInfo` 字段 TD |

#### 4.7.3 与遗留 API 的组合

`ti_*`/`fi_*` 仍可用，且**可与 `match` 混用**。曾有一个 TypeInfo 特有的坑：遗留调用在 `match` 之前时，
scrutinee 变量的登记类型退化为裸 `ptr`（丢掉 `ptr<%TypeInfo>` 内类型），导致 GEP 基类型变成 `ptr`
⇒ `invalid getelementptr indices`。修法是在 `scr_base` 计算后对 TypeInfo 做**无条件基底物化**
（再也不能靠"检查 slot st 先验命中"来跳过，因为降级发生在**后端 llname 注册表**而非 TIR 的 `g_local_sts`）。

---

## 5. 模块职责与代码组织（v2 目标）

| 层 | v2 目标改动 |
|----|-------------|
| `base.tc` | 新增 `TypeInfo` **variant**（§4.1）+ `StructInfo`/`EnumInfo`/… 带 `field_types: []type` 并行数组（§4.2）；**不动** `ti_*`/`fi_*`（遗留保留） |
| `sema.tc` | `@type_info` 元函数返回 **comptime `TypeInfo` variant 类型**（而非 v1 的运行时 variant 类型）；`ti_mk("TypeInfo")` 改为 variant 类型 |
| `hir.tc` / `tir.tc` | 操作码 + 发射**不变**（`@__ti_<T>` 仍由后端合成） |
| **comptime 求值系统**（新增） | 支持 `type` 一等值 + `inline for` 展开 `[]type`；`@type_info(T).Struct.field_types[i]` 在 comptime 求值为具体 `type` |
| `tir_to_ll.tc` | 继续物化**运行时派生数组**（`@__ti_<T>` 全局：names/offsets/type_names/tags）；**删** `ti_*`/`fi_*` 内联分支（独立清理） |
| `codegen_c.tc` | 同上；遗留 `ti_*`/`fi_*` 访问子**暂不动**（独立清理） |
| `runtime/` | 不变（始终不含 `ti_*`/`fi_*`） |
| `examples/` | 新增 comptime `inline for` 用例 + 保留 runtime 派生数组用例 |
| `tests/ir_baseline.json` | 仅当改动后端运行时布局时才 `--update` 重录（comptime 层不进 IR 布局） |

---

## 6. 迁移路线（分阶段，每阶段可独立验证）

| 阶段 | 内容 | 验证判据 | 状态 |
|------|------|----------|------|
| **0** | v1 A-fix 运行时反射落地（C 后端自包含发射 + 双后端一致） | 四代不动点；`run_examples` **91/91** | ✅ 已完成（提交 `e89e2eb`） |
| **0b** | **TypeInfo 成为真正可 match 的内建变体**：`Struct(m) => m.field_count` 字段投影；C 后端合成 `is_`/`as_` 访问器 + `sf_*` 补登记；遗留 `ti_*` 与 `match` 可混用 | `examples/typeinfo_proj` 双后端均 `4/7/40/100`（exit 4）；`run_examples` **93/93**；四代不动点 `g2==g3==g4` | ✅ 已完成（见 §4.7） |
| **1** | **语言能力前置**：引入 comptime `type` 一等值 + `inline for` | comptime 单测：`inline for (s.field_types) |Ft|` 可展开并实例化 | ⬜ 待做（本改版核心门槛） |
| **2** | `@type_info(T)` 返回 comptime `TypeInfo` variant（§4.1）；`StructInfo` 带 `field_types: []type` + 运行时派生数组（§4.2） | 编译期 `@type_info(Point).Struct.field_types[0] == i64` 成立 | ⬜ 待做 |
| **3** | 示例：comptime `inline for` 用例 + runtime 派生数组用例；`ti_*`/`fi_*` **仍保留** | 双后端逐字节一致 | ⬜ 待做 |
| **4** | IR 基线重录 + `gate L2`（含 `cself`，需先解 L-09） | gate 全绿 | ⬜ 待做 |
| **5（独立清理，非本设计）** | 删 `base.tc` 的 `ti_*`/`fi_*` + 后端内联分支 | `run_examples` 仍全绿 | ⬜ 后续 |

> 本设计只覆盖"对齐 Zig 0.16 的 comptime 反射 + 保留运行时派生层"，**不含删除旧函数**；旧 `ti_*`/`fi_*` 清理列为独立阶段 5。

---

## 7. 开放问题 / 决策点

- **Q1（关键门槛）**：t 的 comptime `type` 一等值如何表示与比较？需 comptime 系统能持有一"类型"作为值（类似 Zig 的 `type`），并在 `inline for` / `match`（`.Struct(s)` 等 variant arm）中分发。→ 决定阶段 1 的实现形态。
- **Q2**：`inline for` 语义——是否要求切片长度 comptime-known？`field_types` 长度由类型决定、天然 comptime-known，满足。
- **Q3**：是否保留 `type_info(T)`（运行时）作为 `@type_info(T)`（comptime）的别名/孪生？建议：`@type_info` 为 comptime 主入口，`type_info` 保留为运行时派生层入口（v1 行为），二者共用 `@__ti_<T>` 物化。
- **Q4**：是否扩展 `type_info` 到 enum / union / slice 聚合？→ v2+，不在本次（诊断 `T-CDE-E910 "type_info supports struct only (codegen)"` 保留）。

---

## 8. 遗留问题（非本次回归，独立待办）

- **L-09（C 后端已知类缺陷）**：`gate L2` 的 `cself` 步仍失败。`base.tc` 自身反射 API `base__ti_field_count`/`base__ti_field` 返回值捕获临时量退化成 `void*`。
  → **部分缓解（2026-10-11，阶段 0b）**：`expr_type_desc` 的 member 分支原先**完全不处理指针接收者**（一律落 `named` 判定 ⇒ unknown）。现已补「剥一层指针」+ 在 `c_ti_emit_support` 里向 `sf_*` 补登记 `TypeMeta`/`FieldInfo` 字段 TD，故 **TypeInfo conpat 载荷上的字段投影**已不再退化（`examples/typeinfo_proj` 实证 `int64_t _tmrN`）。
  → **仍未覆盖**：`base.tc` **自编译（cself）**路径下 `ti_*` 返回值捕获的退化是同源问题的另一实例，本次未触及，仍属独立待办。
- `examples/type_info_demo.expected.txt` 的 struct `kind` 已重录为 `7`（两端实际均为 7，原 `0` 是 stale golden）——非回归。

---

## 9. 验证判据（落地前必须满足）

1. **四代自举不动点**：`g2.ll == g3.ll == g4.ll`（md5 一致）。
2. **comptime 单测**：`@type_info(Point).Struct.field_types[i]` 在编译期求值为具体 `type`（如 `i64`）；`inline for` 可展开并实例化字段类型。
3. **双后端 golden**：`node tools/run_examples.mjs --compiler out/dbg/g3.exe` → **91/91** 逐字节一致（含 `tagid_typeinfo` / `type_info_demo`）。
4. **`cself` 全绿**（依赖 L-09 修复）：`g4.exe compile src/tc.tc --emit-c` → clang 链接成功。
5. **IR 基线**：仅当改动后端运行时布局时，须 `tools/ir_snapshot.mjs --compiler out/dbg/g3.exe --update` 重录。

---

*附：v1（A-fix 提交 `e89e2eb`）已使阶段 0 达成；v2 改版新增 comptime `type` 值 + `inline for` 消费模型（阶段 1–3），对齐 Zig 0.16 的 `@typeInfo` 并行数组设计，并保留运行时派生层以延续 t 的运行时反射能力。*

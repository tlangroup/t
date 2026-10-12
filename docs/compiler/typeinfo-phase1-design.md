# 阶段 1 实现设计（Q1 落地方案）：comptime `type` 一等值 + `inline for`

> 配套文档：`docs/compiler/typeinfo-design.md`（v2 设计稿，§6 路线 / §7 开放问题 Q1–Q4）。
> 本文落定 §6「阶段 1」与 §7 Q1 的**具体实现方案**，供评审；确认后再落码。
> 实测依据是已存在的编译器实现，行号以 `src/sema.tc` 当前版本为准。

---

## 0. 目标与范围

- **目标**：对齐 Zig 0.16 的 `@typeInfo` 消费模型——`type` 成为编译期一等值，`inline for` 在编译期展开，配合 `@type_info(T)` 的 comptime `TypeInfo` variant + `field_types: []type`。
- **不在本设计**：
  - 删除 `ti_*`/`fi_*`（设计稿阶段 5，独立清理）。
  - enum / union / slice 反射扩展到 comptime（v2+，设计稿 §7 Q3/Q4）。
  - 运行时反射层（v1 已落地，`type_info(T)` 继续保留为运行时入口）。

---

## 1. 现状盘点（已实测，非假设）

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| type 值在 meta_eval 内部 | **已支持**：ident 是类型名 → `type_node_from_ident` 返回类型描述符节点 | `sema.tc:11874`（`is_type_name` 分支） |
| `@type_val("i64")` 产 type 值 | **已支持**，标注 P4「类型即值」 | `sema.tc:13969` → `type_node_from_ident` |
| `comptime { }` 块编译期执行 | **已支持** | `meta_run_block` `sema.tc:13341` → `meta_exec` |
| `comptime fn` 机制 | **已存在** | `sema.tc:6394`、泛型 `comptime T: type` 形参 `sema.tc:1693` |
| 裸类型名当值（如 `i64` 作值） | **不支持**：sema `check` 阶段先报 `T-SEM-E201` 未定义标识符 | 探针：`comptime { var b = i64 == i64; }` 仍报 E201 |
| type 值间 `==`/`!=` | **不支持**：报 `T-MTA-E617`「操作数类型不一致」 | 探针：`i64 == i64` 在 comptime 块内仍 E617 |
| `var x: type = ...` 持有 type 值 | **不支持**：`type` 未被接受为「持有 type 值」的标注 | — |
| `inline for` 语法/展开 | **完全不存在**：parser 直接报「期待分号，读到 for」 | 探针：`inline for (...) |x| {...}` 解析失败 |
| `@type_info(T)` 返 comptime variant + `[]type` | **未做**：当前 `@type_info` 复用运行时反射路径（`TIR_OP_TYPEINFO` → `@__ti_<T>`），不返 comptime `TypeInfo` variant 也不含 `[]type` | `parse.tc:5347`、`tir.tc:3188` |

**结论**：Q1 的「type 值表示」骨架已在 meta_eval 层存在（type 值 = 类型描述符节点），缺口在 **sema 把类型名当值的路由**、**值间比较**、**变量持有与代码期擦除**、以及 **`inline for` 展开**。这是「接通」工作，不是「从零设计表示」。

---

## 2. Q1 方案：type 作为一等 comptime 值

### 2.1 表示（复用既定，不新增节点种类）

- **type 值 = 类型描述符 AST 节点**：`scalar`（`i64`/`u32`…）或 `named`（`Point`/`Foo`…）节点，由 `type_node_from_ident(name)`（`sema.tc:1716`）产出。
- **规范名提取**：`scalar` → `node_sa`；`named` → `node_sa`。比较按规范名相等（`i64` 与 `i64` 相等，`i64` 与 `u64` 不等）。
- **静态类型标注**：持有 type 值的表达式静态类型记为 `Type`（与 `@type_val`/`@type_of` 当前的 `ti_mk("Any")` 对齐，建议统一为 `Type` 以明确语义）。

> 这与 Zig 一致：`type` 在 t 里是「零运行时表示」的编译期值，不分配运行时槽。

### 2.2 裸类型名即值（surface syntax）

- 在 **comptime 上下文**（定义见 §2.5）内，`is_type_name(ident)` 为真的 ident 视为合法 comptime 值，路由到 `meta_eval`（其 `ident` 分支 `sema.tc:11871` 已能处理）。
- **实现位置**：`sema` 的 ident 解析处，若当前处于 comptime 上下文且 `is_type_name(sa)`，则跳过 `T-SEM-E201`，把该节点标记为 comptime 值（静态类型 `Type`），不参与运行期名字查找。
- **等价关系**：`i64` ≡ `@type_val("i64")`；`Point` ≡ `@type_val("Point")`。保留 `@type_val` 作为显式拼写，裸名是语法糖。

### 2.3 比较 `==` / `!=`

- `meta_eval_binary`（`sema.tc:12231`）增补分支：两操作数均为 type 值节点 → 取规范名比较，返回 `bool` 字面量节点；`!=` 取反。
- **不冲突**：现有 `==` 仅处理标量 / 指针 / 字符串；type 值走新分支（靠操作数种类判定），互不影响。
- 越界/退化：任一操作数非 type 值且另一为 type 值 → `meta_fail`（类型不一致）。

### 2.4 变量持有 type（`var x: type = ...`）

- `sema` 接受 `type` 作为类型标注，语义为「该变量持有 type 值」，静态类型记为 `Any`（与 `@type_val`/`@type_of` 返回类型一致，type 值无独立运行时类型）。
- **编译期绑定 + 代码期擦除（核心）**：`cs_var_decl` 在 `check` 阶段对「标注节点 kind == `type`」的局部变量，于编译期用 `meta_eval` 求值其初始化器（须为编译期已知类型，否则 `T-MTA-E617`）得到 type 值节点，登记进 `g_cvar`（平栈：`g_cvar_name`/`g_cvar_val`/`g_cvar_n`，显式计数器避免 `len()`→`t_len` 链接坑）与 `g_skip_var`（擦除集合）。引用处（`infer_expr` / `meta_eval` ident 分支）命中 `cvar_find` 即返回该 type 值节点（静态 `Any`）。
  - **管线顺序关键点**：`meta_pass` 执行 comptime 块的时机早于 `check` 阶段语句遍历（`cs_var_decl` 注册 var）。故 `meta_pass` 进入 `meta_walk_list` 前，先以 `meta_register_cvars_of` 预扫描函数体、把运行期作用域的 `var x: type` 预注册进 `g_cvar`（与 `cs_var_decl` 同款求值逻辑），求值结束后回弹 `g_cvar_n` 避免跨函数泄漏。否则 comptime 块内引用运行期 `var t: type` 会报 `T-MTA-E620`。
  - **双后端擦除**：C 后端 `emit_stmt` var_decl 分支、LLVM 后端 `tir_emit_stmt` var_decl 分支，均以 `sema.skip_var_has(sid)` 拦截，跳过该变量槽位分配（type 零运行时表示）。
- **逃逸检查**：若 type 值被运行期上下文直接使用（裸引用在 comptime 之外，如 `if (t == i64)` 写在函数运行期作用域）→ `infer_expr` 走普通未解析分支报 `T-SEM-E201`（裸类型名逃逸），属预期运行时逃逸缺口（type 无运行时表示）。comptime 上下文内引用则始终解析到编译期 type 值。

### 2.5 与现有 comptime 机制衔接

- 复用 `meta_run_block` / `meta_exec` / `meta_eval` 框架，**不新建并行机制**。
- comptime fn 返回 type：函数返回类型标注 `type`，`meta_eval_call`（`sema.tc:12902`）返回 type 值节点（其 `ident` 分支已支持；call 结果按返回标注 `Type` 流动）。
- 「comptime 上下文」定义：① `comptime { }` 块体内；② `comptime fn` 函数体；③ 带 `comptime` 形参（如 `comptime T: type`）的作用域内；④ 由上述任一上下文内联展开的 `inline for` body（见 §3）。

---

## 3. `inline for` 设计

### 3.1 语法

```
inline for (iterable) |elem|        { body }
inline for (iterable) |elem, idx|   { body }   // idx: 编译期索引 i64
```

- `iterable` 须为 **comptime-known 集合**：comptime 数组字面量、`@type_info(T).Struct.field_types`、`@type_val(...)` 序列等经 `meta_eval` 求值为数组值者。
- `elem` 绑定每个元素（可为 type 值或普通字面量）；`idx` 绑定编译期索引 `i64` 字面量。

### 3.2 语义与展开

1. 编译期对 `iterable` 求值（`meta_eval`）→ comptime 数组值（`array_lit` 节点，元素为字面量 / type 值）。
2. 对每个元素 `i`：
   - **克隆** body 语句链（参考 `meta_val_copy` / `clone_kids` 的克隆策略，避免复用节点污染模板）；
   - 将 `elem` 绑定到元素值（`menv_push`）；`idx`（若提供）绑定到 `i`（`mv_int`）；
   - 在编译期 meta 解释器内执行 body（`meta_exec`）。
3. 展开方式（S4 实装）：body 的**编译期副作用**（`@compile_log` / comptime 计算 / 类型分派）在编译期落定，`inline for` 节点本身**不产生运行期循环代码**。这正好覆盖 Q1「编译期类型分派 / 编译期日志」场景——`inline for (@type_info(T).field_types) |F| { if (F == i64) {...} }` 的每个 `F` 都是真实 type 值，在编译期完成判别。
   - ⚠ 限制（Q1 范围内可接受，留待后续）：若 body 含需发射为运行期代码的语句（如 `println(x)`），当前实现会在**编译期**执行之而非 unrolling 为运行期展开代码。运行期体 unrolling（AST 原地替换）按需补全。
4. `iterable` 非 comptime-known → 报 `T-MTA-E622`「inline for 的 iterable 必须是编译期已知数组」。

### 3.3 实现位置

- `parse.tc`：新增 `inline_for` 节点（`base.mk_inline_for`，子槽 `sa`=元素名 / `sb`=索引名 / `na`=iterable 表达式 / `la`=语句链 head，与 `for`/`for_each`/`comptime_block` 同构）；`parse_statement` 在 `KwComptime` 之后分流 `inline for`（即 `inline` ident 后跟 `KwFor`）。
- `sema.tc`：`meta_exec` 内 `inline_for` 分支调 `meta_run_inline_for`（新增）——对 `na` 求值、逐元素 `clone_kids(la)` 克隆体语句链、`menv_push` 绑定 elem/idx、`meta_exec` 执行；`break`/`continue`/`return` 由 `meta_exec` 既有协议消费（`return` 向上传播，其余终止/跳过本次展开）。`meta_walk` 对 `inline_for` 直接 return（体在展开期才求值，避免 elem 未绑定时误折叠）。仅允许出现在 comptime 上下文（`meta_pass`/`meta_walk_list` 展开 comptime 块时才会触达 `meta_exec` 的 `inline_for` 分支；运行期上下文的 `inline_for` 节点对后端是未知节点 → 自然报错）。
- 复用 `meta_eval`（数组求值）+ `meta_exec`（body 执行）+ `clone_kids`（体克隆），与既有 comptime 框架一致；`idx` 默认不绑定。

### 3.4 与 type 值的协同

- `inline for (@type_info(Point).Struct.field_types) |F| { if (F == i64) { ... } }`：`F` 是真实 type 值，可 `==` 比较、可作为 `@size_of(F)` 等内建实参 —— 正是 Zig 0.16 的消费模型。

---

## 4. 阶段 2 衔接：`@type_info` 返回 comptime `TypeInfo` variant

- `@type_info(T)` 在 comptime 返回 **`TypeInfo` variant 值**（0c 已使 `TypeInfo` 真正可 `match`，见设计稿 §4.7）；`StructInfo.field_types` 为 `[]type`（comptime 数组，元素是 type 值）。
- **消费验证**：`@type_info(Point).Struct.field_types[0] == i64` 成立；`inline for (...field_types) |F| { ... }` 可分发。

### 4.1 现状缺口（落码前摸底结论）

- **CTFE 值模型无 struct/variant 值表示**：现有 comptime 值只有标量（int/bool/string/float）、`array_lit`（元素是值）、type 值（`typeinfo` 节点）。`meta_eval_member`（sema.tc:11939）**仅**处理 `Enum.Member`→整型；`meta_eval_index`（sema.tc:12153）已支持 `array_lit[i]`（返回元素值）——故 `[i]` 对 `field_types` 数组**已可用**（S4 已验证）、type 值 `==` 已可用（S2）。
- **`@type_info(T)` 当前（落码前）由 parser 物化为 `typeinfo` 节点**（kind="typeinfo"，sa=类型名，type=g_ti_TypeInfo_ti），不是 variant 值，故 `.Struct` 访问不成立。**已解决**：保留 `typeinfo` 物化、在 `meta_eval` 新增 `typeinfo` 分支把它折叠为 `ct_variant`（`TypeInfo` variant 值），详见 §4.2.3 / §6 S5。运行时 `type_info(T)`（TIR_OP_TYPEINFO）与 `@type_info(T)`（comptime）仍两条独立路径。
- **运行时 `type_info(T)`（TIR_OP_TYPEINFO）与 comptime `@type_info(T)` 是两条独立路径**：现有示例（`tagid_typeinfo.tc` / `typeinfo_*.tc` / `type_info_demo.tc`）全部走运行时 `type_info(T)`，改造 `@type_info` 的 comptime 返回值**不会破坏任何示例**。

### 4.2 方案：通用 comptime 值模型（用户裁定，阶段 2 实装）

> 评审裁定：**不采用 scoped（反射专用）方案**，改建一套**通用的 comptime struct/variant 值系统**
> （`ct_variant` + 复用既有 `struct_lit`）。这样 struct/variant 值可服务任意编译期场景（含 v2 enum/union
> 反射），而非仅反射专用。下方为**实际落码**后的设计，与 §4.2 原 scoped 草稿不同。

1. **新增节点 `ct_variant`（comptime 变体值，通用）**（`base.mk_ct_variant`，sema.tc:3534 同款）
   - `sa` = variant 类型名（`"TypeInfo"`）。
   - `sb` = tag/case 名（`"Struct"` / `"Int"` / …）。
   - `na` = 载荷值节点（-1 = 无载荷，如 Bool arm）；Struct 时为 `struct_lit` of `TypeMeta`。
   - 与既有 `struct_lit`（comptime 结构体值，§4.2.2）共同构成通用 comptime 值表示；成员访问在 `meta_eval_member` 统一处理。

2. **TypeMeta 载荷复用既有 `struct_lit`（comptime struct 值），不新增 `ct_struct` 节点**
   - `struct_lit{ sa="TypeMeta", la=FV 链 }`，每项 `FV{ sa=字段名, na=值节点 }`。
   - 直接复用 `meta_eval_struct_lit` / `__mk_FV` 已有的 FV 机制（sema.tc:12178、12245）。
   - 字段：`name:string` / `size:i64` / `kind:i64`(arm code) / `field_count:i64` / `fields:[]FieldInfo`(占位空数组) / `field_types:[]type`。

3. **`@type_info(T)` 的 comptime 值构造**（sema.tc 辅助 `ti_arm_code`/`ti_arm_of`/`build_typemeta_value` + `meta_eval` 的 `typeinfo` 分发）
   - parser 仍把 `@type_info(T)` 物化为 **`typeinfo` 节点**（sa=类型名，与运行时 `type_info(T)` 同形，见 §4.1）；
     **不在 parser 改 mbuiltin**，而是在 `meta_eval` 新增 `typeinfo` 分支：提取 `sa`=类型名 →
     `type_node_from_ident` → `ti_arm_of` 取 arm → `build_typemeta_value` 构造 `struct_lit{TypeMeta}` →
     `mk_ct_variant("TypeInfo", arm, payload)`。
   - **Struct 载荷**：`field_types` 由 T 的声明字段类型在编译期**合成 `array_lit` 的 type 值**（每元素
     `type_node_from_ident(字段类型名)`——与 S1/S2 同源），存于 `struct_lit.field_types` 字段。
   - 其余 kind（Int/Float/…/Union）返回带空 `field_types` 的 `ct_variant`（首切只保证 Struct 链路，验证达标即可；其它 kind 后续补全）。
   - ⚠ 与运行时 `type_info(T)`（`TIR_OP_TYPEINFO` → `@__ti_<T>`）**两条独立路径、互不干扰**：`meta_eval`
     只在 comptime 上下文被调用，运行期 `type_info(T)` 不触达，故既有示例零回归。

4. **`meta_eval_member` 扩展**（sema.tc:11939）
   - 对象为 `struct_lit`：在 `la` 的 FV 链按 `sa` 找字段 → 返回其值（`na`）。
   - 对象为 `ct_variant`：若 `e.sa`（访问名）== `node_sb(obj)`（tag）→ 返回 `node_na(obj)` 载荷；否则 `meta_fail`（T-MTA-E617，"variant case 不匹配"）。
   - 链式 `@type_info(Point).Struct.field_types`：先 `ct_variant`→`.Struct`→`struct_lit`，再 `struct_lit`→`.field_types`→`array_lit`。

5. **`[i]` 与 `==`**：由既有 `meta_eval_index`（array_lit）与 S2 type 值比较承接，无需改动。

### 4.3 落码顺序（实际执行，独立可验证、逐提交）

1. 加 `ct_variant` 节点构造器（`base.mk_ct_variant`，sa=variant名 / sb=tag / na=载荷）。
2. `meta_eval_member` 扩展（struct_lit 字段 / ct_variant case 提取，先于原 Enum.Member 分支）。
3. `meta_val_copy` 扩展（struct_lit 递归 / ct_variant 拷贝），保证 inline for / 多次调用不污染模板。
4. 辅助 `ti_arm_code`/`ti_arm_of`/`build_typemeta_value`（arm 词表对齐 codegen_c.c_ti_arm；Struct 走 `find_struct_fields` 合成 type 值数组）。
5. `meta_eval` 新增 `typeinfo` 分发 → 产 `ct_variant`（保留 parser 的 typeinfo 物化，不动运行时路径）。
6. `TypeMeta` 结构体补 `field_types: []type` 字段（ensure_reflection_builtins，sema.tc:1421；comptime 路径不进运行时布局故无 IR 漂移）。
7. 示例 `examples/type_info_comptime.tc` + 探针 5 验证。

### 4.4 风险与回退

- **风险 A**：`meta_eval_member` 现有 `Enum.Member` 分支须保留；新增 ct_struct/ct_variant 分支须在 `na` 是 ident 且 sym 是 Enum 的判定**之后**插入，避免串味。
- **风险 B**：`type_node_from_ident` 合成的 type 值须与 `is_type_name`/S1-S2 路径完全一致（同一底层 `typeinfo` 节点语义），否则 `field_types[0] == i64` 不成立。
- **回退**：任一步 `tc check src/tc.tc` 失败即回退该步，不污染后续；本改动仅改 comptime 求值，不改 `TIR_OP_TYPEINFO` 运行时路径，故 `run_examples` 既有示例应零回归。

---

## 5. 验证与门禁（每子步必跑）

| 验证项 | 判据 | 说明 |
| --- | --- | --- |
| 自举守护 | `tc check src/tc.tc` → 0 error | 改 `sema`/`parse` 后**必跑**；编译器自身源码进产物，6 entry 合法漂移 |
| 小探针 | `comptime { var b = i64 == i64; }` 等 | 每子步针对性探针 |
| 双后端一致 | `run_examples`（默认 `out/dbg/tc.exe`）93/93 | 既有门禁 |
| 四代不动点 | `g2.ll == g3.ll == g4.ll`（md5） | 自举不动点 |
| IR 基线 | 仅当改动运行时布局才重录 | 本阶段多为编译期展开，通常**不**触发重录 |
| gate L2 | 全绿（含 cself，依赖 L-09） | 末端验收 |

**探针清单（落码前先建，落码后逐个过）**：
1. `comptime { var b: bool = i64 == i64; println(int_to_str(b)); }` → 输出 `1`
2. `comptime fn first_ty(comptime T: type, comptime U: type) type { return T; }` + `first_ty(i64, u32) == i64` → `1`
3. `var t: type = i64;`（在 comptime 上下文持有）→ 不分配运行时槽，可被 `==`/内建消费
4. `inline for ([i64, u32, bool]) |F| { /* F == i64 分支 */ }` → 展开为 3 段 body ✅（输出 `got i64 / got u32 / got bool`）
5. `inline for (@type_info(Point).Struct.field_types) |F| { if (F == i64) {...} }` → 按字段类型分发

---

## 6. 子步骤拆分（提交粒度，独立可验证）

- **S1 裸类型名即值** ✅（已落地，commit 见主设计文档 §8）：sema 在 comptime 上下文把 `is_type_name` 的 ident 路由为 comptime 值（§2.2）。验证：探针 1 `comptime { var same=i64==i64; var diff=i64==u32; if (same && !diff){} }` 经新编译器 `check`/`run` 0 error；`g2 check src/tc.tc` 0 error；自举不动点 g2≡g3≡g4（LLVM IR md5 一致）；`run_examples` 110/110 双后端通过。
- **S2 type 值 `==`/`!=`** ✅（与 S1 同 commit）：`meta_eval_binary` 增补 type 值比较分支（§2.3，`meta_node_is_type` 辅助，按 `node_sa` 规范名比较返回 bool 字面量）；meta 折叠 `i64 == i64` → `true`。探针 1 通过。
- **S3 `var x: type` 持有 + 代码期擦除** ✅（commit 见本文件 §8 / 主设计文档）：`cs_var_decl` 对 `type` 标注变量编译期求值初始化器并登记 `g_cvar`/`g_skip_var`；`meta_pass` 以 `meta_register_cvars_of` 预扫描函数体解决管线顺序（comptime 块早于 cs_var_decl）；`infer_expr`/`meta_eval` ident 分支经 `cvar_find` 解析；C/LLVM 双后端 `skip_var_has` 擦除槽位（§2.4）。验证：`examples/var_type_comptime.tc` 经新编译器 `check` 0 error、comptime 块正确解析运行期 `var t: type` 并打印两条 `@compile_log`；双后端 smoke 对拍通过；`g2 check src/tc.tc` 0 error；自举不动点 g2≡g3≡g4（LLVM IR md5 一致 `d3d8e84…`）；`run_examples` 110/110 双后端通过。逃逸缺口（`var t: type` 在运行期作用域直接引用）仍报 `T-SEM-E201`，符合预期。
- **S4 `inline for` 解析 + 编译期展开** ✅（commit 见本文件 §8 / 主设计文档）：parser 新增 `inline_for` 节点（`mk_inline_for` + `parse_inline_for_stmt`，`|` 分隔 elem/idx，`|e,i|` 支持可选索引）；`meta_run_inline_for` 对 comptime 数组逐元素 `clone_kids` 克隆体语句链、`menv_push` 绑定 elem（/`idx`）、`meta_exec` 执行；`meta_exec` 内 `inline_for` 分支接入、`meta_walk` 跳过其体；iterable 非数组值报 `T-MTA-E622`（§3）。验证：`examples/inline_for_comptime.tc`（值数组 + 类型数组两场景）经新编译器双后端 smoke 对拍通过；`_t_s4_i64.tc` 输出 `elem=1 idx=0 / elem=2 idx=1 / elem=3 idx=2`，`_t_s4_type.tc` 输出 `got i64 / got u32 / got bool`；`g1.exe check src/tc.tc` 0 error（529 warn）；自举不动点 g2.ll≡g3.ll≡g4.ll（LLVM IR md5 一致 `9faf35fe…`）；`run_examples` 112/112 双后端全绿。根因修正：`inline_for.la` 是「语句链 entry 头」而非节点，故须用 `clone_kids` 克隆链——首版误用 `clone_node(entry)` 导致 `meta_exec(-1)` 空转、体永不执行（已修）。
- **S5 `@type_info` 返 comptime `TypeInfo` variant + `field_types: []type`** ✅（commit 见本文件 §8 / 主设计文档）：通用 comptime 值模型（`ct_variant` + 复用 `struct_lit`）；parser 仍物化 `@type_info(T)` 为 `typeinfo` 节点，改在 `meta_eval` 新增 `typeinfo` 分支产 `ct_variant`（§4.2.3，不动运行时 `TIR_OP_TYPEINFO` 路径）。`meta_eval_member` 扩展 struct_lit 字段 / ct_variant case 提取，`meta_val_copy` 扩展保证 inline for / 多次调用不污染模板；辅助 `ti_arm_code`/`ti_arm_of`/`build_typemeta_value` 构造 TypeMeta 载荷（Struct 走 `find_struct_fields` 合成 `field_types:[]type`）。验证：`examples/type_info_comptime.tc` 经新编译器**双后端**（`build` LLVM / `compile --emit-c` C）实跑均输出 `field0 is i64` / `field1 is i64` / `got i64 field`×2，证明 `@type_info(Point).Struct.field_types[0] == i64`、`inline for (...field_types) |F| { if (F == i64) ... }` 全部成立；`tc check src/tc.tc` 0 error（529 warn）；自举不动点 g2.ll≡g3.ll（LLVM IR md5 一致）；`run_examples` 双后端全绿。根因修正：前序把 `@type_info` 处理器写在 `meta_eval_mbuiltin` 的 `type_info` 分支，但 parser 实际产出 `typeinfo` 节点（非 `mbuiltin`），故该分支永不被命中、`meta_eval` 对 `typeinfo` 走 fallback 报 `T-MTA-E617`；修正为在 `meta_eval` 直接分发 `typeinfo` 节点，并删除永不命中的 mbuiltin 死分支。
- **S6 示例 + run_examples + 不动点 + IR 基线 + gate L2**（阶段 3–4）。

> 注：S1/S2 实测发现 `infer_expr` 的 `==`/`!=` 分支（sema.tc:7272）本就对任意操作数类型直接返回 `bool`，故 check 侧无需额外改动；仅 meta 折叠侧（S2）需补 type 值比较。comptime fn 体暂未纳入 `g_in_comptime`（探针仅用 comptime 块），列为 S1 后续补全项。

> 每步独立提交；任一步 `tc check src/tc.tc` 失败即回退该步，不污染后续。

---

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| sema 改动破坏自举 | 每子步 `tc check src/tc.tc` 守护；小步提交 |
| type 值逃逸到运行期 | §2.4 逃逸检查报错，禁止运行时表示 |
| `inline for` 展开复用节点污染模板 | body **克隆**后再绑定（参考 `meta_val_copy`） |
| 双后端 type 值擦除不一致 | S3 单独验收双后端 golden；必要时加 `g_ti_*` 守卫 |
| `==` 新分支与现有语义冲突 | 仅当两操作数均为 type 值节点时走新分支，互不干扰 |

---

## 8. 与 `typeinfo-design.md` 的对应

- 解决 §7 开放问题 **Q1**（comptime `type` 一等值的表示与比较）：本文 §2。
- 解决 §6「阶段 1」：`type` 一等值（S1–S3）+ `inline for`（S4）。
- 解决 §6「阶段 2」：`@type_info` comptime variant（S5）。
- 衔接 §6「阶段 3–4」：示例与门禁（S6）。
- 不改 §6「阶段 5」（ti_*/fi_* 清理）与 §7 Q3/Q4（enum/union 扩展）。

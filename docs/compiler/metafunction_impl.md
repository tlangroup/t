# 元函数 `@import` 与 `@type_info` 实现设计规范

> 配套文档：`docs/compiler/metafunction.md`（元函数概念规范 v3.6）。
> 本文件定义两个复杂元函数的**实现设计**，并列出配套的派发链路改造（D1）。
> 范围严格限于「编译期元函数」；与运行期函数、`comptime fn` 声明标记无关（t 所有函数双栖，`comptime name(...)` 是调用位强制，见规范 §2.2）。

---

## 0. 当前代码事实（已对源码核实，避免架空设计）

| 事实 | 位置 |
|---|---|
| `@`-内置经 `mbuiltin` 节点 → `meta_eval_mbuiltin` 派发 | `src/sema.tc:11820` |
| 运行期 `call` 在编译期上下文 → `meta_eval_call` | `src/sema.tc:11819` |
| `meta_eval_mbuiltin` 已处理 `@type_of`/`@type_val`/`@simd_lanes`/`@compile_error`/类型查询(`@type_size`…)/`@zeroed`/`@str_from_bytes`；未知 → `T-MTA-E607` | `src/sema.tc:13816` |
| `meta_eval_call` 的 `node_bb`(comptime fn) 门禁**已移除**（**D1 已清**，`comptime name(...)` 对任意双栖 fn 可用） | `src/sema.tc:12813` |
| `comptime fn` 语法仍被 parser 接受（`mk_FuncDecl(is_comptime)`），`bb` 侧表多处置位 | `src/parse.tc:2059`, `src/base.tc:1753` |
| `@import("X")` 表达式位已产出 `import_expr` 节点（sa=模块路径），`const m=@import("X")` 绑定模块值，`m.foo` 经 sema 脱糖为 `M__foo` | `src/parse.tc:4645`, `src/sema.tc:6208/9521/10796+` |
| `@module(...)`/`@import("...")` 声明位仍被 `parse_module_decl` 拦截为 `ImportModDecl`/`ModuleDecl` | `src/parse.tc:2314/2354` |
| `type_info(T)` 是**类型位**内建（非 `@`）：`parse.tc:1039` 特判 `name=="type_info"&&LParen` → `typeinfo` 节点(sa=类型名)，后端降为 `@__ti_<T>` 全局常量引用（`codegen_c.tc:2389/5073`, `tir_to_ll.tc:2969/4894`），静态类型 `TypeInfo`(指针) | `src/parse.tc:1039`, `src/codegen_c.tc`, `src/tir_to_ll.tc` |
| `@type_of(e)` 返回 e 的**静态类型**（类型即值节点）；`@type_val("i64")` 把类型名还原为类型节点；二者均在 `meta_eval_mbuiltin` | `src/sema.tc:13818/13833` |

结论：`@import` 的模块值机制**已实质落地**（缺的是向元函数模型的「名分」统一）；`@type_info` 是**新增**的 `@`-前缀元函数，复用既有 `type_info` 节点/常量合成基础设施。

---

## 1. 派发链路改造 D1：`@` 仅解析内建，`comptime` 强制任意双栖函数

**目标（规范 §2.2 / §3）**：`@name(...)` 一律是编译期内建，`@` 是名字一部分；普通双栖函数经 `comptime name(...)` 在编译期执行，不需要任何 `comptime fn` 声明标记。

**改动点（仅 `meta_eval_call`）**：

移除 `src/sema.tc:12813-12816` 的 `node_bb` 门禁：
```t
// 删除：
if (base__node_bb((sy.decl as u64)) == false) {
    return meta_fail("T-MTA-E618", "...要求被调方以 `comptime fn` 声明", e);
}
```
- 保留 `sym_lookup` → `FuncDecl` 判定与 `sy.decl >= 0` 检查（供 `comptime f(...)` 执行任意双栖函数）。
- `mbuiltin` 节点永不走此 `sym_lookup` 路径（其 callee 是 `@name`，不在用户符号表），故 `@foo` 未知内建仍由 `meta_eval_mbuiltin` 报 `T-MTA-E607`，与规范一致。
- `parse` 层的 `comptime fn` 语法（`is_comptime`）暂保留为无害冗余标记（不强制）；后续可清理，但不阻塞本任务。

**判据**：无现有代码依赖 `T-MTA-E618`（v3 模型下 `comptime fn` 概念已撤销）；移除后 `comptime f(...)` 对任意 `fn` 可用，与规范 §2.2 右列对齐。

---

## 2. 元函数 `@type_info(T) -> TypeInfo`

### 2.1 语义

```
@type_info(T: type) -> TypeInfo
```
在编译期把类型 `T` 折成一个 `TypeInfo` 值（运行期即指向合成的 `@__ti_<T>` 全局常量 `TTypeInfo*`）。

**与既有三者的区别（务必讲清，避免重复造轮子）**：
- `type_info(T)`（无 `@`）：**类型位**内建，出现在类型/值表达式位；node kind=`type_info`，sa=类型名；静态类型 `TypeInfo`。后被端降为 `@__ti_<T>` 引用。
- `@type_of(e)`：返回 e 的**静态类型**（类型即值），不做字段反射。
- `@type_info(T)`（新增 `@` 元函数）：与 `type_info(T)` 产出**同构**的 `TypeInfo` 值，但走元函数调用形态（规范 §6 `@`-内置清单），用于「在 `@` 元函数语境里取类型反射」。

### 2.2 实现（**解析期脱糖**，非 `meta_eval_mbuiltin` 分支）

> ⚠ 实测修正：最初设想在 `meta_eval_mbuiltin` 加分支返回 `typeinfo` 节点，但 TIR 把 `mbuiltin` 统一降级为 `call @t_<name>`（`tir.tc:3145`），`type_info` 无对应运行时 shim，链接期报 `undefined symbol: t_type_info`，且 CTFE 不会把 `mbuiltin` 折回 `typeinfo`。故改为**解析期直接脱糖**，与既有 `type_info(T)` 走完全相同的发射路径。

在 `src/parse.tc` `parse_meta_builtin`（≈5343）里，`@type_info(T)` 与其他 `@`-内置**分流**：不进 `mbuiltin` 节点，而是直接产出一个 `typeinfo` 节点（kind=`"typeinfo"`、sa=类型名），与 `parse.tc:1043` 的 `type_info(T)` 解析产物**完全同构**：

```t
if (nm == "type_info") {
    var a0: i64 = -1;
    if (head >= 0) {                       // head 是 mb_arg_is_type 收下的类型节点链
        var ks: []i64 = base.kids_chain(head);
        if (slice_len(ks) > 0) { a0 = ks[0]; }
    }
    var tname: string = "";
    if (a0 >= 0) { tname = base.node_sa((a0 as u64)); }   // named 取 sa；scalar 同理
    var tid: i64 = base.node_new("typeinfo");
    base.node_set_sa((tid as u64), tname);
    base.node_at(tid, ti_at);
    return tid;                            // 直接返回 typeinfo 节点，不走下方 mbuiltin 创建
}
```
- 配套：`mb_arg_is_type("type_info", 0)` 返回 `true`（parse.tc:5371），使第 0 形参按类型解析（否则 `Point` 会被当表达式 ident）。
- `typeinfo` 节点 → TIR `TIR_OP_TYPEINFO` → `@__ti_<T>` 合成全局常量（`tir_to_ll.tc:2969` / `codegen_c.tc:2389`），运行期即 `TTypeInfo*`。**零后端改动**。
- `meta_eval_mbuiltin`（sema.tc:13922）保留一个**防御性** `@type_info` 分支（同样返回 `typeinfo` 节点，sa=类型名，供任何 CTFE 路径兜底），但主路径是上面的解析期脱糖。

### 2.3 用法示例

```t
@main
fn main() i32 {
    var ti: TypeInfo = @type_info(Point);   // 编译期折成 TypeInfo 值，运行期指向 @__ti_Point
    var nfields: i64 = ti_field_count(ti);  // 用运行时 accessor 取出反射信息
    var nbytes:  i64 = ti_size(ti);
    if (nfields == 2 && nbytes == 16) { return 0; }   // Point{x:i64,y:i64}
    return 1;
}
```
> 注意：`TypeInfo` 是值（非全局 const 的折叠目标），须绑定到局部变量再由运行时 `ti_*` accessor 取字段；全局 `const TI = @type_info(Point)` 在当前实现下折叠为 `i64 zeroinitializer`（与既有 `type_info(T)` 全局 const 行为一致），故示例用局部变量形态。

### 2.4 风险（已规避）
- ~~mbuiltin → `t_type_info` 运行时调用死路~~：改用解析期脱糖到 `typeinfo` 节点，复用既有 `@__ti_<T>` 合成，已规避。
- `typeinfo` 节点的 sa 在 `named` vs `scalar` 上取值约定一致（均取 sa），无归一风险。
- 不改变 `type_info(T)` 既有路径，仅新增 `@`-前缀入口，回归面小。

---

## 3. 元函数 `@import("M") -> Module`

### 3.1 现状
`@import("X")` 表达式位已完整落地：`parse_import_expr` 产 `import_expr`(sa=模块路径)；`const m=@import("X")` 绑定模块值；`m.foo` 经 `sema.tc:6208/10796+` 脱糖为 `M__foo`；HIR 降 `HIR_OP_IMPORT_DECL`；C 后端对 `import_expr` 不发射（值即模块别名）。**机制已齐备，缺「名分」统一**。

### 3.2 名分统一（实现要点）
1. **声明位 → 表达式位**：`parse_module_decl` 的 `@import("...")` 分支改为同样产 `import_expr`（或等价地先建 `ImportModDecl` 再在 sema 内联），与表达式位共用同一 `is_modval_import_decl` 判定，去掉「声明位特判」与「表达式位特判」双份逻辑。
2. **纳入元函数派发（可选、低风险）**：在 `meta_eval_mbuiltin` 增加 `if name=="import"` 分支，返回 `import_expr` 节点（sa=路径）。由于 `@import("X")` 当前已被 parser 直接解析成 `import_expr` 而非 `mbuiltin`，此分支是「名分」收口，不改变运行行为——若改动风险偏高，可仅做文档统一、保留现状节点，不强行改派发。
3. **`@module(...)`**：维持「设置当前模块可见性」的副作用内建；声明位拦截保留，待 §4 路线再决定是否与 `@import` 共用 `mbuiltin` 入口。

### 3.3 用法（已实现）
```t
const m = @import("std.math");    // 模块值
const pi = m.PI;                 // → std.math__PI
using m;                          // 引入该模块符号
```

---

## 4. 里程碑与验证

| 步骤 | 动作 | 验证 | 状态 |
|---|---|---|---|
| M1 | D1：移除 `meta_eval_call` 的 `node_bb` 门禁 | `tc.exe check src/tc.tc` 无 `T-*-E` | ✅ |
| M2 | `@type_info` 解析期脱糖（§2.2） | `tc run scratch_metafn_test.tc` 退出 0；IR 折出 `@__ti_Point` | ✅ |
| M3 | `@import` 名分统一（§3.2） | 工作项① 已实现（共用 `is_modval_import_decl` + `modval_load` 内联）；工作项② 因 `@import` 永不进 `mbuiltin`，添加即死代码 → 不做 | ✅ 已核实关闭 |
| M4 | 自举不动点：`build src/tc.tc --output out/dbg/g1` → g2==g3==g4 | `g2.ll==g3.ll==g4.ll` md5 `bab49f2cd7eff67b6d5d960d0ad83ee4` | ✅ |
| M5 | conformance 344/0（`--compiler out/dbg/g1.exe`，含新增 `p_meta_type_info.tc`） | 0 failed，无回归 | ✅ |
| M6 | IR 快照重录（`ir_snapshot --update --compiler out/dbg/g1.exe`）、提交 | baseline 已更新 119/360；已提交 `9649842` 并推送 | ✅ |
| M7 | 编译期诊断内建（§4-bis）：`T-MTA-W621` + `@compile_log` / `@compile_warning` + `print` 归为运行期 | `tc check src/tc.tc` 0 error；自举不动点 g1==g2==g3==g4 md5 `ffcbad4c2677ca2ca18dd8629a36008d`（hir_eval 对齐前）；conformance **345/0**（含新增 `p64_compile_log_ok.tc`）；IR 快照 0 新增 / 0 缺失（3 处 `src/tc.tc` 自身产物漂移，合法） | ✅ |
| M8 | HIR 解释器对齐（§4-bis 末端）：移除 `src/hir_eval.tc` 中 `print`/`eprint` 的 CTFE 内建特判，使 `tc comptime-eval` 与 sema 侧一致（编译期上下文 print → 未注册编译期函数） | `tc check` 0 error；自举不动点 g1==g2==g3==g4 md5 `8b1d2aff86d1a23e8c084a5cccedc992`；`hir_eval_test.mjs` 26/26 + fact.tc 双轨全绿；conformance 345/0；IR 快照重录（src/tc.tc 自身产物漂移，0 新增 / 0 缺失） | ✅ |

> ⚠ 任一 M 步失败即回退该步改动（保持 `node_bb` 门禁/移除的分支），不污染自举链。

## 4-bis. 编译期诊断内建：`@compile_log` / `@compile_warning`，以及 `print` 归位（2026-10-11）

**用户裁定**：新增 `@compile_log` / `@compile_warning`，保留 `@compile_error`；`print` / `eprint` / `println` 一律为**运行期函数**。

### 4-bis.1 为什么必须新增
`print` 原先被登记为编译期内建（`meta_eval_builtin` 里有 `print`/`eprint` 分支，编译期写 stderr）。裁定后编译期上下文不再有输出手段，故补三个专用元函数（规范 §6 已列表）。

### 4-bis.2 实现要点

| 改动 | 位置 | 说明 |
|---|---|---|
| 新增诊断码 `T-MTA-W621`（warning，legacy `T_META_COMPILE_WARNING`，名 `COMPILE_WARNING`） | `tools/diag_defs.json` → `gen_diag.mjs` → `src/diag_table.gen.h` → `gen_diag_t.mjs` → `src/base.tc` | 走**单一真源**链路，defs 163→164；`base.tc` 的 `g_dcount` 与 `[]string` 数组同步为 164 |
| 内建签名注册表 | `src/sema.tc` `mb_variadic` / `mb_arity_min` / `mb_arity_max` | `mb_arity_max = -1` = 不定长无上界；`mb_arity_min` 对不定长内建返回 1。**D4 部分落地、D3 内建侧落地**。⚠ 三者必须**真实被消费**（否则即死代码）：`meta_eval_mbuiltin` 以 `mb_variadic(name)` 派发不定长分支，元数上下界由 `mb_arity_min` / `mb_arity_max` 给出（`amax >= 0` 才检查上界） |
| 登记为已知 / CTFE-only | `mb_is_known` / `mb_is_ctfe_only` | 漏到运行期上下文 → `T-MTA-E605`（与 `@str_from_bytes` 同一档） |
| 求值分支 | `meta_eval_mbuiltin`（`T-MTA-E607` 兜底之前） | 逐实参 `meta_eval`，非标量（string/int/bool/float 之外）报 `T-MTA-E601`；不足 1 个报 `T-MTA-E611`；log 写 `eprint`，warning 发 `T-MTA-W621`（带行列）；返回 `mv_int(0)` |
| 值转字符串助手 | `mv_to_str` | 对齐 `meta_design.md` §2.2 的用法 `@compile_log("meta k = ", k)`：实参可以是任意**标量**编译期值 |
| **移除** `print`/`eprint` 的编译期登记与其 CTFE 分支 | `meta_eval_builtin` | 编译期上下文出现 `print(...)` → `T-MTA-E617 未定义的编译期函数` |
| **移除** `print`/`eprint` 的 HIR 解释器内建特判 | `src/hir_eval.tc` `hv_call_builtin` / `hv_eval_call` | `tc comptime-eval` 路径下 print 不再被当作内建；编译期上下文出现 print → `hv_fn_lookup` 报「调用未注册的编译期函数: print」，与 sema 侧对齐（HIR 解释器是 `comptime-eval` 子命令的实现，已被 gate L2 的 `hireval` 项护栏覆盖） |

**不定长的接线形态**：`mb_variadic` 为真的内建不走精确元数检查，而是「末位（此处即全部位置）吸收余参 → 逐个求值 → 拼成一条消息」。这是规范 §5.3 的第一个真实消费方。

**上下文约束（有意设计）**：三者都是纯编译期内建，只能活在 `comptime { }` 块里。`@compile_error` 额外允许出现在 `comptime fn` 体的**未取分支**（`mb_prune_if` 剪除，不误报）；而 `@compile_log` / `@compile_warning` 若写进 `comptime fn` 体会在 `check` 期命中 `T-MTA-E605` —— 因为 `check` 会遍历 `comptime fn` 体（p40 的 `get_width` 注释已实证）。

### 4-bis.3 测试
- 迁移：`p38_meta_ctfe_ok.tc:53` 与 `p40_meta_builtin_ok.tc:113` 里编译期上下文的 `print(...)` → `@compile_log(...)`。
- 新增：`tests/conformance/pass/p64_compile_log_ok.tc` —— 覆盖字符串/int/bool 混合不定长拼接、`@compile_warning` 多实参拼接、`@compile_error` 在未取分支被剪除。

## 5. 回滚
- D1 单点：把删除的 `node_bb` 门禁块复原即可。
- `@type_info`：删除 `meta_eval_mbuiltin` 中的分支 + 回退测试。
- 全部改动彼此正交，可独立回退。

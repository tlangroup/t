# t 语言 `meta` 元编程设计

> 状态：**设计草案（待评审）** ｜ 对应用例：`examples/meta.tc`
> 目标：对标 Zig `comptime` 的全部核心能力，但严格服从 `t` 宪法（第 2/3/4/7/8 条）。
> 以**单一关键字 `meta`** 统一取代当前分散的 `comptime` 用法，避免引入第二种等价写法。

---

## 0. 背景与动机

`t` 当前已具备半成型的能力：

- `comptime T: any`：Zig 风格编译期类型模板参数，调用点以类型名作首实参触发**单态化**（`instantiate_generic`，M-any 已实现 ✅）。
- `comptime Block`：`ComptimeStatement` 为 **partial**（节点已定义，表达式级语义 spec-only）。
- `comptime fn`：函数级 `isComptime` 标记已接入（`parser.tc` / `checker.tc`）。
- `type_info(T)` + `ti_*`/`fi_*`：编译期类型自省（**已实装** ✅）。
- 缺少：`@compile_log` / `@compile_error` / 类型相等判定 / 编译期字符串构造 / 值型编译期参数 / 表达式级 `meta expr`。

用户希望新增元编程关键字 `meta`，并给出用例 `examples/meta.tc`（原稿为 Zig 风格语法，几乎全部不符合 `t` 文法）。本设计在**不破坏现有门禁**的前提下，定义 `meta` 的完整语义，并将 `comptime` 收敛为 `meta` 的弃用别名。

---

## 1. 宪法符合性评审（四层，第 18 条）

| 条款 | 结论 | 说明 |
|---|---|---|
| 第 2 条 唯一确定语义 | ✅ 合规 | 用单一 `meta` 关键字统一 `comptime` 全部表面（表达式 / 块 / 声明 / 参数），消除 `comptime`/`meta` 二义。 |
| 第 3 条 全行为显式 | ✅ 合规 | 类型转换唯一 `as`；类型比较走 `@type_equal`；无隐式布尔 / 无隐式转换 / 无隐式内存分配。 |
| 第 4 条 AST 原生结构化元编程 | ✅ 合规 | 自省沿 `type_info` 函数式 API（`ti_*`/`fi_*`）进行；CTFE 走 **AST 求值**，彻底废弃字符串拼接宏。 |
| 第 7 条 确定性可复现 | ⚠ 警示 | CTFE 必须是**纯函数**（无 IO / 无副作用 / 无未定义求值顺序）方可保证字节级可复现；浮点与字符串构造顺序须确定。需用户确认纯函数约束强度。 |
| 第 8 条 零未定义行为 | ✅ 合规 | 禁止 `meta` 上下文读写运行时变量 / 内存；非法访问显式报 `T_META_READ_RUNTIME`；`@compile_error` 显式终止。 |
| 第 13 条 铁律校验 | ✅ 合规 | 新增语法 / 内建均通过上表校验后入语言。 |

⚠ **已拍板（2026-08-07；2026-08-30 修订）**：编译期关键字已统一为 `comptime`——`meta` 不再作为关键字（留作他用），历史 `comptime`/`meta` 别名关系已撤销，`W_COMPTIME_ALIAS` 弃用告警已随 `meta` 关键字移除而一并下线。仓库内用例与 conformance 均已迁移到 `comptime` 拼写。

---

## 2. `meta` 的四种表面（语法）

### 2.1 编译期表达式 —— `meta <expr>`
在期望「编译期已知值 / 类型」的位置求值，结果计入常量。
```t
var   x: u32  = meta 100 * 20;            // → 2000，编译期折叠
const arr: [meta 4 + 2]u8 = [1,2,3,4,5,6]; // 数组长度 = meta 求值
auto  val = meta add(7, 8);                // 调用 meta 函数，编译期执行
```

### 2.2 编译期块 —— `meta { <stmt>* }`
块内语句在编译期执行（CTFE），**不产生任何运行时代码**。内部复用运行时语法：`var`/`const`/`auto`/`if`/`while`/`for`/`return`，且同样强制 `;`、强制 `if/while/for` 的括号与大括号（第 3 条）。
```t
meta {
    var k: u32 = 0;
    k = k + 5;
    @compile_log("meta k = ", k);
}
```

### 2.3 编译期声明（顶层）—— `meta const` / `meta var` / `meta fn`
- `meta const` / `meta var`：编译期全局实体，初值经 CTFE 求得（等价于 C 的 `constexpr` 全局）。
- `meta fn`：可被编译期求值的函数；当全部实参均为编译期已知时，调用点就地 CTFE；否则退化为普通运行时调用。
```t
meta const PI: f64 = 3.1415926;
meta add fn(a: u32, b: u32) u32 { return a + b; }
```

### 2.4 编译期参数 —— `meta T: type` / `meta V: T`
- `meta T: type`：编译期**类型**参数 → 调用点以类型作实参触发**单态化**。
- `meta V: T`（T 为值/符号类型）：编译期**值**参数 → 参数值在编译期已知，并参与单态化键。
```t
max fn(meta T: type, a: T, b: T) T { ... }   // 调用：max(u32, 10, 20)
repeat fn(meta s: string, meta n: u32) Sym { ... }  // 调用：repeat("hi", 3)
```

---

## 3. 与既有 `comptime` 的迁移（满足第 2 条）

| 旧（`meta` 别名，已移除） | 新（`comptime`，现行关键字） | 状态 |
|---|---|---|
| `meta T: any` | `comptime T: type` | `meta` 不再是关键字；统一用 `comptime` |
| `meta Block` | `comptime { }` | 同上 |
| `meta fn` | `comptime fn` | 同上 |
| `meta expr` | `comptime expr` | 同上 |

> 过渡完成后，`comptime` 从关键字表移除，仅 `meta` 承担元编程——彻底消除第 2 条禁止的「等价多写」。

---

## 4. 泛型 / 单态化（复用 M-any 机制）

- 调用点以**类型 / 值**作对应 `meta` 参数实参，沿用 `t` 既有「类型即首实参」约定（**不引入方括号 `[]` 新记号**，避免与索引歧义）。
  ```t
  max(u32, 10, 20)        // → max__u32
  repeat("hi", 3)         // → repeat__s2_hi_1748694682_3（值参数按值去重）
  ```
- 机制复用 `instantiate_generic`：深克隆 AST → 替换 `meta` 形参 → 剥离 `meta` 形参 → 重命名 `f__<键>` → 追加实例到 `decl_list`；模板本体与双后端（LLVM / C）均跳过，只处理实例。
- 单态化键 = 全部 `meta` 形参的具体类型 / 值（值参数按值去重，类型参数按类型名去重）。
  形参是类型还是值，由**声明类型**决定：`type` / `any` → 类型参数，整数族 / `bool` / `string` → 值参数。
  字符串键带 FNV-1a 哈希后缀以防字符清洗造成碰撞（`"a-b"` vs `"a_b"`），负整数键前缀 `n`。详见 Phase C。

---

## 5. 编译期内建（新增，统一 `@` 前缀，符合 `t` 的 `@xxx` 注解约定）

| 内建 | 作用 | 返回 | 备注 |
|---|---|---|---|
| `@compile_log(args...)` | 编译期诊断输出（文本 + JSON 双格式，见第 6 条双输出） | `void` | 运行期上下文调用 → `T_META_RUNTIME_CTX` |
| `@compile_warn("msg")` | 编译期告警 | `void` | 同上 |
| `@compile_error("msg")` | 编译期硬错误，终止编译 | noreturn | 同上；用于「不支持的类型」等 |
| `@type_equal(T1, T2)` | 类型相等判定 | `bool` | CTFE 已知 |
| `@type_name(T)` | 类型名字符串 | `string` | 运行时退化为编译期常量 |
| `@type_size(T)` | 类型字节大小 | `i64` | 同上 |
| `type_info(T)` | 丰富自省（`ti_*`/`fi_*`） | `TypeInfo` | **已有** ✅，继续作为底座 |
| `@zeroed([N]T)` | 零初始化定长数组值 | `[N]T` | CTFE 缓冲区构造 |
| `@str_from_bytes(buf, len)` | 由字节构造 `string` | `string` | CTFE 字符串构造 |
| `sym_intern(buf, len)` | 由字节驻留符号 | `Sym` | CTFE 符号构造（见 §6） |

> ✅ **Phase D 已全部落地**：上表 `@compile_error` / `@type_equal` / `@type_size` / `@type_name` / `@zeroed` / `@str_from_bytes` / `sym_intern` 均已实现（见上方 Phase D 实现要点）。`@compile_error` 为唯一保留的 `@compile_*`（noreturn，终止编译）；`@type_name` / `@type_size` / `@type_equal` / `@zeroed` 可在运行期位置折叠为常量，`@str_from_bytes` / `@compile_error` 仅限编译期上下文（否则 `T_META_RUNTIME_CTX`）。

> 约束：`@compile_*` 仅允许出现在 `meta` 表达式 / 块 / `meta fn` 体内；在运行期调用一律报 `T_META_RUNTIME_CTX`，保证第 3 条（行为显式可追溯）。

### 5.1 Phase B 已落地的内建（复用既有运行期内建名，不新增 `@` 符号）

Phase B 的取舍：**能复用既有内建名的就不新增语法**（第 2 条，最小表面）。
下列内建在 `meta` 上下文中自动获得编译期语义，无需任何新拼写：

| 内建 | 编译期语义 | 备注 |
|---|---|---|
| `print(s)` / `eprint(s)` | 编译期日志，**一律写 stderr** | 二者在编译期同义；stdout 留给 JSON / IR |
| `int_to_str(i)` / `i2s(i)` | 纯转换 | |
| `str_len(s)` | 纯查询 | |
| `str_at(s, i)` | 纯查询，越界报 `T_META_RANGE` | |

**因此 `@compile_log` / `@compile_warn` 不再需要** —— `meta { print("...") }` 已经是它，
且没有引入新符号。Phase D 只保留 `@compile_error`（语义确实不同：**终止编译**，noreturn）。

明确拒绝（`T_META_IMPURE`）：`file_read_all` / `file_write_all` / `file_exists` /
`sys_run` / `args` / `exit` / `path_resolve` —— 第 8 条（编译期不得访问运行期世界）+
第 7 条（求值须可复现）。

---

## 6. 类型比较与分支（无特殊 `meta if`）

CTFE 是**真实求值器**，类型比较走 `@type_equal` + 普通 `if`，不新增 `meta if` / `meta while` 关键字（单一 `if` 语法，第 2 条）。

```t
meta get_width fn(meta T: type) u32 {
    if (@type_equal(T, u32)) { return 32; }
    else if (@type_equal(T, u64)) { return 64; }
    else { @compile_error("unsupported type"); }
    return 0;   // 不可达兜底，满足显式返回
}
```

---

## 7. 约束与禁止（铁律落地）

- **禁止访问运行时**：`meta` 上下文读写运行时变量 / 内存 → `T_META_READ_RUNTIME`。
- **纯函数约束**：CTFE 无 IO、无未初始化读取、无 UB，保证第 7 条字节级可复现。
- **无副作用**：`meta` 块不产生运行时代码；其 `var` 仅存活于编译期。
- **显式返回**：`meta fn` 与运行时 `fn` 同规则，所有路径须显式 `return`。

---

## 8. `Sym` 类型澄清

`examples/meta.tc` 原稿用裸 `Sym`。当前 `t` 的具象符号类型是 `Sym32("tag")` / `Sym16("tag")`（带池与 tag）。本设计将 **`Sym` 提升为一级符号句柄类型**（等同默认 32 位池的泛型符号），使 `meta fn(meta s: string, meta n: u32) Sym` 这类「返回任意符号」的签名合法；`Sym32`/`Sym16` 继续作为带池/标签的具象写法。`sym_intern(buf, len)` 返回 `Sym`。

> ✅ **Phase D 已落地一级化**：`resolve_ti` 与 `resolve_type_desc` 在查过用户自定义 `Sym` **之后**才兜底返回一级 `Sym`（bw=32 / alen=32），**仅当程序未自带 `Sym` 时生效** —— `src/tc.tc` 自带 `Sym struct`，自举不受影响，双后端都拿到正确的类型描述。

---

## 9. 实现计划（分阶段，不破坏门禁）

- **Phase A（词法 / 语法 / 标记）** —— ✅ **已落地（2026-08-06，gate L2 13/0/0）**
  实现取「**复用既有 `comptime` 节点**」路线（而非并列新增 `meta`/`meta_block`），理由：
  `comptime` 的解析 / 检查 / 双后端发射链路已存在且被 M-any 单态化依赖，复用即零风险、零 IR 漂移。
  具体落点：
  1. `src/tc.tc` `init_keywords`：`kw_reg("meta","KwComptime")`（别名）+ `kw_reg("type","KwType")`（新）。
  2. `parse_type` 新增 `KwType` 分支 → `node_new("type")`；`resolve_ti` 中 `type` → `ti_mk("Any")`（与 `any` 同语义）。
  3. `parse_declaration`：把 `meta`/`comptime` 前缀**提到最前**，使其可修饰 `var`/`const`（原先只能修饰 `fn`）；
     `parse_global_var` 增加 `is_comptime` 形参并写入 `bb` 槽。
  4. `parse_primary` 新增 `KwComptime` 表达式前缀分支 → `mk_comptime`（支撑 `var a = meta 4+2;`）。
  5. **补齐既有缺口**：`comptime` 表达式节点原先只在 `infer_expr` 有分支，
     C 后端 `emit_expr` 会落到 `/* unsupported expr */`、LLVM 后端 `emit_lle` 静默丢弃。
     本阶段在 `expr_type_desc` / `ll_etd` / `emit_expr` / `emit_lle` 四处补上透传内层表达式。
  6. `tc0/lexer/token.ts` 同步注册 `meta` 别名（`tc0` 只需能编译 `src/tc.tc`，
     故不实现 `any`/`type` 类型参数 —— 与 `tc0` 既有子集边界一致）。

  验收：`examples/meta.tc`(+`.expected.txt`) 双后端运行一致、`tests/conformance/pass/p37_meta_ok.tc` 通过、
  48 个既有示例 IR 逐字节零漂移、gate L2 13 passed / 0 failed / 0 warn。
- **Phase B（CTFE 求值器）** —— ✅ **已落地（2026-08-06，gate L2 13/0/0）**

  与原计划的两处偏离，均为**降风险**的有意选择：

  1. **落点在 checker 之前，不在之后。** `meta_pass()` 挂在 `run_check` 内、`mark_call_callees()` 之后、
     `check_decl` 之前。这样 `meta <expr>` 在类型检查看到它之前就已经变成字面量，
     检查器 / 双后端 / 单态化**全部零改动** —— 直接消掉了 §10「第二解释层漂移」风险的大半。
  2. **求值结果用字面量节点 id 表示，不引入 `MetaValue` 结构体。**
     `int` / `bool` / `string` 三种字面量节点即是值的载体。理由有二：
     ① 「折叠」退化成把字面量内容拷进 `comptime` 节点自身（改 `kind`/`sa`/`ia`/`ba`，
        清 `na..nd`/`la`），无需重接父指针；
     ② 规避 Win64 聚合按值传参 ABI 坑（`t` 的老雷区）。

  具体落点（全部在 `src/tc.tc`，`run_check` 之前的独立模块）：
  1. **环境**：`g_menv_name[]` / `g_menv_val[]` 平栈 + `g_menv_base`（帧基）/ `g_menv_nglobal`（全局常量区）。
     `menv_find` 只看**当前帧 + 全局区**，调用方局部刻意不可见 —— `meta fn` 是纯函数，不做动态作用域。
  2. **求值** `meta_eval`：字面量透传 / `ident` 查环境 / `unary` / `binary`（含 `&&` `||` 惰性短路）/
     `cast`（显式窄化，按标量位宽做二进制补码截断）/ `call`。
  3. **执行** `meta_exec`：`var_decl` / `assign` / `if` / `while` / `block` / `return` / `break` / `continue`，
     返回 0=顺序 1=return 2=break 3=continue。
  4. **调用** `meta_eval_call`：实参先在**调用方**环境求值，再建帧；被调方必须是 `meta fn`（`FuncDecl.bb`）。
  5. **驱动** `meta_pass`：① 先求值顶层 `meta const` / `meta var` 初值填全局区；
     ② 再遍历各声明，遇 `comptime` 折叠、遇 `comptime_block` 执行后置 `la = -1`（运行期零代码）。
     泛型模板本体（`func_is_generic`）以 `g_meta_quiet` 静默跳过，只在实例化后的副本上求值。
  6. **内建**（最小集，见下）：`print` / `eprint` / `int_to_str` / `i2s` / `str_len` / `str_at`。

  **编译期 `print` 写 stderr，不写 stdout。** stdout 是机器可读通道（`check` 的 JSON、`emit-ll` 的 IR），
  且 conformance 对 stdout 做跨编译器逐字节对拍 —— 编译期日志绝不能污染它。
  故 `print` 与 `eprint` 在编译期同义，这是有意为之，不是遗漏。

  **护栏**：步数预算 4,000,000（`T_META_BUDGET`，实测无限循环 0.56s 截断且不撑爆 arena）、
  调用深度 64（`T_META_DEPTH`）、除零（`T_META_DIV_ZERO`）、
  不纯内建拒绝（`T_META_IMPURE`：`file_*` / `sys_run` / `args` / `exit` / `path_resolve`）、
  读运行期变量拒绝（`T_META_READ_RUNTIME`）、非 `meta fn` 调用拒绝（`T_META_NOT_META_FN`）。

  **暂不支持**：浮点（`T_META_NOT_CONST`）—— 第 7 条要求求值顺序可复现，
  浮点结合序须先定死，留到与 Phase C 一并处理；字符串仅支持相等比较，不做拼接 / 切片。

  ⚠ **一处可观察行为变化（预期内，非回归）**：`meta { }` 里的 `print` 从「运行期输出」
  变成「编译期输出到 stderr」。这是 `meta {}` 的正确语义（编译期执行 = 运行期零代码）。
  Phase A 在 `examples/meta.tc` 注释里写下的「运行期可观察行为不变」对**带副作用的块**并不成立，
  已随本阶段修正：`examples/meta.tc` 与 `.expected.txt` 同步更新，
  并改用「编译期累加 `meta var` → `meta <expr>` 折叠回运行期」来演示编译期计算对运行期的影响。

  验收：`examples/meta.tc` 双后端运行一致（`fact(10)` 折叠为 `store i64 3628800`）、
  `tests/conformance/pass/p38_meta_ctfe_ok.tc` + `fail/f61..f66_meta_*.tc` 六个护栏用例全过、
  除 `examples/meta.tc` 与 `src/tc.tc` 自身外 **49 个快照目标 IR 逐字节零漂移**、
  gate L2 13 passed / 0 failed / 0 warn。
- **Phase C（单态化键扩展）** —— ✅ **已落地（2026-08-06，gate L2 13/0/0）**

  `instantiate_generic` 的单态化键从「只有类型」扩展到「类型 + 值」。
  `meta` 形参按**声明类型**分流（`meta_param_is_type`）：`type` / `any`（或无标注）是**类型参数**，
  整数族 / `bool` / `string` 是**值参数**。二者可在同一函数里混用，键按形参顺序拼接。

  **实参处理**（`meta_eval_value_arg`）：调用点实参先过 CTFE 求值器（复用 Phase B 的 `meta_eval`），
  得到字面量节点；再校验**声明类型一致**（第 3 条禁隐式转换 → `T_META_ARG_TYPE`）
  与**取值范围**（按标量位宽二进制补码 → `T_META_RANGE`）。
  求值失败按 Phase B 原诊断透出（如传运行期变量 → `T_META_READ_RUNTIME`）。
  ⚠ 声明类型检查**排在求值之前**：`meta X: f64` 须报 `T_META_VALUE_PARAM_TYPE`（指向形参），
  而不是让求值器先以 `T_META_NOT_CONST` 指向实参 —— 诊断要指向真正的病灶。

  **代换策略**：值参数**直接把字面量节点代入实例体**（`meta_subst_val_kids` / `meta_subst_val_node`
  改写 `ident{sa==name}`），而**不是**在实例开头插一条 `meta const N = ...`。
  理由：`[N]i64` 的数组长度槽在 `resolve_ti` 里要求是 `int` 字面量节点，常量名满足不了。
  类型参数仍走既有 `subst_type_in_kids`（改写 `named{sa==name}` 类型节点），两条通路正交。

  **键编码**（`meta_val_key`，须稳定且无碰撞）：
  整数 → 十进制（负数前缀 `n`，`-5` → `n5`）；`bool` → `true` / `false`；
  字符串 → `"s" + 长度 + "_" + 前 12 个可读字符（非字母数字→`_`）+ "_" + FNV-1a(32)`。
  加哈希是因为字符清洗会让 `"a-b"` 与 `"a_b"` 撞名 —— 实测 `repeat("ab-c",2)` → `repeat__s4_ab_c_3217929650_2`。

  **顺带修掉两处 Phase A 遗留缺陷**（都不是本阶段新引入，但被值参数用例照出来了）：
  1. **类型代换从未生效**：`instantiate_generic` 把 `inn.lc`（**kids 链表头**，不是节点 id）
     喂给了 `subst_type_in_node`，于是函数体里的类型位置从来没被替换过，还会误改无关子树。
     症状：`zero(f64)` 发射 `alloca i64` 却 `ret double`，clang 直接拒收。
     修法：改用 `subst_type_in_kids`。**教训已进技术债清单：`lc`/`lb`/`la` 是链表头，不是节点 id。**
  2. **同一实例第二次调用无限递归**：缓存命中路径直接 `return syms[si0].decl`，
     没有改写调用点 —— `nodes[e].bb` 仍为 `false`，`infer_expr` 于是反复重入 `instantiate_generic`
     直到 arena abort（exit 127，无任何输出）。旧编译器同样复现，属既有 bug。
     修法：抽出 `rewrite_generic_callsite(e, iname, k)`，首次生成与缓存命中**两条路径共用**。

  **实例体内的 `meta` 折叠**：`meta_pass()` 跑在 check 之前，而实例是 check 期间才生成的，
  故 `register_decl` 之后补一次 `meta_walk_list(nodes[inst].lc)`，
  否则模板里的 `meta N * 100` 会漏到运行期。实测 `tagged(7,…)` → `tagged__7` 发射 `store i64 700`。

  验收：`examples/generics_demo.tc` 重写覆盖六种形态（纯类型 / 纯值 / 混合 / 数组长度 /
  同键复用 / 负数键），双后端逐字节一致；`tests/conformance/pass/p39_meta_value_param_ok.tc` +
  `fail/f68..f71_meta_value_*.tc` 四条护栏全过；除 `src/tc.tc` 与 `generics_demo.tc` 外
  **49 个快照目标 IR 逐字节零漂移**；gate L2 13 passed / 0 failed / 0 warn。
  - **Phase D（内建）** —— ✅ **已落地（2026-08-06，gate L2 13/0/0，IR 漂移已归零）**
    注册 `@compile_error` / `@type_equal` / `@type_size` / `@type_name` / `@zeroed` / `@str_from_bytes` / `sym_intern`，并把 `Sym` 提升为一级符号句柄类型；全部走编译期折叠（标量 → 字面量、数组 → `array_lit` 节点），**双后端零新支持、零 `; UNSUPPORTED` 风险**；诊断双输出（文本 + JSON）。
    （`@compile_log` / `@compile_warn` 已由 Phase B 的编译期 `print` / `eprint` 覆盖，从计划中移除 —— 见 §5.1。）

    **落点（全部在 `src/tc.tc`，编译期折叠，双后端零改动）：**
    1. **两类 `@` 内建分流**：
       - *类型查询* `@type_name` / `@type_size` / `@type_equal` + `@zeroed` —— 纯折叠为字面量 / `array_lit`，运行期位置也可折叠（检查器随后照常类型检查，无 IR 漂移）。
       - *CTFE-only* `@str_from_bytes` / `@compile_error` —— 只在编译期求值 / 折叠；在运行期上下文（非 `meta` 块、非 `meta` 形参的 `meta fn`）调用 → `T_META_RUNTIME_CTX`。
       - `sym_intern`（无 `@`）复用既有内建通道，`Sym = "str"` 自动驻留。
    2. **`meta T: type` 类型绑定透传（关键修复）**：CTFE 环境新增并行槽 `g_menv_ty`，与 `g_menv_val` 同槽存「该绑定是类型还是值」（`-1` = 值绑定；≥0 = 类型节点 id）。`meta_eval_call` 对类型形参走 `meta_type_arg_node` 取实参类型节点，而非当其求值；`mb_bound_type` 把 `named{T}` 沿 `menv` 类型绑定解析（循环 ≤16），使 `meta fn` 体内的 `@type_equal(T, u32)` / `@type_size(T)` 能看到被单态化绑定到的具体类型。
    3. **CTFE 数组值**：新增 `meta_eval_array_lit` / `meta_eval_index` / `meta_do_assign` 下标赋值（就地改 `Child.val`）；数组按 t 的值语义，在 `meta_exec` 变量绑定 / 赋值 / 调用**三处**经 `meta_val_copy` 深拷贝，杜绝别名（否则 `b = a; b[0] = 9;` 会污染源 `a`）。
    4. **`@zeroed`**：`mb_zero_value` 按类型递归构造零值（标量 → 0/`false`/`""`；定长数组 → 递归填 0，上限 65536；TypeAliasDecl 递归展开），折成 `array_lit` 节点。
    5. **`@str_from_bytes` / `sym_intern`**：CTFE 经 `meta_bytes_to_str` 由 `[N]u8` + 长度构造 `string` / `Sym`。
    6. **`Sym` 一级化**：`resolve_ti` 与 `resolve_type_desc` 在查过用户自定义 `Sym` **之后**兜底返回 `Sym`（bw=32 / alen=32），仅当程序未自带 `Sym` 时生效 —— 自举安全（`src/tc.tc` 自带 `Sym struct` 不受影响）。
    7. **分支剪枝**：未取分支里的 `@compile_error` 由 `mb_prune_if` 剪掉，不误报；被取分支则按 Zig 语义在「编译期求值」或「运行期位置 check」任一路径触发 `T_META_COMPILE_ERROR`。

    **验收**：51 个快照目标 IR 逐字节零漂移（基线已重录，153 条目）；`tests/conformance/pass/p40_meta_builtin_ok.tc`（类型查询运行期位置 / `MyInt i64` typealias 展开 / get_width 模式 + `T: type` / `@zeroed` + CTFE 数组读写 / `@str_from_bytes` / `sym_intern` / 数组值拷贝 / meta 块）+ `fail/f72..f77_meta_*.tc` 六条护栏全过（`T_META_COMPILE_ERROR` ×2 / `T_META_UNKNOWN_BUILTIN` / `T_META_RUNTIME_CTX` / `T_META_TYPE_AS_VALUE` / `T_META_UNKNOWN_TYPE`）；gate L2 13 passed / 0 failed / 0 warn。
- **Phase E（迁移 & 弃用）** —— ✅ **已落地（2026-08-07，gate L2 13/0/0，IR 漂移零）**；**2026-08-30 收尾**：`meta` 别名与 `W_COMPTIME_ALIAS` 告警已彻底移除，编译期关键字统一为 `comptime`，`meta` 留作他用。
  1. （历史）`W_COMPTIME_ALIAS` 弃用别名告警：曾在四个 `KwComptime` 解析点注入 `warn_comptime_alias()`；现已随 `meta` 关键字移除而一并下线。
  2. **仓库内真实 `meta` 代码用法已迁移为 `comptime`/`type`**：`examples/generics_demo.tc`、`examples/meta.tc`、`tests/samples/game_ecs.tc`、`tests/conformance/pass/p37_meta_ok.tc`；`tests/samples/lexer.tc` 的 `"comptime"` 为字符串字面量测试数据（不动）。
  3. （历史）conformance 曾加 `pass/p41_meta_comptime_alias.tc` 验证告警；该用例已随告警下线而删除。
  4. 关键字统一已在 2026-08-30 完成，无后续过渡期。

---

## 10. 风险

- **第二解释层漂移**：CTFE 求值器与既有 checker / 双后端是并行第二语义层，易与类型系统漂移 → 须复用 `infer_expr` / `type_info` 的归一类型表示，并以 conformance + difftest 锁死。
  > Phase B 实测缓解：求值**在 checker 之前**完成，产物是字面量节点，
  > 检查器随后照常对折叠结果做全套类型检查 —— 两层不是并行而是串行，漂移面显著小于预期。
  > 仍存的漂移点只剩「CTFE 的整数窄化语义」须与 `cast` 的运行期语义一致（已按标量位宽二进制补码对齐）。
- **可复现性（第 7 条）**：CTFE 浮点 / 字符串构造顺序须确定，禁止依赖哈希遍历序等不确定来源。
  > Phase B 的处置：**浮点直接不支持**（报 `T_META_NOT_CONST`），把问题推迟到结合序定死之后再开。
- **与 M-any 耦合**：改动 `instantiate_generic` 须回归 `generics_demo.tc`，确保既有 `comptime T: any` 单态化不受影响（过渡期内）。
- **门禁**：Phase A–E 每步须过 `node tools/gate.mjs L0|L1|L2`，且 IR 漂移归零流程照常。

---

## 11. 用例对齐

原始用例是 Zig 风格语法，与 `t` 文法几乎全不兼容（方括号类型参数、`meta if`/`meta while` 前缀、
`undefined`、`info.fields` 成员糖、`@type_info[T]()`、缺分号等），已全部按 `t` 真实文法修正。
修正后的完整目标形态存于 **`docs/meta_target.tc`**，覆盖：编译期常量 / 编译期函数 / 类型参数泛型 /
类型反射遍历 / 编译期条件分支 / 编译期字符串构造 / 编译期求值块 / 静态查表 / 编译期类型检查 / 编译期诊断。
它依赖 Phase B–D 的 CTFE 与内建，**当前不可编译**，仅作设计与语法对齐用途。

> ⚠ 该文件刻意**不放在 `examples/`**：`tools/ir_snapshot.mjs` 会对 `examples/*.tc` 逐个 emit，
> 放入不可编译文件会让「产物快照比对」步骤永久 WARN（Phase A 落地时踩过此坑）。

**`examples/meta.tc`** 现为 Phase A+B 的**可运行**用例（配套 `examples/meta.expected.txt`，由 L1 `run_examples` 双后端校验），
只使用已落地的表面；随后续 Phase 推进逐步扩充，始终保持可编译可运行。

conformance 覆盖：
- `pass/p37_meta_ok.tc` —— Phase A 四类表面均可通过 check。
- `pass/p38_meta_ctfe_ok.tc` —— Phase B 求值器全形态（递归 / 循环 / break / continue /
  位运算 / 短路 / 窄化转型 / 内建 / `meta {}` 累加回填）。
- `fail/f61_meta_read_runtime.tc` —— `T_META_READ_RUNTIME`
- `fail/f62_meta_not_meta_fn.tc` —— `T_META_NOT_META_FN`
- `fail/f63_meta_impure.tc` —— `T_META_IMPURE`
- `fail/f64_meta_div_zero.tc` —— `T_META_DIV_ZERO`
- `fail/f65_meta_depth.tc` —— `T_META_DEPTH`
- `fail/f66_meta_budget.tc` —— `T_META_BUDGET`
- `pass/p40_meta_builtin_ok.tc` —— Phase D 编译期内建全形态（类型查询运行期位置 / `MyInt i64` typealias 展开 / get_width 模式 + `T: type` / `@zeroed` + CTFE 数组读写 / `@str_from_bytes` / `sym_intern` / 数组值拷贝 / meta 块），运行 `exit=0`。
- `fail/f72_meta_compile_error_runtime.tc` —— `T_META_COMPILE_ERROR`（运行期位置 `@compile_error`）
- `fail/f73_meta_compile_error_ctfe.tc` —— `T_META_COMPILE_ERROR`（`get_width(i8)` 触发被取分支）
- `fail/f74_meta_unknown_builtin.tc` —— `T_META_UNKNOWN_BUILTIN`（`@type_sizeof`）
- `fail/f75_meta_ctfe_only_runtime.tc` —— `T_META_RUNTIME_CTX`（非 `meta` 形参 `meta fn` 内用 `@str_from_bytes`）
- `fail/f76_meta_type_as_value.tc` —— `T_META_TYPE_AS_VALUE`（`return T + 1`）
- `fail/f77_meta_unknown_type.tc` —— `T_META_UNKNOWN_TYPE`（`@type_size(NoSuchTypeHere)`）
- `pass/p41_meta_comptime_alias.tc` —— Phase E 弃用告警验证：故意用 `comptime` 四种形式，`// EXPECT: warning W_COMPTIME_ALIAS`，验证仍 `exit=0`（向后兼容过渡语义）。

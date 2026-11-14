# Option 特性设计（对标 Zig 0.17）

> 状态：**Phase A 已落地（2026-10-29）**，B/C 期待开。
> 本文是 `reference.md §3.5.0` 的上位设计稿；分期由依赖关系驱动，见 §4 路线图。
> 关联：`docs/compiler/tir-design.md §7/§15.2`（ABI）、`docs/design/set-ops/DESIGN.md §13.8`（括号类型）。

---

## 1. 为什么要重写这一章

`?T` 在 tc 里早已实装（AST kind `optional`、TI kind `Optional`、双后端可运行），
但它的**语义面是 Rust 味的**，而且文档与实现已经漂移：

| 事实 | 证据 |
|---|---|
| 文档与实战相反 | reference.md 旧文称后缀 `T?` 为「规范形」，但全仓 `.tc` 源码**零使用**后缀，实战一律前缀 `?T` |
| 构造/取值走函数而非运算符 | `some(x)` / `unwrap(x)` / `is_some(x)` / `is_none(x)`，按**名字字符串**识别（`sema.tc:8761`），用户定义的 `fn some(...)` 会整个遮蔽内建 |
| 空值字面量是自创的裸 `?` | Zig 及主流语言都用 `null`；t 当时的 `null` 只服务可空指针 |
| ABI 是装箱指针 | `tir_st_of_td`（`tir.tc:1171`）把 optional 抹成 `ptr<ST>`；`some()` 每次 arena 分配 + memcpy，**永不回收** |
| 无 `.?` / `orelse` / 载荷捕获 | `parse.tc:5911` 后缀循环只认 `Dot`/`LBracket`/`LParen`/`as`；全仓 `grep -i orelse` 零匹配 |

裁定：**对齐 Zig 0.17**。理由不是「Zig 时髦」，而是 Zig 把「可空性」做成了**类型层面的事实**，
且每一步取值都必须被显式写下来——这与 t 的 L-02 显式原则同源。继续维护一套 `some/unwrap`
名字符串内建，成本大于收益。
（唯一需要权衡的是 Z3 隐式提升对 L-02 的冲击，见 §3 的 O-7。）

---

## 2. Zig 0.17 Optional 语义面（对照基准）

来源：官方 langref `#Optionals` / `Table of Operators` / Precedence 章节，并与 zig.guide、社区文档交叉验证。

| # | 语义 | Zig 写法 | 备注 |
|---|---|---|---|
| Z1 | 类型语法 | `?T`（**前缀**） | **没有后缀 `T?`** —— 这是本次迁移动机 |
| Z2 | 空值 | `null`，coerce 进任意 `?T` | `null` 是 primitive value |
| Z3 | 装入 | **隐式**：`const x: ?u32 = 5;` 无需 `some()` | Zig 没有 `some`，靠这条把构造函数整个消灭 |
| Z4 | 取出 | **永不隐式**：`?T → T` 必须写下来 | 与 L-02 同源 |
| Z5 | 断言取出 | `x.?` ≡ `x orelse unreachable` | 安全构建下 panic；ReleaseFast 是 UB |
| Z6 | 兜底取出 | `a orelse b`，`b` 可为 `noreturn` | ⇒ `orelse return` / `break` / `continue` 都合法 |
| Z7 | 载荷捕获 | `if (x) \|v\| {}`、`if (x) \|*v\| {}` 可变指针捕获 | 判空与取值是**同一处语法**，不可能漂移 |
| Z8 | 迭代到空 | `while (f()) \|v\| {}` | 首个 null 终止 |
| Z9 | 布局 | `?*T` 与 `*T` **同尺寸**（借 0 地址做 niche）；`?u32` 需 tag 字节 | 「只有当 payload 没有多余位模式时才付 tag 的钱」 |
| Z10 | 优先级 | `catch orelse` 同级、可自链不可互链；与 `==` 混用**必须加括号** | langref 有专门的 `ambiguous_precedence_orelse` 编译错误用例 |
| Z11 | 嵌套 | `??T` 合法但是设计异味 | 语言不禁止，规范不鼓励 |
| Z12 | 链式 | **故意不做** `?.` 可选链 | 「每一处 orelse 都要点明那一步找不到时怎么办」 |

---

## 3. 裁定（O-x）

### O-1 ✅ 类型语法只保留前缀 `?T`，删除后缀 `T?`（2026-10-29 已落地）

删除 `parse_type_ex` 中「类型之后」的 `Question` 循环（原 `src/parse.tc:475-478`）。
删掉后 `i64?` 会停在 `?` 上、由调用方 `expect_tok` 直接报错位，**不会**静默落成 Optional。

连带影响（均已同步）：

- `tests/conformance/pass/p_paren_type.tc:22`、`examples/paren_type.tc:20`：`(i64)?` → `?(i64)`
- `reference.md` EBNF（`OptionalType: "?" Type`）与 §3.5.0 标题／正文
- `docs/syntax/drafts/{types,fid}.md`、`docs/design/set-ops/DESIGN.md §13.8/§13.9` 的示例与论证

### O-2 ✅ 空值字面量以 `null` 为规范形，裸 `?` 降级为兼容别名（2026-10-30 代码侧已落地）

二者静态类型同为顶层 `Unknown`，行为等价（`sema.tc` 的 `null` / `opt_none` 分支）。
文档上 `null` 为规范形，裸 `?` 是兼容别名。

**已知副作用（2026-10-30 已堵）**：因为放行靠 `Unknown`，`var x: i64 = null;` 曾通过类型检查。
修法**没有**引入 Zig 式的专属 `null_t` 类型，而是加**加法守卫**（`ti_null_ok` / `null_lit_bad` / `err_null_into`）：

- `null` 的静态类型**保持顶层 Unknown 不变** —— 「由目标反推」这条机制本身就靠它，
  换成专属类型会同时引爆 lub（match 臂合流：`var m: *TypeMeta = match (ti) { .Struct(mt) => mt, _ => null };`）
  与未定型推断、Array→Slice 构造等一大片既有合法写法（4 个 typeinfo 示例实测依赖它）。
- 守卫只在「右值是 `null` / 裸 `?` **且**目标是定型且非 Optional / 非 Pointer」时补一条 `T-SEM-E002`。
- 落点 6 处：`cs_var_decl` / `cs_return`（HIR + CST 两条）/ `cs_assignment` /
  `check_global_var_decl` / `check_global_const_decl` / `check_call_args`。
  conformance `f_opt_null_into_scalar`。

**同批补齐的推断债**：`var a: ?i64 = some(7);` 曾报「expected ?i64 but got ?u8」——
`some` 是**无 Func 签名**的内建 ⇒ 走不到形参类型注入那条路，实参 `7` 按量级自推断成 u8。
修法放在**报错点**（`err_type_mismatch` 里 `opt_try_retag_some`）：把 `some(...)` 实参子树里的
无后缀整数字面量按期望元素类型补 `sb` 位宽 + 清类型缓存，再重推断一次，相等即放行。
（⚠ 先试过「按 `g_lead_expect` 在推断实参**之前**补 sb」，实测该点 `g_lead_expect` 不可靠，
故改为在报错点做——那里 `exp` 一定已知。）

### O-3 新增 `.?` 后缀解包

语义 ≡ `orelse unreachable`，即直接复用 O-4 的取值通路，不需要新的运行期原语。
实现位置在 `parse_postfix` 的 `Dot` 分支内，与成员访问 `x.y` 共享前缀，靠「点之后紧跟 `Question`」
判定。⚠ 注意别把它误建成独立的 `?.` 运算符——Z12 明确不做可选链。

### O-4 新增 `orelse`

- 结果类型 = 左操作数的元素类型（`noreturn` 另行处理）
- 右侧必须允许控制流终止，否则 `x orelse return null;` 这类 Zig 主力写法不可用
- 优先级按 Z10：低于比较运算；与 `==` 相邻时**要求括号**（对齐 langref 的「模糊优先级」编译错误）

### O-5 ✅ 载荷捕获 `if (x) |v|` / `while (x) |v|`（2026-10-30 已落地）

**阻塞点（已解除）**：`|v|` 这个 token 形状在 t 里被两处抢占——bar-lambda 与 inline-for。
裁定（落码前先定死，避免重演值级 `&&` 被类型位误吃的同型故障）：

- **捕获位必须紧跟 `)`**：bar-lambda 只在**表达式起始位**（`parse_primary` 的 `BitOr` 分支）识别；
  inline-for 由 `inline` 关键字前缀区分。⇒ `if` / `while` 的 `)` 之后紧跟 `|` 是**唯一形态**，
  无需前瞻即可判定（实测两种抢占形态都不在 `)` 之后，无歧义）。
- **不做 `|*v|`**：t 的 `unwrap` 返回**副本**，取址指向临时量，语义无意义且易误用 ⇒
  遇到即报 `T-PAR-E001` 编译错误（conformance `f_opt_capture_ptr`），而不是静默按值捕获。

脱糖复用既有内建（`is_some` / `is_none` / `unwrap`），**后端零改动**，与 `.?` / `orelse` 同姿势：

```
if    (x) |v| { B } [else E]
    ⇒ { var __optc_N = x;
        if (is_some(__optc_N)) { var v = unwrap(__optc_N); B } [else E] }

while (x) |v| { B }
    ⇒ while (true) { var __optc_N = x;
                     if (is_none(__optc_N)) { break; }
                     var v = unwrap(__optc_N); B }

值位 if (x) |v| { E1; } else { E2; }
    ⇒ { var __optc_N = x;
        match (is_some(__optc_N)) {
          true  => { var v = unwrap(__optc_N); E1; },
          false => E2 } }
```

三者都保证**条件只求值一次**（先落临时变量）——这是能脱糖成 `is_some(x)` + `unwrap(x)` 的前提。
`while` 的形态刻意把临时量放在**循环体内**：Zig 语义下条件**每轮重新求值**（与 `if` 只求值一次不同）。

**落地时踩到的两个坑**

| 坑 | 症状 | 修法 |
|---|---|---|
| 只吃名字、**漏吃闭合的 `|`** | `if (x) \|v\| {` 报「expected LBrace, but found \|」，列号指向**第二个**管道符，极易误判成捕获位没识别到 | `parse_optcap_name()` 内 `expect_tok("BitOr")` |
| 值位分支体写成 `{ e }` | 值块要求以**表达式语句**结尾 ⇒ `{ e }` 报「expected Semicolon, but found }」 | 值位一律写 `{ e; }`（与既有 `p_value_if_expr` 同约定） |

conformance `f_opt_capture_ptr` / `f_opt_capture_nonopt`（后者由内建自身的 `T-SEM-E790` 挡下）；
示例 `examples/option_capture.tc`（10 项：命中/未命中、聚合载荷、`while` 累加、`break`/`continue`、值位捕获）。

### O-3/O-4 落点调研（2026-10-29，实查结论）

两条都能做到**零新节点类型、零后端改动**——全部走「脱糖在前、分后端在后」，
与值 if（`parse_value_if`）、值循环（`desugar_value_loop`）同姿势。

- **`?T` 的内建按名字识别**：`sema.tc:8761` 的条件是 `fname == "some"/"unwrap"/"is_some"/"is_none"`，
  其中 `fname` 取调用目标 ident 的 `sa`。⇒ 只要 parser 合成出一个 `call(ident("unwrap"), [x])` 节点，
  sema/TIR/C/LLVM 全链路按现有路径走，**一行后端代码都不用动**。
- **`unwrap` 在 none 时确实 panic**：`runtime/t_runtime.c:246` `t_opt_unwrap` 遇 NULL 打 JSON 错误并 `exit(1)`，
  `runtime/t_shim_ll.c:58` 的 LLVM shim 直接复用它。⇒ `.?` ≡ `orelse unreachable` 的运行期语义已经现成。

**`.?`（O-3）**：`parse_postfix` 的 Dot 分支（`parse.tc:5912`）里，Dot 已消费后若 `cur_t()=="Question"`，
吃 `?` 并合成 `unwrap` 调用。前缀参考 `parse.tc:2916`（既有 parser 层合成 call 的先例）。
`.?` 可继续缀 genius（`x.?.field`）天然成立，因为后缀循环接着跑。

**`orelse`（O-4）**：必须**单次求值左操作数 + 短路**，故不能压成 `orelse(a,b)` 内建调用。脱糖为：

```
a orelse b   ⇒   { var __ol_N = a;
                   match (is_some(__ol_N)) { true => unwrap(__ol_N), false => b } }
```

外层用 `base.mk_block_expr`（`base.tc:3450`），末语句须是 `base.mk_expr` 包着的 match ——
`infer_block_expr`（`sema.tc:6518`）只认 `expr` 语句的 `na` 作块值。
match 节点的拼法照抄 `parse_value_if`（`parse.tc:5203-5212`，二臂 `true`/`false`，手工 push kids 链表）。
临时名用自增计数器保证嵌套唯一，对齐 `desugar_value_loop` 按节点 id 命名的做法。

**顺带挖出并修掉一个 C 后端的静默错编（2026-10-29）**

`.?` 让聚合值的直接使用第一次变得顺手，于是踩响了 C 后端既有的一个雷：

```t
var p: Point = op.?;  p.x + p.y   // 两步写法：双后端都得 7
op.?.x + op.?.y                   // 直接缀接：LLVM 得 7，**tmir-c 得 0**
```

根因：C 后端给每个聚合槽都配了自有缓冲（`<slot>_buf`，声明段 `t_alloc` + `memset 0`，
且 `<slot> = <slot>_buf`）。而 `t_opt_unwrap` 那条发射是 `dst = *(unsigned char**)(...)`，
把 `dst` **改指**到了 arena 指针 —— `<dst>_buf` 于是变成一份全 0 的陈旧缓冲，
后续成员访问按聚合基取 `<dst>_buf` ⇒ 读到 0。

这与已登记缺陷 **G-5**（`CALL_IND` 聚合返回同样会改指）完全同型，故修法直接复用它的登记表
`g_c_aggcall_slot`：在 `unwrap` 发射末尾，若元素是用户聚合则登记 `dst`，
使 `ADDR_OF` 取「槽里的当前指针值」而非陈旧缓冲。标量元素两个判定都不成立 ⇒ 既有标量通路一字未动。
（改的是共享 codegen，已用 examples 全量双后端 + conformance 全量回归守住回归面。）
把新级插在 **`range` 与 `or` 之间**（`parse_range` 的左操作数改调 `parse_orelse`，
而 `..` 两端仍直呼 `parse_or`）。这样：

- `==` 等比较仍绑得比它紧 ⇒ 符合 Z10；
- `a orelse b |> f` 读成 `(a orelse b) |> f`（管道是松的那层）；
- range 端点不被 `orelse` 吃掉，既有 `lo..hi` 行为一字不变，符合 L-03「塔只向下扩展、不重排」。

**新增关键字**：`lib/std/rc/cst.tc:36-38,55` 是冻结手维护的三张并行数组 + `g_kw_count`（46），
加 `orelse` 要四处同步。全仓 `.tc` 源码 `grep orelse` **零匹配**，无标识符冲突。

### O-6 ✅ ABI：`opt.boxed` → `opt.tagged`（2026-10-30 已落地）

布局：`?T` = **`%Opt_<E>`** = `struct { i64 __tag, E __val }`，按值、零分配。
none ⇒ `__tag == 0`；some ⇒ `__tag != 0`。

三个刻意的取舍：

- **tag 用 i64 而非 i8**：payload 偏移恒为 8，与 t 的 8 字节对齐布局一致 ⇒ C 后端（手工偏移
  memcpy）与 LLVM（`{ i64, E }` 默认对齐）无需各自算对齐即逐字节对齐。
- **类型名由元素 ST 派生**（同元素 ⇒ 同名），而非按出现顺序编号：std 的 `.tlib` 与主程序
  分别编译时编号会错位导致同名异义。
  ⚠ **不能用 `%T` 开头**：`ll_emit_opaque_defs` 把所有 `%T*` 当运行期结构类型补成
  `= type opaque`（首版命名 `%TOpt_*` 即踩此坑，症状 `Cannot allocate unsized type`）。
  ⚠ **名字是 sanitize 过的，不可逆**：反解元素类型必须查 `g_ssz_fields`（`tir_opt_elem_st`），
  不能对名字做字符串切割。
- **panic 复用现成原语**：none 时把 payload 指针 `select`/三元选成 NULL 再交给既有的
  `t_opt_unwrap(NULL)`（打 JSON 后 `exit(1)`）⇒ 零运行时改动、零新增基本块。

后端改动仅三处内建发射（`some` / `unwrap` / `is_some|is_none`）+ 两处「槽要缓冲」登记。

**落地时踩到的三个坑（都属跨层同步，不是布局本身）**

| 坑 | 症状 | 修法 |
|---|---|---|
| 类型声明在类型段**之后**才注册 | LLVM `use of undefined type` | `tir_pregister_opt_types()` + `tir_collect_opt_types()` 在发射类型段之前跑 |
| `TIRModule` **按值传参**，后端拿到的是拷贝 | 写 `tir.g_mod` 同步不过去 ⇒ 该类型被兜底成 `= type i64`（单字段）⇒ GEP `i32 0,i32 1` 非法 | 后端各自 `append(module.types, ...)` 合并 `tir_collect_opt_types()` 的结果 |
| `unwrap` 由「改指到 arena 指针」改成 memcpy 写槽 | 聚合元素 dst 无缓冲 ⇒ 写到空指针段错误 | 预扫描里把 `unwrap`/`some` 的聚合 dst 登记进 `g_c_agg_base_*` |

### O-7 ✅ `T → ?T` 隐式提升（2026-10-30 已落地，用户裁定批准）

`var a: ?i64 = 5;` / `f(3)` / `return 7;`（返回 `?i64`）全部成立，Zig 式无 `some` 写法可用。
反向 `?T → T` **仍然永不隐式**（conformance `f_opt_no_implicit_unwrap`）。

**实现刻意不改写 AST**：base 没有节点克隆原语（节点是 24 张平行侧表），原地改写成 call
需要重建子树。改为「sema 打标记放行 + TIR 补包装」：

- sema：`err_type_mismatch` 里 `opt_try_lift()` 判定通过后 `opt_lift_mark(e)` 并直接 return。
  对整数字面量先写 `sb` 位宽后缀并重推断（否则 `5` 按量级推成 `u8` 而对不上 `?i64`）。
- TIR：`tir_emit_expr` 读标记，先发射元素值，再 `STRUCT_NEW %Opt_E` 写入 `__tag=1` + payload。
  `STRUCT_NEW` 双后端已支持（C 的 `{0}` 缓冲 + 逐字段 GEP、LLVM 的 zeroinitializer + 逐字段 store）。

**为什么必须先做 O-6**：boxed ABI 下提升 = 一次隐式 arena 分配 + memcpy 且永不回收，
那比 L-02 原本要防的「空值隐形」更糟——连开销都隐形了。换成 tagged 之后提升只是写一个 tag。

**L-02 需相应修订**（见 reference.md）：原条款「`T` 与 `?T` 不自动转换」改为
「`?T → T` 永不隐式；`T → ?T` 允许隐式」。

按 `tir-design.md §15.2` 裁定 2，by-value 形态本来就在规格里（`opt.tagged<ST>` = `{i8, ST}`），
原本排 Stage 5+。对齐 Zig 之后，它从「可选优化」升级为**前置条件**——理由见 O-7。

落地时同步处理两个已探明的存量缺陷：

- **C 后端聚合 case 是别名而非拷贝**：`some(pt)` 拷的是 `unsigned char**`（8B）而非 16B 的 `Point`
  （见 `out/dbg/cback/optional_demo/optional_demo.c:142`，而 LLVM 侧正确拷贝 16B）。
  双后端目前靠「两边对称地多做一层解引用」才恰好对齐，属脆弱平衡。
- **`?*T` 必须走 Z9 的 0 地址 niche**，不得额外加 tag 字节。

### O-7 ⚠ `T → ?T` 隐式提升：排在 O-6 之后再议（关键依赖）

这是本次唯一需要复核的语言取舍。

- Zig（Z3）**允许**隐式提升，`some()` 因此不存在。
- t 的宪法条款 **L-02**（`reference.md`）明文**禁止** `T` 与 `?T` 自动转换，理由是
  「宁可啰嗦，也不让空值在类型层面隐形」，且与 `f > T` 读路径的 Option B 裁定同源。

**建议：改，但必须等 O-6 之后。** 理由是工程性的，不是审美性的：

> 在当前 `opt.boxed` ABI 下，「`T → ?T` 隐式提升」的运行时代价是**一次隐式 arena 堆分配 + memcpy，
> 且永不回收**。这比 L-02 原本要防的「空值隐形」更糟——它连**开销**都隐形了。
> 只有把 ABI 换成 by-value `opt.tagged`（O-6），提升才是 Zig 那种「改一个 tag 字节」的零分配动作，
> 此时放开隐式提升才真正说得通。

换言之 **O-7 依赖 O-6**，不能先做便宜的一半。在此之前 `some(x)` 保持为显式构造入口。

---

## 4. 路线图（依赖有序，非随意排期）

```
A ✅ 类型语法收敛为 ?T 单一形式（已完）
      │
B ✅  ├─ .? 与 orelse           （2026-10-29，O-3 / O-4）
     ├─ if/while 载荷捕获      （2026-10-30，O-5；含值位形态）
      └─ null 规范化 + 推断债补齐（2026-10-30，O-2 代码侧）
      │
C ✅  ABI opt.tagged（O-6，2026-10-30）
      │   （?*T 的 0 地址 niche 仍待做，见 §5）
      │
D ✅  T → ?T 隐式提升 + L-02 修订（O-7，2026-10-30，用户裁定批准）
```

剩余：`?*T` niche（Z9）、`some` 被用户同名函数遮蔽的 arity 校验（§5 首行）。

每期验收链固化：`tc check`(0 error) → 自举 g1/g2 → `gate L2` → IR 快照重录 → 提交 → merge `wb`。

---

## 5. 已探明的坑（实现 B/C 期时先读）

| 坑 | 位置 | 说明 |
|---|---|---|
| 内建按名字字符串识别 | `sema.tc:8761-8780` | 用户 `fn some(...)` 会遮蔽内建；不校验 arity；`some(some(x))` 不报错 |
| `.?` 与成员访问同前缀 | `parse.tc:5911` | 须在 Dot 分支内判定，而非新增 `?.` 运算符（Z12 不做可选链） |
| `==` 优先级歧义 | Z10 | `x orelse y == z` 在 Zig 里是**编译错误**，不是解析妥协 |
| `ti_arm_of` 无 optional 分支 | `sema.tc:15248` | 注释声称有，实际没有 ⇒ `?T` 落到兜底 `"Struct"`，反射不对 |
| `!j` JSON 序列化降级 | `sema.tc:4478` / `4634` | Optional 被判无 RTTI，输出字面 `null` |
| C 后端聚合需对称多做一层解引用 | 见 O-6 | 脆弱平衡，改 ABI 时一并根除 |

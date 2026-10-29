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

### O-2 空值字面量以 `null` 为规范形，裸 `?` 降级为兼容别名

二者当前静态类型同为顶层 `Unknown`，行为已等价（`sema.tc:7518` / `7522`）。
本期**不动代码**，只在文档上把 `null` 立为规范形。

**已知副作用（不在本期修复）**：因为放行靠 `Unknown`，`var x: i64 = null;` 目前也会通过类型检查。
真正堵住它要靠给 `null` 一个专属的 `null_t` 类型（Zig 的做法），排到 O-6 之后与 O-7 一并处理。

### O-3 新增 `.?` 后缀解包

语义 ≡ `orelse unreachable`，即直接复用 O-4 的取值通路，不需要新的运行期原语。
实现位置在 `parse_postfix` 的 `Dot` 分支内，与成员访问 `x.y` 共享前缀，靠「点之后紧跟 `Question`」
判定。⚠ 注意别把它误建成独立的 `?.` 运算符——Z12 明确不做可选链。

### O-4 新增 `orelse`

- 结果类型 = 左操作数的元素类型（`noreturn` 另行处理）
- 右侧必须允许控制流终止，否则 `x orelse return null;` 这类 Zig 主力写法不可用
- 优先级按 Z10：低于比较运算；与 `==` 相邻时**要求括号**（对齐 langref 的「模糊优先级」编译错误）

### O-5 载荷捕获 `if (x) |v|` / `while (x) |v|`（含 `|*v|`）

**阻塞点（已探明）**：`|v|` 这个 token 形状在 t 里已被两处抢占——
bar-lambda（`parse.tc:1746`）与 inline-for（`parse.tc:5120`）。
而 `if` 语句当前只在 `)` 后接 block（`parse.tc:5139`），**没有捕获位**。

⇒ 必须先有一个显式前瞻裁定把三者分开（例如：捕获位必须紧跟 `)`、捕获列表内不得带类型标注等）。
**这是 B 期开工前要先定死的一件事**，否则会重演历史的同型故障——
值级 `&&` 曾被类型位误吃进去（从而静默改变解析结果），根因同样是「新增一处语法没先把前瞻裁定写清楚」。

### O-6 ABI：`opt.boxed` → `opt.tagged`

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
B     ├─ .? 与 orelse          ← 无 ABI 依赖，可在 boxed 上先做
      ├─ if/while 载荷捕获      ← 需先解 |v| 抢占（O-5 阻塞点）
      └─ null 规范化（O-2，文档侧）
      │
C     ABI opt.tagged + ?*T niche   ← tir-design 裁定 2 / 原 Stage 5+
      │   （须独立 stage、重录 TIR/IR 基线）
      │
D     T → ?T 隐式提升 + L-02 修订   ← **必须在 C 之后**，理由见 O-7
```

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

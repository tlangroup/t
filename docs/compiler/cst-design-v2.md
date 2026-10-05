# t 语法树技术规范（重新设计 v2）

> 状态：**设计规格 v2（建议采纳）** — 取代 `cst-design.md` v0.1 的「扁平单态 Node + 字符串 kind」模型  
> 作者：Buddy（编译管线设计）  
> 关联：`cst-design.md`（v0.1，现状）、`hir-design.md`、`tir-design.md`、`ir-taxonomy.md`、`src/base.tc`、`src/parse.tc`、`src/hir.tc`、`src/tir.tc`  
> 约束：本规范是 **设计**，不强制一次性落地；§4.10 给出分阶段、保门禁、保自举不动点的迁移路径。

---

## 0. TL;DR（结论先行）

当前 t 的「语法树」实际是 **CST（具体语法树）**，存储为：

- `base.Node` —— 一个 **28 字段的单体大结构体**（逐项点算：kind 1 + sa/sb/sc/se 4 + has_sa~sc 3 + ia/ib 2 + ba~bf 6 + na~nd 4 + memspace 1 + la/lb/lc 3 + td 1 + ln/cl/tv 3），靠 `kind: string` 区分种类，字段 `na/nb/nc/nd`、`la/lb/lc`、`sa/sb/sc`、`ba..bf` **按 kind 重载**（即「一个 JSON 节点装所有东西」反模式）；
- `base.kids` —— 单独的**链表池**，承载子节点列表（`la/lb/lc` 是链表头索引，不是节点 id）；
- 若干 **全局平行侧数组**（`g_idecl_*`、`g_seen`、`g_node_mod/file`、`g_const_decl_ids`…）存放跨切面属性；
- `sema` **就地改写 CST** 节点（脱糖成 `paren`/`block`/`ident`），并靠 `hir_invalidate` + 回退 CST 收口。

这套模型**已经跑出自举不动点 + gate L2 全绿**，其中「扁平 arena + i64 索引引用」「未定型线性 HIR（= Zig ZIR）」「`.tmi` 类型化模块接口」三条是**现代且正确的**，应保留。

需要改进的核心是 **「单体 Node + 字符串 kind + 字段重载 + 平行侧数组」** 这一组合。它与 Rust / Swift / Zig / MLIR / Roc / Tree-sitter / Roslyn / Go / TypeScript 的现代做法全面背离，导致：类型不安全、字段语义靠约定、字符串比较慢且易错（typo 静默回落 RAW）、跨切面状态散落全局、sema 必须原地改树。

**v2 目标模型 =「按 kind 分表的 typed node tables（SoA）+ 枚举 kind + 打包 NodeRef + 字符串驻留 + 属性侧表 + 访问者/变换框架」**，其中索引 arena 与 HIR/ZIR 完全保留。语法树子系统迁入 **std 库 `std.rc.cst`**（库模块，预编译 `.tlib`）供编译器与 `fmt`/`lint` 共用（§4.14 / G9）。关键词按《最大化标识符设计》重分类为 **强制 / 上下文（修饰+属性）** 三级，lexer 对上下文词发 `Ident`、声明节点用 `modifiers[]`/`attrs[]` 结构化承载（§4.15 / G10）。迁移分 9 阶段（**S0 命名空间迁移** + S1–S8；S6/S7 为**糖架构**与 **Pass 框架**，S8 为**用户可扩展 + fmt/lint 共用底层**，S0/S1 同时落地关键词分类），每阶段独立可门禁、可回滚、不动 `.ll` 指纹。

---

## 0.5 复审结论（2026-09-29：针对「更多糖语法 + 更多管线节点」）

本次针对两大扩展方向复审 v2，发现其在**糖语法的落点与注册机制**、**管线处理节点的 Pass 抽象**两处**架构性欠规范**，需补强（详见 §4.11、§4.12）：

- **糖语法的「落点」未定义（扩展方向①）**：v2 只说「脱糖产生独立 typed AST / HIR」，但没说清脱糖在管线哪一站发生、多个脱糖阶段如何排序、新糖如何注册。真实代码里脱糖散落三处——`parse.tc`（`desugar_lambdas`/`desugar_func_clauses`/`desugar_self_node`）、`sema.tc`（`desugar_format_call`/`lower_pipe`/`lower_range_index`/`lower_for_range`/`desugar_value_loop`/`desugar_imports`/`lower_array_len_infer`/`rewrite_generic_callsite`）、`hir.tc`（**7 个硬编码「不透明 BLOCK」逃生舱 kind**：`block_expr`/`while`/`for`/`unit_lit`/`bitstr`/`import_expr`/`variant_lit`）。新糖目前必须同时改 `parse`/`sema`/`hir.tc` 三处 + 守住 `HIR_OP_RAW` 归零——这恰是 v2 想消除的「同步 6 处」坑，但 v2 的「生成 visitor」只解决「遍历穷尽」，没解决「脱糖注册与排序」。
- **项目铁律须显式绑死到新机制**：`docs/design.md` 规定所有糖必须 **姿势 A**（脱糖为既有节点，禁止 姿势 B 平行新机制）+ **L2 双后端逐字节一致**。本条**已在 §4.11.1 收口（R-SUGAR-A / R-SUGAR-L2）**，但 v2 重设计引入的 `lower_policy` 表 / SAST 渐进降级层 / `DesugarPass` 注册恰恰是 **姿势 B 后门最易开的三处**，旧的「`HIR_OP_RAW==0` + L2 逐字节一致」门禁**必要但不充分**（一个聪明的 姿势 B 也可能蒙混过关）。因此 §4.11.1 须把铁律**显式绑到这三个机制的接入点** + 加「无糖节点残留 HIR」正向断言（详见 §4.11.1 补充）。
- **无 Pass 框架（扩展方向②）**：`compiler-pipeline-design.md` 已规划 mir 上的 borrow-verify pass（G-7）、comptime 折叠、单态化、IR 级 FDO 布局（G-11）等处理节点，但 v2 §4.2 是线性图，没有 `Pass`/`PassManager` 抽象。新增处理节点 = 手工塞进 `sema` 驱动或 `codegen`，无统一接口、无排序/失效、无 Analysis-vs-Transform 区分。§4.5 侧表 keyed by `NodeRef` 有了，但缺「谁拥有该侧表 + 上游变更如何失效」——而这正是 `compiler-pipeline-design.md` per-file/per-API 增量故事的承重墙。

> 补强不影响 v2 既有目标（分表/枚举/侧表/visitor/不可变 CST 全部保留），只是把「糖」与「处理节点」从**散落的手工接线**升级为**注册式、可审计、门禁可守**的一等公民。

## 0.6 二次全面复审（2026-09-29 晚，全文通读）

对全文逐节通读，修正 **9 处实质问题**（3 处为**自相矛盾**，会直接误导实现），并登记 5 项待定观察。

### 已修正（本次）

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 1 | §4.3 核心骨架 | `FuncDeclNode.flags: FuncFlags` 仍是**布尔位域**，与 §4.15.3「改用 `modifiers[]`/`attrs[]` 结构化字段」**直接矛盾** | 改为 `modifiers: []Mod` + `attrs: []Attr` + `cfg_pred: CfgPred`（与 §4.15.3 / §4.16.6 一致） |
| 2 | §4.3 | 注释称 NodeRef「打包 u64」，结构体却是 `{tag: i64; idx: i64}`（128 位）——**自相矛盾** | 改为单 `u64` + `mk_noderef` / `nr_tag` / `nr_idx`；`mk_binary` 同步 |
| 3 | §4.6 | 生成的 `node_visit` 是 **`if/else if` 线性链**（`O(n)`），与 §4.4.1 承诺的「`match` → 跳转表 `O(1)`」**矛盾** | 骨架改为生成 `match(nr_tag(n))`，并注明禁止退化回 if/else 链 |
| 4 | §4.10 S6 | 验收写「`HIR_OP_RAW` **计数不变**」，而 §4.11/§4.12 要求 **`== 0`**——措辞会让门禁判据变模糊 | 统一为 `HIR_OP_RAW == 0`，并补 §4.11.1 的「HIR 中无糖 kind 节点残留」正向断言 |
| 5 | §4.10 S6 | S6 **完全未提 SAST**，但 §4.11.4 要求脱糖产物落 SAST——迁移计划缺环节 | S6 动作补「引入 SAST 渐进降级层（§4.11.4）」 |
| 6 | §4.11.2 | `LOWER_OPAQUE` 被写成永久机制，与 §4.11.1/§4.11.4「糖须全脱糖、无糖节点到 HIR」**方向相反**——真实张力未消解 | 明确为**过渡机制**：仅白名单 7 kind 可用、用户新糖禁止新增、逐条退役、目标归零、门禁跟踪只减不增 |
| 7 | §3 P0 行 | 仍写「分派走 `switch`」，与 §4.4.1 / S1 的 `match` 不一致 | 改为 `match`（穷尽 + 跳转表 `O(1)`） |
| 8 | §5 | `src/base.tc` 条重复「S4 收口时删除垫片」两次 | 删除重复 |
| 9 | 全文 | 标题层级混乱：4.11–4.13 是 `##`，4.14/4.15 却是 `###`、4.16 是 `####`（子节 `#####`）——目录断裂 | 统一 4.14–4.16 为 `##`（子节 `###`），共 22 处 |
| + | §4.16.3 / §4.15 | 谓词 `feature("gpu")` 是函数形式，与「操作数仅限字段 + 字面量」矛盾；两处代码块误用 ` ```rust ` 围栏 | 注明 `feature(x)` 仅为 `"x" ∈ features` 语法糖、不引入求值原语；围栏改 `c` |

### 三项自相矛盾 —— 最终方案（裁定）

| 矛盾 | 最终方案 | 为什么是它 |
|---|---|---|
| ① `FuncDeclNode.flags` 布尔位域 vs §4.15.3 `modifiers[]`/`attrs[]` | **`modifiers: []Mod` + `attrs: []Attr` + `cfg_pred: CfgPred`**，位域废除 | §4.15.3 的收益（fmt 原样还原顺序、lint/反射可查、新增修饰零侵入）**全部依赖**结构化列表；位域只省几个字节，却让「加一个 `entry` 修饰」要改 `mk_FuncDecl` 签名与全部调用方——正是 §1.3 第 2 条要消灭的坑。`entry`（§4.16.5）与 `when` 谓词因此天然有处安放。 |
| ② `NodeRef` 注释「打包 u64」vs 结构体双 `i64` | **单 `u64`**（高 32 tag / 低 32 idx）+ `mk_noderef`/`nr_tag`/`nr_idx` | TL;DR 与 §4.4.1 都以「打包 NodeRef」为前提；且 NodeRef 大量作侧表下标与 map 键（§4.5），单整数比较/哈希最廉价，并能直接对 `nr_tag(n)` 做 `match` 走跳转表。双字段是 128 位且无法整体哈希。 |
| ③ `node_visit` 生成 `if/else` 链 vs §4.4.1 「match → 跳转表 O(1)」 | **生成 `match(nr_tag(n))`**，明令禁止退化回 if/else | §4.4.1 的 O(1) 收益只有 `match` 能兑现；if/else 链是 O(n) 且随 kind 数增长。§4.6 原写法会让 §4.4.1 的承诺落空，故骨架必须与之一致。 |

### 追加修正 4 处（依文档自身规则推导）

| # | 位置 | 问题 | 方案（依据） |
|---|---|---|---|
| 10 | §4.15.1 / §4.15.7 | **`var`/`const` 归类错误**：`let` 因形状歧义被判强制，而与之**完全同构**的 `var`（examples+conformance 实测 **1208 次**，t 主绑定词）、`const` 却被列为「上下文修饰词」；同节括号已写「保留 var 则需同步硬保留」——自相矛盾 | **绑定三兄弟 `let`/`var`/`const` 一并归强制**（同构同进同出）；从修饰列表移除 `var`、`const`；`mut` 从未出现在 t 的 41 项关键字表，**直接移除**。未来若采纳「全局禁 juxtaposition」，三者可一并降为上下文（记入 §7 第 6 条）。依据 = §4.15.1 自身判定规则 + `src/lex.tc:39` 实测 |
| 11 | §4.16.3 | `CfgPred` 被 §4.3 `cfg_pred` 字段与 §4.16.6 引用，**全文却无定义** | 补受限谓词 AST（`CFG_AND/OR/NOT/EQ/IN/FIELD/LIT` + `span`），刻意**不是**通用表达式（禁函数调用/副作用），保证 CfgPass 可在无语义分析前提下编译期求值；操作码封闭登记，禁止用户扩展。依据 = §4.16.3 已有的「操作数仅限字段+字面量」约束 |
| 12 | §4.11.3 | `DesugarPass.run` 给了**两种互斥形态**（`fn() void` 或 `fn(NodeRef) NodeRef`） | **统一为节点级 `fn(NodeRef) NodeRef`**，删模块级变体。依据 = §4.11.1 铁律第 3 条把 run 合同描述为「产出 core/SAST 节点」（只有节点级能表达，也才可被门禁断言姿势 A）+ §4.13.1 用户 API 本就是节点级。需整趟分析的糖改为「分析 Pass 写侧表 + 节点级改写」两段 |
| 13 | §4.5 vs §4.12 | 侧表两套身份对不上：§4.5 是裸数组 `node_type[]`，§4.12 `owns`/`requires` 却是 `Sym32("Table")` 表名 → §4.12.3「失效」无法落地 | 引入 **`SideTable { name: Sym32("Table"), owner, dirty }` 登记表**：§4.5 的数组是**实例**，`name` 是**身份**，`owns`/`requires` 引用 `name`，PassManager 据此建拓扑与置脏。索引一律用 `nr_idx(n)`。用户 `@pass(owns=["myopt"])` 自动进入同一登记，故 lint 可直接消费（§4.13.3） |

### 5 项待定 —— 裁定结果（已落地）

1. **`accept_name()` 入导出面** —— **采纳**：加入 §4.14.2 模块布局与 §4.14.3 导出面（含用户 `@desugar`）。理由：8 类位置各写一遍必然漏，漏了就是 §1.3 第 7 条的静默错编；统一后门禁可断言「8 类位置全覆盖」。
2. **`phase` vs `stage` 命名** —— **采纳改名**：`DesugarPass.phase` → **`order`**（脱糖顺序），`Pass.stage` 保留（IR 层级）。§4.11.3 / §4.12.4 / §4.13.1 已同步。
3. **`Node` 字段数** —— **改为 28**（逐项点算并列于 TL;DR），删去「30」的两处近似写法。
4. **intern 池跨模块** —— **裁定：按 tag 全局共享同一池**（不再是开放问题，§7 第 4 条已标已决）。理由：若同 tag 池按模块分裂，「跨模块同名同 id」不成立，与 §4.4「跨池比较即类型错误」的语言保证冲突；全局唯一是唯一自洽解。
5. **trivia 两种表示** —— **裁定：先做「span 间隙」**（`leading/trailing` 两段字节范围指向源文本，不复制内容），子节点形态留作未来可选。理由：不增节点数、不动 `node_visit` 穷尽性与 `mk_*` 签名，S5 可独立落地，且已够支撑 `--format` 与富诊断。§4.8 与 §4.14.2 已一致。

## 0.7 三次复审（2026-09-29，全文通读 + 文档↔仓库事实核对）

本轮在 §0.6（文档内部自洽）基础上再通读一遍，并把文档里的**外部引用**（工具 / 目录 / 关键字表）逐条对回真实仓库，修正 **4 处**（其中 1 处是 **blocker 级**：整份迁移计划依赖一个已被删除的工具）。

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 14 | §1.4 / §2 / §4.3 / §4.6 / §4.10 S4·S6 / §4.11.2 / §4.12.4 / §4.13 / §5（**共 13 处**） | **依赖已删除的工具**：全文把「enum + 分表 + `mk_*` + visitor + `lower_policy` 的生成」挂在 `tools/totter.tc`，而 **totter 已于 2026-09-28 删除**（`README.md:10/18/141/167/173`、`tote.toml:18`、`src/base.tc:14-16`：`GEN:` 区间现冻结手写）——S4/S6 实际**无工具可执行** | 改为**新建** Node 生成器 **`tools/cstgen.mjs`** + 唯一真源 **`tools/cst_kinds.json`**；§4.3 增「生成器说明」注（含为何不接 `gen_ebnf.mjs`：其 `ebnf.json` 默认写到 **tnote 工程**、刻意与 t 仓库 `out/` 解耦，`README.md:133` / `gen_ebnf.mjs:28-31`）；退路与风险记入 §7 第 7 条 |
| 15 | §4.15.2 / §4.15.7 | 上轮把 `var`/`const` 提升为强制关键词后，**`TokKind` 枚举未同步**（仍只有 `KwFn/KwLet/KwIf/KwElse/KwReturn`），且 §4.15.7 映射表的「上下文·修饰」行仍列着 `const` —— 上轮自身的回归 | 枚举补 **`KwVar, KwConst`** 并注明**不含** `KwPub/KwExtern/KwComptime/KwWhen/KwEntry`；映射表从上下文行移除 `const`、补 `entry` |
| 16 | §8 差异表 | 裸标识符三引号示例写成 `@"""...""")` —— **多一个右括号，示例破损** | 改为 `@"""..."""`；并复核 §4.15.4/§4.15.5/§4.15.6 的 `@"..."` 表述一致 |
| + | §4.14.5 | `std.rc.cst` 落地缺两项**文件系统级前置**：`lib/std/rc/` 目录**当前不存在**（`lib/std/` 下只有扁平 `*.tc`）；`tools/build_std.mjs:32` 的 `MODULES` 目前是 `["mem","math"]`，不加 `rc.cst` 则 `.tlib`/`.tlibd` 不会被预编译 → `@import("std.rc.cst")` 链接模式直接失败 | 补「**S0 落地清单（易漏三项）**」：① 建 `lib/std/rc/cst.tc`；② `MODULES` 加 `"rc.cst"`；③ 路径按 `dots_to_slashes` 落 `out/lib/std/rc/cst.tlib`（勿退回扁平 `out/lib/<mod>.tlib`） |

> **方法论差异**：前两轮只做「文档内部自洽」检查，本轮追加「**文档 ↔ 仓库事实**」核对（工具是否存在 / 目录是否存在 / 枚举是否与裁定同步）。结论：文档内部自洽已达标，**剩余风险集中在外部依赖的时效性**。建议后续把「文档引用的工具与路径」做成存在性断言（如 `dagcheck.mjs` 增一条：文档中出现的 `tools/*.mjs` 与 `lib/**` 路径必须存在），防止文档再次静默腐化。

---

## 0.8 迁移路径专项审查（§4.10）—— 判据层纠错

对 §4.10（S0–S8）做专项审查，并对回真实门禁/CI 设施（`tools/gate.mjs`、`.github/workflows/ci.yml`、`nightly.yml`、`tools/ir_snapshot.mjs`）。发现 **8 处**，其中 **#17 是判据级错误——按原表执行会导致每个阶段都被误判为失败**。

| # | 位置 | 问题 | 修正 |
|---|---|---|---|
| 17 | §4.10 铁律 + S0/S1/S3/S5/S7/S8 验收 | **判据用错（最严重）**：把「`.ll` md5 不变」当验收目标，但 **S0 起几乎每阶段都必然改变 IR 发射**（内联→库链接 / 加字段 / 删字段 / 换 `Span`）→ 按原表执行每阶段都会红，且会被误判为回归 | 新增 **§4.10.0** 拆分两类判据：**硬门 A 自举不动点**（`g2==g3`，L2 加 `g4`；破=回滚）与 **软基线 B IR 快照**（变=**重录**，非回滚）；全表验收统一改为「不动点 A + 基线 B 已按预期重录」 |
| 18 | §4.10 S1 | 「字段布局**保持字节兼容**（仅新增 `tag` 字段）」—— 新增字段**不可能**字节兼容，自相矛盾（与 §0.6 已修的 NodeRef 双 `i64` 同类） | 改为「保留旧字段不删、新增 `tag`（布局必然变 → 基线必重录）」；§6 同步 |
| 19 | §4.10 S0 | S0 验收写「`.ll` md5 不变」，但内联源码树 → `.tlib` **链接**必然导致符号外部化、IR 变化 | 改为「基线重录 + 差异仅为『std 符号外部化』一类预期变化」；风险由「低」上调为 **「中」**（构建期循环 + 种子约束，见 #21） |
| 20 | §4.10 全表 | **缺标准操作序列**：未写「重录基线 / 同步 `tc.exe` / 刷新 seed / **门禁起跑后绝不能再改 `src/`**」 | 新增 **§4.10.2** 六步序列 + 回滚策略（每阶段独立分支、单提交合并 → 回滚 = revert 该提交） |
| 21 | §4.10 全表 | **缺 CI 与种子约束**：CI **只跑 L1**（`ci.yml`，push→main），L2 是本地动作；`ci/seed/tc.exe` 是**提交进仓库的上一稳定版**；S0 后 CI 用**旧 seed** 编译 `lib/std/rc/cst.tc` → cst.tc 只能用 seed 支持的特性子集，否则**本地绿、CI 红** | 新增 **§4.10.1**；S0 验收增列「CI 用 seed 能编出 cst.tc，否则先刷新种子」。**这是 S0 最易踩的坑** |
| 22 | §4.10 S2 / S4 | **顺序错配**：S2 就要产出分表 + 类型化 `mk_*`，S4 才新建生成器 → 同一批代码**手写一遍、再改生成一遍**，第二遍极易漂移 | 新建生成器**前置为 S2a**；§7 第 7 条退路同步为「S0/S1 可全手写，**S2 起建议、最晚 S4 必须有**」 |
| 23 | §4.10 S8 | **依赖缺失**：§4.13.3 / G7 明写「fmt 只消费 CST + trivia」，而 trivia 在 **S5**；S8 却未声明依赖 S5 → fmt 无法保留注释/空白 | S8 依赖改为 **S5 + S6 + S7**；补**依赖图**（关键路径 S0→S1→S2→S3→S4） |
| + | §4.10 S0 / S1 | 主表未体现关键词分类的归属（§4.15.7 归 S0+S1、§4.16.6 `entry`/`CfgPred` 归 S1、CfgPass 归 S7）→ 实现者会漏 | S0 行补「关键字表拆入 `std.rc.cst.lex`」；S1 行补「`KwMod`/`KwAttr`/`KwRole` + `KwMod::Entry` + `CfgPred`」；S7 行补「CfgPass」 |

> **本次核对为真的外部事实**：
> - `tools/gate.mjs` 步骤：`boot_std`(预编译 std，lv0) → `boot1`(→g1) → `snapshot`(IR 快照，lv0) → `conform` → `boot23`(g2==g3，lv1) → `examples` → `hir`/`hireval` → `diffgen`/`diffpipe` → `boot4`(g2==g3==g4，lv2) → `cself`/`difftc0`/`miropt`/`rls`/`tote`。
> - `snapshot` 步骤注释明确：基线**由 LLVM 自举产物 g1 录制**，用 C 产物做基线必然假红；`ir_snapshot.mjs:33` 注明「基线应随语义变更一同提交」。
> - `src/base.tc` **无 `@import`**（叶子），`lex.tc`→`base`，`parse.tc`→`base`+`lex` —— **S0 依赖链干净，可最先做**（支持原判断）。
> - `ci.yml` 头部注释：CI 等价 `gate L1`；L2 的 `miropt` 依赖 wasmtime/riscv，**CI 不跑**；种子刷新命令 `cp out/dbg/tc.exe ci/seed/tc.exe`。

---

## 0.9 S0 实施启动（编码阶段）

> 状态：**进行中**。本节记录从设计转入编码后的**第一手事实**——凡与设计假设冲突者，以本节为准，并已回改相应设计小节。

### 已落地

- 新建 **`lib/std/rc/cst.tc`**（库模块 `std.rc.cst`，文件头 `@module(pub)`），首批搬入**关键字表 + `kw_lookup`**（原 `src/lex.tc` 的 `GEN:kw_lookup` 区间，32–56 行）。
- **为何选它做试点**（三条均已核实）：
  1. **零外部引用**——`grep` 全 `src/*.tc`，`g_kw_text`/`g_kw_kind`/`g_kw_count`/`kw_lookup`/`KwEntry` 除 `src/lex.tc` 外**无任何命中**；影响面完全隔离。
 2. **无运行期全局初始化（源码层）**——`g_kw_text`/`g_kw_kind` 是 `[41]string` **静态定长数组**（HEAD `df2bc21` 已改为编译期初始化，`init_keywords()` 已空）。
    ⚠ **该理由事后被证伪（见下方「`.tlib` 预编译实测」）**：源码层是常量，但 **LLVM 侧仍发成 `zeroinitializer` + `t.__ginit` 逐元素回填**（`g1.ll:662834` / `664915`）。也就是说「是否踩 §4.14.7」**不看源码是不是常量，只看发射产物是否依赖 `t.__ginit`**——本例依赖。结论不变（仍不能安全预编译为 `.tlib`），但**判据必须改写**。
 3. 自包含、可整段搬迁，无需拆分。

### 实施中发现的硬约束（已回改设计）

| 发现 | 依据 | 对设计的影响 |
|---|---|---|
| `.tlib` 独立编译时**跳过进程级全局**（`t__ginit` / `t_atom_table` / `t_atom_count` 由主程序提供） | `docs/reference.md` rule 6b | 带运行期初始化器的全局状态**不能**搬进库 → **S0 拆为 S0a / S0b**，新增 **§4.14.7**；`base`/`parse` 节点池暂缓 |
| 跨包库导入经 `mangle_modules` **必然重整**符号（`g_kw_text` → `cst__g_kw_text`），**即便走内联回退也重整** | rule 2 / rule 5 | 修正「内联回退 ⇒ IR 不变」的误解：**rule 2 的「IR 逐字节不变」只对入口模块成立**（入口别名 `""` 永不重整）。S0 必改 IR、必重录基线 —— 印证 §4.10.0 的判据拆分 |
| `src/*.tc` **均无 `@module` 头**（`base`/`lex`/`parse`/`sema`/`tc` 实测全为 0） | grep | `src` 内联树不需要模块头；一旦迁入库路径则**必须**加 `@module(pub)`，否则跨包访问报 `T-MOD-E558` |
| 库搜索路径可命中 `lib/std/rc/cst.tc` | rule 5b ②（工程源码根的父目录 = 工程根下的 `lib/`） | 搬迁路径可行，无需改搜索配置或加 `T_LIB_PATH` |
| `is_top_decl_kind` **含 `GlobalVarDecl`** | `src/sema.tc:10265` | 全局变量**可**进 `exports.json` 接口块；故阻点不在「能否导出」，而在「库的 `t__ginit` 不执行」 |

### 门禁基线（S0 改动前）

- `node tools/gate.mjs L1`，HEAD `df2bc21`、`src/` 干净：**15 passed / 0 failed / 2 skipped**（1469.7s）。
  - 两个 SKIP（`run_examples`、`difftest 代际对拍`）是 gate 的**快照跳过推理**：「产物快照全同 ⇒ 运行结果必然一致」。⚠ 含义：一旦改动让快照 DIFF，这两项就**不再被跳过、会真的跑**，门禁耗时显著变长。
  - 各步耗时参考：`boot1` 198s、`snapshot` 494.8s、`boot23` 405.7s、`diffpipe` 222.5s、`conform` 74.8s。
- `g1`/`g2`/`g3` 的 `.ll` **均为 47554130 字节**（大小一致；终判以 md5 为准）。

### S0a 改动内容

1. 新建 `lib/std/rc/cst.tc`（`@module(pub)`），承载关键字表 + `KwEntry` + `init_keywords` + `kw_lookup`。
2. `src/lex.tc`：删除原 `GEN:kw_lookup` 区间（25 行），文件头加 **`pub @import("std.rc.cst" :: *);`**
   - 用 `pub` + `:: *` 是**必需的**而非可选：`src/tc.tc:103` 有跨模块调用 `lex.init_keywords();`，只有 `pub` 重导出才能让该调用继续解析到 `cst` 的真实定义（rule 2c：`本模块.name` 重定向到 `M__name`）。
   - 实测 diff：7 insertions / 25 deletions，换行符保持纯 CRLF，无噪音。

### 验证进展

| 步骤 | 结果 |
|---|---|
| `tc check src/tc.tc --emit-deps` | ✅ 依赖图出现 **`{"from":"lex","to":"cst"}`** —— 库模块解析成功，命名空间取末段 `cst`（rule 3），库搜索路径命中工程根下 `lib/`（rule 5b ②） |
| `tc check src/tc.tc` | ✅ EXIT=0，**error 数 0**（仅基线既有的 `T-NAM-W402` 等 warning） |
| `gate L0` | `boot1` **PASS 175.7s**（新代码能自举）、`irverify` PASS、`llvmverify` PASS；**`snapshot` FAIL：「3 处与 LLVM 自举基线不符」** |
| 差异性质定位 | ✅ **`g1.ll` 出现 `cst__KwEntry` / `cst__g_kw_count` / `cst__g_kw_kind` / `cst__g_kw_text` / `cst__init_keywords` / `cst__kw_lookup` 六个重整符号；旧基线中 `cst__` 计数为 0** ⇒ 差异 = 预期符号重整，**非回归**。与 §4.14.7 预判一致 |
| 重录基线 `ir_snapshot.mjs --update --compiler out/dbg/g1.exe --jobs 1` | ✅ 完成（约 9 min）；diff 仅 6 行：3 行元信息（updated / compilerMd5 / srcHash）+ `src/tc.tc::c/h/ll` 三条 md5。**其余 114 个目标（examples / tests / tote）逐字节未变** |
| `gate L1` 复跑 | ✅ **15 passed / 0 failed / 2 skipped**（1513.4s），与前基线**同构**（仍 2 SKIP ⇒ 快照推理仍成立）；`boot1` 190s / `snapshot` 550s / `boot23` 338s / `diffpipe` 258s / `conform` 94s |
| 一代收敛 | ✅ `g1.ll == g2.ll == g3.ll`（md5 `1738dd7e…`）⇒ 判据 A（自举不动点）**绿** |
| 同步 `cp out/dbg/g1.exe out/dbg/tc.exe` + `gate L0` 复跑 | ✅ **10 passed / 0 failed**（833.4s）⇒ 重录后的基线在「新一代编译器」下**依然有效**，非一次性巧合 |
| 提交 / 合并 / CI | ✅ `ec8400a`（分支 `wb`）→ 合并入 `main` 为 `4b63ced` 并推送，触发 `ci.yml`（push to main → `gate L1`） |

> **一个值得记录的观察**：`g1.ll` 的**字节大小与基线完全相同**（47554130），但 md5 不同——重整把 `g_kw_text` 换成 `cst__g_kw_text`，长度变化被其它对齐/命名变化抵消。**故「文件大小相同」不能作为 IR 未变的判据**，必须看 md5（这也是 §4.10.0 坚持用 md5 + 快照而非尺寸的原因）。

### `.tlib` 预编译实测：两个独立硬阻点（S0a 收尾阶段发现）

把 `rc.cst` 加入 `tools/build_std.mjs` 的 `MODULES` 后实测 `node tools/build_std.mjs`（编译器 `out/dbg/tc.exe`），**两个独立失败**：

| # | 现象 | 根因 | 性质 |
|---|---|---|---|
| 1 | `out/lib/std/rc/cst.ll:24:33: error: use of undefined value '@tll_alloc'` → `clang -c (lib) failed` | 运行时 shim 声明（`tll_alloc` / `t_runtime_init` / `t_arena_new` …）由 **`ll_emit_main_wrapper`** 发射，而它第一行即 **`if (g_has_main == false) { return; }`**（`src/tir_to_ll.tc:4993`）。库模式无 `main` ⇒ 一个 shim 声明都不发 ⇒ 库里一旦用到堆分配必崩。（同文件里 `tll_str_eq` 能声明，是走了另一条按需声明路径） | **响亮失败**（链接期报错，不会静默） |
| 2 | 产物中 `@cst__g_kw_text = global [41 x %TStr] zeroinitializer`，**没有 `t.__ginit`**，也没有常量初始化器 | 库模式**跳过 `t.__ginit`**（rule 6b）；而带初始化器的全局**一律**走「zeroinit + ginit 回填」发射，真值**全靠主程序启动时回填** | **静默错编**（若链接进主程序，关键字表**永久全零**，`kw_lookup` 恒返回 `""`，且不报错） |

补充实测：`pub var` → `pub const` **不能**解决 #2（`const` 全局同样发 `zeroinitializer`，且会触发 `UPPER_SNAKE_CASE` lint warning）；故**判据不是「源码是否常量」而是「发射是否依赖 `t.__ginit`」**。

**处置（已落地）**：
- `MODULES` **保持 `["mem","math"]`**，不列 `rc.cst`；`std.rc.cst` 走**源码内联导入**（无 `.tlib` 时编译器自动内联，已由 gate L1 15/0 验证）。
- `build_std.mjs` 仍做**通用化改造**（点分逻辑名 → `dots_to_slashes` 自动推出源路径与产物路径 + `mkdir -p` 父目录），为将来嵌套模块（如 `std.rc.cst.lex`）**预留**，不改语义。
- 新增 **R-LIB-PURE 规则**（§4.14.7）：`.tlib` 适用面 = **纯函数 + 零初始化全局**。已预编译的 `mem`/`math` 天然满足（无全局状态），故现状安全。
- 解除阻塞的前置（**不属 S0 范围**）：① 库模式补发 shim 声明；② 全局改发**静态常量初始化器**（LLVM `global [41 x %TStr] [ ... ]`）——② 同时是主程序优化（省掉 ginit 里 41×N 条 store），但会**大幅改变 IR**，须单独立项并整体重录基线。

---

## 0.10 S1 实施启动：kind 宇宙普查与枚举化

> 状态：**进行中**。本节记录 S1（§4.4.1 kind 数值化）开工前的**源码实证**与据此改写的方案。

### 0.10.1 普查工具链（先建工具，再动手改码）

| 工具 | 作用 |
|---|---|
| `tools/cst_kinds_census.mjs` | 从 `src/*.tc` 抽取四类证据（① `node_new("K")` 产生点 ② `mk_X(` 调用 ③ `.kind == "K"` 判定 ④ `.kind = "K"` 改写），产出清单 **`tools/cst_kinds.json`** |
| `tools/cstgen.mjs` | 消费清单，生成 `lib/std/rc/cst.tc` 的 `GEN:kinds` 区间（`g_nkn_count` / `node_kind_names` / `NK_*` / `nk_name` / `nk_of_kind` / `is_node_kind`）；`--check` 供门禁断言「生成物 == 清单」（S2a 验收项提前具备） |

### 0.10.2 三个改变方案的实测事实

| # | 事实 | 证据 | 对方案的影响 |
|---|---|---|---|
| 1 | **注册表不完整**：`node_kind_names` 只有 86 项，实证 Node kind 有 **105** 项，漏 19 个（`ClauseDead` / `block_expr` / `import_expr` / `variant_lit` / `deserialize` / `conpat` / `bitstr*` / `slice_pat` / `unit_lit` / `typeinfo` …） | census 报告 | 枚举**必须**按实证全集建，否则这些 kind 一律落到 "未注册"，将来 `match(nr_tag)` 分派会出现「全走 unknown 兜底臂」的静默退化 |
| 2 | **`.kind` 是多个互不相交宇宙共用的字段名**：`Node.kind` / `TypeDesc.kind` / `HvValue.kind` / token kind 混在一起。仅出现在比较式里的 28 个串（`Array` / `Map` / `Void` / `Pointer` / `Slice` …）实为 **TypeDesc.kind**，不是 Node kind | census 分类（按「有无产生点」区分） | 枚举**必须按宇宙隔离**，禁止把 TypeDesc 串并进 `NK_*`——与 §4.4.1 的 `Sym16/32/64(tag)`「不同集合不可比较」**同一原则** |
| 3 | **9 个 kind 会在构造后被改写**（`n.kind = "block"` / `"ident"` / `"paren"` / `"FuncDecl"` / `"closure_make"` / `"serialize"` / `"deserialize"` / `"ClauseDead"` / `"block_expr"`，共 20 处赋值） | census「构造后改写」表 | **S1 不落地 `tag` 字段**（见 0.10.3 裁定） |

附带事实：`is_node_kind` / `node_kind_names` **零外部消费点**（只有 `src/tc.tc:104` 调一次空的 `init_node_kinds`），注册表实质是**死代码** ⇒ 把它从 86 扩到 105 **零语义风险**，且迁入 `std.rc.cst` 也只影响符号重整。

### 0.10.3 裁定：S1 **不**新增 `Node.tag` 字段（偏离 §4.10.3 原措辞，理由如下）

原方案：S1「新增 `tag` 字段；`Node` 布局变化」。**实施期改为延后到 S4（随 `NodeRef` 落地）**，理由：

1. **陈旧状态风险**：`tag` 是 `kind` 的**派生值**；既然有 20 处构造后改写 + 3 处 `dst.kind = src.kind` 整节点拷贝，任何一处漏同步 ⇒ `tag` 与 `kind` 不一致，且**不报错**（正是 §1.3 第 7 类「静默错编」）。
2. **当前零消费者**：字段在 S2 分表落地前无人读取，纯属负担。
3. **S2 有条件安全落地**：S2 会重写 `mk_*`/节点写入路径，届时可统一收口为 **`node_set_kind(ni, k)`**（同时写 `kind`+`tag`）+ **节点拷贝走 `node_copy()`**，并用 `grep "\.kind = "` 断言「零裸写」——这才是可验证的穷尽性，而不是靠人肉记住 20 处。
4. **能力无损**：S2 的访问者在进入节点时算一次 `nk_of_kind`（此时 kind 已稳定），之后全整数分派，与原方案的 O(1) 等价。

> 过渡实现取舍：`nk_of_kind` 目前是**线性扫描**（105 次串比较）。原因：t 语言层**没有暴露字符串序比较**（runtime 只有 `tll_str_eq`，无 `strcmp`），无法二分；且它当前只在 `is_node_kind` 内部被调用（死代码路径）。S4 消费方切到 `u64 NodeRef`（`nr_tag(n)` 取 `NK_*`）后该开销自然消失。
>
> **实施期事实校正（2026-09-30）**：S1a 仅建立 `NK_*` 数值 kind *宇宙*（注册表 + `nk_name`/`nk_of_kind`/`is_node_kind`，迁入 `std.rc.cst`，`cstgen --check` 硬不变量）；`Node.kind` 存储类型**未变**（仍为 `string`，824 处消费方仍 `n.kind == "X"`），`g_node_nref` 占位数组**仍为全 0**（写入面只在 `node_new` append 0，未由 `cst_register_*` 回填 `tag|idx`）。即：「`tag`/`NodeRef` 打包」**不在 S2 落地**，而是随 **S4**（mk_*/消费方从 `i64 id` 切到 `u64 NodeRef`）落地——与 §4.10.3 S4「`node_to_hir` 桥切到 `NodeRef`」一致。S2 的真实交付是 SoA `tbl_*` 镜像 + 双写 + 类型化访问器，旧 `nodes[]` 仍是真相源（§0.12.5）。故 §4.10.3 S1「`kind:string → 数值枚举 NK_*`」应读作「建立 NK_* 宇宙；存储/消费切换骑在 S4 的 NodeRef 上」，非「S1 改 Node.kind 存储类型」。

### 0.10.4 本轮改动内容

1. `lib/std/rc/cst.tc` 新增 **`GEN:kinds` 区间**（105 个 kind + `NK_*` 常量 + `nk_name` / `nk_of_kind` / `is_node_kind`），由 `cstgen.mjs` 生成。
2. `src/base.tc`：删除原 86 项注册表（含 `init_node_kinds` / `is_node_kind`），文件头加 **`pub @import("std.rc.cst" :: *)`** 重导出 —— 与 S0a 的 `lex.tc` 同构，`base.init_node_kinds()`（`src/tc.tc:104`）等引用点**零改动**。
3. 新增门禁步骤 **`cstkinds`（CST kind 清单一致性，`cstgen --check`）**，紧随 `diagdef` 之后 —— 把「生成物 == 清单」提升为硬不变量，与 `gen_diag --check` 同构。
4. 验证（全部实测）：

| 步骤 | 结果 |
|---|---|
| `tc check src/tc.tc` | ✅ EXIT=0，errors **0**（warnings 291，与改动前同量级；**cst.tc 零告警** → `NK_*` 命名合规） |
| `dagcheck.mjs` | ✅ OK：9 模块 / 1218 个顶层符号，**无反向引用**（`base → std.rc.cst` 属外部库边，不计入 src DAG） |
| `cstgen --check` | ✅ OK（105 个 kind，生成物与清单一致） |
| `gate L0`（改动后首跑） | `boot1` **PASS 175.4s**（新代码能自举）、irverify/llvmverify PASS；**`snapshot` FAIL「3 处不符」**（预期：`src/tc.tc` 的 c/h/ll 三个 md5，因编译器自身代码增量） |
| 重录基线（g1） | ✅ 117 targets / 354 entries（482.4s）；`git diff` **仅 6 行**：3 行元信息 + `src/tc.tc::c/h/ll` 三条 md5；**其余 114 个目标逐字节未变** |
| `gate L1` | ✅ **15 passed / 0 failed / 2 skipped**（1505.6s）——含 `自举不动点 (g2==g3)` PASS 346.7s、`conformance` PASS 90.8s、`双轨对拍` PASS 270.5s |
| 一代收敛 | ✅ `g1.ll == g2.ll == g3.ll`（md5 `16c506c6…`）⇒ 判据 A 绿 |
| 同步 `cp out/dbg/g1.exe out/dbg/tc.exe` + `gate L0` 复跑 | ✅ **10 passed / 0 failed**（778.4s）⇒ 重录基线在新一代编译器下仍有效 |

---

## 0.11 S1b：上下文关键词下沉（试点批）

> 状态：**进行中**。§4.15 的落地方式经实施期复核后改为**分批下沉**，本节记录第一批的取舍与验收。

### 0.11.1 为什么不能「整表一次性翻转」

`src/parse.tc` 的 99 处 `Kw*` 判定里，有一类是**报错分支**而非消费分支，例如：

```c
if (t == "KwStruct") {   // 旧式 `Name struct` 已废弃 → 报 T-PAR-E102
    parse_fatal_at("T-PAR-E102", "... `Name struct` is no longer supported", lex.pos);
}
```

若把 `struct` 一并翻成 `Ident`，这些**诊断会静默失效**（旧式写法不再报错，而是被解析成别的东西），
conformance 的 `fail/` 用例随即转红。故下沉必须**逐词检查「是否与报错分支耦合」**。

### 0.11.2 判定改写规则（本批确立的实现范式）

上下文关键词在词法层已是 `Identifier`，因此 parser 判定**一律改为按词文本、不按 token 类型**：

```c
- if (lex.cur_t() == "KwPub") {        // 旧：按 token 类型
+ if (lex.cur_v() == "pub") {          // 新：按词文本（两种 token 下都成立）
```

- `cur_t()=="KwX"` 与 `cur_v()=="x"` 在翻转前**等价**（`Kw*` token 的 `v` 就是该词文本），
  故改写本身**零行为变化**，可独立验证；翻转只改 `std.rc.cst` 的 `g_kw_tier` 一行数据。
- 捕获在变量里的（`var t: string = lex.cur_t();` → `t == "KwX"`）需**同时**取文本
  （`var tv: string = lex.cur_v();` → `tv == "x"`）。⚠ 只在**同一 token 位置**做判定时才成立；
  跨位置持有 token 类型变量的地方不能这么改。

### 0.11.3 第一批下沉的 4 个词 + 两条排除理由

| 词 | 类别 | 判定点 | 结论 |
|---|---|---|---|
| `pub` / `kernel` / `overload` / `extend` | 上下文·修饰 | 全部在**声明起始位消费前缀**（7 处） | ✅ 下沉 |

**排除 `comptime`（必须留强制）**：它在**表达式层**是前缀 `comptime expr`（`parse_primary`），
与「标识符 `comptime`」在 1-token 前瞻内**不可区分**（`return comptime;` vs `comptime x`）→
按 §4.15.1 判定规则属强制。（本批最初误列 `comptime`，实施期按此理由剔除。）

**排除类型构造词（`struct`/`enum`/`flag`/`union`/`variant`/`agent`/`type`/`map`…）**：
它们的判定点里混有**旧式 `Name struct` 报错分支**，须随各自分支一并处理，不属第一批。

### 0.11.4 验收（试点用例 + 门禁）

| 检查 | 结果 |
|---|---|
| 试点用例：`var pub/kernel/overload/extend: i32` | 改前 **T-PAR-E101**（expected Identifier）；改后 **0 error** |
| 目标场景：`struct S { pub: i32; kernel: i32 }` + `s.pub` / `s.kernel` | 改后 **0 error**（§4.15 的「点号后无歧义 ⇒ 降为字段名」落地） |
| 回归：`pub fn f()` 顶层声明仍可用 | 0 error |
| 回归：局部 `pub var x` 仍报 **T-MOD-E556** | ✅ 诊断保留（未因下沉而静默失效） |
| 真实示例 `examples/adt_list.tc` | 0 error |
| `gate L0`（改动后首跑） | `boot1` PASS 175.4s；**`snapshot` FAIL 仅「3 处」**（= `src/tc.tc::c/h/ll`）⇒ **token 流变化未影响任何 example/test 产物** |
| 重录基线（g1） | ✅ 117 targets / 354 entries；`git diff` **仍只 6 行**（3 元信息 + src/tc.tc 三条 md5） |
| `gate L1` | ✅ **16 passed / 0 failed / 2 skipped**（1457.7s）——含不动点 349.6s、conformance 93.3s、双轨对拍 261.1s |
| 一代收敛 + 同步后 L0 复跑 | ✅ `g1.ll==g2.ll==g3.ll`（`ef3872cd…`）；**L0 11 passed / 0 failed**（879.3s） |

---

## 0.12 S2 实施：NodeRef 双写落地 + 种子递归根因实证

> 状态：**S2 全量铺开已落地并达成自举不动点**——91 kind 的 `tbl_*` SoA 切片 + `cst_register_*` 双写登记 + 92 个 `mk_*` 挂接，经 `tools/cst_rollout.mjs` + `tools/cstgen.mjs` 生成并接线；**S2b（种子失控递归）已修复**（见 §0.12.5）。C 后端固定点 `C_b==C_c` 已达成（genB/genC `tc.h`/`tc.c` 逐字节 `SAME`，详见 §0.12.6）。

### 0.12.1 根因纠正（推翻「通用种子递归 bug」旧结论）

前序总结曾断言「S1b 种子存在通用 LLVM 发射 / 语义分析失控递归 bug（约 10 个全局切片即触发）」。经实证**证伪**：

| 验证 | 命令（种子 = `out/dbg/tc.exe`，S1b） | 结果 |
|---|---|---|
| 还原 `src/base.tc` 到 HEAD（`d573dbb`）后全量编译 | `tc.exe check src/tc.tc` | **EXIT=0**（291 warnings / 0 errors） |
| 结论 | 种子本身无通用递归 bug；崩溃确由 S2 新增代码触发 | — |

### 0.12.2 真实触发规律（12 轮隔离实证，`out/_probe/iso*.py` + `mini_*.tc`）

对 base.tc 逐项叠加 / 剥离 S2 组件，精确定位种子在**全程序编译**语境下的失控递归（崩溃码 `EXIT=127` / `0xC00000FD` / `3221225725` = Windows `STATUS_STACK_OVERFLOW`）：

| 组件组合 | 结果 |
|---|---|
| `CstTables` 10 字段结构体（单独） | OK |
| `mk_noderef` / `Span` / `mk_span` 辅助函数（单独） | OK |
| `cst_register_binary` / `cst_nref_of` 任一函数（单独） | OK |
| 3 个裸全局切片（单独） | OK |
| 全局结构体（切片字段）+ 1~2 函数 | OK |
| 全局结构体 + **5 函数** | **CRASH** |
| 全局结构体 + 6 个 reg 函数 | **CRASH** |
| **10 个裸全局切片 + 1 函数** | **CRASH** |
| 仅 `g_node_nref` + `node_new` 内 `append`（MIN_gnref_only） | OK |
| 上述 + 9 个 `tbl_*` 裸全局切片 | **CRASH**（与 1 函数共存即越阈值） |
| `mini_base.tc`（小文件，struct+funcs） | **OK（不复现）** |

**结论**：S1b 种子在**全程序编译**时，对 import 模块 `base.tc` 携带「全局结构体（切片字段）+ ~5 函数」或「~10+ 切片类型全局声明 + 函数」的组合陷入语义分析失控递归（栈溢出）。与具体语句（裸全局 / 结构体字段、索引读写、`append`、`slice_len`、`mk_noderef` 调用）**无关**——本质是**声明数量 / 组合阈值效应**。该 bug **不在最小程序上复现**，属种子全程序 / 跨模块语义分析缺陷，**须修种子才能根治**（即 S2b）。

### 0.12.3 已落地的最小可编译 S2 设计（彻底绕过种子 bug）

- **`src/base.tc`（GEN:node-structs 区间）**：仅
  ```c
  pub var g_node_nref: []u64;            // 与 nodes[] 按 id 对齐的平行 NodeRef 数组（默认 0 = 未登记）
  pub fn cst_nref_of(id: i64) u64 {      // 校验双写：旧节点 id → 新分表 NodeRef；未登记返回 0
      if (id < 0 || id >= slice_len(g_node_nref)) { return 0; }
      return g_node_nref[id];
  }
  ```
  并在 `node_new`（约 263 行，`append(g_node_file, g_file)` 之后）双写：
  ```c
  append(g_node_nref, 0);   // S2 双写：与 nodes[] 按 id 对齐；当前全写 0（未登记）
  ```
  **不含** `CstTables` 结构体 / `cst_register_*` / 辅助函数。
- **`tools/cstgen.mjs`（目标 2）**：改为生成**逐字段独立 typed 全局切片**（符合 §4.14.7「逐字段独立 typed 切片」语义）；当前仅生成 `g_node_nref`，`tbl_*` 与 `cst_register_*` 生成代码注释标注「延后 S2b 修种子后铺开」。
- **行为保持**：因 `parse.tc` 从未挂接 `cst_register_*`，旧 IR 零变化；当前双写写入的全是 0，纯验证机制，不引入语义差异。

**验证**：`seed check src/tc.tc` → **EXIT=0**；`seed compile src/tc.tc --emit-c` → **EMIT_EXIT=0**（产出 `tc.c` 2.3MB + `tc.h`）。

### 0.12.4 自举不动点（关键门禁，已达成 ✅）

用种子作 gen0 验证 S2 自举（C 后端固定点 `C_b == C_c`）：

- `tools/fb.mjs`：node 版，逻辑正确但 `execFileSync` 在 Windows 上对 `tc.exe` 触发 `EBUSY`（errno -4082，文件锁），**未采用**。
- `tools/fb_bash.sh`：**bash 驱动版**（直接 spawn `tc.exe` 与 `clang`，绕开 node EBUSY），注入 `ensureMsvcEnv()` 的 `LIB`/`INCLUDE`，链接用 `-Wl,/STACK:268435456`（**去掉 `/LARGEADDRESSAWARE`**——lld-link 将其误解析为输入文件导致链接失败）。

运行结果：
```
gen1: SEED   -> g1.exe   (emit rc=0, link rc=0)
gen2: g1     -> g2.exe   (emit rc=0, link rc=0)
gen3: g2     -> g3.exe   (emit rc=0, link rc=0)
genB/tc.h : SAME
genB/tc.c : SAME
S2 SELF-HOST FIXED POINT REACHED
```
产物位于 `out/fb/gen{A,B,C}/`。这证明 S2 双写脚手架**不引入任何 IR 分化且编译器可自举**。

> 注：项目规范的权威固定点是 LLVM 后端 `g2.ll==g3.ll==g4.ll`；本分支 S2 pilot 以 C 后端固定点 `C_b==C_c` 验证（确认 C 路径零分化 + 自举可达）。S2b（种子失控递归）**已修复**（见 §0.12.5），修复后种子同样达成 `C_b==C_c` 固定点。

### 0.12.5 S2b 根因与修复记录（已落地 ✅）

**根因（实证定位，推翻「通用种子递归 bug」与「声明数量阈值」旧结论）**：`src/sema.tc` 中 `infer_expr`（HIR 表达式类型推断）与 `ie_sub`（取操作数定义指令）形成**相互递归**——`ie_sub` 无条件 `return infer_expr(fb)`，`infer_expr` 在多数 kind 分支调用 `ie_sub(ei,0,n.na)`；当 HIR 的 **def-use 图存在回边（环）** 时无限 / 极深递归 → `STATUS_STACK_OVERFLOW`（`EXIT=127` / `0xC00000FD` / `3221225725`）。此前误判为「声明数量 / 组合阈值效应」，实为 **def-use 成环**；ASan（512MB 栈）构建在同样压力输入下**完成（RC=0）**，印证递归有限但极深（深度随环规模增长）。ASan 调用链确认：
```
sema__check_func_decl_ex → … → sema__infer_expr_hir → sema__cs_if → sema__check_stmt_hir
  → … → sema__ie_sub ⇄ sema__infer_expr   (数千次重复)
```

**修复（循环断路器，只切真环、不误伤 DAG 共享操作数）**：
- 新增全局 `var g_infer_on: []i64;`（推理中标记）。
- `infer_expr` 入口：置 `g_infer_on[e]=1`，`defer { g_infer_on[e]=0; }`（覆盖所有 return / 脱糖自调用出口）。
- 新增守卫 `ie_infer(fb)`：若 `g_infer_on[fb]==1`（def-use 成环）返回 `Unknown` 切断递归；否则 `return infer_expr(fb)`。
- 将 `ie_sub*` / `infer_expr_hir` 等**全部调用站点**的 `infer_expr(fb)` 改为 `ie_infer(fb)`（仅 `ie_infer` 体内保留 `infer_expr(fb)` 避免自递归）；`cs_if` 处 `if (fb >= 0) { return ie_infer(fb); }` 同步改守卫。最终 grep 核验：仅 `ie_infer` 体内（~5441 行）保留 `infer_expr(fb)`，其余 11 处调用站点（5450/5455/5464/5470/5482/5489/5501/5509/7900 等）均为 `ie_infer(fb)`。

**验证**：
- **14 个压力全局**：旧种子 `EXIT=127`（崩）；修复种子 `FIXED_STRESS_EXIT=0`，**291 warnings / 0 errors（与 pristine 完全一致）**。
- **150 个压力全局**：修复种子 `FIXED_STRESS150_EXIT=1`（普通语义错 `T-PAR-E101`，parser 约束，与 sema 无关），**无栈溢出** → 修复可扩展到远超全量 S2 规模。
- **自举不动点零回归**：修复种子同样达成 `C_b==C_c`（`SAME/SAME`，`S2 SELF-HOST FIXED POINT REACHED`，经由 `tools/fb_fixed.sh`：`sed 's#tc.exe#tc_new.exe#' tools/fb_bash.sh` 用 `out/dbg/tc_new.exe` 作 gen0）→ 证明 S2b 修复**零 IR 分化**。

**S2 全量铺开（已落地 ✅，本会话）**：
- 由 `tools/cst_rollout.mjs` 自动抽取 `src/base.tc` 全部 **92 个 `mk_*`** 的字段 schema（同一 kind 多构造器如 `pointer` 的 `mk_pointer`/`mk_dev_ptr` 取**字段并集**、缺失字段补类型默认值），写出 `tools/cst_nodes.json`（**91 个 kind**）。
- `tools/cstgen.mjs` 据此生成 `base.tc` 的 `GEN:node-structs` 区：每个 kind 一组 `tbl_<RecK>_<field>` 逐字段 typed 全局切片 + `Rec<K>` 结构 + `cst_register_<RecK>(...)` 双写登记 + `cst_get_<RecK>(i)` 读取。
- `cst_rollout.mjs` 向 92 个 `mk_*` 注入 `cst_register_<RecK>(...)` 调用（统一锚定在 `return id;` 前、独立成行、幂等），达成双写；旧 `nodes[]` 仍是真相源，分表为其 SoA 镜像。
- **验证**：修复后种子 `out/dbg/tc_new.exe` 编译含全量 SoA 的 `src/tc.tc` → **EXIT=0 / 0 errors**（此前 S1b 种子在此规模必崩）；3 代自举 `tools/fb_fixed.sh` → genB/genC `tc.h`/`tc.c` 逐字节 `SAME`，`S2 SELF-HOST FIXED POINT REACHED`（tc.c 均 **2,399,955** 字节）→ **零 IR 分化**。

**后续待办**：
1. **重录基线 + 跑 gate L0/L1**（按 §4.10.2 序列，LLVM 后端权威固定点 `g2.ll==g3.ll==g4.ll` 复核），合并到 `wb/main` 触发 CI。
2. **同步修复后种子**：将自举产物（`out/fb/genB/g2.exe`，与 genC 逐字节等价的 S2 编译器）替换为 `out/dbg/tc.exe` 或提交为新的 `ci/seed`。

---

## 0.13 S3 实施：跨切面属性迁侧表（`provenance` → `node_type`）

> 目标（§4.10.3 / §4.5）：**跨切面属性迁到侧表**（`node_type/resolve/mod/file/scope`），删 `Node.td` 与全局平行数组；`sema` 查侧表而非节点字段；侧表统一登记 `SideTable{name,owner,dirty}`。
> 执行策略：**按属性拆分子步**（每个子步独立验证 + 独立提交），避免一次性大改触发自举回归（§4.10.3 注的教训）。

### 0.13.1 step1：provenance 侧表登记 + 读取面路由（已落地 ✅）

- `base.tc` 落地 §4.5 的登记设施：`struct SideTable{name,owner,dirty}` + `pub var g_sidetables` + `sidetable_register(name, owner)`。
- **provenance**（节点所属模块/文件）成为第一张登记的内置侧表，表名 `node_provenance`（owner `S3`）；存储仍复用既有平行数组 `g_node_mod`/`g_node_file`（与 `nodes[]` 按 id 对齐）。
- 读取面新增访问器 `node_mod(id)` / `node_file(id)`；外部消费方（parse/sema/tir/tir_to_ll 共 ~13 处）从 `base.g_node_mod[X]` / `base__g_node_mod[X]` 改走访问器。**存储全局暂保留**，待全部属性迁完后统一删除（避免半途断链）。
- 验证：`tc check src/tc.tc` EXIT=0 / 0 errors；自举不动点 `g2.ll == g3.ll`（md5 `016de6df…`，48,659,619 B）；基线重录 354 条目，差异**仅** `src/tc.tc::{c,h,ll}`；`gate L1` **16 passed / 0 failed**。
- 提交 `b78f9fd`。

### 0.13.2 step2：`Node.td` → `node_type` 侧表 + 删除字段（已落地 ✅）

**先做事实普查，再动手**（避免被「同名不同结构体」误导）：全局 `\.td` 有 **33 处**引用，但其中真正属于 `Node.td` 的只有 **7 处**——其余是 `MIRGlobal.td` / `TMIRGlobal.td` / `TIRGlobal.td` 等**同名但不同结构体**的字段，以及注释。真正的 `Node.td` 面其实极小：

| 类别 | 位置 | 迁移后 |
|---|---|---|
| 字段声明 | `base.tc` `struct Node` | **删除** `td: i64` |
| 初始化 | `base.tc` `node_new` 的 `n.td = 0` | `append(g_node_td, 0)` |
| 写回 | `tir.tc` `tir_expr_td` 回填 / `S1` 预标注 / 越界丢弃 | `base.node_set_type(...)` |
| 读 | `tir.tc` `tir_expr_td` 缓存早返回 / `tir_expr_st` ident 分支 | `base.node_type(...)` |

- 新增侧表 `pub var g_node_td: []i64`（0 = 未定型；> 0 = TD 索引；-1 = 已丢弃），并登记第 2 张内置侧表 `node_type`（owner `S3`）；`sidetable_init()` 幂等登记 `node_provenance` + `node_type` 两张，供后续 PassManager 建依赖拓扑（§4.12）。
- 至此 **语法树不再携带类型**——跨切面类型属性由侧表以节点 id 为键持有，`Node` 布局与下游阶段解耦。

### 0.13.3 一处「无效写」的等价性处置（重要，勿在这个坑上顺手「修」）

`tir_expr_st` 的 ident 分支原有：

```tc
var n: Node = base.nodes[e];          // ← 值拷贝，不是引用
if (n.td > 0 && n.td < slice_len(sema.tds) as i64) { return tir_st_of_td(n.td); }
if (n.td > 0) { n.td = -1; }          // ← 写在副本上：从未写回 nodes[]
```

`n` 是 `base.nodes[e]` 的**值拷贝**，且此后不再读 `n.td` ⇒ `n.td = -1` **完全没有实际效果**（作者意图应是清掉越界缓存，但写错了对象）。
**迁移时不得顺手把它升级为 `node_set_type(e, -1)`**——那会真的写回并改变缓存回收行为，把一个纯搬迁变成一次语义改动。本步的做法是**删除该无效写并就地注释说明**；越界缓存的真正回收点在 `tir_expr_td` 顶部（`base.node_set_type(e, -1)`），两处语义已对齐。

> 教训：重构阶段发现疑似 bug，**默认按严格等价搬迁**，把 bug 连同处置理由写进注释单独提 issue；不要夹带修复（否则这轮验证里复现的指标变化无法归因）。

### 0.13.4 并行安全前提（必须先证明）

侧表与 `nodes[]` 必须**严格等长**，否则下标错位 → **不崩溃的静默错编**（最难查的一类）。已核查并满足：

- `append(nodes, n)` 在全仓**唯一**（`base.tc` 的 `node_new`），故在它之后同步 `append(g_node_td, 0)` 即保证平行；
- `nodes` **无**整体赋值 / 截断 / 清空（grep `nodes = ` 无真命中，`g_vf_nodes` 是另一个变量）；
- 其余 88 处 `slice_set(nodes, ...)` 为**原地更新**，不改变长度。

### 0.13.5 验证

| 判据 | 结果 |
|---|---|
| `tc check src/tc.tc` | EXIT=0 / **0 errors** |
| 判据 A：自举不动点 | `g2.ll == g3.ll` md5 **`0ab64e81ede7d3cd1a8f2d79efae7383`**（48,659,438 B） |
| 判据 B：基线重录 | 354 条目；**changed = 仅 `src/tc.tc::{c,h,ll}`，ADDED = 0，REMOVED = 0** |
| **非编译器目标 IR 变化** | **0** |
| 门禁 | **`gate L2` 24 passed / 0 failed**（2689s） |

> 「非编译器目标 IR 变化 = 0」是本次搬迁的**等价性铁证**：删掉 `Node.td` 后，全部 examples / conformance / tests 的 IR **逐字节不变**——即「编译器自身的 IR 变了（源变了），但它编出来的任何成品都没变」。
>
> gate L2 中与「删结构体字段」直接相关的步骤全部 PASS：**C 后端自举 `cself`**（223s，`tc.c → clang → conformance`）、**MIR 中端优化 differential 四轨**（185s）、**run_examples 双后端并行**（567s）、**自举四代不动点 `g2 == g3 == g4`**（131s）、**difftest 代际/外部对拍**、**rls 快速通道**。

### 0.13.7 step3：`node_resolve` 侧表（取代 `g_idecl_n/d`，已落地 ✅）

**等价性论证（先于编码）**：旧 `idecl_set(idn, decl)` 是 last-write-wins 反向扫描——对 `idn` 的多次写入，最终值 = **最后一次 `idecl_set` 调用**的值（命中即原地更新，不重复 append）。改为 `node_resolve[idn] = decl` 直接 O(1) 覆盖写后，同一 `idn` 的多次写入最终值**完全相同** ⇒ 解析结果与旧实现逐字节一致 ⇒ 用户程序 IR 不变。

**事实普查**：`g_idecl_*` 仅 `base.tc` 内部 8 处引用；外部仅经 `idecl_set`/`idecl_get` 包装（sema×2、codegen_c×1、tir×2，均 `base.`-前缀），无文件直接读 `g_idecl_n/d`。

**落地**：
- `base.tc` 新增侧表 `pub var g_node_resolve: []i64`（默认 -1），登记第 3 张内置侧表 `node_resolve`（owner `S3`）；新增访问器 `node_resolve(id)`（越界返回 -1）/ `node_set_resolve(id, decl)`。
- `node_new` 同步 `append(g_node_resolve, -1)`，与 `nodes` 严格平行（并行安全前提同 §0.13.4，未变）。
- **删除** `g_idecl_n` / `g_idecl_d` 全局 + `idecl_set` / `idecl_get` 函数；5 处调用点重命名为 `base.node_set_resolve` / `base.node_resolve`（编译期可捕获遗漏）。`sema_idecl_infer_idents` 等函数名保留（仅语义函数，非全局）。

**验证（待后台自举确认）**：`tc check` EXIT=0 / 0 errors；自举不动点 `g2.ll==g3.ll`；基线重录差异**仅** `src/tc.tc::{c,h,ll}`（编译器自身源变化），**非编译器目标 IR 变化 = 0**（等价性铁证）。

### 0.13.7b step4：`node_const` 侧表（取代 `g_const_decl_ids`，已落地 ✅）

**等价性论证（先于编码）**：旧 `g_const_decl_ids` 是「decl id 列表」，`g_const_decl_has(d)` 线性扫描判属（O(n)）。改为 per-node 标志 `g_node_const[d]`（默认 0；`node_set_const(d)` 置 1）后，成员集合**逐字节一致**——`node_set_const` 仅在原 4 个 `append(base.g_const_decl_ids, X)` 点调用（parse `parse_const_stmt` / 全局 `KwConst` / 局部 `KwConst` ×2），写入的 `d` 值完全相同；`node_const(d) != 0` 与 `g_const_decl_has(d)` 真值表一致 ⇒ 用户程序 IR 不变。

**落地**：
- `base.tc` 新增侧表 `pub var g_node_const: []i64`（默认 0），登记第 4 张内置侧表 `node_const`（owner `S3`）；新增访问器 `node_const(id)`（越界返回 0）/ `node_set_const(id)`（置 1）。
- `node_new` 同步 `append(g_node_const, 0)`，与 `nodes` 严格平行（并行安全前提同 §0.13.4，未变）。
- **删除** `g_const_decl_ids` 全局 + `g_const_decl_has` 函数；4 处 `append(base.g_const_decl_ids, X)`（parse.tc）→ `base.node_set_const(X)`；4 处 `base.g_const_decl_has(X)`（sema.tc `check_const_ref` 路径）→ `base.node_const(X) != 0`。

**验证（待后台自举确认）**：`tc check` EXIT=0 / 0 errors；自举不动点 `g2.ll==g3.ll`；基线重录差异**仅** `src/tc.tc::{c,h,ll}`，**非编译器目标 IR 变化 = 0**（等价性铁证）。

### 0.13.8 S3 剩余子步（待推进）

1. ✅ `node_scope` 取代 `g_seen`（**工作 A**，commit `1d6f431`）：扁平 `g_seen`+哨兵+空操作 pop → 作用域帧栈（`g_frame_keys`/`g_frame_starts`/`g_frame_owners`/`g_frame_sp`）+ 第 6 张 S3 侧表 `g_node_scope[]`，行为逐字节等价。等价性铁证：IR 基线仅 `src/tc.tc::{c,h,ll}` 变化，非编译器目标 = 0；gate L2 **24/0**（含自举四代不动点 g2==g3==g4）。⚠ 关键坑：`g_seen_pop` 必须保持**空操作**（不回退 sp）——否则嵌套块之后的外层变量会误看到块前同级变量（实测 `string_utils.tc::c` 漂移）；旧哨兵的帧隔离语义由 `g_frame_starts[sp-1]` 固定为「最近一次 push 的起始下标」还原。
2. （已完成 ✅）`g_const_decl_ids` → `node_const[]` 侧表，见 §0.13.7b step4。
3. **删除原始全局平行数组**：`g_seen` 已删（被 `g_frame_*` + `g_node_scope` 取代）；`g_node_mod`/`g_node_file` 已是侧表保留；`g_local_decls`/`g_conpat_binds` **仍被 mangle 逻辑使用**（2026-10-02 复核确认：base.tc:1893/1952 仍在，`codegen_c.tc` 1526/1615/1670/1729/3492 使用；`node_conpat[]` 侧表尚无），待 `node_conpat` 侧表化后清理。S3 侧表化（provenance / type / resolve / const / scope 五张）**全部落地** → 进入 **S4**（消费方切 `u64 NodeRef`，见 §0.14）。
  - ⚠ **S3 因此应记为 partial**：§4.10.3 对 S3 的要求是「删 `Node.td` **与全局平行数组**」，`Node.td` 已删，但 `g_local_decls`/`g_conpat_binds` 两个全局平行数组未清。该遗留项归 §0.14.5 第 4b 项（deferred）。

### 0.14 S4 实施记录（消费方切 u64 NodeRef）

> S4 真实范围（§4.3 / §4.10 阶段表）：消费者逐步换用访问者、删除旧 `base.Node` 字段、删 re-export 垫片、`node_to_hir` 桥切到 `NodeRef`。这是编译器级表示迁移，量级远大于 S3，**按最小可验证增量推进**。

#### 0.14.1 step1：激活 `g_node_nref`（tag|idx 打包）+ NodeRef 打包/解包 helper（commit `821c19b`，2026-10-01）

- **动机**：S2 已埋 `g_node_nref: []u64` 占位（全 0）与 SoA `tbl_*` 分表（由 `tools/cstgen.mjs` 生成 `cst_register_*` 双写）；但 `g_node_nref` 从未写入 `tag|idx`，`NodeRef` 类型与 `mk_noderef`/`nr_tag`/`nr_idx` 亦未定义。本步把统一引用表示落地为可用基础设施（尚未切换任何消费方）。
- **改动**（`src/base.tc`）：
  - 定义 `mk_noderef(tag, idx)` / `nr_tag(n)` / `nr_idx(n)`：单 u64 高 32 位 = kind-tag（`nk_of_kind(kind)` 的 `NK_*` 枚举值），低 32 位 = 节点索引。
  - `node_new` 写入 `g_node_nref[id] = mk_noderef(nk_of_kind(kind), id)`；未注册 kind 暂归 `tag=0`（当前无消费方，安全）。
  - ⚠ **t 当前无 `type` 别名语法**（§4.3 的 `pub type NodeRef = u64` 是目标设计、尚未落地），故 NodeRef 暂以 `u64` 直接表示；helper 落在 `GEN:node-structs` 生成区**之外**，避免破坏 `cstgen --check` 一致性。
- **坑**：初版把 helper 误放进 `GEN:node-structs` 区导致 `cstgen --check` 失败；移出即恢复。另发现 `cst_nodes.json` 已扩 105 kind 但 `GEN:kinds` 未同步，`cstgen --emit` 补到 105（磁盘内容与 HEAD 一致，git 未显差异）。
- **验证（等价性铁证）**：IR 基线差异仅 `src/tc.tc::{c,h,ll}`（3 DIFF / 0 NEW / 0 GONE），**非编译器目标 IR 变化 = 0**；gate L2 **24/0**（含自举四代不动点 g2==g3==g4、双轨对拍、REPL 冒烟、run_examples 双后端）。

#### 0.14.2 step②：`node_*` 访问器切 `u64 NodeRef`（commit `a9c2970`，2026-10-01）

- **动机**：让 S3 五张侧表的消费方改用统一引用表示，为 step③（`mk_*` 返回 `NodeRef`）铺路。§0.14.2 原列的第 1 项。
- **改动**（`src/base.tc`）：10 个访问器入参 `id: i64` → `n: u64`，函数体首行统一 `var id = nr_idx(n)` 再走原边界检查：`node_mod`/`node_file`/`node_type`+`node_set_type`/`node_resolve`+`node_set_resolve`/`node_const`+`node_set_const`/`node_scope`+`node_set_scope`。
- **关键决策（偏离原计划的「调用点同步 `cst_nref_of(id)`」）**：**不改动任何调用点**。实证确认 `t` 存在**隐式 `i64 → u64` 拓宽**（用 scratch 程序 `tc check`/`tc compile` 各 0 诊断验证），故每个现存的 `i64` 实参自动拓宽为 `tag=0` 的 `NodeRef`，且 `nr_idx(u64(id)) == id` 对**全部合法节点索引及 `-1` 哨兵**逐位成立 → 行为**逐字节等价**。
  - 这比机械地把数百处调用点包 `cst_nref_of(...)` 更安全：① 零调用点改动 = 零引入风险；② 当下 `NodeRef` 只有 `tag=0`，包与不包行为完全一样，纯属噪声；③ 等 step③ `mk_*` 真正返回带 `tag` 的 `NodeRef` 时，这些调用点会自动获得正确的 tag，无需现在预演。
  - 等价性铁证：见下验证。
- **验证（等价性铁证）**：IR 基线差异仅 `src/tc.tc::{c,h,ll}`（3 DIFF / 0 NEW / 0 GONE），**非编译器目标 IR 变化 = 0**；`tc check src/tc.tc` 0 error（仅 510 条预存 style warning）；`g1` 自举成功；gate L2 复跑预期 **24/0**（含自举四代不动点 g2==g3==g4）。

#### 0.14.3 step③：`mk_*` 构造器返回 `u64 NodeRef`（接续 step② `a9c2970`）

- **动机**：让「构造→消费」全链路统一为 `NodeRef`。§0.14.3 原列第 2 项。step② 已让访问器收 `u64`，本步让构造器产 `u64`，二者闭合。
- **改动**：
  - `node_new` 返回 `i64 → u64`；`mk_*` 96 处 `fn mk_*(...) i64` → `fn mk_*(...) u64`（base 93 + parse 2 + sema 1，脚本精确替换返回位、零改参数位、函数体零改动）。`mk_*` 直接 `return node_new(...)`，故自动继承新返回类型。
  - ⚠ **关键决策（与原计划的偏差，重要）**：`node_new` 返回的是**裸索引**（仅静态类型提升为 `u64`），**不是** `mk_noderef(tag, idx)` 打包值。理由：既有代码在 `mk_*` 体内与全部 749 处调用点大量以 `nodes[nid]` / `slice_set(nodes, nid, ...)` 把返回值**直接当数组下标**。`t` 在下标处的 `u64 → i64` 收窄**不会**解包 tag，若返回打包值，下标会取到 `tag<<32 | idx` 的巨大数 → 整体越界 → **全部目标发射失败**。故 tag 只存于 `g_node_nref` 侧表（step1 已写入），访问器经 `nr_idx(nid)` 取裸索引，与 `node_new` 返回裸索引逐位一致。本步的 `NodeRef` 因此 =「静态类型为 u64、运行时值为裸节点索引」（tag 暂恒 0），是分阶段迁移的正确中间态。
  - 原计划把此步列为「高风险全量签名变更」是基于「`u64→i64` 收窄非隐式」的误判：实证 `t` 同时允许隐式 `u64→i64` 收窄与 `u64` 数组下标（scratch 程序 `tc check`/`tc compile` 各 0 诊断），故 749 处调用点**全部自动收窄通过，零调用点改动**——本步实为**纯签名变更、零行为变化**。
- **⚠ 实测踩坑（已修，务必记取）**：首版 `node_new` 写成 `return mk_noderef(nref_tag, nid)`（返回打包值），结果 `ir_snapshot` 报 **117 个目标全部 `failed to emit`**（g1 自身发射即越界崩溃）。回退为返回裸索引后立即恢复。铁律：**凡返回 NodeRef 的构造器，其返回值被当作数组下标的既有代码必须先用 `nr_idx` 解包，否则绝不能返回打包值**——分阶段迁移期间一律返回裸索引。
- **⚠ 二次踩坑（cstgen --check 门禁红灯，已修）**：本步初版用 Python 脚本批量替换 `fn mk_*(...) i64 → u64`。脚本以**文本模式** `open()/write()` 全量读写 `base.tc`（文件为 CRLF），把 GEN 生成区间的字节悄悄改写（行尾/空白规范化）；而 `cstgen --check` 对 GEN 区间做**逐字节精确比较**，于是门禁 `cstgen --check` 红灯（"GEN:node-structs 区间与 cst_nodes.json 不一致"）。根因**不是** `mk_*` 语义改动，而是脚本 I/O 副作用。修复：`node tools/cstgen.mjs --emit`（依 `cst_nodes.json` 重生成 canonical GEN 区间，覆盖脚本扰动）；`mk_*`/`node_new` 改动在 GEN 区间之外，被 `--emit` 完整保留。此后 `--check` 绿灯（kinds 105 / node-structs 91）。**教训：批量改 `src/*.tc` 绝不用文本模式脚本对含 GEN 生成区的文件做全量重写——必须用 Edit 工具或二进制/无归一化 I/O，否则会污染生成区触发门禁。**
- **验证（等价性铁证）**：IR 基线 **354 份产物与基线逐字节相同（含 `src/tc.tc` 自身 0 DIFF / 0 NEW / 0 GONE）** → 非编译器目标 IR 变化 = 0（比 step② 的 3 DIFF 更彻底：纯签名变更零行为影响）；`tc check src/tc.tc` 0 error（510 条预存 style warning）；`g1` 自举成功；**gate L2 24 passed / 0 failed（2855.6s）**：cstgen --check、四代不动点 g2==g3==g4、MIR differential 四轨、C 后端自举、run_examples 双后端、双轨对拍、REPL 冒烟、rls 快速通道全绿。commit `72d461f`；快进推送 `s2-noderef:main`（`a9c2970..72d461f`）。

#### 0.14.4 step④：HIR 节点 `nd` 字段切 `u64 NodeRef`（接续 step③ `72d461f`）

- **动机**：§0.14.4 第 3 项原文。把 HIR 内部对源 CST 节点的引用 `HirInst.nd` 从 `i64` 升为 `u64 NodeRef`，与 step②/③ 的访问器/构造器 `u64` 化闭合（消费侧也开始吃 NodeRef）。**本步只动 `HirInst.nd`**；`node_to_hir` 桥改造、删旧 `base.Node` 字段 + 删 re-export 垫片（§4.14.4）是更高风险 epic，留作独立步（见 §0.14.5 第 3 项）。
- **改动（`src/hir.tc` 4 处）**：
  - `HirInst.nd: i64 → u64`（line 95）。
  - 新增 `fn hir_nd_none() u64 { return -1 as u64; }` 取代模块级 `const HIR_ND_NONE: u64 = 0xFFFFFFFFFFFFFFFF`（见下踩坑）。
  - `hir_inst_node` 返回 `inst.nd as i64`：迁移期 NodeRef==裸索引，逐位等价，20+ 调用点零改动。
  - 比较点 `if (inst.nd >= 0)` → `if (inst.nd != hir_nd_none())`：修复 `u64` 下 `>=0` 恒真导致的哨兵语义断裂。
- **⚠ 实测踩坑（已修，务必记取）**：首版用模块级 `const HIR_ND_NONE: u64 = 0xFFFFFFFFFFFFFFFF`，`t` 发射该全局常量初始化器时原样写出 `i64 0xFFFFFFFFFFFFFFFF`；LLVM IR 的 `i64` 字面量是有符号的（上界 2⁶³−1），`0xFFFFFFFFFFFFFFFF` 越界被 clang 拒 → **自举一代 `tc.exe → g1` 链接失败**（"1 error generated"）。实证 `-1 as u64` 发射为合法的 `i64 -1`（LLVM 底层 u64==i64，位模式全 1 不变），故改函数形式绕开。铁律：**凡需全 1 哨兵的 `u64`，绝不用模块级 `const` 高位常量（发射成越界 `i64` 字面量）；改用 `fn ...() u64 { return -1 as u64; }` 或取 `< 2⁶³` 的值（如 `0xFFFFFFFF`）**。
- **等价性论证**：`HirInst.nd` 仅在 `hir.tc` 内部消费（调试打印 + 序列化往返），从不进入 MIR/TIR/LLVM 代码生成；序列化 `hir_put_u64(inst.nd)` 经 `u64→i64` 收窄按位写 8 字节，与改动前 `i64 -1` 逐位相同；比较 `>=0`→`!=hir_nd_none()` 行为一致。`ir_snapshot` 只比对 `.ll/.c/.h`（不比对 `.hir`），其余 351 份产物逐字节相同。
- **验证与基线漂移（重要）**：首跑 gate L2 在「自举一代」通过，但「产物快照比对」报 **3 处 DIFF（仅 `src/tc.tc::{c,h,ll}`），0 NEW / 0 GONE**。经核查：
  - step④ g1 对 `src/tc.tc` 的发射 = step③ 同步出的 `out/dbg/tc.exe`（md5 全对上 `24ab9a3c…`/`f9cd4d61…`/`fbd9a08d…`）→ **step④ 相对 step③ 零发射变化**；
  - 基线 `f1dff4b2…` 是 **step③ 的 gen-1 g1** 产物，而稳定编译器是 g4（固定点 `g2==g3==g4`）；gate 注释明确改了发射器后 `g1 != g4` 是预期漂移，基线由 g1 录制 → 与同步出的 g4 天然差这 3 文件（与 step② 的"3 DIFF src/tc.tc"完全同型）。
  - 故 3 DIFF 是**基线陈旧 + 自举表示漂移**，非回归。按路线图"确认预期差异后 `--update` 重录"，用当前稳定 g1 重录基线（`node tools/ir_snapshot.mjs --update --compiler out/dbg/g1.exe`），复跑只读快照 `354 份逐字节相同`，复跑 gate L2 预期 **24 passed / 0 failed**。
  - ⚠ **注意**：门禁会把 g4 回拷到 `out/dbg/g1.exe`，导致 `g1.exe` 文件瞬时变成 g4（发 `f9cd4d61…`）；只读快照/基线录制须认准**自举初期的 gen-1 g1**（发 `fb408b13…`），复跑门禁即回到该状态，快照 0 DIFF——中间态的 md5 错位只是文件瞬时覆盖，非编译非确定性。
- **commit**：commit `2bea53f`（`src/hir.tc` / `docs/compiler/cst-design-v2.md` / `tests/ir_baseline.json`）；快进推送 `s2-noderef:main`（`72d461f..2bea53f`）。gate L2 **24/0**（重录基线后复跑）。

#### 0.14.5 后续子步（待推进，按风险分级）

1. ✅ **`node_*` 访问器切 `u64 NodeRef`**（step②，见 §0.14.2，commit `a9c2970`）。
2. ✅ **`mk_*` 构造器返回 `u64 NodeRef`**（step③，见 §0.14.3，commit `72d461f`）。
3. ✅ **HIR 节点 `nd` 字段切 `u64 NodeRef`**（step④，见上：仅 `HirInst.nd: i64→u64` + 哨兵函数 `hir_nd_none`；20+ `hir_inst_node` 调用点零改动）。⏳ **仍待办（更高风险 epic）**：`node_to_hir` 桥改造、删旧 `base.Node` 字段 + 删 re-export 垫片（§4.14.4）—— 这些会触碰跨模块 `Node` 字段消费，留作独立步，不在本步。
4. 收尾（拆分标注状态，2026-10-02 复核）：
   - 4a. ✅ **`node_*` 旧 i64 版访问器退役** —— 已闭合（step② 整体改 u64 版）。
   - 4b. ⏳ **`g_local_decls`/`g_conpat_binds` 迁 `node_conpat[]` 侧表后清理** —— **未做**（二者仍在 base.tc:1893/1952，被 codegen_c 使用；`node_conpat` 侧表尚无）。属 S3「删全局平行数组」遗留，deferred。
   - 4c. ⏳ **让构造器返回带 tag 的打包 NodeRef** —— 待有真实消费者（届时须先把所有下标站点改为 `nr_idx`）。

#### 0.14.6 最高风险 epic 拆解规划（2026-10-01 调研）

> **研判结论（2026-10-01）**：推荐**方案 A**（S4 在 step④ 收口，删 `base.Node` 单结构体降为 deferred 未来 epic）。理由见「推荐 A 的理由」与下方三维度权衡；方案 B 的 SoA 重构在当前无真实消费者，孤立推进风险/收益比不划算，应留待模块系统搬迁（base.tc→`std.rc.cst`）或工作 B 启动时借势。

**现状盘点（决定性数据）**
- `pub struct Node`（base.tc:1729-1760）仍持有约 30 个核心 AST 字段：`kind/sa/sb/sc/se/has_sa..has_sc/ia/ib/ba..bf/na/nb/nc/nd/memspace/la/lb/lc/ln/cl/tv`。
- 已迁出的侧表**仅覆盖跨切面属性**：`g_node_td/mod/file/resolve/const/scope/nref`（7 个）；**核心 AST 字段（na/nb/nc/nd/kind/sa/ia/la/lc 等）尚无对应侧表**。
- `pub var nodes: []Node`（base.tc:1762）仍在存储 Node 值本身。
- 消费面规模（grep `base.nodes[id]` / `var n: Node = base.nodes[...]`）：`sema.tc` 370、`codegen_c.tc` 110、`parse.tc` 105、`tir.tc` 111、`hir.tc` 22、`comptime_fold.tc` 10、`codegen_dev.tc` 22、`codegen_c_tmir/wasm/mir/tmir/tir_to_ll` 少量 ≈ **750+ 处字段访问点**。

**S4 主线已在 step④ 收口（类型层 NodeRef 化闭合）**
- step②/③/④ 把 `node_*` 访问器、`mk_*` 构造器、`HirInst.nd` 全部升 `u64 NodeRef`，且已证等价性（step④ 输出 md5 与 step③ 全对上；gate L2 24/0）。
- 迁移期 `NodeRef == 裸索引`（`node_new` 返回裸索引、tag 仅存 `g_node_nref`），所有 `base.nodes[id]` 下标站点继续以裸索引工作，零改动。
- 故「消费方切 `u64 NodeRef`」在**类型契约层已闭合**：外部 API（访问器/构造器/HIR 桥）已吃 NodeRef，内部表示仍是 AoS 的 `Node`。

**两个互斥方案**

**方案 A — S4 收口，删 Node 降为 deferred（推荐）**
- S4 的交付 = 类型层 NodeRef 化（step②/③/④ 已完成且 verify 全绿），即 §0.14.4 第 3 项「HIR 节点 `nd` 切 `u64 NodeRef`」已交付；「删旧 `base.Node` + 删 re-export 垫片」从 S4 主线移除，正式降格为 **deferred 未来 epic**。
- 依据：删 Node 单结构体本质是「AST 表示 AoS→SoA」重构，真实驱动力应是 ① 性能（SoA 缓存友好）/ ② 模块系统（base.tc 整体迁 `std.rc.cst` 时 Node 不能仍是 base.tc 全局 struct）/ ③ 增量编译（按需加载字段）——三者均属未来需求。§0.14.5 第 4 项「待有真实消费者时再让构造器返回**带 tag** 的打包 NodeRef（须先把所有下标站点改为 `nr_idx`）」即此意：当前无真实消费者需要打包 NodeRef，且打包的前置（`nr_idx` 改造）远未就绪。
- 收尾仅做低风险项：§0.14.5 第 4 项的 **`node_*` 旧 i64 版访问器退役**——该项**已闭合**（step② 已把它们整体改成 u64 版，旧 i64 版不复存在）。
- **⚠ 更正（2026-10-02 复核，原文有误）**：上一版曾写「`g_local_decls`/`g_conpat_binds→node_conpat` 侧表清理…故该项实际已闭合」，**此断言与代码事实不符，已撤回**。实测：
  - `g_local_decls`（base.tc:1893）与 `g_conpat_binds`（base.tc:1952）**仍在**，且被 `codegen_c.tc`（1526/1615/1670/1729/3492）实际使用；
  - `node_conpat[]` 侧表**不存在**（侧表登记册 base.tc:1795–1799 只有 `node_provenance/type/resolve/const/scope` 五张）。
  - 故该项**未闭合**，仍是 S3「删全局平行数组」的遗留项（与 §0.13.8 第 3 项一致），继续列为 deferred，**不得**凭「step② 退役了旧访问器」推断它已完成——二者是不同对象。
- 代价/风险/门禁：零。

**方案 B — 完整 SoA 重构（高风险，~750 处迁移）**
- step⑤（基础设施）：为 Node 剩余全部字段建 `g_node_*` 侧表 + `node_field()` 访问器；`node_new` 创建节点时把每个字段写入对应侧表，同时**保留 `nodes[]` 并存**直到所有消费方迁完。纯新增、不改消费方，发射 IR 不变（gate 验证）。
- step⑥（hir.tc 先行）：22 处 `var n: base.Node = base.nodes[tn]` 迁到 `u64 NodeRef` + `node_field()`，验证模式与热路径性能。
- step⑦a-d（逐后端）：`sema`(370)/`codegen_c`(110)/`parse`(105)/`tir`(111) 逐个把 `base.nodes[id].field` 改成 `node_field(id)`，每个后端一 commit + gate。
- step⑧（删 Node）：所有消费方迁完后删 `pub struct Node` + `nodes[]` + re-export 垫片，侧表成唯一真相源；若要「打包 NodeRef」还需前置把 step⑦ 所有下标站点改为 `nr_idx()`（避免 `u64→i64` 收窄不解包 tag 导致越界）。
- 风险：① ~750 处机械改动，静默错编风险高；② `node_field(id)` 函数调用（bounds 检查 + sidetable_init 开销）在热路径（孩子遍历 `n.na/n.nb`）的性能回归，除非编译器能 inline；③ SideTable 机制（§4.5）本为跨切面属性设计，塞入核心 AST 字段语义不符，需先扩展其语义；④ 7-8 次 45 分钟 gate（~6 小时门禁墙）。
- 等价性验证：每步必须 `ir_snapshot` 逐字节比对（预期仅 `src/tc.tc` 漂移则 `--update`），且四代不动点 `g2==g3==g4` 不破。

**推荐 A 的理由**
1. S4 类型层契约已闭合，外部 API 已消费 NodeRef；删 Node 不改变任何可观测行为，纯内部表示变更。
2. 无当下消费者需要打包 NodeRef（`node_new` 裸索引返回安全，所有下标站点依赖裸索引）。
3. 方案 B 的 SoA 收益（性能/模块化/增量）在当前阶段无法兑现，却要付 ~6 小时门禁 + 750 处高风险机械改动；等工作 B（sema 统一词法树/增量/IDE）或模块系统真正需要时再启动，可与其合并、一次性借势。
4. 保留 `nodes[]` 并存不阻塞任何已规划工作；base.tc→`std.rc.cst` 搬迁才是删垫片/删 Node 的真正时机，那是一个更大的独立迁移 epic。

**⚠ S4「收口」的真实语义 = PARTIAL（务必按此理解，勿当作阶段已完成）**

按 §4.10.3 阶段表，S4 原列四项：「消费者换访问者 `node_visit`/`transform」+「删旧 `base.Node` 字段」+「删 re-export 垫片」+「`node_to_hir` 桥切 `NodeRef`」。**实际只交付了「消费方切 `u64 NodeRef`」的类型层**（step②/③/④），上述四项**全部 deferred**。故 S4 应记为 **partial**，不是 done。

- **硬前置约束（承接 §4.10.3 依赖图注释，不得随 S4 降格而丢失）**：原文「**工程上应先完成 S4（删旧 `base.Node` 字段），否则 S8 的插件 API 会同时暴露新旧两套节点表示**」。该项现已 deferred，因此其约束**顺延为：删 `base.Node` 字段 + 删 re-export 垫片必须在 S8 之前完成**。S5/S6/S7 不依赖它（S6 依赖 S3、S7 依赖 S6、S5 可并行），故推迟不阻塞后继阶段；但进入 S8 前必须回来收口，否则新旧两套表示同时暴露给插件 API。
- **验收判据同步说明**：§4.10.3 给 S4 的验收是「`hir_test` 穷尽性守住（`node_visit` 分支数 == `NK_*` 数）」——因 `node_visit`/`transform` 未建，该判据**当前不适用**；S4-partial 的实际验收退化为「不动点 A 绿 + gate L2 24/0 + 基线 B 已按预期重录」（§4.10.0）。

### 0.14.7 SoA 节点载荷外置迁移启动（2026-10-02，用户裁定「启动 SoA 迁移」）

> **背景**：§0.14.6 方案 A 把「删 `base.Node` 字段 + 删 re-export 垫片」降格为 deferred 未来 epic，硬前置顺延到 S8 之前。现 S5 已收口（§0.16.9），S8 的硬前置即此；用户 2026-10-02 裁定**启动**该 epic，采用 **staged bootstrap**（每字段组独立验证自举不动点 + gate 全绿 / 或 IR 快照 0 NEW/0 GONE），接受多 session 推进。

**迁移范式（已 pilot 验证）**
- 每个 `Node` 字段 `F: T` → 平行侧表 `g_node_F: []T`（与 `nodes` 按 id 对齐）+ 访问器 `node_F(n: u64) T` / `node_set_F(n: u64, v: T)`（经 `nr_idx` 取裸索引，带越界哨兵，仿 `node_mod`）。
- `node_new` 内：删 `n.F = 默认值`，改 `append(g_node_F, 默认值)`。
- 全部读取点 `base.nodes[x].F` / 局部 `var n: Node = …; n.F` → `node_F(id/d/…)`；全部写入点 `n.F = v; slice_set(nodes, x, n)` → `node_set_F(x, v)`。
- 该字段在 `pub struct Node` 中**删除**（强制编译期清零剩余引用，确保无遗漏站点）。
- `sidetable_init()` 注册 `"node_F"`（与 S3 侧表一致）。

**Pilot：`se`（C 互操作导出 ABI 符号名）**
- 5 处站点：base.tc `cst_dump` 读 + `node_new` 默认；codegen_c.tc `emit_func_decl` 读（`cx_name = node_se(d)`）；parse.tc 3 处写（`base.node_set_se(fd, fname)`）。
- 验证：`tc check` 0 error；`g1` 自举重建成功；`examples/c_interop.tc`（`@c_export`）经 g1 C 后端编译运行输出 `5`/`55`，生成 C 为干净名 `int64_t add(...)`/`fib(...)`（证实 se 侧表读回正确）；IR 快照 **3 DIFF（`src/tc.tc::{c,h,ll}`，0 NEW/0 GONE）** → 用户程序 IR 中性。
- ⚠ **通用安全规则（本轮再印证）**：凡「无此节点」哨兵的 `-1` 必须显式整型（`var x: i64 = -1`），不可裸写 `var x = -1`（t 推断 `u8` 致符号扩展越界崩溃——见 S5 step5 教训）。

**批次 2：`has_sa` / `has_sb` / `has_sc`（存在性标志位组，2026-10-03）**
- **先做同名字段普查（§0.13 / S3「6019 血泪」纪律）**：`.has_sa|.has_sb|.has_sc` 全部命中 18 处，其中 **4 处是同名假阳性** —— `base.tc:408/409/437/557` 的 `r.has_sa/r.has_sc` 属于 S2 已 SoA 化的 **per-kind record struct**（`RecImportDecl` / `RecImportModDecl` / `RecStructDecl`，配套 `tbl_RecXxx_has_sc`），与 `Node` 无关。**真实 Node 站点仅 10 处**，普查砍掉 22% 假工作量。
- 另查**整节点赋值**（`nodes[a] = nodes[b]` / `slice_set(nodes, a, nodes[b])`）：**不存在**（唯一一条 `slice_set(nodes, id, nodes[id])` 是同节点自赋值的空操作）⇒ 字段外置后不会因值拷贝而丢失传播，搬迁安全。
- 存储：`g_node_has_sa / g_node_has_sb / g_node_has_sc: []i64`（沿用 `g_node_const` 的 **0/1 先例**而非 `[]bool`，与既有侧表切片类型保持一致）。
- ⚠ **默认值必须是 `1`（true）** —— 旧 `node_new` 写的是 `n.has_sa = true`，只有 3 个 `mk_*` 构造器才可能置 false。故：`node_new` append `1`，且**访问器越界返回 `true`**（按「字段默认值」对齐，而非返回 0；仿 `node_se` 越界返 `""` 的处理）。这是本组最易错的一点。
- 站点（10 处）：`node_new`（默认值）、`mk_ImportDecl`(sa,sc) / `mk_ImportModDecl`(sc) / `mk_StructDecl`(sc) 写；`codegen_c.tc::emit_struct_decl` 读（`n.ba && base.node_has_sc(d)`，**唯一读方**）；`sema.tc::clone_node` 跨节点传播（**唯一传播点**，原 `nn.has_X = sn.has_X`）。
- ⚠ **覆盖缺口与补强（重要方法）**：该读方是 `@bitpack` 判定，而 **115 个 examples 对 `@bitpack` 零覆盖** ⇒ IR 快照**无法**证明其等价。故补做**差分对拍**：`tc compile out/_bitprobe2.tc`（含 `@bitpack(Backing) struct Flags`，且已否决两个错误写法 —— 参数不能是 `u32` 这类**类型关键字**、也不能缺省）分别由**变更前种子 `out/dbg/tc.exe`（= step3 的 g4）**与**新 g1** 发射，`.h` / `.c` **逐字节相同**；并确认产物里出现 `// @bitpack(Backing) struct`（证明该代码路径确实被触达，而非双方都没走到）。
  → 沉淀为 epic 通用方法：**IR 快照覆盖不到的站点，一律用「变更前编译器 vs 新编译器」差分对拍补证**，并显式验证路径可达。
- 验证：`tc check` 0 error；g1 重建成功；差分对拍 `.h`/`.c` IDENTICAL；IR 快照 **3 DIFF（`src/tc.tc::{c,h,ll}`，0 NEW/0 GONE）** ⇒ 114 个 example 目标全部不变；**gate L2 = 25 passed / 0 failed（2732.9s）**。

**⚠ 本轮踩到的门禁假失败（已定位并修，记入速查）**
- 前两次 gate L2 分别 **24/1**（`双轨对拍` 228.0s，87/88）与 **23/2**（`双轨对拍` **恰 480.0s** + 连带 `REPL 冒烟` 35.0s 失败）。
- 判据：① 唯一「真」失败项耗时**恰 480.0s** = `STEP_TIMEOUT_MS`（8min）硬超时被 SIGKILL（速查坑已知形态）；② 同参数**手跑 `_diffpipe.mjs` 两次均 88/88**（196s / 259s）、`repl_test.mjs` 手跑 **4/4 全过**；③ `REPL` 与本次 src 改动**毫无关系**（4 条 read_line 冒烟），它失败只能来自资源竞争。
- 根因：`双轨对拍` 88 用例 × 双轨（LLVM + TIR）全量编译 + clang 链接，紧接在 `run_examples`（本轮 492.4s，已放宽到 20min）之后跑，**受资源竞争影响显著**。被 SIGKILL 的步骤留下孤儿进程 → 拖慢/拖挂后续步骤。
- 处置（与 snapshot 步同一做法：**调用处传 `timeoutMs`，不抬高全局默认值**）：`双轨对拍` 步放宽到 20min。**只抬预算、不改判据**（新旧轨不一致仍硬失败）。放宽后第三次 gate = **25/0**。
- 沉淀：**门禁出现「耗时≈480.0s 且手跑可过」的失败时，先按硬超时/资源竞争处置，勿当成回归**；并注意一个被杀的步骤会连带拖挂后续步骤，需逐项手跑复验。

**批次 3：`be` / `bf`（声明级 bool 标记组，2026-10-03）**
- 选组依据：实测使用量最低的未迁字段（`be 6` / `bf 12`），且**语义内聚** —— 二者都是「声明（FuncDecl）级 bool 标记」：`be` = 是否 `@c_export`（C 互操作导出，生成 C ABI 平铺入口）；`bf` = 是否 `kernel fn`（Device 入口，host 双后端跳过、`codegen_dev` 处理）。
- 普查结论（纪律先行）：`.be` 全 6 处、`.bf` 全 12 处**均为真 Node 站点**（本组无 `has_*` 那类同名 record-struct 假阳性）；且**无整节点赋值**、`nodes` 仅在 `node_new` 内 append、无整体重置 ⇒ 侧表对齐有保障（同批次 2 的排查项）。
- 存储：`g_node_be / g_node_bf: []i64`（沿用 `g_node_const` 的 **0/1 先例**）。
- ⚠ **默认值方向与批次 2 相反** —— 旧 `node_new` 写的是 `n.be = false; n.bf = false;`（而 `has_*` 写的是 `= true`）⇒ `node_new` append **0**，且**访问器越界返回 `false`**。搬迁新组时**不许照抄上一组的「默认 true」写法**，必须先回看旧 `node_new` 的初始化值。
- 站点（18 处）：
  - `be`：写 = `parse.tc` 三处 `@c_export` 分支（原 `base.nodes[fd].be = true`）；读 = `codegen_c.tc::emit_func_decl`（**唯一读方**，配合 `node_se` 决定 clean-name / 转发器）；`base.tc` 的 dump 打印。
  - `bf`：写 = `parse.tc::parse_func_decl` 的 `is_kernel` 分支 —— 原写法是**「取值 → 改字段 → `slice_set` 回写」**，外置后直接 `node_set_bf(id, true)`，回写步骤随之消失（SoA 附带收益：减少一次整节点写）；读 = `codegen_c`（2 处）/ `codegen_dev` / `sema`（3 处，含 `dev_check_list` 传参）/ `tir` / `tc.tc::module_has_kernels`。
- ✅ **本组无覆盖缺口**（与批次 2 的 `@bitpack` 零覆盖不同）：语料中 `@c_export` 有 `c_interop.tc` / `c_interop_lib.tc`，`kernel fn` 有 `vecadd_device.tc` / `vecadd_device_full.tc` / `_cpuemu_check.tc`。故仍按 epic 方法补做**差分对拍**（变更前种子 vs 新 g1）作双保险，三个用例 `.c`/`.h` 均 **IDENTICAL**；并**显式验证路径可达**（防"空路径"假绿）：`c_interop.h` 输出 clean name `int64_t add(...)` / `int64_t fib(...)` ⇒ be 生效；`vecadd_device.h` **不含** `vec_add` 声明 ⇒ bf 的「host 跳过 kernel」生效。
- 验证：`tc check` 0 error；g1 重建成功（2m10s）；差分对拍 3/3 IDENTICAL + 路径可达；IR 快照 **3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`；114 个 example 目标全不变，快照覆盖 `[ll,c,dev]` 三轨）→ `--update` 重录基线（117 targets / 354 entries）；**gate L2 = 25 passed / 0 failed（2960.0s）**，四代不动点 `g2==g3==g4` + lint 冒烟 27.0s 全绿。已同步种子 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。
- ✅ **反证上一批的门禁假失败处置正确**：本轮 `双轨对拍` **PASS（286.5s）**、连带曾失败的 `REPL 冒烟` **PASS（24.7s）** —— 放宽 `timeoutMs`（只抬预算不改判据）后连续两轮不再出现，确认此前是资源竞争而非回归。

**批次 4：`memspace` / `bd`（Device 地址空间 + 模块/成员标记，2026-10-03）**
- 选组：紧接批次 3 的两个最低量字段。**两者语义并不内聚**，但都属「低量 + 有语料覆盖」的可安全搬迁项，故同批实施、**组内各自独立验证**（`tc check` + 重建 g1 + 差分对拍 + IR 快照），批次边界跑一次 gate L2（沿用 §0.14.7 的 staged 纪律：完整 gate 只在批次边界跑）。
- ⚠ **普查大量砍掉假工作量（本组最典型）**：`memspace` 计数 13 处，其中 **7 处是同名假阳性** —— `tbl_RecPointer_memspace` + `RecPointer` struct（S2 已 SoA 化的 per-kind record，base.tc:1351-1363）、`sema` 的 `TD.memspace`（类型描述，sema.tc:32）、`tir`/`codegen_c` 的 `t.memspace`（同一个 TD）。**真实 Node 站点仅 6 处**。`bd` 计数 15 处，`base.tc:417/423/426/438` 的 4 处属 `RecImportModDecl`（S2 record struct）⇒ 真实站点 11 处。
- ⚠ **`bd` 字段被复用（重要，勿擅自拆分语义）**：同一字段承载两种语义 —— ① `ImportDecl`/`ImportModDecl` = 是否走库搜索路径（`lib/` 依赖库 vs `src` 源码根）；② `member` 节点 = 是否是某个 `call` 的 callee（由 `sema::mark_call_callees` 置位，`infer_expr_body` 据此抑制「结构体无此字段」的 T-SEM-E208 误报，见 sema.tc:7598-7601 注释）。外置只做**等价搬迁**（单一 `g_node_bd` 侧表），语义拆分属独立重构，不在本 epic 范围。
- 存储：`g_node_memspace: []i64`（默认 **0** = host，值域 0/1/3/5）、`g_node_bd: []i64`（默认 **0** = false）。两者默认值均为「零」，与批次 3 同向（再次印证：默认值必须回看旧 `node_new`，而非沿用上一组）。
- 站点（17 处）：`memspace` —— 写 `mk_dev_ptr`（`node_set_memspace`）；读 `codegen_dev::dev_type_of`（发 `!llvm.ptr<as>`）、`sema::resolve_type_desc`（透传 `TD.memspace`）。`bd` —— 写 `mk_ImportModDecl`（库路径）、`parse`（`test "..."` 合成函数标记）、`sema::mark_call_callees`（member callee）；读 `sema`（3 处 import 库路径判定 + 1 处字段误报抑制）、`test.tc`（3 处测试筛选）、dump；传播 `sema::clone_node`。
  - SoA 附带收益：`parse` 的测试函数分支原本是「取值 → 改 `bd`/`sb`/`sc`/`bc` → `slice_set` 回写」，其中 `bd` 已改走侧表（其余字段仍在 Node 上，回写保留）；`sema::mark_call_callees` 的 `ce.bd = true` 同理。
- ✅ **覆盖与等价证据（本组最强）**：三种 bd 语义均有语料覆盖 —— ① 库路径：`@import("std.sort")`（bsearch_demo）、② 测试标记：`testing_demo.tc`、③ member callee：普遍方法调用。差分对拍（变更前种子 vs 新 g1）5/5 IDENTICAL（testing_demo / bsearch_demo / vecadd_device / vecadd_device_full / c_interop），并显式验证路径可达：产物含 `__test_`×5、`sort`×19。
  - `memspace` 的读方 `codegen_dev` **只在 device 轨执行**（C 轨不触达），故额外做 **`emit-dev` 轨对拍**：`vecadd_device.tc` 的 `.mlir` **DEV_IDENTICAL**，且产物含 **`!llvm.ptr<1>`×25（global/dev_ptr）+ `!llvm.ptr<3>`×4（shared）** ⇒ 非 0 的 memspace 值被正确写入并读出（侧表默认值若错位会立即暴露），`kernel_func`×2 证明 bf 路径同时可达。
- 验证：`tc check` 0 error；g1 重建 2m26s；差分对拍 5/5 IDENTICAL + dev 轨 IDENTICAL + 路径可达；IR 快照 **3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`；114 个 example 目标全不变，覆盖 `[ll,c,dev]`）→ `--update` 重录基线（117 targets / 354 entries）；**gate L2 = 25 passed / 0 failed（3019.0s）**，四代不动点 `g2==g3==g4` + 双轨对拍 320.1s + REPL 25.6s + lint 冒烟 24.8s 全绿。已同步种子 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。

**批次 5：`bb` / `bc`（bool 载荷组，2026-10-03）**
- 选组：剩余最低两档（`bc 30` / `bb 38`），且同属 bool 载荷家族（与 `ba` 三连；`ba 91` 量级偏大，留待下批单独处理）。
- 普查（纪律先行）：`bc` 30 处命中里 2 处在注释中 ⇒ 真站点 29；`bb` 38 处里 **4 处是 S2 record-struct 假阳性** —— `base.tc:215/349/378/522` 的 `r.bb = tbl_RecFuncDecl_bb[i]` 等（`RecFuncDecl` / `RecGlobalConstDecl` / `RecGlobalVarDecl` / `RecSL`，S2 已 SoA 化的 per-kind record）⇒ 真站点 34。
- ⚠ **本组新形态：`bb` 同时是 4 个 `mk_*` 构造器的形参**（`mk_FuncDecl` / `mk_GlobalConstDecl` / `mk_GlobalVarDecl` / `mk_SL`）。处置：**保留形参、只改函数体**（`n.bb = bb` → `node_set_bb((id as u64), bb)`）⇒ 15 处 `mk_FuncDecl(...)` 调用点与 `cst_register_Rec*` 的 S2 dual-write **签名全部不动**，把「跨模块签名变更」级风险降为「局部一行」。这是本组能安全并入同一批的关键。沉淀为范式：**构造器形参不必随字段外置而删除**，形参作为构造参数仍可语义自洽地转写为侧表写。
- ⚠ **新坑：局部 `base` 遮蔽模块名（通用，记入速查）**：`sema::fr_resolve_bitfield` / `fr_resolve_flag` 与 `codegen_c` 的 flag 布局函数内都有局部变量 `var base: i64`（位基址），**遮蔽了 base 模块名** ⇒ 这些作用域内不能写 `base.node_bb(...)`（会被解析成对 i64 取字段），必须直呼降级名 **`base__node_bb(...)`**。本组共 3 处（sema×2、codegen_c×1）。
- 语义复用（勿擅自拆分）：`bb` 按 kind 承载 4 种语义 —— `let`/`auto` 的 is_let（VarDecl）、comptime 类型参数（`P`）、`comptime fn` 标记（FuncDecl）、`SL` 显式 offset 标志。外置只做**等价搬迁**（单一 `g_node_bb`），语义拆分属独立重构，不在本 epic 范围。`bc` 语义单一：声明是否被 `pub` 修饰（顶层跨模块可见性）。
- 存储：`g_node_bb / g_node_bc: []i64`（默认 **0 = false**，与 `be`/`bf`/`bd` 同向；第三次印证「默认值必须回看旧 `node_new` 而非沿用上一组」）。
- 站点（63 处）：`bc` —— 写 19 处集中在 `parse`（各类顶层声明的 `is_export` 分支，`nodes[d].bc = true` → `node_set_bc`）；读 `sema`（reexport 判定、`collect_module_defs` 的 `def_add`）、`tir`（链接库 `tir_emit_extern` 门控）、`tir_to_ll`（lib 导出 json）；传播 `sema::clone_node`。`bb` —— 写 `parse`（auto/let/P.pcomp）+ 4 个 `mk_*`；读 `sema`（`func_is_generic`、`instantiate_generic`、flag/SL offset、`comptime fn` 判定、meta 折叠筛选）、`tir`、`codegen_c`、`hir`（HIR GlobalDecl `ba` 位）。
  - SoA 附带收益：4 处「取值 → 改字段 → `slice_set` 回写整节点」简化为单 setter（parse 的 `auto`/`let`/`P.pcomp`、sema 的 ident 未解析一次性诊断位与 match 重入位）。
- ✅ **覆盖与等价证据（本组最强，因语料天然零覆盖）**：`bc` 与 `bb` 的 is_let 分支在 115 个 examples 上**覆盖极弱**（examples 无 `let`、pub 消费需跨模块），故按 epic 通用方法做**三层差分对拍**（变更前种子 `out/dbg/tc.exe` = 批次 4 的 g4 vs 新 g1，编译同一份源）：
  ① 7 个 examples：`physics` / `agentkit` / `c_interop`（pub 顶层声明）、`bitstr_demo` / `bitstr_protocol`（SL 显式 offset ⇒ bb 非 0）、`generics_demo`（comptime 类型参数 ⇒ P.bb）、`meta`（`comptime fn` ⇒ FuncDecl.bb）—— `.c`/`.h` 全 IDENTICAL；
  ② 自建 probe `out/_p5let.tc`（`let` + `auto` + `pub fn` + `pub struct`）—— IDENTICAL，且**显式验证路径可达**：产物含 `int64_t lv = 5;`（let 发射）、`uint8_t au = 3;`（auto 走 is_let）、`pub_add`；
  ③ **`src/tc.tc` 自身**（497+188+430+239 处 pub 声明、34+63 处 comptime，覆盖 `bc` 全部读方与 `bb` 全部 4 种语义）—— **2.4MB `.c` + 129KB `.h` 逐字节 IDENTICAL**。侧表默认值若错位（true/false 反向）或站点漏迁，此对拍必然不等。
- 验证：`tc check` 0 error；g1 重建 2m27s；IR 快照 **3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`；114 个 example 目标全不变，覆盖 `[ll,c,dev]`）→ `--update` 重录基线（117 targets / 354 entries）；**gate L2 = 25 passed / 0 failed（2957.2s）** —— 产物快照比对 PASS（447.3s，重录后由 DIFF 转 PASS）、自举四代不动点 `g2==g3==g4`（154.8s）、run_examples 双后端（568.1s）、双轨对拍（288.3s）、C 后端自举（234.4s）、MIR differential（193.1s）、lint 冒烟 22.9s 全绿。已同步种子 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。

**批次 6：`sc`（字符串载荷，sa/sb/sc 整族外置预演，2026-10-03）**
- 选组：`sc 33` 为当时剩余最低一档，且是 **首个 `[]string` 类型侧表** —— 先前 5 批全是 `[]i64`（bool 以 0/1 表示）。本批的真实目标是**验证「非标量侧表 + `node_new` 锁步 append」范式成立**，为 `sa`/`sb`（杀手级量级 1268/150）整族外置铺路。
- 普查（纪律先行）：33 处 `.sc` 命中里 **14 处是同名结构体假阳性**，来自三个不同的结构体 —— `RecImportDecl` / `RecImportModDecl` / `RecStructDecl`（S2 已 SoA 化的 per-kind record，`cst_get_Rec*` 里的 `r.sc = tbl_RecX_sc[i]`）、`Diag.sc`（诊断起始列，base.tc:3984/3998/5156/5170/5244/5245）、`FixS.sc`（修复起始列，base.tc:4057）。**真实 Node 站点 19 处**。
- ⚠ **`sc` 按 kind 复用 5 种语义（本批最多，勿擅自拆分）**：① `ImportDecl`/`ImportModDecl` 的用户书写别名（`@import("x" as m)` 的 `m`）；② `StructDecl` 的 `@bitpack(T)` 标量成员类型名（`node_has_sc` 为真时有效）；③ `FuncDecl` 的 `"__lambda__"` Lambda 脱糖标记（检查期据此把未解析标识符判为「捕获失败」，LLVM 后端据此前置 env 首参）；④ `FuncDecl` 的 suite 测试路径（`g_suite_path`，`tc test` 的显示名前缀）；⑤ `P` Param 的 conpat variant 类型名（后端据此拼 `<V>_is_<C>` / `<V>_as_<C>`）。外置只做**等价搬迁**（单一 `g_node_sc`），语义拆分属独立重构，不在本 epic 范围。
- 存储：`g_node_sc: []string`（默认 **`""`**；越界读返 `""`，与 `node_mod`/`node_file` 同规约）。`node_new` 锁步 `append(g_node_sc, "")`。
- 站点（19 处）：写 —— `mk_ImportDecl` / `mk_ImportModDecl` / `mk_StructDecl`（三者 `sc` 均为**构造器形参**，沿用批次 5 沉淀的范式：**保留形参、只改函数体** ⇒ 调用点与 `cst_register_Rec*` 的 S2 dual-write 签名全不动）、`parse`（lambda 标记、suite 路径）、`sema`（conpat `P.sc = vname`）、`clone_node` 传播；读 —— `cst_dump`、`hir`（`HIR_OP_IMPORT_DECL` 的 b 串）、`sema`（`g_in_lambda` 判定、`handle_one_import` 的 `user_alias`、lambda 无捕获识别）、`tir`（env 首参前置门控）、`codegen_c`（`conpat_walk` 的 variant 名、`@bitpack` 标量类型）、`test`（测试显示名 `sc + " / " + sb`）。
- ⚠ **搬迁前必查「值拷贝是否有回写」（为本批特设检查项）**：Node 值拷贝上的写若无 `slice_set` 回写即为**无效写**，此时迁到侧表会把「无效写」变成「真实生效」，属于**顺手改 bug**、会让本轮验证指标无法归因（违反 §0.14.7 等价搬迁铁律）。本批逐个确认了三处值拷贝写均有回写：`parse::lift_one_lambda` 的 `fdn.sc`（两条出口各有 `slice_set`，parse.tc:1894/1958）、`parse::parse_test_decl` 的 `fn_n.sc`（2600）、`sema::conpat_check` 的 `pn.sc`（3105）⇒ 均可安全等价搬迁为 setter。
- ⚠ **工具坑（本批新踩）**：`src/*.tc` 是 **CRLF 行尾**，多行跨行替换模式必须写 `\r\n`；用纯 `\n` 构造的 old-string 会静默匹配失败（Python 需以 `newline=''` 打开才保留 `\r\n`）。
- ✅ **覆盖与等价证据（本组最强，因 examples 天然零覆盖）**：五种语义中 **①②③ 在 examples 上覆盖极弱**（`examples/` 无 `@bitpack`、无 `import X as Y`、无 `suite`，仓库内 `src`/`lib` 也一个 `as` 别名都没有），故自建 3 份 probe 并按 epic 通用方法做差分对拍（变更前种子 vs 新 g1，编译同一份源）：
  ① `@import("std.math" as mm); return mm.abs(-5);` —— IDENTICAL，且**路径可达**：产物含 **`mm__abs`**（mangle 消费了 sc=mm；若侧表读失效会退化为「未定义的标识符 mm」而非编译通过）；
  ② `struct Proto @bitpack(u16) { cmd: i64; len: i64; }` —— IDENTICAL，路径可达：`.h` 含 **`// @bitpack(u16) struct`**；
  ③ `suite "math" { test … }` 含嵌套 suite —— `tc test` 双方同为 `test math / dbl 应翻倍` + `test math / nest / zero` 2 passed，路径可达（显示名 = `sc + " / " + sb`，正是 `test.tc:252` 的消费者；旧 doc 曾误记 examples 无 suite，实为 `tests/samples` 有）；
  ④ `__lambda__` —— `lambda_demo` / `closure_demo` / `closure_struct_demo` 三个 example IDENTICAL；
  ⑤ conpat variant 名 —— `adt_status` 等 12 个 example IDENTICAL，路径可达：`.c` 含 **`Status_is_Ok`** / **`Status_as_Ok`**（消费 copat 的 sc=Status）；
  ⑥ **`src/tc.tc` 自身 —— 2.46MB `.c` + 129KB `.h` 逐字节 IDENTICAL**（覆盖 `__lambda__` 全路径与 clone_node 传播）。侧表默认值若错位或站点漏迁，此对拍必然不等。
- 验证：`tc check` 0 error；g1 重建 2m34s；差分对拍三层全 IDENTICAL + 五种语义路径均可达；IR 快照 **3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`；114 个 example 目标全不变，覆盖 `[ll,c,dev]`）→ `--update` 重录基线（117 targets / 354 entries）；**gate L2 = 25 passed / 0 failed**；已同步种子 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。

**批次 7：`nd`（子节点索引，na/nb/nc/nd 四槽外置预演，2026-10-03）**
- 选组：`nd` 是当时剩余最低一档（grep 40）且已是**孤品**（同族 `na`/`nb`/`nc` 未迁）。本批的真实目标是验证**「索引型侧表」范式**成立（前 6 批只覆盖 bool 与 string 两类），为 `na 1070` / `nb 461` / `nc 80` 三座量级高峰铺路。
- 普查（纪律先行）：30 处 `.nd` 命中里 **8 处是同名结构体假阳性** —— `RecTile.nd`（`base.tc:1641` 的 `r.nd = tbl_RecTile_nd[i]`，S2 per-kind record）与 `HIRInst.nd`（`hir.tc:142/179/1135/1205/1267`，HIR 指令的 nd 槽，与 CST 节点无关）。**真实 Node 站点 22 处**。
- 存储：`g_node_nd: []i64`（默认 **`-1`** = 无该子节点；**越界读也返 `-1`**）。`node_new` 锁步 `append(g_node_nd, -1)`。
- ⚠ **索引型侧表与 bool 侧表的关键差异**：默认值与越界读返回值必须是 **`-1`（哨兵）而非 `0`**。若错写成 `0`，会把「无子节点」读成「子节点 = 节点 0」，是**静默错误**（不崩、不报错，只在深层子树上产出错误结构）。这是本类侧表独有的失败模式，bool/string 类不存在。
- 站点（22 处）：写 —— `mk_tile`（`nd` 为构造器形参，沿用批次 5 范式：**保留形参、只改函数体** ⇒ 调用点与 `cst_register_RecTile` 的 dual-write 签名不动）、`clone_node` 传播、`subst_type_in_node` / `meta_subst_val_node` / `subst_type_ident_node` 三个替换函数的读改写同槽、`meta_fold_expr` 与 `@zeroed` 折叠的整节点传播、`comptime_rewrite_to_literal` 的子节点槽清零、`dev_safe_node` 的零节点初始化（**直接删除**——侧表越界读天然返 `-1`，与原 `n.nd = -1` 等价，无需保留）；读 —— `cst_dump`、`hir::hir_type_text`（`@Tile(...)` 文本重建）、`sema`（`tile_fold_child` flavor、`fmt_scan_subtree`、`expr_has_local_addr`、`dev_check_node`、`meta_walk`×2、`mb_walk`）、`parse`（`cap_scan`、`lam_find`、`clone_type_node`、`desugar_self_node`）、`comptime_fold`（`comptime_has_runtime_ref`）。
- ⚠ **本批新踩的工具坑：行尾注释吞掉闭合括号**。批量替换时把 `// 注释` 追加到形如 `if (…) { return …; }` 的**单行**语句尾部，会把该行末尾的 `}` 一并纳入注释 ⇒ 块未闭合 ⇒ 后续 `pub fn` 被判为嵌套声明，报 **`T-MOD-E556`（`pub` 只能修饰顶层声明）**，且报错位置在**下一个函数**而非改动行，极易误判。本批在 `parse.tc:2172` 与 `hir.tc:287` 各踩一次。规避：**替换前先看 old-string 是否含行尾 `}`；若不含，注释必须另起一行写在语句之上**。
- ⚠ 另一个既有坑的变体：`src/*.tc` **逐文件行尾不同**（本批实测 `parse/sema/hir/tir` = CRLF，`base/codegen_dev/comptime_fold/tc` = LF），脚本须**按文件自适应探测**，不能全局假定 CRLF。
- ✅ **覆盖与等价证据**：`nd` 的主力语料是 `@Tile(rows, cols, T, flavor)` 的第四参（flavor 槽），`examples/tile_demo.tc` 完整覆盖且**含非默认值路径**（`hardware`=0 与 `simulate`=1）：
  ① `tile_demo` 实跑（`tc run`）新旧双方输出**逐行一致**，含 `@tile_flavor(e)` = **1**（证明 nd 槽被写入、被 `tile_fold_child` 读出、经 `hir_type_text` 重建，非默认值路径可达）；
  ② 17 个 example 编译产物（`.c`/`.h`）**全部 IDENTICAL**（含 `vector_demo`、`generics_demo`、`meta`、`fmt_json_a1a`、`fstring_json`、三个 lambda/closure 例）；
  ③ 自建泛型×tile probe（`fn tsum(comptime T: type) { var a: @Tile(2,2,T,simulate); … }`，类型参数嵌在 `@Tile` 内部 ⇒ 触发 `subst_type_in_node` 递归进 tile 的 nd 分支）—— 产物 IDENTICAL，实跑退出码双方均 **24**（`tsum(i32)=12 + tsum(i64)=12`）；
  ④ **`src/tc.tc` 自身 —— 2.46MB `.c` + 129KB `.h` 逐字节 IDENTICAL**（覆盖 `clone_node` 传播、三个 subst 函数、`meta_walk`/`mb_walk`/`cap_scan`/`lam_find`/`desugar_self_node`/`comptime_fold` 全部读方）。侧表默认值若为 `0` 或站点漏迁，此对拍必然不等。
- 验证：`tc check` 0 error；g1 重建 2m36s；IR 快照 **3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`）→ `--update` 重录基线（117 targets / 354 entries）；**gate L2 = 25 passed / 0 failed**；已同步种子 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。

**批次 8：`ib`（通用整数槽，索引型侧表范式复用，2026-10-03）**
- 选组：`ib` 是当时剩余量级最低的一档（grep 59），且与批次 7 的 `nd` 同属**索引型**载荷 ⇒ 可直接复用刚验证过的 `-1` 哨兵范式，单批风险最低。
- 普查（纪律先行）：59 处 `.ib` 命中里 **15 处是假阳性** —— 3 处 S2 per-kind record 读取（`base.tc:524` `r.ib = tbl_RecSL_ib[i]`、`1646` `tbl_RecTile_ib`、`1693` `tbl_RecConpat_ib`）+ 12 处注释。**真实 Node 站点 44 处**。
- 存储：`g_node_ib: []i64`（默认 **`-1`** = 无标记；**越界读也返 `-1`**）。`node_new` 锁步 `append(g_node_ib, -1)`。
- ⚠ **`ib` 是复用最重的字段：按 kind 承载 6 种互不相干的语义**（本批只做等价搬迁，未拆语义）：
  ① `SL`（flag 槽位）的显式 offset（配合 `bb` 标志位；`@offset(n)` 注解）｜② `tile` 节点折叠出的**列数**（`ia`=行、`ib`=列、`la`=flavor）｜③ `array_lit` 被 sema 回填的 **TD 下标**（`>=0` 表示此字面量构造向量/瓦片，`cat` 查 `tds[ib]`；⚠ 标记只能挂 `ib`——`array_lit` 的 `ia` 在 sema 之后会被抹回 `-1`，历史实测）｜④ `conpat` 的子模式个数 / `VC`（variant case）的载荷个数（多载荷 `>=2`）｜⑤ `F`（结构体字段）的 **tagID**（`>=1` 显式 `@N` / 全自动顺序分配 `1,2,3…` / `-1` 未分配）｜⑥ leading-dot 结构体字面量 `.{...}` 的标记（`==1`）。
- 站点（44 处）：写 —— `mk_SL` / `mk_tile` / `mk_conpat`（`ib` 均为构造器形参，沿用批次 5 范式：**保留形参、只改函数体** ⇒ 调用点与三个 `cst_register_Rec*` 的 dual-write 签名全不动）、`parse` 5 处（合成 `F` 节点、`F.tagID`、leading-dot 标记、`VC` 载荷数，均有 `slice_set` 回写）、`sema` 8 处（`tile_resolve` 列数回填、`clone_node` 传播、向量/瓦片字面量 TD 标记、`@tsplat`/tile 内省回填、struct tagID 全自动分配）；读 —— `cst_dump`、`sema` 12 处（`tile_resolve` 已折叠判定、`conpat_check` 的 want/got、`resolve_type_desc`、struct tagID 统计与去重、flag 布局显式 offset ×2、leading-dot ×2）、`codegen_c` 9 处（`@tsplat` 列数、conpat 多载荷访问器、`@tile_cols` 内省、向量/瓦片字面量发射、`array_lit` 二次包裹门控、flag 布局、type_info 序列化 tagID）、`tir` 2 处、`tir_to_ll` 1 处。
- ⚠ **本批新踩的坑：按「首个匹配行」定位字段会命中同名的 S2 record**。脚本用「找第一个 `ib: i64;`」删字段，实际删掉的是 `base.tc:506` 的 **`RecSL.ib`**（S2 per-kind record，与 `Node` 无关），`Node.ib` 反而没删。正确做法：**先定位 `pub struct Node {` 的行号，再在其块内查找**；或用带上下文的 `old_string`（`ia: i64;\n ib: i64;\n ba: bool;`）让工具因「不唯一」报错来暴露歧义。已写进 `topics/impl-rules.md`。
- ✅ **覆盖与等价证据**：`ib` 的 6 种语义全部有现成语料，且**均验证了非默认值路径可达**：
  ① 显式 offset —— examples 无 `@offset` 用例（`tests/samples/game_ecs.tc` 有但是旧 `import(X)` 语法已废弃、编译不过），故自建 probe `flag Slot[u32] { lo: 8 @offset(0); hi: 8 @offset(16); tag: 4 @offset(24); }`：产物 IDENTICAL，实跑退出码双方均 **9**（`flag_get(lo)=3 + hi=5 + tag=1` —— offset 若读错则位域重叠、值必然不同）；`bitflags` / `bitstr_demo` / `bitstr_protocol` 实跑输出一致；
  ② tile 列数 —— `tile_demo` 实跑双方同为 `6 / 1 / 10`；
  ⑤ tagID —— `tagid_typeinfo` 产物 `__ti_Point_f[]` 含 `, 1 }` / `, 2 }` / `, 3 }`（显式 `@1/@2/@3`），`__ti_Auto_f[]` 同为 `1/2/3`（**全自动分配分支**）⇒ 两条分支都被消费；
  ⑥ leading-dot —— `tuple_demo` 实跑输出逐行一致（`t.0=1 t.1=hi t.2=true` …）；
  ③④ —— `adt_multi` / `adt_shape` / `adt_status` / `match_ext` / `shapes` / `vdot_all` / `vector_demo` 等 17 个 example 编译产物**全部 IDENTICAL**；
  ⑦ **`src/tc.tc` 自身 —— 2.46MB `.c` + 129KB `.h` 逐字节 IDENTICAL**（覆盖 `clone_node` 传播、tagID 决议、flag 布局、全部读方）。侧表默认值若为 `0` 或任一站点漏迁，此对拍必然不等。
- 验证：`tc check` 0 error；g1 重建 4m28s；IR 快照 **3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`）→ `--update` 重录基线（117 targets / 354 entries）；**gate L2 = 25 passed / 0 failed**；已同步种子 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。

**批次 9：`nc`（第三子节点槽，索引型范式第二次复用；⚠ 本批暴露「Node 值传参丢 id」致命坑，2026-10-03）**
- 选组：`nc` 是当时剩余量级最低的一档（grep 80），且与批次 7 的 `nd` 同属 `na/nb/nc/nd` 四槽中的「子节点索引」族 ⇒ 直接复用已验证的 `-1` 哨兵范式，单批风险最低。
- 普查（纪律先行）：80 处 `.nc` 命中里 **15 处假阳性**（`tbl_RecFor_nc` / `tbl_RecArm_nc` / `tbl_RecTile_nc` 三处声明 + 三处 `r.nc = tbl_…[i]` 读取 + 注释）⇒ **真实站点 65 处**（写 9 + 读 56）。
- 存储：`g_node_nc: []i64`（默认 **`-1`** = 无该子节点；越界读也返 `-1`）+ `node_nc()` / `node_set_nc()` + `sidetable_register("node_nc","S4")` + `node_new` 锁步 `append(-1)`。构造器 `mk_for` / `mk_arm` / `mk_tile` **保留 `nc` 形参**，只把 `n.nc = nc` 换成 `node_set_nc((id as u64), nc)` ⇒ 调用点与三个 `cst_register_Rec*` 的 S2 dual-write 签名全不动（沿用批次 5 起的范式）。
- `nc` 语义（按 kind 复用，本批只做等价搬迁、未拆语义）：① `for` 的**增量表达式**（continue 块，tir 在 `contL` 块发射）｜② `arm`（match 臂）的**体表达式**（`na`=等值模式、`nb`=when 守卫）｜③ `tile` 的 **cols 表达式节点**（`na`=元素类型、`nb`=rows、`nd`=flavor）｜④ `P`（绑定参数）的 **when 守卫表达式**｜⑤ 其余通用第三子节点槽。
- ⚠⚠ **本批致命坑（新发现；已入 `topics/impl-rules.md`）：`Node` 结构体按值传参时，末尾字段 `id` 不可靠。**
  迁移时读点统一写成 `base.node_nc((X.id as u64))`（`X` 为 Node 值变量）。这对**局部 `var X: Node = base.nodes[…]`** 成立——实测诊断 `sid=331 nid=331 nc=330`，逐点等价；但 `tir::tir_emit_for(n: Node)` 收的是**形参**，实测 `n.na` 正确（322）而 **`n.id` 读到垃圾值 75**（真实下标 331），于是 `node_nc` 实际读的是 `nodes[75].nc = -1` ⇒ **for 增量被当作「无」而不发射**，定长数组 `!j` 编码的下标循环丢失 `jx0 = jx0 + 1`，实跑 **`arena: out of memory`**（死循环），而 C 后端因原生 `for(;cond;incr)` 语义掩掉该差异、产物仍逐字节一致。
  根因不在侧表本身（侧表读写逐点等价，诊断已证），而在**依赖了形参 Node 的 `.id`**。
  修复：`tir_emit_for` 改收**节点索引 `sid: i64`**（函数内 `var n: Node = base.nodes[sid]`），调用点 `tir_emit_for(sid)`；其余读点不动（均为局部变量取值）。
  **铁律**：凡要按 id 查侧表，**禁止在 `Node` 形参上读 `.id`**——要么用局部 `base.nodes[…]` 取值，要么把索引作为形参传入。（`Node.id` 是 S5 step2 的过渡字段，且是 `Node` 结构的**最后一个**字段，值传参时不可信；改动前从不读它，故此前未暴露。）
- ✅ 覆盖与等价证据（`nc` 的五种语义全部有语料，且**均验证非默认路径可达**）：
  ① for 增量 —— `mini.tc`（定长数组 `[3]i64` 的 `!j` 按下标遍历；**死循环强判据**：修复前 g1 实跑 `arena: out of memory`、seed 正确输出 `[10,20,30]`，修复后双方逐字节一致）、`array_range`（`90/90/30`）、`p3_loop_value`（值循环 for 脱糖，走 `desugar_value_loop` 的 `mk_for(n.na, n.nb, node_nc(n.id), …)`，输出 `ok=5`）；
  ② arm 体 —— `match_demo`（`zero one two many zero positive negative 42 …`）；
  ③ tile cols —— `tile_demo`（`… 21 6 1 10`）；
  ④ P when 守卫 —— `clause_demo` / `overload_demo` / `overload_catchall`（`zero positive negative 20 200 …` / `zero one many …` / `default big negative`）；
  以上 8 个 example 编译 + 实跑输出**逐行 IDENTICAL**；
  ⑤ **`src/tc.tc` 自身 —— 2.46MB `.c` + 130KB `.h` 逐字节 IDENTICAL**（md5 `cc7be409…` / `56f91b90…`，seed 与 g1 一致），且与 IR 快照 `src/tc.tc::c` 的 `now` 值吻合 ⇒ 该 3 DIFF 属源码变更导致的预期表示漂移。
- 验证：`tc check` **0 error**（531 warning 全为既有命名风格告警 `T-NAM-W401/W402`/`T-MOD-W561`，无一条与 nc 相关）；g1 自举 2m46s；**首轮 IR 快照异常 = 12 DIFF**（含 9 个 examples，与既往批次「仅 `src/tc.tc` 变」的形态不符）⇒ 按异常信号追查，定位上述致命坑并修复后复跑，回到 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）** ⇒ `--update` 重录基线（117 targets / 354 entries，334.9s）。
- **gate L2 = 25 passed / 0 failed（3533.6s）**：产物快照比对 468.6s、conformance 149.3s、自举不动点 g2==g3 321.8s、run_examples 694.9s、双轨对拍 381.6s、**四代不动点 g2==g3==g4 174.9s**、MIR 中端 differential 249.5s、C 后端自举 294.0s、rls 400.2s、lint 冒烟 30.3s 全绿。已同步 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`。
  ⚠ 首轮 gate 在 conformance 步报 `f44_fid_read_agg missing code T_FID_DESERIALIZE_AGG`，但 stderr 显示是**沙箱拦截了该用例文件的读取**（`[sandbox] … (file-read)`）；隔离重跑 `tools/conformance.mjs` 得 **316 passed / 0 failed** ⇒ 属环境偶发，与本次改动无关（第二次完整 gate 该步 PASS 149.3s）。
- ⚠ **方法论收获**：IR 快照的「examples 出现 DIFF」是本轮唯一能暴露该 bug 的信号（C 后端对拍完全看不出来——跨后端语义差异把增量丢失掩掉了）。后续每批**必须**同时看「examples 是否 0 DIFF」，不能只看 0 NEW/0 GONE。

**批次 10：`ba`（通用 bool 载荷，bool 范式第五次复用；含「形参 `.id` 隐患」的系统性复查，2026-10-04）**
- 选组：`ba` 是当时剩余量级最低的一档（grep 91），且是**最后一个 bool 载荷**（`bool` 侧表范式此前已被 `bd`/`be`/`bf`/`bb`/`bc` 五批验证）⇒ 单批风险最低。
- 普查（纪律先行）：91 处 `.ba` 命中里 **8 处假阳性**（`base.tc` 的 `r.ba = tbl_Rec{FuncDecl,StructDecl,BitstrSeg,Bool,Arm,Range,VarDecl,ImportItem}_ba[i]`，全是 S2 per-kind record 的**读**，从不从 `nodes[]` 取 `ba`；`cst_register_RecBool(ba)` 等 dual-write 直接收形参）⇒ **真实 Node 站点 83 处**（base 内 12 + 其余 71：写 9 + 读 62）。
- 存储：`g_node_ba: []i64`（默认 **`0` = false**；越界读返 `false`）+ `node_ba()` / `node_set_ba()`（**bool 进出**，与 `node_bb/node_bc` 同形）+ `sidetable_register("node_ba","S4")` + `node_new` 锁步 `append(0)`。八个构造器（`mk_FuncDecl` / `mk_StructDecl` / `mk_bitstr_seg` / `mk_bool` / `mk_arm` / `mk_range` / `mk_var_decl` / `mk_ImportItem`）**保留 `ba`/`rest`/`wild` 形参**，只把 `n.ba = X` 换成 `node_set_ba((id as u64), X)` ⇒ 调用点与 `cst_register_Rec*` 的 S2 dual-write 签名全不动（沿用批次 5 起的范式）。
- ⚠ **`ba` 是复用最重的 bool 槽：按 kind 承载 8 种互不相干的语义**（本批只做等价搬迁，未拆语义）：
  ① `bool` 字面量的**真值**（量最大、最热）｜② `var_decl` 是否 **`const`/`let`**（只读绑定；`cs_assignment` / `check_stmt_cst` 据此报 `T-SEM-E762`）｜③ `arm` 是否 `_` **通配**｜④ `P`（形参）是否 `_` **通配**｜⑤ `range` 是否**闭合区间** `..=`（脱糖为 `<=` 而非 `<`）｜⑥ `bitstr_seg` 是否**变长尾段** `rest/bitstr`｜⑦ `ImportItem` 是否**通配** `:: *`｜⑧ `StructDecl` / `VariantDecl`（抽象/开放变体，尾部 `_`）/ `FuncDecl`（clause 脱糖主体）各自的结构性标记。
- ✅ **批次 9 隐患的系统性复查（本批开工前必做）**：批次 9 发现「`Node` **形参**的 `.id` 是垃圾值」后，本批开工前先跑了一次全量普查——扫描 `src/*.tc` 全部 `node_X((V.id as u64))` 站点共 **113 处**，逐个回溯到所属函数头判定 `V` 是「形参 `V: Node`」还是「局部 `var V: Node = nodes[…]`」，结果 **0 处形参**（含本批新增的 57 处）⇒ 该隐患无残留。**此普查应作为后续每批的固定前置步骤**（`Node` 尾部 `id` 字段仍在，风险敞口持续存在）。
- ✅ 覆盖与等价证据（`ba` 的 8 种语义全部有语料，且**均验证非默认/非平凡路径可达**）：
  ① bool 真值 —— `mini`（`{"x":3,"y":-7} [1,2,3] …`）、`match_demo`、`overload_demo`；
  ② `const`/`let` 只读 —— `tests/conformance/fail/f140_ref_write_readonly.tc`（`let r1 = &a; *r1 = 5;`）双编译器均报 **`T-SEM-E762`**（证明 `var_decl.ba=true` 被写入且被 `cs_assignment` 读出）；
  ③ arm 通配 —— `match_demo` 的 6 处 `_ =>` 臂；
  ④ 形参通配 —— `clause_demo`（`fn classify(_) string`）、`overload_demo`（`overload fn describe(_)` / `greet(_)` / `tag(_)`）；
  ⑤ 闭合区间 `..=` —— `match_ext`（`match_ext ok`）；
  ⑥ 位串变长尾段 —— `bitstr_protocol`（`payload/bitstr` 尾段解构，实跑 `5 2 8 222 173 190 239 4`）；
  ⑦ 导入通配 —— examples 无 `:: *` 用例（现有 import 全是整模块 `@import("x")`），故自建 probe `@import("std.math" :: *); abs(0 - 7)`：双编译器实跑均 `v=7` ⇒ `ImportItem.ba=true` 路径可达且 `sel_register` 读侧表正确；
  ⑧ 抽象变体 —— `adt_status`（`variant Status { Ok(i64); Err(i64); _ }`，实跑 `7 -3`）；
  ⑨ 附带覆盖 sema 的 `m_an.ba = true` 分支（切片 `[..]` / 范围 `..` 全通配臂改写）—— `match_slice` / `match_ext`；
  以上 **14 个 example 编译 + 实跑输出逐行 IDENTICAL**，另有 2 个自建 probe 一致；
  ⑩ **`src/tc.tc` 自身 —— 2.47MB `.c` + 130KB `.h` 逐字节 IDENTICAL**（md5 `6847634b…` / `41704e46…`，seed 与 g1 一致），覆盖 `clone_node` 传播、`meta_fold_expr` / `mb_fold_inplace` / `comptime_rewrite_to_literal` 整节点改写、八个构造器与全部读方。
- 验证：`tc check` **0 error**（531 warning 全为既有命名风格告警 `T-NAM-W401/W402`/`T-MOD-W561`，与批次 9 完全一致，无一条与 ba 相关）；g1 自举 2m14s（注释清理后复建 3m19s，产物 md5 不变 ⇒ 注释不影响 codegen）；IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）** ⇒ `--update` 重录基线（117 targets / 354 entries，207.6s）。
- **gate L2 = 25 passed / 0 failed（1755.0s）**：工具链断言 0.3s、诊断注册表 0.1s、CST kind 清单 0.1s、静态检查 0.7s、预编译 std 1.8s、**自举一代 152.0s**、IR 静态审计 1.3s、LLVM verifier 1.5s、产物快照比对 253.4s、conformance 50.3s、UNSUPPORTED 0.4s、**自举不动点 g2==g3 272.6s**、run_examples 140.9s、HIR AstGen 10.1s、HIR 解释器 1.0s、difftest 代际 3.2s、双轨对拍 67.3s、REPL 冒烟 4.6s、**四代不动点 g2==g3==g4 158.6s**、MIR differential 60.8s、C 后端自举 211.7s、difftest tc0 40.1s、rls 快速通道 318.1s、tote 冒烟 1.0s、lint 冒烟 3.3s 全绿。已同步 `g4→out/dbg/tc.exe`、`gr→out/rls/tc.exe`（同步后 `tc check` 复检仍 0 error / 531 warning）。

**批次 11：`lc`（kids 链表头，⚠ 带 `-2` 特殊哨兵的索引型侧表，2026-10-04）**
- 选组：`lc` 是当时剩余量级最低的一档（grep 92），与 `la`/`lb` 同属 **kids 链表头**族。它与批次 7 的 `nd`、批次 9 的 `nc` 虽同为索引型，但**语义完全不同**：`nd`/`nc` 装的是**节点 id**，`la`/`lb`/`lc` 装的是 **kids 池里的链表头下标**（必须用 `*_kids` / `*_list` 系列链表下钻，当节点 id 用会张冠李戴——`sema::instantiate_generic`、`parse::parse_method_decl`、`hir::hir_lower_funcdecl` 三处注释都在警告这件事）。
- 普查（纪律先行）：92 处 `.lc` 命中里 **8 处假阳性** —— `base.tc:219` `r.lc = tbl_RecFuncDecl_lc[i]`、`265` `tbl_RecLambda_lc[i]`（S2 per-kind record 的读，从不从 `nodes[]` 取 `lc`）+ 6 处注释（`sema:2068`、`parse:5108`、`hir:447/634`、`tir:3893/3895`）⇒ **真实站点 84 处**（base 4 + 其余 80：写 12 + 读 68）。
- 存储：`g_node_lc: []i64`（默认 **`-1` = 空 kids 链**；越界读也返 `-1`）+ `node_lc()` / `node_set_lc()` + `sidetable_register("node_lc","S4")` + `node_new` 锁步 `append(-1)`。构造器 `mk_FuncDecl` / `mk_lambda` **保留 `lc` 形参**，只把 `n.lc = lc` 换成 `node_set_lc((id as u64), lc)` ⇒ 调用点与 `cst_register_RecFuncDecl` / `cst_register_RecLambda` 的 S2 dual-write 签名全不动。
- ⚠⚠ **本批最关键的默认值判定：`lc` 带一个 `-2` 特殊哨兵，默认值必须是 `-1` 而非 `-2`。**
  `FuncDecl` / `lambda` 等带体节点用 **`lc == -2`** 表示「本体已由别处消费 / 是外部注入的合成声明」，需跳过常规语句遍历与检查。判据遍布 10 处：`if (n.lc > -2)`（`parse::desugar_lambdas`、`tir::tir_lower_func`、`codegen_c::build_type_map`/`emit_func_decl`）、`if (n.lc != -2)`（`sema::instantiate_generic`、`ovl_instantiate`、`desugar_imports`、`meta_pass`）、`if (n.lc == -2)`（`sema::check_func_decl_ex`、`meta_eval_call`）。写入点只有 `sema` 里 4 个合成 FuncDecl 的构造实参（`mk_FuncDecl(..., -2, ...)`，为 variant/ADT 生成 `X_from_Case` / `X_is_Case` / `X_as_Case` 三类访问器）。
  ⇒ 侧表默认 **`-1`**、越界读 **`-1`**：若错写成 `-2`（或越界返 `-2`），每个新节点都会被当成「已消费的合成声明」而**跳过语句检查与发射**——与批次 7 指出的索引型失败模式同源（静默错误，不崩不报）。
- 站点（84 处）：写 12（`clone_node` 传播、三个 subst 函数的读改写同槽、`instantiate_generic`×3、`ovl_instantiate`×2、`@tile` 编译期内省回填 flavour、lambda 提升的 `fdn.lc = list_concat(...)` 与两处 `ln*.lc = -1`、`meta_fold_expr` 整节点传播；`codegen_dev::dev_safe_node` 的 `n.lc = -1` **直接删除**——侧表越界读天然返 `-1`，与原写法等价）；读 68（`cst_dump`、`sema` 30、`parse` 14、`hir` 4、`tir` 3、`codegen_c` 5、`codegen_dev` 1、`comptime_fold` 1）。
- ⚠ **有效写判定**（批次 7 铁律）：逐个核过 12 个写点，**全部有 `slice_set` 回写**（`subst_type_in_node` / `meta_subst_val_node` / `subst_type_ident_node` 三姊妹在 `slice_set(base.nodes, nd_id, n)` 前改写；`instantiate_generic` / `ovl_instantiate` 在 `slice_set(base.nodes, inst, inn)` 前；`spn2`/`ln3`/`ln2`/`fdn`/`dst` 同理）⇒ 可安全机械升级为 setter，不存在「把原本无效写变成有效写」的风险。
- ✅ **批次 9 隐患的固定前置普查**：本批开工后重跑（`src` 已新增 51 处 `.id` 读点）——扫描全部 `node_X((V.id as u64))` 共 **164 处**（上批 113 处），**0 处落在 `Node` 形参上**。该普查自批次 10 起为每批固定步骤。
- ✅ 覆盖与等价证据（`lc` 的 4 种语义全部有语料，且**均验证非默认路径可达**）：
  ① 通用 `FuncDecl` 语句链表头 —— `mini` / `meta` / `generics_demo` / `p3_loop_value` / `pipeline_demo` / `enum_constval`（含 `-2` 判据的通过分支 `!= -2`）；
  ② `lambda` 体语句链表头 —— `lambda_demo`（`add(3,4) = 7 … make_d`）、`closure_demo`、`closure_struct_demo`（覆盖 lambda 提升的 `fdn.lc = list_concat(ch, ln.lc)` 与 `ln*.lc = -1` 三处写点，以及 `parse::desugar_lambdas` 的 `lc > -2` 判据）；
  ③ `@tile`/`@Vector` 编译期内省的 flavour 槽（`sema` 回填 `ti_tflavor` → `tir::tir_emit_call` / `codegen_c::emit_expr` 读出）—— `tile_demo` 实跑 `… 21 6 1 10`，其中 `@tile_flavor` 同时覆盖 **0（hardware）与 1（simulate）**两条分支；
  ④ `variant` 合成访问器的 **`-2` 哨兵**（4 个写入点全在此）—— `adt_shape`（`75 28 0`）/ `adt_status`（`7 -3`）/ `adt_list`（`0 42 109`）/ `adt_multi`（`75 12 6 0 -1 42 0`）/ `match_ext`（`match_ext ok`）；
  以上 **14 个 example 编译 + 实跑输出逐行 IDENTICAL**；
  ⑤ **`src/tc.tc` 自身 —— 2.47MB `.c` + 130KB `.h` 逐字节 IDENTICAL**（md5 `acd39015…` / `260dabdd…`，seed 与 g1 一致），覆盖 `clone_node` 传播、三个 subst 函数的 kids 递归、lambda 提升、整节点改写与全部读方。侧表默认值若为 `-2` 或任一站点漏迁，此对拍必然不等。
- 验证：`tc check` **0 error**（531 warning 全为既有命名风格告警 `T-NAM-W401/W402`/`T-MOD-W561`，与批次 9/10 完全一致，无一条与 lc 相关）；g1 自举 3m36s；IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）** ⇒ `--update` 重录基线（117 targets / 354 entries，405.1s）。
- ✅ **gate L2 = 25 passed / 0 failed（2977.4s）**，含四代自举不动点 `g2 == g3 == g4`（`自举一代 201.5s` / `产物快照比对 456.2s` / `不动点 g2==g3 303.5s` / `run_examples 487.1s` / `双轨对拍 343.5s` / `四代不动点 150.0s` / `MIR differential 167.3s` / `C 后端自举 236.1s` / `rls 快速通道 290.2s`）。种子已同步（`g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`），同步后 `tc check` 复检仍 **0 error / 531 warning**。

**批次 12：`sb`（通用字符串载荷，第二个 `[]string` 侧表，2026-10-04）**
- 选组：`sb` 是当时的最低一档（grep 150），与批次 6 的 `sc` 同属**字符串载荷**族 ⇒ `[]string` 侧表范式第二次复用。此前 bool 族（`ba/bb/bc/bd/be/bf`）、索引族（`nd/nc/lc/ib`）均已验证成立，本批补上 string 族的第二例，并把它做成 sa/sb/sc 三槽的收口预演。
- 普查：131 处 `.sb` 原始命中里 **19 处假阳性** —— 9 处 `tbl_Rec{EnumDecl,FlagDecl,ImportDecl,ImportModDecl,StructDecl,Vval,ForEach,ImportItem,Conpat}_sb`（S2 per-kind record 的读，从不从 `nodes[]` 取 `sb`）+ 10 处注释 ⇒ **真实站点 121 处**（写 32 / 读 90）。
  ⚠ 一处易误判：`codegen_c.tc:4305` 行内含字符串字面量 `"// flag["`，按「遇 `//` 即截断」的朴素启发会被当成注释而**漏迁**，实为真读点（已补回）。
- 存储：`g_node_sb: []string`（默认 **`""`**；越界读也返 `""`）+ `node_sb()` / `node_set_sb()` + `sidetable_register("node_sb","S4")` + `node_new` 锁步 `append("")`。9 个构造器（`mk_EnumDecl` / `mk_FlagDecl` / `mk_ImportDecl` / `mk_ImportModDecl` / `mk_StructDecl` / `mk_VVal` / `mk_for_each` / `mk_ImportItem` / `mk_conpat`）**保留 `sb` 形参**，只把 `n.sb = sb` 换成 `node_set_sb((id as u64), sb)` ⇒ 调用点与 `cst_register_Rec*` 的 S2 dual-write 签名全不动。
- ✅ **哨兵普查结论：`sb` 没有「默认之外的哨兵值」**（与第十一批 `lc` 的 `-2` 截然不同）。`""` 之外出现的值是 `"?"`（named 的未知限定符，`parse::type_node_mangle` 里与 `""` 同义处理）与 `"soa"` / `"i64"` / `"u64"` / `"f64"` / `"f32"` / `"b"` / `"s"` 等**纯语义值** ⇒ 默认与越界读一律 `""`，不存在「把普通节点读成特殊状态」的静默错误面。该结论已固化进 `node_sb` 处注释（含判据与 12 种语义清单）。
- ⚠⚠ **本批唯一的实质性改造：4 个 `Node` 值形参函数必须改收索引**（批次 9 致命坑的形状——值传参末尾字段 `id` 不可读，`node_sb((n.id as u64))` 会读到错误节点）：

  | 函数 | 改造前 | 改造后 | 调用点提供的索引 |
  |---|---|---|---|
  | `tir::tir_emit_closure_capture` | `(n: Node)` | `(sid: i64)` + 函数内 `var n = base.nodes[sid]` | `tir:2290` 的 `sid` |
  | `tir::tir_emit_for_each` | `(n: Node)` | `(sid: i64)` + 函数内取节点 | `tir:2362` 的 `sid` |
  | `codegen_c::c_bitint_suffix` | `(n: Node)` | `(sid: i64)` + 函数内取节点 | `codegen_c:2161` 的 `e` |
  | `tir::tir_emit_closure_make` | `(n: Node, e: i64)` | 签名不动，直接复用已有的 `e` | —— |

  四者每个都只有 **1 个调用点**，且调用方作用域已有裸索引，改造零扩散；`tir::tir_emit_for(sid)`（批次 9 已改）是同形范例。
- ⚠ **有效写判定**（批次 7 铁律）：22 个非构造器写点逐个核过，**全部有精确 `slice_set(<nodes>, <idx>, <var>)` 回写** ⇒ 可安全机械升级为 setter，不存在「把原本无效写变成有效写」的风险。`sema::clone_node` 的 `nn.sb = sn.sb` 同步改为侧表跨节点传播。
- ⚠ **`base` 局部遮蔽**：`codegen_c::emit_flag_decl`、`sema` 若干函数内有 `var base: i64`，搬迁脚本按函数区间自动识别并改用降级名 `base__node_sb(...)`，由 `tc check` 0 error 兜住。
- 迁移结果：**117 处访问器调用**（写 31 / 读 86）。与 121 处原站点的差值可归因：`node_new` 的 `n.sb = ""` 由 `append(g_node_sb, "")` 取代（−1 写）；`tir_emit_for_each` 的 `n_sb`、`c_bitint_suffix` 的 `sfx` 把重复读提取为局部量（−3 读）。
- ✅ **批次 9 隐患的固定前置普查**：本批开工后重跑 —— 扫描全部 `node_X((V.id as u64))` 共 **248 处**（上批 164 处），**0 处落在 `Node` 形参上**（4 个 Node 形参函数已在搬迁前显式改造为收索引，未留隐患）。
- ✅ 覆盖与等价证据（`sb` 的 12 种语义全部有语料，且**均验证非默认路径可达**）：
  ① EnumDecl/FlagDecl 底层整型名 —— `enum_match_dispatch`（golden 双编译器 PASS）；
  ② ImportDecl/ImportModDecl 模块路径 —— `agent_npc_mind` / `colony_demo`（跨模块 `@import`）；
  ③ StructDecl `"soa"` 布局标记 —— **无 examples 语料，另写探针 `struct #soa SoaPt {…}`**，实跑双编译器均 `exit 7`、C 产物 `.h` 逐字节相同且命中 `typedef struct SoaPt { // #soa layout` 分支（证实 `node_sb(...) == "soa"` 的通过分支可达）；
  ④ Vval / variant_lit 的 case 名 + ⑦ Conpat 构造器限定符 —— `adt_shape`（`75 28 0`）/ `adt_list`（`0 42 109`）/ `adt_multi` / `match_ext`；
  ⑤ ForEach 第二（值）变量 —— `map_advanced` / `map_assign` / `map_literal_forin`；
  ⑥ ImportItem `:: *` —— `src/base.tc:23` 的 `pub @import("std.rc.cst" :: *)` 在每次自举编译都会走，由 `src/tc.tc` 的 2.47MB `.c` + 130KB `.h` 逐字节对拍覆盖；
  ⑧ int/bool 字面量数值后缀 —— `literal_demo` / `tile_demo` / `vector_demo`（含 `c_bitint_suffix` 三处读点）；
  ⑨ named 类型限定符 —— `agent_npc_mind`（跨模块类型引用，覆盖 `n.sb != "" && n.sb != "?"` 通过分支）；
  ⑩ closure_capture / closure_make 的环境结构名 `__env_N` —— `lambda_demo` / `closure_demo` / `closure_struct_demo`；
  ⑪ mbuiltin（`@tsplat`/`@splat`）元素标量类型名 —— `tile_demo`（`… 21 6 1 10`）/ `vector_demo`；
  ⑫ 测试 FuncDecl 的显示名 `disp` —— `testing_demo`（`tc test` 双编译器输出逐字节一致；该例无 golden、本就不在 `run_examples` 覆盖集内，两编译器同样报同一条既有 IR 错 `testing__f64_to_str.llt4`，属种子既有行为、与本批无关）。
  以上 **16 个 golden example 双编译器 16/16 PASS**、外加 `testing_demo` / `enum_constval` 的 `tc test` 与 1 个 soa 探针全部逐字节一致；
  ⑬ **`src/tc.tc` 自身 —— 2.47MB `.c` + 130KB `.h` 逐字节 IDENTICAL**（md5 `97340eb0…` / `6c2c79a1…`，seed 与 g1 一致），覆盖 `clone_node` 传播、三个 subst 函数的整节点改写、lambda 提升与全部读方。

- 验证：`tc check` **0 error**（531 warning 全为既有命名风格告警 `T-NAM-W401/W402`/`T-MOD-W561`，与批次 9/10/11 完全一致，无一条与 sb 相关）；g1 自举 1m57s；IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）** ⇒ `--update` 重录基线（117 targets / 354 entries，273.3s）。
- ✅ **gate L2 = 25 passed / 0 failed（2806.3s）**，含四代自举不动点 `g2 == g3 == g4`（`自举一代 147.3s` / `产物快照比对 458.8s` / `conformance 112.2s` / `不动点 g2==g3 342.8s` / `run_examples 423.2s` / `双轨对拍 180.1s` / `四代不动点 160.1s` / `MIR differential 150.4s` / `C 后端自举 282.0s` / `rls 快速通道 384.1s`）。种子已同步（`g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`），同步后 `tc check` 复检仍 **0 error / 531 warning**。

**批次 13：`ia`（通用整数槽，剩余字段里的最低一档；2026-10-04）**
- 选组：批次 12 迁移建议的直接落地 —— `ia 153` 是当时剩余 7 个字段里的最低一档，且属**索引型 `-1` 哨兵**（批次 7 的 `nd` / 批次 8 的 `ib` 已两度验证该范式）。与 `sb`（string）/`ba`（bool）/`lc`（带 `-2` 哨兵的索引）合起来，至此**四种侧表形态全部跑通**。
- 普查：140 处 `.ia` 原始命中（含 `base.tc.s2pilot.bak` 之外的全部 `src/*.tc`）里 **17 处假阳性** ——
  ① **9 处 `tbl_Rec{F,ClosureCapture,SL,VC,Vval,Int,Sym,Vector,Tile}_ia`**：S2 已 SoA 化的 per-kind record（`r.ia = tbl_RecX_ia[i]`，从不从 `nodes[]` 取值），沿用批次 6/12 的剔除规则；
  ② **8 处纯注释**（`codegen_c:747`、`codegen_dev:191`、`tir:2367/2368/3903/3904/3905/5071`）。其中 `tir:3904` 行内含 `base.i2s(n.ia)` 形式的 **反引号字符串**、`codegen_c` 的注释里也有 `"//"` 类误判面（批次 12 的 `codegen_c:4305` 教训）⇒ 故本批的分类脚本 `tools/cls.py` 做成**引号/转义状态机**（不再按「遇 `//` 即截断」的朴素启发）：先做字符串感知、再判注释位置。
  ⇒ **真实站点 123 行**（写 35 / 读 88）。
- ✅ **哨兵普查结论：`ia` 只有 `-1` 一个哨兵，没有 `lc` 那种 `-2`**。判据：写负值处只有 `node_new` / `mk_vector` / `mk_tile` 的 `-1`；全部 `-2` 命中要么属于 `lc`/`lb`（`base.node_lc(...) != -2`、`n.lb != -2`、`mk_FuncDecl(..., -2, ...)` 的位置实参），要么是局部量（`spec == -2`、`vcall != -2`、`bir != -2`）。⇒ 默认与越界读一律 `-1`，无「把普通节点读成特殊状态」的静默错误面。
- ✅ **Node 值形参普查（批次 10 起的固定前置）**：`tools/nvf.py` 扫出 2 个含 `Node` 值形参且读写 `.ia` 的函数 —— `tir::tir_match_pattern_cond(arm: Node, …)`（`p.ia`，`p = base.nodes[arm.na]`）与 `tir::tir_emit_match(n: Node, …)`（`bwn2.ia`，`bwn2 = base.nodes[bsn2.nb]`）。二者**都不需要用 `.id`**：各自作用域已提供裸索引 ⇒ **本批 0 处签名改造**（与批次 12 的 4 处改造形成对比，属批次 9 隐患的「无害形状」）。`.id` 读点普查：**本次新增调用全部用显式索引，无 `(V.id as u64)` 形态**。
- 存储：`g_node_ia: []i64`（默认 **`-1`**；越界读也返 `-1`）+ `node_ia()` / `node_set_ia()` + `sidetable_register("node_ia","S4")` + `node_new` 锁步 `append(-1)`。7 个构造器（`mk_F` / `mk_closure_capture` / `mk_SL` / `mk_VC` / `mk_VVal` / `mk_int` / `mk_sym`）**保留 `ia` 形参**，只把 `n.ia = ia` 换成 `node_set_ia((id as u64), ia)` ⇒ 调用点与 `cst_register_Rec*` 的 S2 dual-write 签名全不动；`mk_vector` / `mk_tile` 的 `n.ia = -1`（冗余置位，但为严格等价保留）同步改为 setter。
- ⚠ **有效写判定**（批次 7 铁律）：**25 个非构造器写点逐个核过，全部有精确 `slice_set(nodes, <idx>, <var>)` 回写** ⇒ 可安全机械升级为 setter。

  | 分布 | 数量 | 代表站点 |
  |---|---|---|
  | `parse` | 7 | 元组标记（`844`）、overload 角色码 1/2（`2857/2889`）、单子句还原 `ia=0`（`3577/3626`）、fidconst 值（`4702`）、F 位宽成员（`5054`）|
  | `sema` | 14 | vector lane 回填（`350`）、tile rows（`500`）、vval/comptime 传播（`12567/13032`）、atom intern（`6378`）、overload 实例 `ia=0`（`2233`）、P 模式回填 VC 下标（`3116`）、`mbuiltin` 回填（`6297/6320/6348`）|
  | `codegen_c` / `tir` | 各 1 | atom 的「读≤0 则 intern」同行读写（均原位保留 `slice_set` 回写体，见下）|
  | `comptime_fold` | 1 | `comptime_rewrite_to_literal` 跨节点传播 |
  | `base` | 2 | `mk_vector` / `mk_tile` 的显式 `-1` 置位 |

  ⚠ **两处特殊的「同行读+写」**（`codegen_c::emit_expr` 的 atom 分支、`tir::tir_emit_expr` 的 atom 分支）：原代码是 `if (n.ia <= 0) { n.ia = sema.atom_intern(n.sa); slice_set(base.nodes, e, n); }`。迁移后 `node_set_ia` 自身已落盘 ⇒ `slice_set` 退化为「写回一个未变的 `n`」的**幂等体**；按「严格等价搬迁」纪律**原位保留**（而不是顺手删），避免把「整理代码」混进本批归因。
  ⚠ **`tir::tir_match_pattern_cond` 的 atom 分支（`4886-4887`）是既有的无效写**：`aid = atom_intern(p.sa)` 之后 `slice_set` 写回的 `p` 里 **`p.ia` 从未被赋值**（历史如此），故该分支的回写本就是空操作。本批**照原样保留**（`node_ia` 读 + 原 `slice_set`），**不把它升级成 setter**（批次 7 铁律：不得偷偷把无效写变成有效写）。
  ⚠ **`codegen_dev::dev_safe_node` 的 `n.ia = 0` 是死写**：它与前几批不同 —— 零节点的 ia 初值是 **`0` 而非全局默认 `-1`**，故不能直接套用「越界读访问器返默认值即等价」的论证。经普查确认 **本文件改造后无任何 `Node` 消费方读 `ia`**（唯一提及在 `dev_parse_int` 的注释里）⇒ 删除后行为逐点不变，理由已写入该处注释。
- ⚠ **`base` 局部遮蔽**：`codegen_c`（`emit_flag_decl` / `fr_layout` 等 6 处 `var base`）、`sema`（`8973` / `13699` / `12515` 附近）内的限定名由脚本按函数区间自动切到降级名 `base__node_ia(...)`；最终分布 `base.node_ia` × 95 / `base__node_ia` × 5，由 `tc check` 0 error 兜住。
- 迁移结果：**落成 123 行访问器调用（写 33 / 读 90）**。与原始 123 行的差值可**精确归因**：−2 写（`node_new` 初值由 `append(g_node_ia, -1)` 取代、`codegen_dev` 零节点死写删除）、+2 读（`codegen_c:2170` / `tir:3031` 两处「同行既读又写」被拆成 `if` 行 + setter 行）。定义侧：`pub var g_node_ia`、`node_ia`/`node_set_ia`、`sidetable_register("node_ia","S4")`、`node_new` append。
- ✅ **`nodes` 唯一增长点复查**：全仓只有 `base.tc:2707`（`node_new` 内）一处 `append(nodes, n)`，无别处直接构造 `Node{}` 或整体重排 ⇒ 侧表与 `nodes` 的**下标锁步不变量**成立，不存在「侧表比 nodes 短」的越界读面。
- ✅ 覆盖证据（`ia` 的 13 种语义**全部有语料**，且 IR 快照对**全部 115 个 examples 的 `.ll` 与 `.c`** 逐字节比对 ⇒ 非默认分支已由黄金语料打到）：
  ① `@Vector` lane 数 —— `vector_demo`；② `@Tile` rows —— `tile_demo`；③ `mbuiltin`（`@splat`/`@tsplat`/`tile_rows`）lane/行 —— `vector_demo` / `tile_demo`；
  ④ `int`/`bool` 字面量 radix —— 全部示例（`mv_int` 恒写 10）；⑤ `sym` 位宽 —— `sym_demo` / `sym_global` + conformance `p16_sym_ok` / `f15_sym_cross_pool` / `f16_sym_needs_string`；⑥ `atom` intern id —— `atom.tc`；⑦ `fidconst` 描述符值 —— `fid_demo` / `fid_read_demo`；
  ⑧ `struct_lit` 元组标记 — `tuple_demo` / `tuple_after_local` / `tuple_match_demo` / `tuple_pospattern_demo`（golden）；⑨ `FuncDecl` overload 角色码 0/1/2 —— `overload_demo` / `overload_type` / `overload_catchall` / `overload_cross_a`；⑩ `F` 位宽成员 `sfield_ia` —— `bitflags.tc`（`readable: 1; level: 4; owner_id: 8;`）；
  ⑪ `VC` case tag + ⑬ `P` 模式回填 —— `adt_shape` / `adt_list` / `adt_multi` / `match_ext`；⑫ `vval` case 下标 —— comptime 变体（`meta_eval` 路径，由 `src/tc.tc` 自编译覆盖）。
- 验证：`tc check` **0 error / 531 warning**（warning 全为既有命名风格告警，无一条与 ia 相关）；g1 自举 **1m56s**；**`src/tc.tc` 自身 seed vs g1 逐字节 IDENTICAL**（`.c` 2,479,641 B md5 `41c7bb7b…` / `.h` 130,389 B md5 `c015e273…`）；IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）** ⇒ `--update` 重录基线（117 targets / 354 entries，233.2s）。
- ✅ **gate L2 = 25 passed / 0 failed（2564.1s）**：教员的三关全过——「产物快照比对（ll + c 双后端）
  365.3s PASS」（基线已重录，故**不再**出现改 src 后首跑的陈基线假 FAIL）、
  **「自举不动点 g2 == g3」302.9s PASS**、**「自举四代不动点 g2 == g3 == g4」167.0s PASS**；
  `run_examples dbg（双后端，并行）466.7s PASS`、`conformance 106.7s PASS`、
  `双轨对拍 219.6s PASS`、`C 后端自举 208.7s PASS`、`rls 快速通道 285.6s PASS`。
  收口：安装 `g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`，复检 `tc check` 仍是 0 error / 531 warning。

**批次 14：`lb`（kids 链表头，⚠ 与 `lc` 同族的**双哨兵** `-1` / `-2`，2026-10-04）**

- **选组**：`lb 218` 是剩余字段里用量最低者，且与批次 11 已迁的 `lc` 同为 kids 链表头 ⇒ 模板、哨兵范式、
  失败模式全部现成（`la`/`lb`/`lc` 三槽同源，`base.tc:1725` 明写 `-1` = null 列表、`-2` = 该列表不存在）。
- **普查（批次 13 门禁等待期完成，只读）**：`.lb` 原始 218 → `tools/cls.py` 分出 REAL 193 / COMMENT 8 /
  STRLIT 0；再剔除 12 处 S2 `tbl_Rec{EnumDecl,FlagDecl,FlagSetDecl,FuncDecl,Lambda,StructDecl,UnionDecl,
  VariantDecl,For,ForEach,If,While}_lb` ⇒ **真实站点 181**。分布：sema 74 / codegen_c 33 / parse 28 /
  tir 15 / base 14 / hir 6 / comptime_fold 3 / codegen_dev 2 / tir_to_ll 1。
- ⚠⚠ **哨兵普查结论（本批最重要的一条）**：`lb` **有 `-2`**，与批次 11 的 `lc` 同族，但**语义不同**——
  `lc` 的 `-2` = 「本体已由别处消费的合成声明」；`lb` 的 `-2` = 「**该列表不存在**」，典型是
  `if` 无 else 分支（`sema:5963`「lb == -2 表示无 else 分支」、`tir:2395` `var has_else: bool = n.lb > -2;`）
  与「空参数列表」（`sema:9651` 明写：用 `-2` 表示空，**-1 会被当作 null 链表头处理**，故二者不可合并）。
  判据遍布 `> -2`（parse 1682/1797、sema 5702/5744/5771/9837/12452、codegen_c 1102/3706）
  与 `!= -2`（sema 7986/8466）⇒ 迁移时三条铁律：① 侧表默认值 **-1**（`node_new:2704` 旧初值就是 `-1`，
  `-2` **只由调用方经构造器实参**写入）；② 越界读返 **-1**（返 `-2` 会让「越界节点」被误判成
  「无 else 分支 / 空参数列表」——**静默错误**）；③ 所有 `> -2` / `!= -2` 判据**逐字保留**。
- **Node 值形参普查**（`tools/nvf.py`，修订后）：**只有 1 处需改签名** —— `tir.tc:2391
  tir_emit_if(n: Node)` 直接读 `n.lb`（2395/2411），迁移后要按 `.id` 查侧表，而 Node 值传参丢末尾 `id`
  字段（批次 9 致命坑）。唯一调用点 `tir.tc:2284` 的 `tir_emit_stmt` **已有 `sid`** 可用
  （隔壁 `tir_emit_for(sid)` / `tir_emit_for_each(sid)` 正是同批改造的先例）⇒ 改 `tir_emit_if(sid: i64)`
  + 函数内 `var n: Node = base.nodes[sid];`。另两个候选 `tir_match_pattern_cond` / `tir_emit_match`
  读的是局部 Node（`dvn`），作用域有裸索引 ⇒ **不动签名**。
- **存储**：`g_node_lb: []i64` + `node_lb()` / `node_set_lb()` + `sidetable_register("node_lb","S4")`
  + `node_new` 锁步 `append(g_node_lb, -1)`；`Node` 结构体的 `lb: i64;` 删除，改为上述三条铁律的注释。
  12 个构造器（`mk_EnumDecl` / `mk_FlagDecl` / `mk_FlagSetDecl` / `mk_FuncDecl` / `mk_lambda` /
  `mk_StructDecl` / `mk_UnionDecl` / `mk_VariantDecl` / `mk_for` / `mk_for_each` / `mk_if` / `mk_While`）
  **保留 `lb` 形参**，只把函数体 `n.lb = lb;` 改为 `node_set_lb((id as u64), lb);`（调用点不变）。
- **`cst_dump`**：本函数本身就收索引 `id`（非 Node 值），读点改 `c = node_lb((id as u64));`。
- **结果**：**172 行访问器调用**（读 155 / 写 17），分布 base 13 / parse 28 / sema 79 / tir 15 /
  hir 6 / codegen_c 33 / comptime_fold 3 / tir_to_ll 1；加上 `tir_emit_if` 签名改造与 `codegen_dev`
  两处手工站点。与 181 个真实站点的差值归因：`node_new` 初值由 append 取代（−1 写）、
  `codegen_dev::dev_safe_node` 的零节点写删除（−1 写）、`clone_node` 等**传播型**站点一读一写同行（−若干）。

- ⚠ **`codegen_dev` 两处站点需要人工判定（批次 13 的同场景，结论相反）**：
  ① `dev_safe_node` 的 `n.lb = -1;` —— 零 Node 无 id，迁移后是**死写**还是**可等价消去**取决于默认值是否一致：
  本例零节点初值恰为 `-1`，与 `node_lb` 越界读返回值 `-1` **一致** ⇒ 与第十一批 `lc` 同样处理（删除 + 论证注释）。
  ⚠ 这与第十三批 `ia` 的结论**相反**：那里零节点写的是 `0` 而访问器越界返 `-1`，套不上「返默认值即等价」，
  且经普查确认无消费方 ⇒ 按**死写**处理并删除。**同文件同形态的两处，判定可以完全相反，务必逐字段回看。**
  ② `dev_trace_*` 里的 `var c: i64 = dn.lb;` → `base.node_lb((d as u64))`（`dn = dev_safe_node(d)`）。
- ⚠ **`nodes` 唯一增长点复查**：全仓仍只有 `base.tc` 一处 `append(nodes, n)` ⇒ 侧表与 `nodes` 下标锁步成立。

- **本批踩到并修掉的 3 个迁移工具 bug**（均为「自动改写产出错误代码」，靠完工后的机械兜底检查才发现 2 个）：

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | `base.base.node_lb((d as u64))` 双限定 | `base.nodes[` 里优先命中了较短的 `nodes[`，替换起点算到 `base.` 之后 | `idx_at_end` 改为**由长到短**匹配前缀 |
| 2 | 单行 `if (c) { X.lb = f(...); }` 产出括号不闭合；同行多语句 `n.na=-1; n.lb=-1; n.sa="";` 吞掉后续语句 | 写分支把 `=` 之后的**全部剩余文本**当 rhs | 加**护栏**：写点必须独占整条语句，否则判 UNMAPPED 交手工 |
| 3 | `hir.tc` 6 处全部 nomap | 该文件通篇写 `var n: **base.**Node = base.nodes[d];`（类型标注带模块限定），识别正则只认裸 `Node` | `NODE_DECL_RE` 支持 `(?:base\.)?Node` |

  ⇒ 由此得到一个**不依赖工具正确性的机械兜底**：对所有改动行做「括号/花括号平衡 + 无 `;;`」检查
  （本批据此一次性扫出 4 行语法损坏）。**建议每批完工都跑一遍**（脚本做法：`git diff -U0` 取新行 →
  逐行忽略字符串后计 `()` / `{}` 深度，负值或末尾非零即异常；跨行 `if (...) {` 开块是正常的 `+1`）。

- 验证：`tc check` **0 error / 531 warning**（warning 全为既有命名风格告警）；g1 自举 **2m01s**；
  **`src/tc.tc` 自身 seed vs g1 逐字节 IDENTICAL**（`.c` md5 `85c83578…` / `.h` md5 `702c1083…`）；
  IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）**，且 `::c` 的新值 `85c83578…` 与上面
  seed/G1 差分对拍产出的 `.c` md5 **完全一致**（两个独立测量互相印证 ⇒ 漂移只来自源码自身变更）
- ✅ **gate L2 = 25 passed / 0 failed（2536.7s）**：「产物快照比对（ll + c 双后端）347.3s PASS」（基线已重录，
  不出现陈基线假 FAIL）、**「自举不动点 g2 == g3」253.5s PASS**、**「自举四代不动点 g2 == g3 == g4」152.3s PASS**；
  `run_examples dbg（双后端，并行）421.7s PASS`、`conformance 99.5s PASS`、`双轨对拍 225.5s PASS`、
  `C 后端自举 227.5s PASS`、`rls 快速通道 344.4s PASS`；本批动过 `hir.tc`，故特别关注
  **「HIR AstGen 验证（emit-hir + 二进制往返）29.9s PASS」**与「HIR 解释器验证 3.3s PASS」。
  收口：安装 `g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`，复检 `tc check` 仍是 0 error / 531 warning。

**批次 15：`nb`（第二子节点槽，⚠ 按 kind 复用 11 类语义且含非索引值，2026-10-04）**

- **选组**：`nb 461` 是剩余字段里最低者，与批次 7 的 `nd`、批次 9 的 `nc` 同属 na/nb/nc/nd 索引槽族。
  顺序刻意安排为「**先小后大**」：`nd`（22 站）→ `nc` → **`nb`（本批，四槽里量级最大）** → `na`（留最后，1071 站）。
  ⚠ 与批次 14 的 `lb` **不同族**：`lb` 是 kids 链表头 + `-2` 双哨兵，`nb` 是纯子节点索引 + 单 `-1` 哨兵。
- **普查**：`.nb` 原始命中 461（`.F` 计数含同行多次命中与 record 假阳性）→ 按行分类 **REAL 429 /
  COMMENT 7 / STRLIT 0**；再剔除 21 处 `tbl_Rec*_nb`（`base.tc` 的 S2 per-kind record，形态一律是
  `r.nb = tbl_Rec*_nb[i];`）⇒ **真实站点 408 行**。分布：`sema 173 / codegen_c 83 / tir 69 / parse 26 /
  base 25 / hir 18 / codegen_dev 12 / comptime_fold 2`。本批吸取批次 14「漏了 hir.tc」的教训，**首批就把
  `hir.tc` 纳入执行清单**（18 行顺利迁移、0 unmapped）。
- ⚠ **哨兵普查结论（本批第一条支柱）**：全仓对 nb 的比较**只剩三种** —— `>= 0`（66）、`< 0`（33）、
  `== 1`（1，`slice_pat` 的 children 计数）；`> -2` / `!= -2` / `== -1` / `== 0` **全部为 0**
  （复核命令：`git grep -E '\.nb *(> -2|!= -2|== -1|== 0)' HEAD -- src/*.tc`，输出为空）。
  ⇒ `nb` 是**纯 `-1` 单哨兵**的索引型侧表，迁移时**不需要**像 `lc`/`lb` 那样特判并保留第二哨兵判据。
- ⚠ **`nb` 的语义复用清单（11 类 + 1 个非索引值，全文写入 `base.tc::node_nb` 注释）** —— 名义是
  「第二子节点槽」，实际按 kind 承载完全不同的东西，**本批只做等价搬迁，严禁顺手拆语义**：

  | # | kind | `nb` 的实际含义 |
  |---|---|---|
  | ① | binary / assign / assignment | **右操作数**（`na` = 左操作数） |
  | ② | index | `n.na[n.nb]` 的**下标表达式** |
  | ③ | cast | **目标类型节点**（`na` = 待转换表达式） |
  | ④ | array / map / vector / tile | **第二类型参数 / 长度 / rows 表达式**（`@[N]T` 的 N、`key→value` 的 value、`vector` lane 数） |
  | ⑤ | range | **终点**（`-1` = 省略；`na` = 起点同规） |
  | ⑥ | for | **cond**（`na` = init、`nc` = upd、`la` = body、`lb` = else） |
  | ⑦ | arm（match） | **when 守卫**（`-1` = 无守卫；`na` = 等值模式，`-1` = 通配） |
  | ⑧ | pipe_map / pipe_filter / pipe_apply | **右侧一元函数值**（`na` = 左操作数） |
  | ⑨ | bitstr_seg | **位宽表达式**（`-1` = **变长尾段**，是一条独立的语义，不可与「无子节点」混写） |
  | ⑩ | const_decl / var_decl / GlobalConstDecl / GlobalVarDecl | **初始化表达式**（`na` = 类型节点） |
  | ⑪ | EN（map/结构体字面量条目） | **value 表达式**（`na` = key） |
  | ⚠ | slice_pat | **非索引值**：children 总数（计数），**不是**节点下标 |

- **Node 值形参普查（`tools/nvf.py nb`）：8 个命中全部落在 `src/tir.tc`**，分**三类**处置
  （前两类沿用批次 9/11 既有范式，**第三类是本批新发现的**）：

  | 函数 | 原签名 | 判据 | 处置 |
  |---|---|---|---|
  | `tir_emit_serialize` | `(n: Node)` | 要按 id 读 nb 侧表 | 改 `(sid: i64)` + 体内 `var n: Node = base.nodes[sid];` |
  | `tir_emit_deserialize` | `(n: Node)` | 同上 | 同上 |
  | `tir_emit_cast` | `(n: Node, est: i64)` | 同上 | 改 `(sid: i64, est: i64)` |
  | `tir_emit_assign` | `(n: Node, est: i64)` | 同上，10 处读 + 2 处 `lhs.nb` | 改 `(sid: i64, est: i64)`，`lhs.nb` → `node_nb((n.na as u64))` |
  | `tir_emit_binary` | `(n: Node, e: i64)` | ⭐ **`n == base.nodes[e]`，两个形参是同一个节点** | **删掉 Node 值形参** → `(e: i64)` |
  | `tir_emit_logical` | `(n: Node, is_and: bool, e: i64)` | ⭐ 同上 | **删掉 Node 值形参** → `(is_and: bool, e: i64)` |
  | `tir_match_pattern_cond` | 未变 | 读局部 Node `p`，作用域已有裸索引（`arm.na`） | **不动签名**，按最近前置声明映射 |
  | `tir_emit_match` | 未变 | 读局部 `arm` / `bsn2`，裸索引 `armIds[i]`、`base.kids[bseg2].val` 可用 | **不动签名**，同上 |

  ⭐ **新沉淀 —— Node 值形参第三类处置「冗余形参直接删」**：当 Node 值形参 `n` 与同签名的索引形参 `e`
  恒等（调用点形如 `tir_emit_binary(base.nodes[e], e)`）时，**删除 Node 值形参**优于改成收索引。
  理由：留着值形参就留了「值拷贝 vs 索引」**两个真相源**，将来任何一处不同步即重演批次 9 的静默丢字段；
  删掉则由单一真相源保证正确。可用判据：调用点传的就是 `base.nodes[<本函数已有的索引形参>]`。
- **存储**：`g_node_nb: []i64` + `node_nb()` / `node_set_nb()` + `sidetable_register("node_nb","S4")`
  + `node_new` 锁步 `append(g_node_nb, -1)`；`Node` 结构体的 `nb: i64;` 删除，改为上述三条铁律的注释。
  19 个 `mk_*` 构造器**保留 `nb` 形参**，只把函数体 `n.nb = nb;` 改为 `node_set_nb((id as u64), nb);`
  （调用点不变）；`mk_slice_pat` 的 `n.nb = count;` 同式改为 `node_set_nb((id as u64), count);`
  ⇒ **④⑩⑪ 的计数/类型/初值语义照存**。`cst_dump` 本就收索引 `id`，读点改 `node_nb((id as u64))`。
- **结果**：**自动迁移 357 行 + 手工 15 行**。自动分布 —— sema 169 / codegen_c 83 / tir 34 / parse 26 /
  base 24 / hir 18 / comptime_fold 2 / codegen_dev 1；**8 个文件 dry-run 全部 0 unmapped**
  （`git diff -w --stat`：8 files, 502 insertions / 422 deletions）。手工 15 行 = `sema` 4 处
  `guard:multi-stmt` 拦截 + `codegen_dev` 11 处；另有 `tir` 6 处签名改造不计入访问器行。
- ⚠ **`sema` 4 处护栏拦截（工具按预期工作）**：形态雷同的单行 `if (n.nb >= 0) { n.nb = f(n.nb, ...); }`，
  写点不独占整条语句 ⇒ 判 UNMAPPED 交人工。手工形态统一为「**先抽局部变量，再写回**」：
  ```t
  // S4 §0.14.7 SoA：原单行 `if (n.nb >= 0) { n.nb = subst_type_in_node(n.nb, ...); }` ——
  //   自动迁移器的「写点独占整条语句」护栏判 multi-stmt 拦截，此处**手工**迁移（第十五批）：
  var n_nb: i64 = base.node_nb((nd_id as u64));
  if (n_nb >= 0) { base.node_set_nb((nd_id as u64), subst_type_in_node(n_nb, name, concrete)); }
  ```
  **这一抽至关重要**：同行一读一写，若任凭自动迁移递归改写 rhs，会在两次读之间把值换掉。
  涉及 `subst_type_in_node`（1702）、`meta_subst_val_node`（1760）、`subst_type_ident_node`（1802）
  与一处 `to instance and clear na/nb and clear to lb/sb`（5902）。
- ⚠ **本批唯一的实质错误：链式 Node 局部导致「双层 nb」误迁**。`lower_range_index` / `lower_in_range` 里有
  `var r: Node = base.nodes[n.nb];` … `r.nb`；映射内核按「最近前置声明」把 `r` 映成 `n.nb`，产出
  `node_nb((n.nb as u64))` —— **内层 `n.nb` 此刻已不再是 Node 字段**（结构体里刚删掉），是纯错误符号。
  正解是 `base.node_nb((base.node_nb((e as u64)) as u64))`，四处（sema 4986 / 5005 / 5006 / 5065）手工修好。
  ⭐ **`cls.py` 为何能发现它**：这批文件里纯 Node 的 `nb` 字段已删除，**任何残留的 `.nb` 文本都是异常**
  （合法残留只有 `tbl_Rec*_nb`）⇒ REAL 计数从 25 掉到 21 的那 4 行正是它。
  ⇒ **固化新心得：迁完跑 `cls.py`，若残留 REAL 数 ≠ 已剔除的记录假阳性数，必须逐条看完再收工**；
  并且**「链式 Node 局部」（如 `var r: Node = base.nodes[n.nb];` 之后再写 `r.nb`）是自动迁移的高危形态**，
  应列入每批的人工必查项。
- ⚠ **`codegen_dev::dev_safe_node` 的零节点写 `n.nb = -1;`** ⇒ **删除并写论证注释**：零 Node 无 id，
  迁移后无法回写侧表，而越界读 `node_nb` 返 `-1` 与原写值一致 ⇒ **等价可删**（同批次 14 `lb`、第九批 `nc`）。
  ⚠ 与批次 13 `ia` **结论相反**（那里零节点初值 0、越界读 -1，套不上「返默认值即等价」，只能按死写删除）
  ⇒ **同文件同形态的两处，判定可以完全相反，务必逐字段回看默认值。** 另 11 处 `dev_trace_*` 读点改
  `base.node_nb((d as u64))` 等式（`dn = dev_safe_node(d)`）。
- ⚠ **写点有效性核验**：对 base 24 处、parse 4 处、sema 16 处写点逐一确认后续有 `slice_set(base.nodes, …)`
  回写 ⇒ 无「Node 值拷贝上的无效写被升级成 setter」（铁律）。
- ⚠ **`nodes` 唯一增长点复查**：全仓仍只有 `base.tc` 一处 `append(nodes, n)` ⇒ 侧表与 `nodes` 下标锁步成立。
- **完工三项复核（批次 14 固化）全绿**：① 改动行「忽略字符串的 `()` / `{}` 平衡」扫描 —— 80 条 flagged
  全为 `if (…) {` 的正常 `+1` 开块，无负值、无吞符号；② `tools/cls.py .nb` —— REAL **21**（全是
  `tbl_Rec*_nb`）、COMMENT 13、STRLIT 0；③ 行尾逐文件保真（`base|sema|codegen_c|parse|codegen_dev|
  comptime_fold` = LF，`tir` = 5683 CRLF、`hir` = 1299 CRLF，均与原工作区一致）。
  ⚠ 其中只有 **`tir` 是 `.gitattributes` 的 `-text` 字节保真文件**（改错即整文件重写）；
  `hir` 属 `text=auto`，其工作区 CRLF 会被 git 归一化忽略（`git diff` 会打 CRLF 告警），
  本次仍**按原形态逐字节写回**以保持 review 干净 —— 前一轮记忆里的「hir 是 CRLF 保真文件」说法有误，已更正。
- 验证：`tc check` **0 error / 531 warning**（warning 全为既有命名风格告警）；g1 自举 **2m24s**；
  **`src/tc.tc` 自身 seed vs g1 逐字节 IDENTICAL**（`.c` md5 `285188e2bbedee961e202894e7aa6a9b` /
  `.h` md5 `9e6eed122505eb520f444f1045ef5845`）；IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅
  `src/tc.tc::{c,h,ll}`）**，且 `::c` 新值 `285188e2…` 与上面 seed/g1 差分对拍的 `.c` md5 **完全一致**
  （两个独立测量互相印证 ⇒ 漂移只来自源码自身变更）；`--update` 重录基线（117 targets / 354 entries，
  274.4s，`tests/ir_baseline.json` 仅 6 行变化 = 3 DIFF × 双后端）。
- ✅ **gate L2 = 25 passed / 0 failed（2664.5s）**：「产物快照比对（ll + c 双后端）410.3s PASS」（基线
  已重录，不出现陈基线假 FAIL）、**「自举不动点 g2 == g3」310.3s PASS**、
  **「自举四代不动点 g2 == g3 == g4」151.5s PASS**；`run_examples dbg（双后端，并行）428.6s PASS`、
  `conformance 111.6s PASS`、`双轨对拍 224.3s PASS`、`C 后端自举 233.2s PASS`、`rls 快速通道 323.7s PASS`、
  `MIR 中端优化 differential 166.0s PASS`、`difftest tc0 外部对拍 63.2s PASS`、`tc lint 冒烟 18.1s PASS`。
  本批动过 `hir.tc`，故特别关注 **「HIR AstGen 验证（emit-hir + 二进制往返）28.4s PASS」** 与
  「HIR 解释器验证 3.3s PASS」。收口：安装 `g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`，
  复检 `tc check` 仍是 **0 error / 531 warning**。

**批次 16：`la`（kids 链表头，⚠ 同族 ≠ 同哨兵：纯 `-1` 单哨兵；2026-10-04）**

- **选组**：`la 500` 是剩余字段里用量最低者，也是 kids 链第三槽（`lc` 批次 11 / `lb` 批次 14 已外置），
  模板与形态都可复用 ⇒ 按既定「由小到大」继续。⚠ 但**哨兵与同族的 `lb`/`lc` 不同**（见下），不可照抄。
- **普查**：含 `.la` 的行共 **469**；剔除 42 行 `tbl_Rec*_la`（`base.tc` 的 S2 per-kind record 布满线）
  与 9 行纯注释提及 ⇒ **真实站点 418 行**。分布：
  `sema 188 / codegen_c 77 / tir 52 / base 44 / parse 25 / hir 17 / test 9 / comptime_fold 3 / codegen_dev 3`。
  ⭐ **`src/test.tc` 是本 epic 首次出现的新站点文件**（9 行：`tt_strip_main` / `tt_has_tag` / `tt_run`
  里的注解链查找）⇒ 又一次证明「每批必须重做全仓普查」，历史文件清单不可复用（批次 14 漏 `hir.tc`
  是同一教训的另一面）。
- ⚠ **哨兵普查结论（本批第一支柱）**：对 `la` 的比较**只剩两种** —— `>= 0`（35）、`< 0`（9）；
  `> 0` / `== 0` / `== 1` / `== -1` / `> -1` / `> -2` / `!= -2` / `== -2` **全部为 0**
  （复核：`git grep -E '\.la *(> 0|== 0|== 1|== -1|> -1|> -2|!= -2|== -2|!= -1)' HEAD -- src/*.tc` ⇒ 空）。
  ⭐ **同族 ≠ 同哨兵**：`la` 与 `lb`/`lc` 同为 kids 链槽族，装的同样是 **kids 池下标而非节点 id**
  （下钻必须 `var k: Child = base.kids[c];` 再取 `k.val` / `k.next`），**但本槽没有 `-2`** ——
  `lc` 的 `-2`（本体已由别处消费的合成声明）与 `lb` 的 `-2`（该列表不存在）在 `la` 上一律不成立
  ⇒ 只需 `-1`（空链）单哨兵；**不得**把前两者的 `-2` 判据套过来（延续 §0.14.7 的双刃哨兵总原则）。
- **Node 值形参普查（`tools/nvf.py la`）：4 个命中，三类处置各有一例**（三类划分见 impl-rules）：

  | 函数 | 原签名 | 判据 | 处置 |
  |---|---|---|---|
  | `tir_emit_while` | `(n: Node)` | 要按 id 读 la 侧表，而 Node 值形参 `.id` 不可靠（批次 9 坑） | 改 `(sid: i64)` + 体内 `var n: Node = base.nodes[sid];` |
  | `tir_emit_match` | `(n: Node, as_stmt: bool, est: i64)` | 同上；⭐ **两个调用点的索引名不同**（`sid` / `e`） | 改 `(sid: i64, …)`，**形参统一取名 `sid`**（避免照抄某个调用点而误用另一个） |
  | `tir_emit_closure_make` | `(n: Node, e: i64)` | ⭐ `n == base.nodes[e]` 恒等 → 第三类 | **删冗余 Node 值形参** → `(e: i64)` |
  | `tir_match_pattern_cond` | 未变 | 作用域内已有裸索引可用 | **不动签名**，按最近前置声明映射 |

  另跑既定普查「`node_\w+\((\w+)\.id as u64\)` 是否落在 Node 形参上」⇒ **0 处危险**。
- **存储**：`g_node_la: []i64` + `node_la()` / `node_set_la()` + `sidetable_register("node_la","S4")`
  + `node_new` 锁步 `append(g_node_la, -1)`（回看旧 `node_new` 确认该槽初值本就是 `-1`）；
  `Node` 结构体的 `la: i64;` 删除并留注释（三条铁律 + 「本槽无 `-2`」判据 + 「la 装 kids 池下标」）。
  base 44 处 = **41 个构造器** `n.la = la;` → `node_set_la((id as u64), la);`（**保留形参**，调用点不变）、
  `mk_tile` 的 `n.la = -1;`、`cst_dump` 的读点（本就收索引 `id`）。
- **结果**：自动迁移 **419 行** + 手工 **3 处半吊子收尾** + **2 行跨索引同步**（见下）；
  `git diff -w --stat` = **9 files / 509+ / 432−**（IR 基线另 6 行）。
- ⚠ **迁移工具行为新发现：`--apply` 对 `guard:multi-stmt` 做半吊子**。`tools/soa_migrate.py la src/sema.tc`
  dry-run 报 **188 changes / 3 UNMAPPED**（形态与批次 15 同：`if (n.la >= 0) { n.la = f(n.la, …); }`，
  写点不独占整条语句），但 **`--apply` 之后这 3 处被改了一半**：条件与 rhs 的读点已换成 `node_la(...)`，
  **唯独留下写点仍是 `n.la = …`**。它**既不报错也不中断**，肉眼扫 diff 极易放过 —— 本批是被
  `tools/cls.py` 的**残留 REAL 计数 ≠ 预期**（应为 0，实为 3）揪出来的，涉及 `subst_type_in_node`
  （1711）、`meta_subst_val_node`（1771）、`subst_type_ident_node`（1815）。
  ⇒ **再次强化批次 15 的铁律：完工复核必须核对「残留 REAL 数 == 预期假阳性数」，而不是「跑一遍就算」**。
- ⚠⭐ **本批唯一的实质错误（S4 通用新坑）：Node 整体结构体赋值不再搬运已外置字段**。

  - **症状**：IR 快照 **15 DIFF / 0 NEW / 0 GONE**，其中 **6 个 examples 双后端同步 DIFF**
    （`adt_list` / `adt_multi` / `adt_shape` / `adt_status` / `match_ext` / `shapes`）。
    按批次 9 铁律 —— **examples 出现 DIFF = 行为变了（非表示漂移），必须追到底**，未定位前**不得**重录基线掩盖。
  - **差分定位**：`examples/adt_list.tc` 的 C 产物只差 2 行 ——
    `< … sum(List_from_One(42)) … sum(List_from_Many(9)) …` vs `> … sum(List_from_One()) … sum(List_from_Many()) …`
    ⇒ **ADT 合成构造器的实参列表丢失**。
  - **根因**：`sema::infer_expr_body` 的 `variant_lit` 脱糖 `V { .Case(args) }` → `<V>_from_<C>(args)`
    最后一步是 `base.nodes[e] = cn;`，而 `cn` 来自**另一个索引** `call_id`。`la` 还是结构体字段时，
    这一句把 `call_id` 的全部字段（含实参 kids 链）搬进 `nodes[e]`；外置后**只搬 Node 里剩下的字段**，
    实参链仍留在 `g_node_la[call_id]`，而 `g_node_la[e]` 保持 variant_lit 的默认 `-1`
    ⇒ 后端按 `node_la(e)` 读到空实参列表。
  - **普查**：全仓 `nodes[X] = <Node 值>` / `slice_set(nodes, X, <Node 值>)` 共 **216 处**，其中
    **跨索引仅 2 处**（`sema` 6063 变体字面量脱糖、7591 前导点无 payload 构造器），其余 214 处是
    **同索引回写**（写回自己，侧表不受影响，无害）⇒ 正因为只有 2 处，逐一核实成本可控。
  - **修法**：在整体赋值之后补一行跨索引侧表同步，并写明「为什么必须补」：
    ```t
    base.nodes[e] = cn;
    base.node_set_la((e as u64), base.node_la((call_id as u64)));
    ```
  - ⭐ **归因纪律（务必沿用到后续批次）**：严格等价要求补**全部**已迁字段（原语句本来搬全部），
    但这 2 处对其余 20 个字段的丢失**是自各自批次起就存在**、且因两节点取值恒等而不可观测的历史技术债；
    一次性补齐会越过本批归因边界、并可能扰动已录基线 ⇒ 采用「**本批迁入哪个字段，就在这些站点补哪个字段**」
    的增量纪律（本批补 `la`），其余列为**归因台账**，待 S4 收口（删 `Node`）时用统一辅助一次性对齐。
  - ⭐ **沉淀工具 `tools/wholescan.py`（本批新增，S4 工具箱第四件）**：扫全仓找出跨索引 Node 整体拷贝，
    逐站点列出「已同步 / 未同步」的 SoA 字段清单（`python tools/wholescan.py --only=la`）。
    ⇒ 后续 `na 1071` / `kind 1187` / `sa 1268` 三座高峰**必踩同一个坑**（尤其 `kind`：整体赋值不再搬 kind
    ⇒ 可能直接改变后续派发），有了它就不必再人工重演本次的 3 小时定位。
- **完工三项复核全绿**：① 改动行「忽略字符串的 `()` / `{}` 平衡」扫描 —— **419 行**含 `node_la`，**0 异常**；
  ② `tools/cls.py .la` —— REAL **42**（**全部**为 `tbl_Rec*_la`，与预期假阳性数**精确相等**，非 record
  残留为空）/ COMMENT 17 / STRLIT 0；③ 写点逐个确认 `slice_set` 回写 —— **0 个无效写被升级**
  （初次误报 3 处是 `var base` 遮蔽导致回写写成降级名 `base__nodes`，补进检查清单后归零）。
- **行尾**：`tir.tc`（`.gitattributes` 的 `-text` 字节保真）5683→5698 行仍全 CRLF；`hir.tc` / `test.tc`
  属 `text=auto`，按原形态写回；`git diff --stat` 与 `git diff -w --stat` **完全一致**（无行尾漂移假 WIP）。
- **验证**：`tc check` **0 error / 531 warning**；g1 自举 **2m43s**；固件修复后重跑
  **`src/tc.tc` 自身 seed vs g1 逐字节 IDENTICAL**（`.c` md5 `80075cc7c84ae021a0ce2699575ad253` /
  `.h` md5 `a4e74291de2a265cf5a77ed2204172d8`）；IR 快照回到 **3 DIFF / 0 NEW / 0 GONE（仅
  `src/tc.tc::{c,h,ll}`）**，且 `::c` 新值 `80075cc7…` 与上面 seed/g1 差分对拍的 `.c` md5 **完全一致**
  （两个独立测量互证 ⇒ 漂移只来自源码自身变更）；6 个先前 DIFF 的 examples 经 g1 复编译已与种子
  **逐字节一致**（`.c` / `.h` / `.ll` 三产物全对）；`--update` 重录基线（117 targets / 354 entries，263.7s）。
- ✅ **gate L2 = 25 passed / 0 failed（2693.2s）**：「产物快照比对（ll + c 双后端）433.7s PASS」（基线已重录，
  不出现陈基线假 FAIL）、**「自举不动点 g2 == g3」298.7s PASS**、**「自举四代不动点 g2 == g3 == g4」147.2s PASS**；
  `run_examples dbg（双后端，并行）468.2s PASS`、`conformance 121.6s PASS`、`双轨对拍 232.6s PASS`、
  `difftest 代际对拍 7.6s PASS`、`C 后端自举 219.8s PASS`、`rls 快速通道 313.2s PASS`、
  `MIR 中端优化 differential 154.9s PASS`、`difftest tc0 外部对拍 56.7s PASS`、`tc lint 冒烟 17.1s PASS`。
  本批动过 `hir.tc` 与**首次动过 `src/test.tc`**，故特别关注 **「HIR AstGen 验证（emit-hir + 二进制往返）
  29.1s PASS」**、「HIR 解释器验证 3.2s PASS」，以及吃 `src/test.tc` 的 `conformance` 与 `tc lint 冒烟`
  ⇒ 三者全 PASS（本批改了测试内建，若有闪失，`conformance` 会先变红）。
  收口：安装 `g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`，复检 `tc check` 仍是 **0 error / 531 warning**。

**批次 17：`na`（`na`/`nb`/`nc`/`nd` 索引槽族的最后一槽，⚠ `na` 是 `name` 的前缀；2026-10-04）**
- **选组**：`na 1071` 是剩余字段里用量最低者，也是索引槽族的最后一槽（`nd` 批次 7 / `nc` 批次 9 / `nb` 批次 15
  已外置）。它是 `Node` 里用量最大的索引槽（binary/assign 左操作数、call/mbuiltin callee、member/index 基、
  FuncDecl 返回类型、arm 等值模式、for 的 init、if/match 的 cond、range 起点…… 语义复用清单已完整写进
  `base.tc::node_na` 上方注释）。
- **普查**：含 `.na` 的行 **998** → 剔除 50 行 `tbl_Rec*_na`（S2 per-kind record）+ 38 行纯注释 ⇒ **真实站点 910 行**；
  分布 `sema 377 / codegen_c 192 / tir 159 / base 54 / hir 52 / parse 47 / codegen_dev 16 / comptime_fold 12 /
  tir_to_ll 1`（⭐ `src/tir_to_ll.tc` 是本 epic 里**首次**出现的文件）。落成 **966 处 `node_na` 读 +
  106 处 `node_set_na` 写**（多处同行 ⇒ 访问器数 > 站点行数，归因差值正常）。
- ⚠ **本批独有的迁移器陷阱：`na` 是 `name` 的**前缀****。`d.name` 会被 `.na` 命中；若接收者恰是已映射的
  Node 局部量就会被**改坏**。已给 `tools/soa_migrate.py::find_all_outside` 加 `word_boundary=True` 护栏
  （要求 `.F` 后不紧跟 `[A-Za-z0-9_]`）。修复前后：base.tc 的 UNMAPPED 由 2（`nomap:d | d.name = rname;`）
  降为 0；回归验证 `la` 仍是 0 changes，确认护栏无副作用。
- **哨兵普查**：**纯 `-1` 单哨兵** —— `>= 0` 126 / `< 0` 26；`>0` / `==0` / `==1` / `==2` / `==-1` / `!= -1` /
  `>-1` / `>-2` / `!= -2` / `== -2` **全部为 0**，且 `n.na = -2` 的写入点 **0 处** ⇒ 默认 `-1`、越界读返 `-1`
  即严格等价（`node_new` 旧初值也确为 `-1`）。
- **Node 值形参（`tools/nvf.py na`）5 个，三类处置本批全部用上**：
  ① **类一（调用方有裸索引，签名改收索引）**：`tir_member_addr(mnode: Node)` → `(e: i64)`（三处调用点分别传
     `base.node_na((sid as u64))` / `e` / `e`）；`tir_match_pattern_cond(arm: Node, …)` → `(armId: i64, …)`
     （调用点传 `armIds[i]`）。
  ② **类三（Node 值形参与宿主的 `base.nodes[e]` 恒等 ⇒ **直接删冗余值形参**）**：`tir_emit_amp(n: Node, est)`
     → `(e: i64, est)`、`tir_emit_unary(n: Node)` → `(e: i64)`、`comptime_fold::comptime_call_is_variant(n: Node)`
     → `(e: i64)`。三者唯一调用方分别是 `tir_emit_expr(e)`×2 与 `comptime_has_runtime_ref(e)`，且 `n` 均来自
     `base.nodes[e]`。⚠ 后两个函数体仍读 `n.sa`（`sa` 未外置），故**函数内保留 `var n: Node = base.nodes[e];`**，
     只有 `na` 走侧表访问器 —— 不能为了「干净」把整个 Node 局部量删掉。
- **跨索引整体拷贝（普查 ④）**：`tools/wholescan.py --only=na` 报告 **2 处**（同索引回写 214 处，无害）——
  仍是批次 16 击穿的那两处 `sema::infer_expr_body` 的 ADT 脱糖。⚠ **本批 `na` 是必须同步的**（与 `la` 不同的根因）：
  `mk_call(na, la, ti)` 把 **callee** 放进 `call_id` 的 `na` 槽、把实参 kids 链放进 `la` 槽；而 `e` 原本是
  variant_lit，其 `na` 存的是**实参链**。漏同步 ⇒ `e` 变成 call 后 `infer_expr` 会把实参链当 callee 解析。
  已补 `base.node_set_na((e as u64), base.node_na((call_id as u64)));`。
  ⚠ 工具侧：`wholescan.py` 的 `LOOKAHEAD=6` 只认拷贝后 6 行内的同步 ⇒ **两个 setter 必须紧随拷贝行**，
  长注释要后置（本批第一版把 `node_set_na` 写在 6 行注释之后，工具误报「未同步」）。
- ⭐ **本批最严重的新坑：索引表达式自身含被迁字段 ⇒ 内层未递归迁移（31 处）**。
  形如 `var ini: Node = base.nodes[n.na];` 的声明，工具用**迁移前**的原文建立「接收者 → 索引表达式」映射，
  于是把下游的 `ini.na` 译成 `base.node_na((n.na as u64))` —— **外层译了，内层的 `n.na` 是未迁移的字段读**。
  三个工具都看不见：`soa_migrate.py` 二次扫描 PLAN 恒为 **0**（该 `.na` 已落在访问器实参位，读/写点识别
  都不再命中）、`cls.py` 只做分类统计、`wholescan.py` 只看整体拷贝。
  **唯一可靠捕获手段是 `tc check`**：31 处 `T_UNKNOWN_FIELD`（`sema 14 / codegen_c 10 / tir 4 / hir 2 / parse 1`）。
  修法：逐行回溯接收者的 `var X: Node = base.nodes[IDX];`，把内层也换成访问器
  （`base.node_na((base.node_na((IDX as u64)) as u64))`）；并**先验证接收者在区间内未被重声明/重赋值**
  （本批 11 组区间全部 CLEAN）。
  ⇒ 已给 `tools/soa_migrate.py` 加 **`==== STALE-INNER ====` 自检**（只看含访问器的行，避开 `tbl_Rec*_na`
  与注释里的反引号引用两类假阳性），以后每批 dry-run 即可见。
- ⚠ **另一个复现的旧坑**：`sema.tc:12564` 那行是 `var base: i64 = meta_eval(...)` —— **局部 `base` 遮蔽 base 模块**，
  插入 `base.node_na` 必须写成降级名 `base__node_na`（该作用域既有 53 处 `base__` 用法可佐证）。已写专条扫描脚本，
  全仓扫过确认无第二处。
- **行尾**：`src/tir.tc`（`-text` 字节保真）**一度被我自己的脚本毁掉**（Python 默认 universal-newlines 读取
  把 5698 行 CRLF 整体转成 LF，`git diff --stat` 虚增到 11416 行），已按原形态整体还原，
  `git diff --stat` 与 `-w --stat` 复验一致（358 行）。
- **完工四次复核**：① 改动行括号平衡 —— 仅 4 处「可疑」，全是新访问器 `node_na`/`node_set_na` 的函数头 `{`
  与配对 `}`，属预期；② `cls.py .na` —— `.na` 字段访问**全清**（全仓枚举 `\.[A-Za-z_]\w*na\b` 只剩
  `node_na` 938 / `node_set_na` 53，合法假阳性为 50 处 `tbl_Rec*_na` 与 `.name` 前缀）；
  ③ 写点回写 —— 扫出 7 个「无回写」候选，逐个人工确认后归零（4 处是真有回写，只是回写用**降级名**
  `base__nodes` 导致首版脚本漏配；2 处是 `node_new` / 零节点初值，按等价论证处理；1 处是注释）；
  ④ `wholescan.py --only=na` 两处已同步。
- **验证**：`tc check` **0 error / 531 warning**（与批次 16 基线同）；g1 自举 **2m20s**；
  **`src/tc.tc` 自身 seed vs g1 逐字节 IDENTICAL**（`.c` md5 `80e8c4c755a4dcf57560bab466e29e19` /
  `.h` md5 `c8cf5565ff2119c3e1cb6c2008f3b675`）；IR 快照 **3 DIFF / 0 NEW / 0 GONE（仅 `src/tc.tc::{c,h,ll}`）**，
  且 `::c` 新值 `80e8c4c7…` 与 seed/g1 差分对拍的 `.c` md5 **完全一致**（两个独立测量互证）。
  本批**没有**出现 examples DIFF ⇒ 未触发批次 9 的硬信号（对比批次 16 的 6 个 examples DIFF，
  说明跨索引同步补在自举之前起了作用）。

**批次 18：`kind`（AST 派发键 —— Node 里**语义最重**的一档；⭐ 本批确立「编译驱动」迁移法；2026-10-04）**
- **选组**：批次 17 收口后 `Node` 只剩 `kind` / `sa` / `id`；取 **`kind 1187`**（三部固化的升序遍历里
  `kind` 低于 `sa`）。⚠ 但它**不是**一个普通的字符串载荷：它是全编译器 AST 的**唯一派发键** ——
  前端解糖、`sema::infer_expr_body` / `hir_lower_*` / `tir_emit_*` / 双后端发射的每一处分派都写
  `X.kind == "<名字>"`。⇒ 任何一处读到错的 kind 就是**静默错编**（不像数值槽那样常常表现为崩溃），
  且一旦外置，**跨索引整体赋值就不再搬 kind** ⇒ 批次 16/17 击穿的那 2 处拷贝会**直接改派发**。
- **普查**：含 `.kind` 的命中 **1183** 处（分布在 13 个文件），其中**同名假阳性极多** —— `t.kind`
  （TypeInfo / TD）、`p1.kind`（`Pass`）、`x.kind`（`HValue`）、`tr2.kind`（`TriviaTok`）都不是 Node。
  ⇒ ⭐ 本批改用**编译驱动**定案（见下条），权威清单 = **`tc check` 点名的 920 行 / 1022 处**，
  分布 `sema 486 / codegen_c 183 / tir 135 / parse 52 / codegen_dev 24 / hir 20 / comptime_fold 13 /
  tir_to_ll 4 / test 2 / tc 1`；**`hir_eval.tc` 的 38 处全是非 Node**（`HValue.kind`），从未进过清单。
- ⭐ **方法论升级（本批最大收获）：编译驱动模式 `soa_migrate.py --lines=<json>`**。
  做法：① 先把 `kind` 从 `Node` 里**删掉**、建好侧表与访问器；② `tc check` 报 **1022 处
  `T-SEM-E208 UNKNOWN_FIELD`**，每条都带 `file:startLine` ⇒ 这就是**编译器自己给出的、零假阳性的
  真实站点清单**；③ 把这张表喂给迁移器，把迁移范围**收窄到这些行**。
  价值：接收者的类型由**类型检查器判定**，而不是由正则猜；同名 `.kind` 假阳性（`t.kind` 也是 string，
  改坏了**不报错**、无法自证）被从根上排除。这比批次 17「靠 `tc check` 兜 STALE-INNER」更进一步 ——
  从「事后补漏」升级为「事前定案」。后续每批（尤其 `sa`，它不是 `sappend` 的前缀问题而是**语义槽**）
  建议**一律走这条路径**。
- **工具新增（三处，均已写回 `tools/soa_migrate.py`）**：
  ① `--lines=<json>`：编译驱动的行号白名单（见上）；
  ② 认 **返回 Node 的函数**作接收者 —— 全仓普查确认只有 `dev_safe_node` 一个（`codegen_dev.tc`），
     不认则该文件全部站点掉进 UNMAPPED；
  ③ ⭐ **`resolve()` 改为按 `(行, 列)` 取最近前置**（见下条的同坑复盘）。
- ⭐⭐ **新坑（第三类）：同一行声明 + 同一行使用的 Node 局部量**。
  形如 `if (mlen >= 0) { var mvn: Node = base.nodes[mlen]; if (mvn.kind == "int") { … } }` ——
  旧 `resolve` 要求 `ln < lineno`（严格小于），看不见**同行**的声明，于是回落到函数里**更早**的
  同名声明：把 `mvn.kind` 译成 `base.node_kind((mrows as u64))`（`mrows` 来自上一个 `@tsplat` 分支！）
  ⇒ 编译期表现为「未定义标识符 `mrows`」。全仓只有 **3 行**是这种形态（`sema` 6330 / 6333 / 6385），
  已逐个手工订正（6385 是**被误伤**的那一行，应为 `mlen`）；工具侧已把 `build_map` 加上声明的
  **列号**、`resolve` 改为 `(行,列) `序比较 ⇒ 同类形态以后自动命中正确索引。
  ⚠ 教训：**同一形态再小也要先全仓枚举**（本批是先 migrator 全覆盖、再专项扫描 `= nodes[` 与
  `node_kind(` 同行共现的行，3 行一次扫干净）⇒ 已固化为完工复核第 ⑥ 条。
- **跨索引整体拷贝（普查 ④）**：`tools/wholescan.py` 的 `SOA_FIELDS` 已补入 `kind`，报告仍是
  **2 处**（`sema` 6078 / 7614）—— ⚠⚠ **本批最致命点**：这两处的语义恰恰是「把 `e` 从 variant_lit
  **改写**成 call」，靠的就是 `nodes[e] = cn` 顺带搬过去的 kind。漏同步 ⇒ `return infer_expr(e)`
  二次进入时 `base.node_kind((e as u64))` 仍是 `"variant_lit"` ⇒ **再次脱糖 ⇒ 无限递归**（不是丢实参
  那种局部错误）。已补 `base.node_set_kind((e as u64), base.node_kind((call_id as u64)));`，
  `wholescan --only=kind` 复验「已同步: la,na,kind / 未同步: 空」。
- **默认值论证（本批第二支柱）**：`node_new(kind: string)` 是**唯一**建节点入口，且 `kind` 是它的
  **必填形参** ⇒ 真实节点的 kind 恒由调用方显式给出，**不存在「漏给默认值」的情形**；故侧表只有一条
  `append(g_node_kind, kind)`，访问器越界读返 **""**。
  零节点侧：`codegen_dev::dev_safe_node` 的 `n.kind = "";` 按**等价删除**（同第十六批 la / 第十四批 lb
  的论证：零节点初值恰等于访问器越界返回值）—— ⚠ 前提是「本文件内已无任何消费方从返回值读 kind」，
  本批 23 处站点全部改为直通侧表后才敢删，已写入该处注释。
- **Node 值形参（`tools/nvf.py kind` + 放宽到 `base.Node`）**：**0 个**（本批无需处置）。另手工处理
  `tir` 两处 `callee.kind`（`callee` 是 `base.nodes[base.node_na(...)]` 的值拷贝），改读既有的
  `callee_id`：`base.node_kind((callee_id as u64))`。
- **落成**：自动迁移 **915 行**（另有 base 手写 1、tir 手写 2、sema 同行形态手写 2、
  2 处 kind 同步行新加 + 若干论证注释）；访问器最终用量 **`node_kind` 977 处读 /
  `node_set_kind` 28 处写**（含定义与注释提及）。

**批次 19：`sa`（Node 里**最后一个真实载荷字段**；⭐ 本批撞出「类型检查器盲区」；2026-10-04）**
- **选组**：批次 18 收口后 `Node` 只剩 `sa`（string）与过渡字段 `id`。`sa` 是用量最大的字符串载荷，
  且是 `sappend` / `safe` 等标识符的**前缀** ⇒ 沿用批次 17 加的 `word_boundary` 护栏。
- **普查**：字边界口径 `.sa` = **1145 行 / 1270 处**（11 个文件，含 `src/hir_eval.tc` 这个从未入过
  编译器清单的文件）；⚠ `Node.sa` 真站点最终以 `tc check` 点名为准：**1040 行 / 1162 处**
  （`sema 560 / codegen_c 238 / tir 138 / parse 68 / hir 50 / base 46 / codegen_dev 21 /
  comptime_fold 11 / test 5 / tir_to_ll 4` —— 这里已是**订正后**的口径，见下）。
- **默认值 / 哨兵**：`node_new` 旧初值 `n.sa = ""` ⇒ **默认 `""`、越界读亦 `""`**；全仓写点（91 个）全部
  是字符串值（46 处构造器 `n.sa = sa` 形参直传 + 常量串），**无数值哨兵、无负值、无 `-2` 第二哨兵**
  ⇒ 直接复用第六批 `sc` / 第十二批 `sb` 验证过的「string 空串单哨兵」范式。
- **Node 值形参**：放宽口径（⚠ `tools/nvf.py` 只认 `: Node`，不认 `base.Node`）全仓扫 ⇒ 值形参 **0 个**；
  返回 `Node` 的函数仍只有 `codegen_dev::dev_safe_node` 一个 ⇒ 零节点 `n.sa = "";` 按批次 18 的
  等价论证**删除**（前提：本文件 21 处站点已全部改为直通侧表，无消费方从返回值读 sa）。
- ⭐⭐ **本批最大教训：`tc check` 并非全集，存在「结构体字面量内部」的盲区**。
  批次 18 确立的「删字段 → `T-SEM-E208` 点名 → `--lines` 驱动」编译驱动法默认「报 0 错 = 迁完」。
  本批却发现 **`tir.tc` 有 9 处真 Node 读从未被点名**（2061/2103/2259/2796/2830/2962/2968/3070/3390），
  形态清一色是 `X{ field: n.sa, … }` —— 也就是**结构体字面量内部的字段访问**。
  ⚠ 已用探针实验证伪两种猜想并锁定根因：
  · 「遇到错误即中断后续检查」❌ —— 在同一函数里连插两个探针，两个都报出来；
  · 「该函数根本没被检查」❌ —— 在函数里插 `var z: i64 = "x";` 立刻报 `T-SEM-E202`；
  · ✅ 真相：同一行 `g_cur_func = TIRFunc{ name: n.sa, … };` **不报**，而紧邻下一行
    `var zz: string = n.sa;` **报 `T-SEM-E208`** ⇒ **检查器不解算结构体字面量初值里的字段访问**。
  ⇒ 处置：**补 ⑦ RE-LIT 专项扫描**（见下方清单），并确立新判据
  **「`tc check` 报 0 错 **且** 迁移器全文重扫 PLAN==0 **且** RE-LIT 扫描为 0」三条件同时成立才算迁完**。
- **另一处需论证的写点**：`codegen_c::emit_stmt`（原 3504 行）。旧代码 `n.sa = cname;` 写在本函数从未
  回写的 Node **值拷贝**上，但下方 20+ 处 `n.sa` 读取依赖这个 mangle 结果 ⇒ 属「局部有效写」。
  迁 ADA 形式为 `base.node_set_sa((sid as u64), cname)` 才能保住那些读值；代价是该 mutation 从此
  **持久化**（局部写升级为全局写）。已在代码里留 8 行论证注释，并由双后端差分 + 逐字节自举对拍兜底。
- **跨索引整体拷贝**：仍是 `sema` 那 2 处（`base.nodes[e] = cn;` / `= cln;`），本次补 `node_set_sa` 同步
  （`wholescan.py` 已把 `sa` 纳入 `SOA_FIELDS`，23 → 24 项）⇒ 台账由「未同步: sa」转为「已同步: la,na,kind,sa」。
- **落成**：自动迁移 1024 行（base 45 / hir 50 / parse 68 / codegen_c 238 + codegen_dev 20 / comptime_fold 11 /
  sema 458 / test 5 / tir_to_ll 4 / tir 136+9）；手工仅 4 处（tir 2 处 `callee` 值拷贝值→既有 `callee_id` /
  `sema` 5934 同行多语句写点 / `codegen_dev` 零节点等价删除）；访问器最终用量
  **`node_sa` 1053 处读 / `node_set_sa` 94 处写**（含定义与注释提及）。

**批次 20-A：删「Node 局部声明」死代码（§4.14.4 收口第一刀；⭐ 纯删除 757 行、语义中立；2026-10-04）**
- **动机**：24 个载荷字段全部外置后，`pub struct Node` 只剩 `id`（S5 过渡字段）⇒ `var n: Node = base.nodes[e];`
  这类局部声明**已无任何可读载荷**，是纯死代码（`nodes[]` 真站点 880 处里有 671 处就是这种声明）。
  清掉它们才能把 `nodes[]` 引用降到可控规模，最终删 `pub var nodes: []Node;`。
- **普查（剔注释后真站点）**：`nodes` 引用 **880** 处 = 局部取值声明 **671** + `slice_set(nodes,…)` **213**
  + `slice_len(nodes)` **25** + 跨索引整体拷贝 **4** + 裸赋值 **6** + `append(nodes,…)` **1**。
  ⚠ `pub struct Node` 与 `pub var nodes` 之外，**没有任何 `nodes[X].字段` 的真实读取**（12 处命中全是注释）。
- **新工具 `tools/drop_node_decl.py`**（本批沉淀，第五条工具）：按「作用域内标识符出现次数」驱动，三规则：
  · **R1 死声明**：声明后变量完全未再出现 ⇒ 删声明行；
  · **R2 成对回写**：变量唯一用途是配套 `slice_set(nodes, IDX, n);`（base 的 ~200 个 `mk_*` 构造器即此形态）
    ⇒ 声明行与回写行**成对删除**（字段已全部走 `node_set_X` ⇒ 该回写是**无操作**）；
  · **R3 id 反查**（⚠ **本批未启用**，用 `--safe-only` 关掉）：变量仅以 `n.id` 形式被使用时可把
    `n.id` 就地换成索引表达式。**前置条件**：`nodes[i].id == i` 必须全局成立 —— 见下方第二个坑。
- ⭐ **坑一（工具 bug）：括号平衡定位函数末尾时没剥字符串**。字符串里的 `{` / `}`（如 `sb_cat3("{", …)`）
  让 `func_end` 把函数区间算短 ⇒ 明明在用的变量被判成「未使用」误删 ⇒ `tc check` 报 8 个 `T-SEM-E201`。
  ⇒ 修法：函数区间统计一律走 `strip_code`（剥注释**并清空字符串字面量**），不能只 `strip_comment`。
- ⭐⭐ **坑二（事实，非 bug）：`nodes[i].id == i` 并不全局成立**。sema 那 4 处跨索引整体拷贝
  （`base.nodes[e] = cn;`）会把**源节点的 `id` 搬到目标槽**（目标槽 `id` 变成源索引）⇒ R3 的等价前提被破坏；
  且这 4 处**还在搬运 span/td/trivia 等未同步字段**，本身也不能贸然删（删了会丢这些字段的覆盖语义）
  ⇒ **R3 必须等整体拷贝问题解决后再启用**，本批只跑 R1+R2（零语义风险）。
- **安全红线（本工具存在的全部理由）**：删除局部声明时若该名字在作用域内**仍被使用**，删除后 t 会把它
  解析到**外层同名变量** ⇒ **不报错、静默错值**（比报错危险得多）。故凡不满足三规则者一律 SKIP 列出
  （本批 SKIP **188** 处，交后续批次）。另：统计出现次数时**必须剥字符串**，否则 `sb_cat3("n", …)` 里的
  `"n"` 会被 `\bn\b` 命中（实测一度把 1 处报成 86 处）。
- **落成**：**11 个 src 文件、757 行删除、0 行插入**（`git diff --stat` 为纯 `-`）；`nodes` 真站点 880 → **260**；
  `tc check` **0 error / 530 warning**（较批次 19 的 531 少 1，正是被删死声明自带的那条告警）。

**批次 20-B1：拆掉 4 处跨索引整体拷贝（⭐ 认知修正：Node 只剩 `id` ⇒ 整体拷贝只搬 `id`；2026-10-05）**
- ⭐ **认知修正（推翻批次 20-A 的一处保守判断）**：批次 20-A 曾判断「这 4 处还在搬 span/td/trivia 等
  未同步字段、不能贸然删」。**该判断是错的** —— span/td/trivia/mod/file 早在 S3/S5 就已外置成独立侧表，
  **根本不在 `Node` 结构体里**；`Node` 现在只剩 `id` ⇒ `base.nodes[e] = cn;` **只搬 `id` 一个字段**。
- **4 处逐个定性**（`sema::infer_expr_body` / 同函数族内）：
  · `nodes[e] = cn;`（cn = `nodes[call_id]`）与 `nodes[e] = cln;`（cln = `nodes[call_id]`）—— **真拷贝**，
    把**源节点 call_id 写进 e 槽** ⇒ 这是 `nodes[i].id == i` 不变量的**唯一破坏源**；
  · `nodes[e] = n;`（n = `nodes[e]`）与 `nodes[na(e)] = cn;`（cn = `nodes[na(e)]`）—— **恒等赋值**
    （写回同槽同值，连 `id` 都不变）⇒ **删除严格等价、零风险**。
- **真语义不被牵连**：把 e 由 variant_lit 改写成 call 的语义，早已由紧随其后的
  `node_set_kind/na/la/sa` **显式同步**承载（批次 16/17/18/19 逐批补上的），删除整体拷贝不动这四行。
- ⚠ **为什么可以删「真拷贝」那 2 处**：搬过去的 `id` 唯一的消费者就是 `X.id` 形式的反查
  （即 R3 要消除的 123 处候选）；而 R3 候选中**落在污染源所在巨型函数内的只有 2 处，且与 `e` 无关**
  ⇒ 该函数内无人读 `nodes[e].id`。跨函数的消费者由**验证链**兜底（见下）。
- **落成**：4 处整体拷贝全删（留论证注释），`tools/wholescan.py` 口径下**残留整体拷贝站点 = 0**；
  再跑 `drop_node_decl.py --safe-only` ⇒ 新增可删 **0**（`cn`/`cln`/`n` 仍被 `.id` 使用，符合预期）。
- **验证（关键：本批是**可能改变运行时行为**的一批，必须靠 examples 兜底）**：
  · `tc check` **0 error / 530 warning**；seed vs g1 逐字节 IDENTICAL（`.c` `90f8e90b…` / `.h` `b548f3f5…`）；
  · IR 快照 **2 DIFF（`::c`/`::ll`）、0 NEW / 0 GONE、`examples` 零 DIFF**；
  · ⭐ **旁路对照 diff 是决定性证据**：HEAD 版 vs 当前版的 `.c` 共 **12 删 / 8 增** —— 其中 4 行删除
    正是这 4 处整体拷贝本身（`(*(base__Node*)t_slice_at(base__nodes, e)) = cn;` 等），**没有任何其它逻辑行
    变化**，其余 8+8 行是局部槽号位移的标识符改名。
  · ⚠ 该 diff 只能证明「生成代码无连带改变」，**不能**证明运行时 `nodes[e].id` 变化无人消费
    ⇒ 最终判据是 **gate L2 的 run_examples（47 例双后端）+ conformance + 双轨对拍 + 四代不动点全绿**。

**批次 20-B2：启用 R3（`X.id` → 索引内联），131 声明删除 + 295 处重写（⭐ 解锁条件达成；2026-10-05）**
- **R3 解锁的判据（20-B1 的直接成果）**：全仓 `.id` 的**唯一写入点**是 `base::node_new` 里
  `n.id = slice_len(nodes);`（在 `append` **之前**执行 ⇒ 恰好等于最终下标）⇒ **`nodes[i].id == i` 全局成立**
  （grep 全仓 `.id =` 只有这一处；20-B1 删掉的 4 处跨索引整体拷贝是它**唯一的破坏源**）。
- **R3 规则**：局部 `var n: Node = base.nodes[IDX];` 若在其作用域内**所有出现都是 `n.id`**（且 `n` 未被
  重新赋值、未被重声明遮蔽）⇒ 把 `n.id` **就地换成索引表达式 IDX**，然后删掉声明行。
- ⭐ **R3 专属防线（`idx_vars` + `assigned_between`）**：索引表达式里的变量若在「声明行 → 使用行」之间
  被重新赋值/重声明，则旧 `n.id`（**旧值**）≠ 替换后的索引（**新值**）⇒ 该处替换会**静默取错节点**。
  故逐个候选做区间扫描，命中即 SKIP 并列入 `R3-SKIP`（本次 dry-run **R3-SKIP = 0**）。
- ⭐ **坑三（工具 bug，本批踩到）**：索引抽取原用 `nodes\[(.*?)\]` **非贪婪**正则 ⇒ 遇到**嵌套下标**
  `base.nodes[fields[fi]]` 会停在第一个 `]`，抽成 `fields[fi`（**丢掉外层 `]`**）⇒ R3 产出
  `base.node_span_id(fields[fi).line` ⇒ `tc check` 报 `T-PAR-E101 语法错误：期待 RBracket，实际读到 )`
  （`src/hir.tc:372`）。**修法**：换成配对感知的 `nodes_index()`（从 `[` 起扫到匹配 `]`，字符串已由
  `strip_code` 清空，不会误判）。修完重跑 dry-run，DROP 从 123 → **131**（多出的 8 处是之前因索引抽错
  而未被识别的 **R2 成对回写**）。
- ⭐ **复核①的正确口径（修正批次 19/20-A 的机械兜底）**：本批有大量**整行改写**，被替换的旧行常常是
  开块行（`if (…) {`，自身净 `+1` 花括号）⇒ 按「单行平衡」判会得到 **54 个假阳性**。
  正确做法是按**文件统计增删两侧的 `{`/`}` 与 `(`/`)` 净差**：本次 7 个文件**全部为 0** ⇒ 结构守恒。
- **落成**：**7 个 src 文件、423 删 / 292 增**（292 = 改写后的新行，423 = 131 死声明 + 292 条旧行）；
  `nodes` 真站点 260 → **198**；残留 `.id` 真站点 **127**（含 `node_new` 那个写入点本身）。
  工具重扫 ⇒ DROP 0 / REWRITE 0（幂等）。
- **索引表达式的等价性抽查**：100 个被删声明的索引表达式里只有 3 个含函数调用
  （`node_na((mk.val …))` / `node_nb((e …))` / `node_na((s …))`）⇒ 逐个核对「声明行 → 使用行」之间
  **无对应侧表写入** ⇒ 重求值等价；其余全是纯变量 / `kids[x].val` / `arr[i]`，区间内无改动。
- **验证（三层）**：
  · `tc check` **0 error / 530 warning**（与批次 20-A/B1 基线一致）；
  · seed vs g1 逐字节 **IDENTICAL**（`.c` 2 538 896 B `e1297867…` / `.h` 130 903 B `d5bf239b…`）；
  · IR 快照 **2 DIFF（`::c`/`::ll`）、0 NEW / 0 GONE、examples 零 DIFF**；
  · ⭐ **旁路对照 `.c` 447 删 / 316 增**：447 = **131 死声明 + 316 条含 `.id` 旧行**，316 条增行一一对应；
    两侧 `{`/`}` 净差**同为 +77**（完全抵消）、`name__NNNNN` 槽位改名 **100% 配对、0 个新增名**
    ⇒ 差异 = 纯删除 + `X.id` 内联 + 槽号位移，**语义中立**。

**批次 20-C：新增 R4（R3 + 删配对回写），吃掉 61 处 SKIP 中的 45 处（⭐ `nodes` 真站点降到两位数；2026-10-05）**
- **动机**：20-B2 跑完 R3 后剩 61 处 SKIP。摸清形态后发现**绝大多数**（45 处）是同一个模式 ——
  局部 Node 的用途 = **若干 `name.id` 读 + 一条尾部 `slice_set(base.nodes, IDX, name)` 回写**。
  现有三条规则都够不着：R2 要求**全部**用途是 `slice_set`；R3 要求**全部**用途是 `name.id`。
- ⭐ **R4 规则**：把两类用途**合起来判定** —— 只要作用域内的出现行能二分成「纯 `.id` 行」与
  「`slice_set(nodes, IDX, name)`（同 IDX）行」且无第三类，就：`.id` 行内联成 IDX、
  删掉 `slice_set` 行、删掉声明行。
- ⭐ **为什么 R4 删 `slice_set` 是安全的（本批的核心论证）**：`Node` 只剩 `id`；
  `n` 是 `nodes[IDX]` 的**值拷贝**且全程未被改（`reassigned` 已查、`n.id = …` 全仓不存在）；
  侧表写入一律走 `node_set_X((… as u64), …)` **直写按索引寻址的侧表**，不经过 `n`；
  ⇒ `slice_set(nodes, IDX, n)` 只是把 `nodes[IDX].id` 写成**它自己的值**（`nodes[i].id == i`）
  ⇒ **无操作**。（20-A 的 R2 已经是同一论证，本批只是把它从「全部用途都是回写」放宽到「混有 `.id` 读」。）
- **另清一处手工点**：`base::mk_infer_ret` 里残留的 `slice_set(nodes, id, nodes[id]);`
  —— 载荷外置后这是「读同槽再写回同槽」的**恒等空写**（没有配套的局部声明，工具看不见），一并删除。
- **落成**：**4 个 src 文件（+ base.tc 1 行）、216 删 / 107 增**；删除行分类
  **45 Node 声明 + 63 `slice_set` 回写 + 107 含 `.id` 旧行**（合计恰为 216，无第四类）；
  `nodes` 真站点 198 → **89**、`.id` 真站点 127 → **21**；`slice_set(nodes, …)` 由 213 → **1**
  （唯一残留：`src/tir.tc:4867`，其索引与声明来源不同，需单独判）。SKIP **61 → 16**。
- **验证（三层 + 决定性判据）**：
  · `tc check` **0 error / 530 warning**；seed vs g1 逐字节 **IDENTICAL**
    （`.c` 2 530 936 B `ae480018…` / `.h` 130 903 B `d5bf239b…`）；
  · IR 快照 **2 DIFF（`::c`/`::ll`）、0 NEW / 0 GONE、examples 零 DIFF**；
  · ⭐ **旁路对照 `.c` 246 删 / 137 增**：246 = **45 死声明 + 64 `slice_set` + 122 含 `.id` 旧行
    + 15 改名旧行**（64 = 工具的 63 + 手工删的 `mk_infer_ret` 恒等空写），137 = 122 重写新行 + 15 改名新行；
    两侧 `{`/`}` 净差**同为 +16**、槽位改名 **100% 配对、0 新增名** ⇒ 语义中立；
  · ⭐⭐ **gate L2 25/0（2876.2s）+ run_examples 双后端 512.6s 全绿** —— 这是「删掉 64 条回写
    **运行时无人消费**」的**决定性证据**（生成代码的 diff 证明不了运行时值的去向）。

**批次 20-D：降级名解锁 + 剩余 SKIP 人工裁决（⭐ `.id` 真站点 21 → 2；2026-10-05）**
- ⭐ **坑四（工具拼写盲区）：`nodes` 有三种写法**。除 `nodes` / `base.nodes` 之外，还有 **`base__nodes`**
  —— 局部 `var base: …` 遮蔽 base 模块的作用域里，跨模块访问必须写**降级名**（`mod.foo` → `mod__foo`）。
  工具正则只认前两种 ⇒ 8 处 SKIP **纯属拼写卡点、无任何语义风险**。修法：抽出
  `NODES = r'(?:base(?:\.|__))?nodes'` 供 `nodes_index` / `_is_slice_set` 共用 ⇒ 立刻解锁
  **18 删 / 14 重写**（`slice_set(base__nodes, …)` 同理）。
- ⭐⭐ **`assigned_between` 只查「变量被重新赋值」，不查「侧表被写入」** —— 本批最重要的新教训：
  · 反例 `sema::infer_expr_body` 的 `cn`：`var cn: Node = nodes[node_na(e)];` … `node_set_na((e…), …)`
    （6994 行**改了 `na(e)`**）… 才到 `cn.id` 读点 ⇒ **不能**内联成 `node_na((e as u64))`
    （旧值 ≠ 新值）。⇒ 改法：**Node 局部量 → 裸索引局部量**（`var cn_id: i64 = node_na(e);`），
    读点改 `cn_id`。这是「索引表达式含侧表 getter」时**唯一安全**的等价形态。
  · 正例 `tir::tir_match_pattern_cond` 的 `p`：区间内无 `node_set_na` ⇒ 可直接内联。
- **人工裁决的 6 处（逐处论证）**：
  · `sema::fmt_scan_subtree` 的 `xn`：两处赋值都是 `nodes[x]` ⇒ `xn.id` **恒等于 `x`**
    （na/la 被改写也不影响 id）⇒ 内联为 `x`，声明与「重读」赋值一并删。
  · `sema` 950 段的 `nn` / `op`：**只写不读**（`nn` 仅被 `=` 赋值、`op` 只用于给 `nn` 赋值）
    ⇒ 连同声明共 4 行一并删（`lit_id` 才是真语义载体）。
  · `tir::tir_emit_call` 的 `n` / `callee`：`callee` 只写不读（其原读点 `callee.na` 已在第十七批
    改走侧表）⇒ 删 3 行；`n.id` 内联为 `e`。
  · `tir::tir_match_pattern_cond` 的 `p`：内联为 `node_na(armId)`；行内嵌的
    `slice_set(base.nodes, node_na(armId), p);` **只删该子语句**（`_is_slice_set` 要求行首匹配，
    故工具看不见这种「嵌在 `if (…) { …; slice_set(…); }` 里」的回写）。
  · `codegen_dev` 的 `dn`：**保留** —— 初值是 `dev_safe_node(d)`（不是 `nodes[…]`），
    `dn.id` 在 d 越界时是零节点的 id ≠ `d` ⇒ 不能内联，留待「`dev_safe_node` 改返索引」时一并处理。
- **落成**：`src/sema.tc` + `src/tir.tc`，**50 删 / 21 增**；
  `.id` 真站点 21 → **2**（只剩 `node_new` 的写入点与 `codegen_dev` 的 `dn.id`）、
  `nodes` 真站点 89 → **60**、`slice_set(nodes, …)` → **0**、SKIP 16 → **1**。
- **验证链（全绿，commit `?`）**：
  · `tc check src/tc.tc` = **0 error / 530 warning**（warning 与基线逐条一致，无新增）。
  · 自举 g1 2m13s → **seed vs g1 逐字节 IDENTICAL**（`.c` 2 528 771 B / `e2931ea0…`、
    `.h` 130 903 B / `d5bf239b…`）。
  · IR 快照：**2 DIFF（`src/tc.tc::c` / `::ll`）、0 NEW / 0 GONE、examples 零 DIFF**
    ⇒ 符合「仅表示漂移」的正常形态（见致命坑：examples 若 DIFF 即行为变更，必须追到底）。
  · **旁路对照**（旧 seed 与新 g1 分别对 `src/tc.tc` 编译后对拍 `.c`）：**61 删 / 31 增**，
    删行分类 = 15 死声明 + 11 空回写 + 21 含 `.id` 旧行 + 14 槽位改名行（合计恰 61，无第四类）；
    两侧 `{`/`}` 净差同为 **+3**、`(`/`)` 净差同为 **0**；增行里的 `name__NNNNN` 槽位改名
    **100% 与删行配对**、**0 个新增名** ⇒ 判定**语义中立**。
  · `--update` 重录基线（117 targets / 354 entries，282.2s）→ **gate L2 25 passed / 0 failed
    （2934.1s）**，其中 run_examples 双后端 532.3s 全绿、自举四代不动点 `g2==g3==g4` PASS
    ⇒ 11 条被删的 `slice_set` 回写与 4 条「只写不读」赋值链**运行时确无消费者**。
  · 收口：安装 `g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`，复检仍为 **0 error / 530 warning**；
    清理 `out/_p20d`、`out/_c*.json`；`src/tir.tc`（`-text`）**CRLF 5608 行全程保真**未漂移。

**批次 20-E：`slice_len(*nodes)` → `node_count()`（删 `nodes[]` 的最后一块硬阻塞；2026-10-05）**
- **动机**：S4 收口的终点是删掉 `pub var nodes: []Node;`，但全仓有 **29 处**在量节点池长度：
  `slice_len(nodes)` 4（`base.tc`）/ `slice_len(base.nodes)` 21 / `slice_len(base__nodes)` 4，
  分布于 `base` 4 · `codegen_dev` 7 · `comptime_fold` 3 · `hir` 2 · `sema` 11 · `tir` 2。
  （⚠ 先前估的「25 处」偏低，以本次普查的 **29** 为准。）
- **做法**：新增访问器 `pub fn node_count() i64`，**本批函数体就写 `return slice_len(nodes) as i64;`**
  ⇒ 与替换前**逐字等价**，本批是**纯重命名、零语义风险**；下一批（20-F）删 `nodes` 时
  **只改这一行函数体**（改读锁步的 `g_node_kind`），29 个调用点**全部不动**。
- ⭐ **锁步性已证**：全仓仅 `node_new` 里 **1 处** `append(nodes, n)`（`base.tc:2967`），
  而 `g_node_kind` 在同一函数里逐节点 append ⇒ `slice_len(nodes) == slice_len(g_node_kind)` 恒成立。
- ⭐ **坑五（新脚本 `tools/node_count_migrate.py` 的判据写错）**：`call_for()` 原本判
  `matched.startswith('base__')`，但 `m.group(0)` 是以 **`slice_len(` 开头**的整段匹配、不是索引表达式
  ⇒ 4 处 `slice_len(base__nodes)` 被误产成 `base.node_count()`，而那些作用域里**有 `var base` 局部遮蔽**
  （降级名正是因此才存在）⇒ 会解析到局部变量上。修法：判据改为 **`'base__nodes' in matched`**。
- **落成**：6 个 src 文件 **29 处改写 + 新增 `node_count()` 定义 8 行**（`git diff` 40 增 / 29 删）。
- **验证链**：`tc check` **0 error / 530 warning**；自举 g1 **2m21s**；
  seed vs g1 **逐字节 IDENTICAL**（`.c` 2 528 416 B `d1d33166…` / `.h` 130 935 B `76c9e4b4…`）；
  IR 快照 **3 DIFF（`::c` / `::h` / `::ll`）、0 NEW / 0 GONE、examples 零 DIFF**
  （⚠ `::h` 这次也变是**预期内**的合理偏离：新增了 `base__node_count` 的**函数声明**，
  与旁路对照 `.h` **+1 行**逐条对账；硬信号是 **examples 零 DIFF**，满足）；
  旁路对照 **`.c` 37 删 / 41 增** = 29 处调用点改写 + 4 行新增 `base__node_count()` 定义
  + 8 行局部槽位改名（`idv__222613→222544`、`v__228941→228872`，**Δ 恒为 −69** 且 100% 配对），
  **无第四类** ⇒ 语义中立；`--update` 重录基线（117 targets / 354 entries，268.6s）；
  **gate L2 = 25 passed / 0 failed（2635.2s）**，四代不动点 `g2==g3==g4` PASS（137.0s）、
  run_examples 双后端 462.2s 全绿、产物快照比对 410.6s、双轨对拍 244.3s、rls 快速通道 287.0s。

**批次 20-F：删 `pub struct Node` + `pub var nodes`（⭐ S4 epic 终点；2026-10-05）**
- **四组动作**：① `dev_safe_node` 改返**索引** → 消掉最后 1 处 `.id` 读点；
  ② 删 4 处「只声明不读」的 `Node` 局部量（`codegen_c` 的 `wn`、`sema` 的 `mvn`/`mvn2` ×3）；
  ③ 删 `pub struct Node`（132 行，含 24 字段的逐批历史注释）与 `pub var nodes: []Node;`；
  ④ `node_count()` 函数体改读**锁步的 `g_node_kind`**。
- ⭐⭐ **`dev_safe_node` 越界必须返 `0`，不能返 `-1`**（本批唯一的语义判断点）：
  唯一调用点的旧语义是「读**零 Node** 的字段」，而零 Node 的 `id` 由 `var n: Node;` 零初始化为
  **0** ⇒ 越界等价于**按索引 0 读侧表**。返 `-1` 会落到访问器的越界分支返**字段默认值**，
  与「node 0 的该字段值」在 node 0 非默认时**不相等** ⇒ 只有返 `0` 才严格等价。
  （直觉上的「安全索引 = -1」在这里是错的，已在函数注释里写明。）
- ⚠ **坑六（新脚本 `tools/drop_node_struct.py`）**：`range`/`del` 的行号是**原文件**的，
  但前一条删除会让后续下标整体前移 ⇒ **必须按行号降序施加**（升序会把后面每个 op 打偏）。
  脚本已修，并在 dry-run 里打印每条 op 的首行预览供人工对账。
- **落成**：4 个 src 文件 **28 增 / 190 删**（净 −162，绝大部分是被删的 struct 注释）；
  `Node` / `nodes` 的**代码站点全部归零**（残留 `\bNode\b` 与 `nodes[` 全在注释里），
  `.id` 读点 **0**，`slice_set(nodes,…)` **0**。
- **验证链**：`tc check` **0 error / 530 warning**；自举 g1 **2m23s**；
  seed vs g1 **逐字节 IDENTICAL**（`.c` 2 527 662 B `33953ae4…` / `.h` 130 831 B `1ad485ed…`）；
  旁路对照 **`.c` 32 删 / 21 增**、**`.h` 6 删 / 1 增**，分类 = 意图内改动（`.c` 16 删 / 5 增：
  删 `base__nodes` 数组、`node_count` 体改读 `g_node_kind`、`node_new` 的 `n={0}`/`n.id`/`append`
  3 行、3 处 `mvn/mvn2`、`dev_safe_node` 5→3 行、`dn` 声明、`dn.id`→`dev_safe_node(d)`、`wn` 声明）
  + 4 组局部槽位改名（16 行，**分两组恒定位移**：`cp__26380→26359` 与 `id__36630→36609`
  Δ=**−21**；`idv__222544→222475` 与 `v__228872→228803` Δ=**−69**；100% 配对）。
  ⚠ 位移分两组不是异常：位移量随「删除发生在哪个模块」累加（早段已删 ⇒ Δ 小，晚段再删 ⇒ Δ 大）；
  **clang 链接 g1 无重名冲突即证明无槽位碰撞**。
  IR 快照 **3 DIFF（`::c`/`::h`/`::ll`）、0 NEW / 0 GONE、examples 零 DIFF**；
  `--update` 重录基线（117 targets / 354 entries，277.7s）；
  **gate L2 = 25 passed / 0 failed（2652.4s）**：四代不动点 `g2==g3==g4` PASS（148.6s）、
  run_examples 双后端 446.1s 全绿、产物快照比对 395.7s、自举不动点 g2==g3 306.8s、
  双轨对拍 197.9s、MIR differential 154.6s、C 后端自举 239.8s、rls 快速通道 333.6s。
  ⇒ **产物 `.c` / `.h` 里 `base__nodes` 与 `base__Node` 计数均为 0**（已 grep 核实）。


**批次 20-G：侧表注释里已失效的 `nodes[]` 表述清理（纯注释批次；2026-10-05）**
- **动机**：20-F 删掉 `pub struct Node` + `pub var nodes` 后「节点句柄 = 裸索引」，但侧表声明处的
  行尾注释仍写着「与 nodes 平行」「`nodes[i]` 的 …」—— 这些是**事实错误的当前形态描述**，
  会持续误导后续四项 deferred（尤其 `node_visit` 访问者化与 S3 全局平行数组清理）。
- ⭐ **口径不是「全文替换 `nodes`」**，而是分三组（这是本批唯一的判断点）：
  - **A 组（32 处，改）**：`base.tc` 侧表声明的行尾注释，白名单 = `grep -n 'nodes[i]' src/base.tc`
    的 31 行 **+ `g_node_scope` 的 1 行**（后者只有「与 nodes 平行」没有 `nodes[i]`，首轮白名单漏了）
    ⇒ 「与 nodes 平行（的数组）」→「与节点池等长、按 id 索引」；「`nodes[i]` 的」→「节点 i 的」。
  - **B 组（20 处，改）**：把 `base.nodes` 当作**当前数据源**描述的模块头 / 函数头 / 行内注释
    —— 首轮 9 处（`codegen_dev:11,471`、`comptime_fold:14`、`hir:10,132`、`base:1776,1846,1927`、
    `codegen_c:1534`），**二次扫描补 11 处**（`sema:2042,5237,5380,5859,5861,6468`、
    `tir:14,1079,1578,1666`、`test:18`）。
    ⦁ `base:1776` 原写「最终删 `pub struct Node` + `nodes[]`」这一**待办口吻**已过期 ⇒ 改「20-F 已删」。
    ⦁ `sema:5237` 的旧约束「局部变量禁用 `nodes`（与 `base.nodes` 裸名冲突）」在 20-F 后**已失效**，
      但保留名字 `elem_nodes` 不动 ⇒ 注释改为「曾禁用 … 该冲突不复存在，名字沿用」。
  - **C 组（保留不动）**：明写「原签名 / 旧代码 / 此前 / 取代 `nodes[id].x = …`」的**历史沿革注释**
    （`comptime_fold:56`、`tir:3478/3555-3556/4530/4850`、`tir_to_ll:3315/4174`、`codegen_c:3447/4999`、
    `parse:1139`、`base:2611/2685-2687/2882/3109-3110/3789`）。
    ⚠ 判据：它们记录的是**迁移前形态**，改成新说法反而丢掉「为什么这么改」的信息 —— 这是本批
    **不能**用全文替换的根本原因。
- **新脚本 `tools/comment_nodes_cleanup.py`（S4 工具箱第八件）**：显式 op 表（文件 / 行号 / 旧串 / 新串）
  + A 组行号白名单；两道自检 —— ① **逐行 `code_part`（字符串感知地切掉 `//` 之后）必须逐字节不变**，
  ② 二进制读写保终结符 + 写回比对。脚本做了**幂等改造**（找不到旧串但已是新形态 ⇒ 静默跳过），
  故可分多轮增量补齐、安全重跑。
  ⚠ 本批 8 个文件在 worktree 里**全是 CRLF**（git blob 是 LF，被 `text=auto eol=lf` 归一化故
  `git diff` 看不见）⇒ 必须原样写回，否则整文件重写（批次 13 行尾红线的同款坑）。
  ⚠ **`src/tir.tc` 是 `-text`**（字节原样入库、blob 就是 CRLF）⇒ 这里行尾保真是**硬**要求；
  复核口径：`git diff --stat` 与 `git diff -w --stat` **必须完全一致**（本批二者相同 ⇒ 零漂移）。
- ⚠ **中途修正（诚实记录）**：首轮按「`base.tc` 侧表声明」+「5 个文件模块头」的口径落了 **40 处**并
  **已启动 gate L2**；随后做全仓精确普查（正则排除 `g_vf_nodes` / `elem_nodes` / `cnodes` 等
  标识符假阳性）才发现**还漏 12 处**（含我自己漏写进白名单的 `base.tc:2737`）。
  ⇒ **停掉在跑的门禁**（跑改 src 会让门禁结果失真，见 impl-rules「门禁跑起来后绝不能再改 src」），
  一次性补齐到 **52 处**再重启门禁 —— 宁可损失 8 分钟门禁进度，也不留「门禁测过一个已被改动的 src」。
- ⏭ **有意跳过**：`base.tc:30`（「旧 `nodes[]` 仍是真相源…」）位于 **`GEN:node-structs` 生成区间
  （25–1694）内**，由 `tools/cstgen.mjs --emit` 整段重写 ⇒ 手改会被覆盖且会让 `cstgen --check` FAIL，
  须由生成器侧一并修（另立小步）。同理跳过 `base.tc:1721` 的 `GEN:ast` 标记行。
- **落成**：8 文件 **52 增 / 52 删**（`base.tc` 35、`sema` 6、`tir` 4、`codegen_dev` 2、`hir` 2、
  `codegen_c` 1、`comptime_fold` 1、`test` 1）。
- **验证链（纯注释 ⇒ 最强形态的「零行为变化」自证）**：
  ① `tc check` **0 error / 530 warning**（与 20-F 完全一致）；
  ② 自举 g1 **2m07s**（52 处齐备后重跑）；
  ③ seed vs g1 **逐字节 IDENTICAL**，且 `.c` 2 527 662 B `33953ae4…` / `.h` 130 831 B `1ad485ed…`
     —— **与 20-F 基线（改注释前的产物）逐字节完全相同** ⇒ 这一条同时兼作旁路对照，
     **无需**再回退旧 src 重做一次对拍；
  ④ IR 快照 **0 DIFF / 0 NEW / 0 GONE**（117 targets / 354 entries 逐字节相同，examples 零 DIFF，
     273.7s；仅 srcHash / compilerMd5 两个**元数据**漂移）；
  ⑤ `--update` **只重录元数据**（354 份产物条目零变化）⇒ 与批次 13–19 的「陈基线必 FAIL」
     不同，**本批首跑即 0 DIFF**，证明注释确实不进产物；
  ⑥ **gate L2 = 25 passed / 0 failed（2861.2s）**：自举一代 g1 173.1s、产物快照比对 379.0s、
     conformance 115.1s、自举不动点 g2==g3 274.3s、run_examples 双后端 519.0s 全绿、
     双轨对拍 276.3s、**四代不动点 g2==g3==g4 150.2s**、MIR differential 189.4s、
     C 后端自举 238.4s、tc0 对拍 65.2s、rls 353.9s、tote 3.2s、lint 24.5s。
  ⇒ 本批是 S4 里**唯一一个首跑 IR 即 0 DIFF** 的批次（前 19 批都要先 `--update` 才拿真绿）。

**批次 20-H：删 re-export 垫片 `pub @import("std.rc.cst" :: *)`（§4.14.4 deferred ②；2026-10-05）**
- **动机**：S0 把 kind 注册表 / 关键字表迁进库模块 `std.rc.cst` 时，为「引用点零改动」在
  `src/base.tc:23` 与 `src/lex.tc:12` 各留了一个 **`pub @import("std.rc.cst" :: *)` 通配重导出垫片**。
  §4.14.4 把「删 re-export 垫片」列为 S4 四项 deferred 之一，且它与「删 `base.Node`」
  （批次 20-F 已完成）**共同构成 `@desugar` / `@pass` 插件化的硬前置** —— 否则 S8 的插件 API
  会同时暴露「经 base/lex 转发」与「直连 std.rc.cst」两套入口。
  ⇒ **本批落地后，S8 的硬前置全部兑现。**
- ⭐ **真实规模远小于预估**：垫片只被 **3 处代码 + 2 处模块内裸名** 用到（全仓去注释精确普查，
  正则排除 `g_vf_nodes` / `elem_nodes` / `cnodes` 等假阳性）：
  | 站点 | 原写法 | 20-H 后 |
  |---|---|---|
  | `base.tc:2878` | `nk_of_kind(kind)`（`:: *` 提供的裸名） | `cst.nk_of_kind(kind)` |
  | `lex.tc:780` | `kw_lookup(text)`（裸名） | `cst.kw_lookup(text)` |
  | `hir.tc:711` | `base.lower_policy_of(k) == base.LOWER_OPAQUE` | `cst.lower_policy_of(k) == cst.LOWER_OPAQUE` |
  | `tc.tc:103` | `lex.init_keywords();` | `cst.init_keywords();` |
  | `tc.tc:104` | `base.init_node_kinds();` | `cst.init_node_kinds();` |
- ⭐⭐ **形态三易其稿（本批唯一的实质判断点，完整记录避免后人重走）**：
  | 趟 | 形态 | `tc check` 结果 | 判定 |
  |---|---|---|---|
  | 一 | 去 `pub` + 收窄为**选择性导入** `@import("std.rc.cst" :: nk_of_kind)`，调用点用**裸名** | 0 error / **532** warning | ✗ 裸名跨模块访问新增 4 条 `T-MOD-W561`（UNQUALIFIED_XMOD） |
  | 二 | 改**模块别名表达式** `const cst = @import("std.rc.cst")` + `cst.` 限定调用 | 0 error / **532** warning | ✗ 消掉 4 条 W561，但 `const cst` 非 UPPER_SNAKE 又新增 4 条 `T-NAM-W402`（CONST_UPPER）——净零 |
  | 三 | **声明式** `@import("std.rc.cst");`（别名 = `last_segment` = `cst`），调用点不变 | 0 error / **528** warning | ✅ 最终形态 |
  - 第三趟的依据不是猜测，是两条**文档/测试实证**：
    ① `lib/std/rc/cst.tc:23` 官方用法第二条就写着 `@import("std.rc.cst" as cst)`；
    ② conformance **`p42_std_import.tc`** 用的正是声明式 `@import("std.math")` + `math.max(...)`。
  - ⭐ 为什么声明式能消 W402：`validate_const_name`（`base.tc:4555`，由 `parse.tc:1132/2244` 调用）
    对**所有** `const` 生效，全仓 30+ 个 `const base = @import("src.base")` 同样吃 W402
    （基线 62 条里绝大多数是它）；声明式 `@import` **不产生 const 声明** ⇒ W402 回到基线 62。
  - **负向测试**（证明确实解析、不是被静默放过）：把 `cst.nk_of_kind` 故意写成
    `cst.nk_of_kind_TYPO` ⇒ `tc check` **报 1 error**；还原后回到 0/528。
- **告警偏离的最终账（净 −2，且减掉的是真问题）**：
  `530（20-F/20-G 基线） = 464 W401 + 62 W402 + 4 W561`
  → `528（20-H） = 464 W401 + 62 W402 + 2 W561`。
  ⇒ W401/W402 **分毫未动**；**W561 4 → 2**，减掉的正是**垫片自身**（两条 `:: *` 通配导入）
  触发的跨模块裸名告警。剩余 2 条是 `sema.tc:4661` 的既有告警，与本批无关。
- **新脚本 `tools/drop_shim_import.py`（S4 工具箱第九件）**：三趟 op 表（`PHASE1_SUBS` / `SUBS` /
  `PHASE3_SUBS`）+ 二进制读写保行尾 + 写回自检。
  ⚠ **行号驱动批量编辑必须「先 sub、后 ins（ins 之间降序）」** —— op 表行号以**原文件**为基准，
  先 ins 会让后续 sub 整体下移打偏（首跑实测踩到 `AssertionError: 插入后行号漂移 hir.tc:711`）。
  ⚠ 三趟的行号是**各趟当时**的行号（每趟插行/扩注释会让后续行下移），整表重跑必然对不上 ⇒
  脚本对「old 不在且 new 也不在」只**告警不中断**，定位为「改动台账复核器」而非一次性迁移器。
- **落成**：4 文件 **18 增 / 13 删**（`base.tc` 13、`lex.tc` 10、`tc.tc` 5、`hir.tc` 3；含注释改写）。
- **验证链**：
  ① `tc check` **0 error / 528 warning**（见上账）；
  ② 自举 g1 **2m15s**；
  ③ seed vs g1 **逐字节 IDENTICAL**：`.c` 2 527 662 B `3493b215…` / `.h` 130 831 B `3d82401b…`；
  ④ ⭐ **旁路对照**（本批**必须**做，因为产物哈希与 20-G 基线不同）：回退 4 文件到 HEAD 版 →
     用 seed 编译取 20-G 基线产物 → 还原（`diff -r -q` 自检 OK）。`.h` 与基线 **IDENTICAL**；
     `.c` diff **仅 50 行**，且 `grep -vE '__[0-9]+'` **结果为空** ⇒ **100% 是 `__N` 临时量改名**
     （`cp__26359→26360`、`id__36609→36610`、`idv__222475→222477`、`v__228803→228805`），
     由新增/改写的 AST 声明节点数量变化引起，**零语义影响**（字节数仍 2 527 662 完全不变）。
  ⑤ ⭐ **脚本里预设的两个待实测点，实测结论**：
     · 「选择性导入是否会改变哪些 cst 全局被发射」—— **不会**：`cst__g_kw_text` / `g_kw_kind` /
       `g_kw_tier` / `node_kind_names` 等在两个版本里**一个都不少** ⇒ 发射面按**模块**而非按选择器；
     · 「`pub @import` 是否额外发射转发包装函数」—— **不会**：`lex__init_keywords` /
       `base__init_node_kinds` 在 **20-G 与 20-H 两版里都是 0 次出现** ⇒ 垫片从未产生转发函数，
       调用点本来就直发 `cst__init_keywords` / `cst__init_node_kinds`。
       ⇒ 这解释了为什么删垫片**只**带来临时量编号漂移，而没有符号名变化。
  ⑥ IR 快照 **1 DIFF（`src/tc.tc::c`）/ 0 NEW / 0 GONE**，examples **零 DIFF**（296.2s）：
     差异正是 ④ 的 `.c`（`was 4ce5d77d… → now 3493b215…`），内容 = 50 行临时量改名；
     ⚠ 判据：**examples 零 DIFF ⇒ 非行为变化**（见 impl-rules「examples 出现 DIFF 是硬信号」）。
  ⑦ `--update` 重录基线（117 targets / 354 entries，337.6s）；
  ⑧ **gate L2 = 25 passed / 0 failed（3481.1s）**：自举一代 g1 171.6s、产物快照比对 486.4s、
     conformance 149.0s、自举不动点 g2==g3 321.4s、run_examples dbg 双后端 653.3s、
     HIR AstGen 45.4s、HIR 解释器 4.7s、difftest 代际对拍 12.4s、双轨对拍 373.8s、
     REPL 冒烟 28.5s、**四代不动点 g2==g3==g4 183.4s**、MIR differential 239.0s、
     C 后端自举 288.5s、tc0 对拍 81.6s、rls 389.7s、tote 3.8s、lint 27.1s。
     另有工具链断言 1.3s / 诊断注册表 0.3s / cstgen 0.3s / 静态检查(catn+shadow+dag) 1.7s /
     预编译 std .tlib 13.4s / IR 静态审计 2.1s / LLVM verifier 2.0s / UNSUPPORTED 计数 0.4s。
  ⇒ 安装四代种子（`g4 → out/dbg/tc.exe`、`gr → out/rls/tc.exe`）后双种子复检均 **0/528**。

**批次 20-I：修 `GEN:node-structs` 区间内已失效的 `nodes[]` 注释（20-G 遗留小步，生成器侧；2026-10-05）**
- **动机**：批次 20-G 清理了 52 处注释，但**有意跳过** `base.tc` 里位于
  **`GEN:node-structs` 生成区间（绝对行 29–1698）内**的一句：
  「旧 `nodes[]` 仍是真相源，本区为其 SoA 镜像」。
  该句在 20-F 删掉 `nodes[]` 后已是**事实错误**（现在节点句柄就是裸索引、侧表是唯一真相源），
  但它**不能手改**（区间由 `tools/cstgen.mjs --emit` 整段重写、`--check` 逐字节比对，
  手改会被下次生成覆盖且立即让 `cstgen --check` FAIL）⇒ 必须由**生成器侧**改。
- **改动**：只动 `tools/cstgen.mjs` 里生成该行注释的那一条 `NL.push(...)`：
  「旧 `nodes[]` 仍是真相源，本区为其 SoA 镜像。」
  → 「**侧表 `g_node_*` 是唯一真相源，本区是其按 kind 的 SoA 镜像。**」
  然后 `node tools/cstgen.mjs --emit` 重新生成 + `--check` 复核。
- ⭐ **改动面自证**：`--emit` 同时重写了 `GEN:kinds`（`lib/std/rc/cst.tc`，105 kind）与
  `GEN:node-structs`（`src/base.tc`，91 pilot kind）两个区间，但
  `git status` 只有 **`src/base.tc` 一个文件变更、diff = 1 insertion / 1 deletion**
  ⇒ 生成器与清单本来就同步（`--check` 事前事后均 OK），本次**只**改了目标注释那一行。
- ⏭ **有意跳过**：`tools/cstgen.mjs` 自身「S2 落地说明」块里也有一句「当前仅建立与
  `nodes[]` 按 id 对齐的平行 NodeRef 数组 `g_node_nref`」—— 该块含
  「S1b 种子编译器 / 延后到 S2b」等**历史沿革标记**，按批次 20-G 的 **C 组口径保留**
  （它说明的是「为什么这么生成」，改成新说法会丢掉理由）。
  ⚠ 判据与 20-G 完全一致：**注释里有没有时间标记** —— 有则保留，无则改。
- **落成**：2 文件（`tools/cstgen.mjs` 3 增 / 0 删 的注释说明 + 1 行生成串改写；
  `src/base.tc` **1 增 / 1 删**，由 `--emit` 产出、非手写）。
- **验证链（纯注释 ⇒ 走 20-G 确立的最强自证路径）**：
  ① `cstgen --check` **OK**（105 kind / 91 pilot，事前事后均 OK）；
  ② `tc check` **0 error / 528 warning**（与 20-H 完全一致）；
  ③ 自举 g1 **2m18s**；
  ④ seed vs g1 **逐字节 IDENTICAL**，且 `.c` md5 `3493b215…` / `.h` md5 `3d82401b…`
     —— **与 20-H 基线（改注释前的产物）完全相同** ⇒ 这一条**同时兼作旁路对照**，
     **无需**再回退旧 src 重做一次对拍（判据见 impl-rules「纯注释批次的最强自证」）；
  ⑤ IR 快照 **0 DIFF / 0 NEW / 0 GONE**；
  ⑥ **无需 `--update`**（0 DIFF ⇒ 基线本就正确）；
  ⑦ **gate L2 = 25 passed / 0 failed（2843.5s）**：自举一代 g1 139.5s、产物快照比对 418.5s、
     conformance 126.6s、自举不动点 g2==g3 321.6s、run_examples dbg 双后端 484.1s、
     双轨对拍 211.1s、**四代不动点 g2==g3==g4 152.2s**、MIR differential 153.4s、
     C 后端自举 244.4s、tc0 对拍 52.4s、rls 349.1s、tote 2.8s、lint 20.0s；
     安装四代种子后 dbg / rls 双种子复检均 **0/528**。
  ⇒ 与 20-G 同为「首跑 IR 即 0 DIFF、无需重录基线」的纯注释批次。
- ⚠ **记录一次非回归的门禁失败（诚实记录）**：首次跑 gate L2 只跑了 729.3s 就
  **8 passed / 1 failed**，失败在「产物快照比对」步，stdout 只有半截路径
  `…\irsnap.23948\c__examples__colony_wave\colony_wave.c`，真正的根因在 stderr：
  `[sandbox] 命令被沙箱拦截` —— 拒绝 `out/dbg/irsnap.*` 下两个 `.c` 的
  **file-read** 与 **file-delete** ⇒ Node 进程崩。
  判据（为什么认定不是回归）：① 失败信息里**没有任何产物差异内容**，只有路径碎片；
  ② 同一项检查单独跑 `ir_snapshot.mjs --compiler out/dbg/g1.exe` 是 **OK / 0 DIFF**；
  ③ 按 20-H 成功时的调用形态（`dangerouslyDisableSandbox`，**不显式传 `timeout`**）
  重跑即 **25/0**。⇒ 属**环境噪声**，非代码回归；但**必须重跑拿到真绿**，不能用
  「单独跑过」代替门禁结论。


**批次 20-J：S3 遗留的两个全局平行数组 → per-node bool 侧表（§0.14.5 第 4b 项收口；2026-10-05）**
- **动机**：§0.13.8 第 3 项与 §0.14.5 第 4b 项都记着同一笔账 —— S3 的要求是「删 `Node.td`
  **与全局平行数组**」，`Node.td` 已删，但 `g_local_decls` / `g_conpat_binds` 两个全局平行数组
  一直没清，**S3 因此只能记为 partial**。本批清掉它们，**S3 的这项遗留闭合**。
- **对象与改名**：
  | 原 | 语义 | 20-J 后 |
  |---|---|---|
  | `g_local_decls` + `g_local_has(dcl)` | 「已唯一化重整（mangle 成 `name__<sid>`）的声明节点」**集合**，线性扫 O(n) | `g_node_mangled` + `node_mangled()` / `node_set_mangled()` |
  | `g_conpat_binds` + `g_conpat_bind_has(d)` | 「conpat 载荷绑定（发射期现场合成的 var_decl）」**集合**，用于**禁止**对其重整 | `g_node_conpat` + `node_conpat()` / `node_set_conpat()` |
  ⦁ `node_conpat` 这个名字是 §4.10.3 **原文预定**的（「待 `node_conpat` 侧表化后清理」），
  不是本批新造；`node_mangled` 取自 `g_local_decls` 注释里的既有术语「唯一化重整 / mangle」。
  ⦁ 二者是「**已登记 id 的集合**」而非「id → 值」的映射，但语义上**完全等价于节点上的一个
  bool 标记** ⇒ 换侧表后 O(1)，并与 S4 已迁的 19 个字段同一范式。
- ⭐⭐ **动手前先证的四条等价性**（本批的验收核心，逐条已证，**不是**事后补的）：
  ① **越界写会被丢弃 = 行为差异吗？** —— 不会。`node_set_xxx` 越界是静默 `return`
     （范式见 `node_set_bc`，`base.tc:2344`）。写入侧只有两类 id：`mk_var_decl` 的返回值
     （该函数**首行即 `node_new`**，返回 `node_count()-1`，侧表已 append ⇒ 恒在界内）
     与源码已有声明节点 id（恒 `< node_count()`）。⇒ 不存在「写了却被丢弃」。
  ② **原集合允许重复 append，bool 标记幂等** —— 集合成员关系 ⟺ 标记为 true，
     重复 append / 重复写 true 都不改变判定结果 ⇒ 恒等价。
  ③ **有无「清空 / 重置」语义？** —— 无。grep 全仓「给 `g_node_kind` / `g_local_decls` /
     `g_conpat_binds` 赋空数组」的写法结果为空 ⇒ 旧数组与侧表都从不重置；侧表随 `node_new`
     增长、默认 false（= 不在集合）。
  ④ **负 id / 越界读**：旧线性扫返回 false；新访问器 `id < 0 || id >= slice_len(...)`
     返回 false ⇒ 一致。
- ⚠ **三个不能踩的点**（照抄时最容易漏）：
  · 访问器范式是 `sidetable_init(); var id = nr_idx(n); …`（`node_bc`，`base.tc:2338-2347`），
    **读函数首行必须有 `sidetable_init();`**，setter 不需要。
  · 新侧表必须在 `sidetable_init()` 里 **登记**（`sidetable_register("node_xxx", "S3")`）——
    它是**侧表登记簿**（供 IDE / 调试枚举），**不是**扩容逻辑。本批两张归 `"S3"`（收的是 S3 遗留）。
  · `node_new` 里必须 append 默认值，否则侧表与节点池不等长 ⇒ 越界读全返 false（**静默**错）。
    ⦁ 复核：`grep -n 'append(g_node_' src/base.tc` 的 37 处**全部落在 `node_new` 内**
    ⇒ append 点唯一，无第二处需要同步。
- **新脚本 `tools/s3_globals_to_sidetable.py`（S4 工具箱第十件）**：op 表支持三种
  `sub` / `ins` / `range`（整段替换），全部 **按行号降序施加**（改大行号不影响小行号，
  插入与改行数都不会打偏）；二进制读写保行尾 + 写回自检 + 幂等跳过 + 行号漂移只告警。
- **落成**：2 文件 **35 增 / 24 删**（`base.tc` 43 行、`codegen_c.tc` 16 行）。
  旧名残留只剩 **6 处注释**（「原 `g_local_has` / S3 遗留 `g_local_decls` 侧表化」等
  历史沿革表述），按批次 20-G 的 **C 组口径保留**。
- **验证链**：
  ① `tc check` **0 error / 528 warning**（与 20-H/20-I 一致）；
  ② 三项机械复核：改动行括号/花括号平衡（忽略字符串）、`node_new` 已 append 两张新侧表、
     `sidetable_init` 已登记两张 —— 全过；
  ③ 自举 g1 **2m18s**；seed vs g1 **逐字节 IDENTICAL**（`.c` `4249021a…` / `.h` `554a7db3…`）；
  ④ **旁路对照**（产物哈希与 20-I 基线不同，必做）：回退 2 文件到 HEAD → seed 编译取基线 →
     还原（`diff -r -q` 自检 OK）。`.h` diff **14 行**、`.c` diff **151 行**，逐条分类为四类
     —— ① `sidetable_register` 新增 2 行；② 全局变量改名 + 线性扫函数 → 侧表访问器；
     ③ `node_new` 新增 2 行 append；④ 4 处调用点改写 —— 其余全是 `__N` 临时量编号漂移
     （`cp__26360→26436`、`id__36610→36686`、`idv__222477→222574`、`v__228805→228902`）。
     **无超出预期的改动**。
  ⑤ IR 快照 **3 DIFF（`src/tc.tc::{c,h,ll}`）/ 0 NEW / 0 GONE，examples 零 DIFF**（242.6s）；
  ⑥ `--update` 重录基线 → **117 targets / 354 entries**（253.2s）；
  ⑦ **gate L2 = 25 passed / 0 failed（2543.5s）**，自举四代不动点 **148.2s**（`g2 == g3 == g4`）。
     分步耗时（关键项）：工具链断言 0.8s / 诊断注册表 0.3s / `cstgen --check` 0.3s /
     静态检查 1.1s / 预编译 std 9.3s / **自举一代 142.3s** / IR 静态审计 1.6s /
     LLVM IR verifier 1.5s / **产物快照比对 388.8s** / conformance 91.7s /
     自举不动点 287.5s / **run_examples dbg 413.2s** / HIR AstGen 30.9s / HIR 解释器 3.1s /
     difftest 代际对拍 7.4s / 双轨对拍 191.4s / REPL 冒烟 17.5s / **MIR differential 150.3s** /
     C 后端自举 238.0s / difftest tc0 50.3s / **rls 快速通道 347.1s** / tote 2.4s / lint 18.4s。
     一次跑过、无沙箱拦截（20-I 那次的环境噪声未复现）。
  ⑧ 提交 `25814e0` → FF 推送 `s2-noderef:main`，远端 `main == 25814e0`。
- ⭐⭐ **为什么「examples 零 DIFF」不够，必须另做覆盖证明**（本批最重要的方法论收获）：
  按 impl-rules「examples 出现 DIFF 是硬信号」，零 DIFF 通常可判定非行为变化。但本批
  **反查发现 mangle 路径在快照里根本没被触发** —— 编译器自身产物里能匹配 `[A-Za-z_]\w*__\d+`
  的只有 4 个临时量名（`cp__`/`id__`/`idv__`/`v__`），**没有一个是 mangle 产生的 `name__<sid>`**；
  adt_list 等示例的产物里同样为 0。⇒ 若就此收工，「零 DIFF」只是**没覆盖**，不是等价。
  故按「变更前种子 vs 新 g1 差分对拍同一 probe」补了两个显式 probe：
  · **`p_mangle.tc`**（同函数内 `var x` 声明两次）⇒ 产物出现 **`x__6`**（2 次），
    seed(20-I) 与 g1(20-J) 产物 **逐字节 IDENTICAL**，两版足迹同为 `x__6` ✓
  · **`p_conpat.tc`**（`match` 两个臂各绑定同名 `x`）⇒ 产物里 **没有** `x__N`
    —— 这正是 conpat 豁免应有的结果；**反证**：若 `node_conpat` 的写或读失效，
    第二个臂的同名 `x` 会被 `g_seen_has` 命中而重整成 `x__N`。两版产物亦 IDENTICAL ✓
  ⇒ 两条路径（写+读）都被显式证明等价，而非依赖「没报警」。

**批次 20-K：`node_to_hir` 桥入参侧切 `u64` NodeRef（§4.14.4 四项 deferred 之三；2026-10-05）**
- **动机**：§4.10.3 / §0.14.4 四项 deferred 里，前两项（删 `base.Node`、删 re-export 垫片）已由
  20-F / 20-H 闭合，第三项是「`node_to_hir` 桥切 `NodeRef`」。step④ 已把 `HirInst.nd` 升为 `u64`
  且 `hir_inst_node` 内部 `as i64` 收窄（注释明写「迁移期 NodeRef==裸索引，逐位等价」），
  ⇒ 桥的**入参侧**仍是裸 `i64`，与 step②/③/④ 的 `u64` 化不一致。本批补齐入参侧。
- ⚠ **刻意只做入参侧，返回值侧（`hir_inst_node → u64`）留作独立步**，理由是三条实测风险：
  · sema 里 15+ 处形如 `var d: i64 = hir.hir_inst_node(di);`，返回值还参与 `!= e` / `== fb` 比较；
  · 改成 `u64` 后 C 后端会生成**无符号比较**，`-1` 哨兵的比较语义随之改变（`-1` 变 `0xFFFF…FFFF`）；
  · `sema.tc:13255` 有 `if (hir.hir_of_node(pd) < 0)` 这类**判据依赖有符号性**，一旦返回侧被 u64 化
    就恒为真 ⇒ 静默改语义。故按「最小可验证增量」原则拆开，本批不动返回侧。
- ⭐⭐ **负 id 不逐位等价（本批最关键的一条认知）**：「NodeRef == 裸索引，逐位等价」**只对非负索引成立**。
  `nr_idx(n)` = `((n << 32) >> 32) as i64` —— 低 32 位**零扩展**后再转 `i64`，故
  `nr_idx(((-1) as u64))` = **4294967295**，不是 `-1`。
  ⇒ 原函数首行 `if (n < 0) return` 的哨兵语义**不能**靠 `as u64` 后的 `n < 0` 承接（u64 恒非负），
  必须靠既有的**越界分支**兜住：`id >= slice_len(g_hir.node_to_hir)` ⇒ 返 `-1` / 静默 return。
  这与全仓 `node_*` 访问器的范式（`id < 0 || id >= slice_len(...)` 返默认）完全一致。
- **落成**：2 文件 **29 增 / 27 删**（`hir.tc` 18 行：两个签名 + 两个函数体改走 `base.nr_idx`；
  `sema.tc` 38 行：15 处 `hir_invalidate` + 4 处 `hir_of_node` 调用点加 `(x as u64)`）。
  新脚本 **`tools/hir_bridge_noderef.py`**（S4 工具箱第十一件）。
- ⚠ **脚本首版踩到行号偏移 bug（已修）**：op 表分 `RANGE`（整段替换）与 `SUB`（单行）两类，
  首版**先施加全部 RANGE 再施加 SUB** —— 而 `RANGE 162-164` 由 3 行变 4 行，使后续 170/171
  整体下移一位 ⇒ `hir_invalidate` 的签名与函数体改到错位。
  **修法**：把 RANGE 与 SUB **合并后统一按起始行号降序**施加（大行号先改，小行号不受影响）。
- **验证链**：
  ① `tc check` **0 error / 528 warning**；
  ② 完整性复核：全仓 `hir_of_node(` / `hir_invalidate(` 只剩 2 处定义 + 19 处调用点，**全部已改**、无遗漏；
  ③ 自举 g1 **2m21s**；seed vs g1 **逐字节 IDENTICAL**（`.c` 2 528 734 B `9db3e2e1…` / `.h` 130 925 B `eea739ca…`）；
  ④ **旁路对照**（产物与 20-J 基线不同，必做）：`.h` diff **仅 4 行**（两个签名 `int64_t → uint64_t`）；
     `.c` diff **72 行**，剔除 `__N` 临时量编号漂移后**只剩三类** —— 签名、`n → id` 的 `nr_idx` 解包、
     sema 19 处 `((uint64_t)x)` 转换。**无超出预期的改动**。
  ⑤ IR 快照 **3 DIFF（`src/tc.tc::{c,h,ll}`）/ 0 NEW / 0 GONE，examples 零 DIFF**（246.6s）；
  ⑥ `--update` 重录基线 → **117 targets / 354 entries**（256.2s）；
  ⑦ **gate L2 = 25 passed / 0 failed（2508.3s）**，自举四代不动点 **146.8s**（`g2 == g3 == g4`）。
     分步耗时（关键项）：工具链断言 0.8s / 诊断注册表 0.2s / `cstgen --check` 0.2s /
     静态检查 1.1s / 预编译 std 9.2s / **自举一代 145.0s** / IR 静态审计 1.4s /
     LLVM IR verifier 1.3s / **产物快照比对 372.3s** / conformance 94.5s /
     自举不动点 291.7s / **run_examples dbg 399.2s** / HIR AstGen 28.8s / HIR 解释器 3.0s /
     difftest 代际对拍 7.1s / 双轨对拍 189.1s / REPL 冒烟 17.0s / **MIR differential 149.4s** /
     C 后端自举 239.7s / difftest tc0 49.7s / **rls 快速通道 340.2s** / tote 2.4s / lint 17.9s。
     一次跑过、无沙箱拦截。
  ⑧ 提交 `a20f301` → FF 推送 `s2-noderef:main`，远端 `main == a20f301`。
- ⭐ **为什么本批不必像 20-J 那样补 probe**：20-J 的问题是「mangle 路径在**任何**语料里都没有
  运行时足迹」，而本批两条路径是 sema 的核心桥 —— 在编译器自身 2.53MB 语料上有 **16 + 5 处调用点**，
  且 base vs seed 的 diff 已逐条分类为预期改动；examples 侧的 0 DIFF 是「**新 g1 vs 20-J 旧基线**」的
  前后对比，不是同版本自比。⇒ 覆盖充分（判据：先反查是否有足迹，有则 diff 分类即为等价证据）。

**剩余字段实测使用量（`.F` 命中数；泛型名字段含非 Node 假阳性，仅作排序参考）**
（✅ 已迁 `se`、`has_sa`、`has_sb`、`has_sc`、`be`、`bf`、`memspace`、`bd`、`bb`、`bc`、`sc`、`nd`、`ib`、`nc`、`ba`、`lc`、`sb`、`ia`、`lb`、`nb`、`la`、`na`、`kind`、**`sa`** —— 共 **24 个字段**）。
> 迁移至此，`Node` 里**只剩过渡字段 `id`**（S5 step2，随 `Node` 一并消失），**真实载荷字段全部清空**
> ⇒ 可进入 §4.14.4「删 Node」收口动作（四项 deferred：`node_visit` / 删 Node 字段 / 删 re-export 垫片 /
> `node_to_hir` 桥；其中「删 Node + 删垫片」是 `@desugar`/`@pass` 插件化的硬前置）。
> 迁移至此，`Node` 的**全部 bool 载荷已清空**（批次 10）、**`la`/`lb`/`lc` kids 链槽族三槽全部清空**
> （`lc` 批次 11、`lb` 批次 14、`la` 批次 16；⦁注意三者**哨兵并不一致**：`lc`/`lb` 带 `-2`，`la` 纯 `-1`）、
> **`na/nb/nc/nd` 索引槽族四槽全部清空**（`nd` 批次 7 / `nc` 批次 9 / `nb` 批次 15 / **`na` 批次 17**，
> 四槽**均为纯 `-1` 单哨兵**）、**AST 派发键 `kind` 已清空（批次 18）**、字符串族外置其四（`sc`、`sb`、`kind`、**`sa`**），**字符串载荷全部清空**、**通用整数槽 `ia`/`ib` 两槽全部清空**
> （批次 8 / 批次 13）。四类侧表形态（bool / string ×2 / 索引 `-1` / 带 `-2` 哨兵的索引）**全部验证成立**
> ⇒ 后续外置只剩工作量、无范式风险。**批次 19 已迁完最后一档 `sa 1268`** —— 它是 Node 里**仅存的真实载荷字段**
> （⚠ `sa` 是 `sappend` / `safe` 等标识符的**前缀**，沿用批次 17 给 `soa_migrate.py` 加的 `word_boundary`
> 护栏即可）。`sa` 迁完 ⇒ **`Node` 只剩过渡字段 `id`**，即可进入 §4.14.4「删 Node」收口动作。越往后站点越多、单批风险越高，后续宜**继续小组合 + 组内独立验证**；每批**开工后必须普查 ① Node 值形参、② `node_X((V.id as u64))` 是否落在形参上、③ 是否有 `-1` 之外的哨兵**（批次 9/11 致命坑的系统性防线），收尾时**必须核对 examples 是否 0 DIFF**（批次 9 的方法论收获）。
> ⚠ **工具复用提示（批次 13 新增）**：`tools/soa_migrate.py` 的「Node 局部量 → 索引」映射内核（取**最近前置**声明、函数区间内识别 `var base` 遮蔽 → 切降级名、行尾注释剥离）与 `tools/cls.py`（字符串感知注释判别）、`tools/nvf.py`（Node 值形参普查）可直接复用于后续批次：抽取内核已抽象成 `tools/soa_migrate.py`（字段由首个命令行参数给出，如 `python tools/soa_migrate.py lb src/sema.tc`），不再需要改动脚本内的常量。
> ⚠ **自动迁移 ≠ 免检（批次 14 三条硬性收尾动作 + 批次 16 第④条 + 批次 17 第⑤条 + 批次 18 第⑥条）**：
>   ① **完工后必做机械兜底** —— 对所有改动行做「忽略字符串的 `()` / `{}` 平衡 + 无 `;;`」检查。
>      本批据此一次性扫出 4 行语法损坏（详见上方「本批踩到并修掉的 3 个迁移工具 bug」表），
>      而 `tc check` 之外没有任何别的手段能在跑门禁前发现它们。
>   ② **迁完再跑一次 `tools/cls.py .<field>`** —— 必须确认「REAL 站点」只剩已剔除的 `tbl_Rec*_X`；
>      本批正是靠这一步才发现 **迁移清单漏了 `src/hir.tc` 的 6 处**（普查清单里有，执行清单里没有）。
>   ③ **写点逐个确认有 `slice_set` 回写** —— 否则原本是 Node 值拷贝上的**无效写**，被升级成 setter
>      会偷偷改变语义（铁律，见 impl-rules）。注意回写可能用**另一个变量名**（如 dst），需人工确认。
>   ④ **每批必跑 `python tools/wholescan.py --only=<本批字段>`（批次 16 新增）** —— 自动迁移器
>      **完全看不到**「整体 Node 结构体赋值」这类站点（`base.nodes[e] = cn;` 里没有出现 `.la`），
>      而每外置一个字段就会让这些站点静默少搬一个字段。本批正是这里被击穿：
>      `sema` 2 处跨索引整体拷贝未同步 `la`，导致 6 个 ADT/match examples 的合成构造器丢实参
>      （`List_from_One(42)` → `List_from_One()`）。同站点还有 214 处**同索引回写**天然无害，
>      脚本会自动区分二者，不必人工筛。
>   ⑤ **每批必看 dry-run 输出的 `==== STALE-INNER ====`（批次 17 新增，已内建进 `soa_migrate.py`）** ——
>      当接收者的索引表达式自身含被迁字段（`var ini: Node = base.nodes[n.na];`）时，工具会用**迁移前**
>      的原文建映射，产出 `base.node_na((n.na as u64))` 这种「外层译了、内层是未迁字段读」的半吊子。
>      ⚠ **二次扫描发现不了**（PLAN 恒为 0），只有 `tc check` 的 `T_UNKNOWN_FIELD` 能兜住 ——
>      批次 17 就是这样一次性冒出 **31 处**。收尾判据：`STALE-INNER` 除注释里的反引号引用外须为 0。
>   ⑥ **每批必扫「同行声明 + 同行使用」的 Node 局部量（批次 18 新增）** —— 形态是
>      `if (mlen >= 0) { var mvn: Node = base.nodes[mlen]; if (mvn.kind == "int") { … } }`。
>      老版本 `resolve()` 要求声明行号 **严格小于**使用行号，看不见同行声明，会回落到函数里
>      **更早的同名声明**（本批把 `mvn.kind` 译成 `node_kind((mrows as u64))`，串到上一个分支的
>      变量上）。工具已修（改为按 `(行,列)` 取最近前置），但**每批仍须专项扫一遍**：
>      `= nodes[…]` 与本批访问器在同一行共现的行，逐个确认索引表达式对得上（本批 3 行、含 1 行被误伤）。
>      ⚠ 与第 ③ 条联动：写点回写扫描的首版脚本只认 `base.nodes`，漏了降级名 `base__nodes`
>      ⇒ 误报 3 个「无回写」；正确写法是三种前缀一起匹配（`(?:base__nodes|base\.nodes|nodes)`）。
>      本批 25 个写点最终全部命中同索引回写。
>   ⑦ **每批必做「结构体字面量内部站点」专项扫描（批次 19 新增，`tc check` 的盲区）** ——
>      ⚠ **检查器不解算 `X{ field: n.<f>, … }` 里的字段访问**：本批 `tc check` 报 0 错，
>      却仍有 9 处真 `Node.sa` 读（清一色在 `TIRFunc{…}` / `TIRInst{…}` / `TirEmitRes{…}` 里）。
>      扫描必须**跨行**（字面量 `Ident{` 到配对 `}` 的区间内出现的 `.<field>` 都算），
>      且要覆盖**全部已迁字段**（本批据此确认批次 ≤18 **无同类漏网**：全 24 字段扫出 0 处）。
>      ⚠ 因此「`tc check` 报 0 错」**不再**是完备判据，须三条件并列：
>      **0 错 + 迁移器全文重扫 `PLAN==0` + ⑦ 扫描为 0**。
>   ⑧ **每批必看「迁移器不带 `--lines` 的全文重扫」（批次 19 固化）** —— `--lines` 过滤会掩盖
>      盲区站点；收尾时对每个改动文件再跑一次不带过滤的 `soa_migrate.py`，`PLAN` 必须也为 0
>      （本批正是靠这一步才暴露出 tir 的那 9 处）。残余 `UNMAPPED` 只允许是**非 Node 接收者**
>      （如 `HirInst.inst.sa`、S2 生成 record 的 `r.sa`）。
> ⚠ **执行顺序红线（批次 19 实测）**：**先 `--apply`、再手工改**。手工插入注释会让后续
>      `--lines=<json>` 的行号整体偏移 ⇒ 工具把人为外的内容改到错误的行上（本批在
>      `codegen_dev.tc` 踩到：plan 由 20 变 1，且唯一那处改错了行）。已回滚重做：
>      `git checkout -- <file>` → 重新 dry-run → apply → 最后补注释。
> ⚠ **行尾红线（批次 13 实测）**：上述 Python 脚本以文本模式读写会把 **CRLF 文件整体转成 LF**（本批把 `src/tir.tc` 全文件 5653 行行尾改写，`git diff --stat` 一度虚增到 11309 行）。**必须**以二进制读写（`open(p,'rb')` / `newline=''` 保留原终结符）或事后按原文件形态还原；收尾时用 `git diff --stat` 与 `git diff -w --stat` 对照校验（二者应一致）。

**后续批次（待做，按使用量升序、每组独立绿）**全部完成后删 `pub struct Node` + `nodes[]` + `node_new` 的 Node 构造 + 全部 `slice_set(nodes, …)`，`id` 字段随 `Node` 一并消失（届时裸索引即句柄），S4 方真正收口（随后补 `node_to_hir` 桥改造 + 删 re-export 垫片，见 §4.14.4）。

### 0.13.9 `node_scope` 设计（经批判修订；原"统一作用域基础设施"方案已降级）

> **已落地（commit `1d6f431`，2026-10-01）**：工作 A 已按本设计实现并通过 gate L2 24/0。下文为设计依据与边界；实现细节与验证见 §0.13.8 第 1 项。工作 B（sema 统一词法树 / 增量 / IDE / 相位 CTFE walker）仍为独立 R&D epic，未启动。

> **修订记录（2026-10-01）**：初版按用户四要求升级为"统一作用域树+图"方案。经批判后判定该方案**混淆了名字解析与标识符重名、把 S3 收口任务偷换成解析器重写、且含大量无当下消费者的过度工程**，故降级为下方的"窄而安全"设计。四要求的合理内核被保留并重新落地（见各条）。

#### 事实纠偏（修订依据）
- **LLVM 后端并不使用 `g_seen`**：C 后端重名用 `g_seen`（base.tc:1880、`codegen_c.tc`），LLVM 后端重名用 `src/llname.tc` 的 `ll_mangle`/`g_ll_addrslot`（`tir_to_ll.tc:429/454/1270` 等）。二者是**不同关注点**：sema 做*名字解析*（`x` 绑定到哪个声明）、`g_seen` 做 *C 发射重名*、LLVM 做 *LLVM 名*。碰撞域（词法 vs 发射序）与失败模式都不同，硬塞进一棵树是错误耦合。原"三套互不相通"表述有误。
- 闭包（`closure_make`/`closure_capture`/`lambda`，sema.tc:4135/5242/6409）与 comptime 泛型（`comptime T: any`/`meta T: type`/`instantiate_generic`，sema.tc:1553–2005）**真实存在**，故"expr 粒度""相位"不是空想，但落点须精确（见下）。

#### 修订后设计：拆为两类工作，风险分级
- **工作 A（S3 收口，安全）：只替换 `g_seen`。** 纯发射侧重构：`g_node_scope[]` 侧表由*发射帧树*（原 24 个 `g_seen_push` 站点）构建，mangle 决策读它。sema 解析器、`llname.ll_mangle` **完全不动**。这就是 §0.13.8 的原意，IR 非编译器目标变化=0，从根上消除 `-O2` 自别名隐患。
- **工作 B（独立 R&D epic，需另立 sign-off）：sema 统一词法作用域树 + 工具链。** 这是**解析器重构**（把 `sym_lookup` 上溯从 `scope_parents` 链迁到 `node_scope` 树），不是 S3 性质的任务，量级大一个数量级、会破坏"IR 变化=0"纪律。只在出现真实消费者（IDE / 增量编译）时才启动，不塞进 S3。

#### 四要求的合理内核如何落地（修订版）
- **#1 基础统一 → 仅"发射侧"统一，不碰解析侧**。`g_node_scope`/`g_scopes` 取代 `g_seen` 的发射帧；sema 与 LLVM 的*名字来源*仍各自保留（sema 的 `scope_parents` 链、LLVM 的 `ll_mangle`）。不强行三合一。
- **#2 粒度精细化 → 仅"引入绑定的表达式"才建 expr 作用域**。scope 树节点 = `module`(=现有 `global_scope`/`node_mod`，**不新增 kind**) / `function` / `block`(原 24 push 站点) / **绑定表达式**（闭包体经 `closure_capture`、for-in 迭代器绑定、if/match 绑定器）。**不为任意表达式建 scope**（否则每个二元子表达式都建节点，树爆炸）。
- **#3 工程化升级 → 从"现在就建图"降级为"数据模型可扩展"**。侧表保留 `parent`+`owner`(+`kind`)，未来可加 `ScopeEdge`；但**现在不建图机械、不做增量脏传播、不做 IDE 持久化**。无当下消费者即不投入。
- **#4 编译时/运行时分离 → 相位挂在符号上，不拆 scope**。保留唯一词法树；仅 CTFE 需要处给符号加 `phase`(runtime/comptime/both)（已有 `is_comptime`/`closure_capture` 雏形可复用）。CTFE 在唯一词法树里走 comptime 子树求值。按相位拆 scope 会复制词法相同的 scope、引发不一致解析，故不做。

#### 核心技术模型（工作 A 范围）
```c
pub var g_scopes:     []Scope;     // Scope{ id, parent, owner(块节点 id), kind(1=fn/2=block/3=expr) }
pub var g_node_scope: []i64;       // 与 nodes 平行：节点→所属 scope id（默认 -1）
pub fn node_scope(id: i64) i64 {...}
pub fn node_set_scope(id: i64, s: i64) void {...}
// build_scope_tree()：在发射期对每个 g_seen_push 站点对应的 AST 块节点建一个 parent=当前scope 的子作用域，
//   owner=该块节点；var_decl 落入当前作用域并 node_set_scope(var_decl, scope.id)。
// mangle 决策（替代 g_seen_has+g_seen_add）：取 s=node_scope(sid)，扫 s.decls（同作用域、排除自身）
//   若有同名 n.sa 且非 conpat 绑定 → cname=name__sid，记 g_local_decls。独立块永不比较 → 与 g_seen 哨兵隔离逐字节一致。
```
- 经 `sidetable_register("node_scope", "S3")` 登记（第 6 张侧表，与 `node_mod` 正交互补）。

#### 等价性证明协议（消除"高风险"）
- **阶段 0**：加 `g_node_scope`+`build_scope_tree`，`g_seen` **双跑**，对每个 `var_decl` dump `(fn, scope_owner, name, mangled?)` 与 `g_seen` 版对比，`run_examples --all` 断言全相等。**零行为变化**。
- **阶段 1**：证明相等后，codegen_c 切读 `node_scope`，删 `g_seen_*`（原 S3-step5）。重跑 gate L2 + 基线（行为不变 → IR 变化=0）。
- **阶段 2（收口）**：删 `g_seen` 相关全局，`node_scope` 验收闭合 → S3 全部完成 → 进 S4（消费方切 `u64 NodeRef`）。
- 每阶段 gate L2 + 基线 0 变化 + 提交推 main。

#### 与工作 B 的边界（防范围蔓延）
- 工作 A 不动 `sym_define`/`sym_lookup`/`scope_parents`/`ll_mangle`。
- `conpat` 豁免：`g_conpat_bind_has` 是独立谓词，单独迁成 `node_conpat[]` 侧表（属 S3 剩余清单 `g_conpat_binds`），mangle 决策时跳过，**不塞进 `node_scope`**。
- 工作 B（sema 统一词法树、增量/IDE、相位 CTFE walker）列为**后续独立 epic**，本文档不展开实施，待真实需求触发。

---

### 0.15 路线偏离总账（2026-10-02 复核：§4.10.3 阶段表 ↔ 仓库实际实施对账）

> 目的：逐项对账「路线要求」与「实际提交序列」，对每处偏离给出**正确性证明**或**修正**。

**实际实施序列（git log，均已快进推送 main）**

```
S0   ec8400a / 4b63ced / e3aacf2   关键字表 + kind 迁入 std.rc.cst；.tlib 预编译实测暂缓
S1a  c5178ca                        kind 宇宙普查 + cstgen + 105 项 NK_*；base.tc 转重导出垫片
S1b  d573dbb                        上下文关键词下沉试点
S2   c264fbf / c6634b6 / 349bc50    NodeRef 双写 + SoA 分表 + 双后端自举不动点
S3   b78f9fd → 01d8b82 → 926e6f6 → a78d9ba → 1d6f431
     provenance / node_type / node_resolve / node_const / node_scope 五张侧表
S4   821c19b → a9c2970 → 72d461f → 2bea53f → 93eb234
     step1 g_node_nref 激活 → step② 访问器 → step③ mk_* → step④ HirInst.nd → 收口裁定
工作B a244377 → b91182f → 8e58623   支柱 1 step1/2/(3+4)
S6   4c38666 / ffac9e1             lower_policy[] 查表替换 6 硬编码分支 + g_desugar_passes 注册表收口（§0.16.1/0.16.2）
S7   88c8114 / 021eae8             PassManager 框架 + passes_validate 全管线注册（§0.16.3/0.16.4）
S5   22dfefd                       step1：Span 结构 + node_span 侧表（纯加法，零行为；读方迁移留 step2，§0.16.5）
S8   e33ed23 / b47210c             step1：tc fmt trivia 感知再发射（忠实还原基础版）→ step2：规范化重排
                                   → step3：tc lint（HIR 结构化规则 + lint_smoke 门禁步）
                                   三步均在 base.Node 仍存在下落地，与 S4 epic 解耦（§0.15 偏离 6 合理）
```

**对账表**

| # | 路线要求 | 实际落地 | 判定 |
|---|---|---|---|
| 1 | S0 `.tlib` 预编译库模块 | 暂缓（`build_std.mjs` 只做点分路径预留） | ✅ **非偏离** —— §4.14.7.1 实测两个硬阻点，§4.10.3 S0 行已内化该暂缓 |
| 2 | S1 是否新增 `Node.tag` | 延后到 S2/S4 | ✅ **非偏离** —— §0.10.3 已裁定并同步修正 §4.10.3 措辞 |
| 3 | S3「删 `Node.td` **与全局平行数组**」 | 删了 `Node.td`/`g_idecl_*`/`g_seen`；**`g_local_decls`+`g_conpat_binds` 仍在**（base.tc:1893/1952，被 `codegen_c.tc` 使用） | ⚠ **未闭合** ⇒ S3 亦应记为 **partial** |
| 4 | S4 四项（访问者 / 删 `base.Node` 字段 / 删 re-export 垫片 / `node_to_hir` 桥切 NodeRef） | 只交付「消费方切 `u64 NodeRef`」类型层 | ⚠ **偏离（partial）** —— 论证见 §0.14.6（方案 A），**硬前置已顺延，见 §0.14.6 末** |
| 5 | 工作 B「**待真实消费者触发** + 另立 sign-off」（§0.13.9） | 由**用户裁定**启动（`work-b-design.md` 第 4 行自述） | ⚠ **偏离** —— 证明与边界见下 |
| 6 | S8 依赖 S4 硬前置（删 `base.Node` 字段 + 删 re-export 垫片，§4.14.6 / §0.14.6） | S8 step1 `tc fmt` 在 **`base.Node` 仍存在** 下落地（§0.16.11，gate L2 24/0） | ⚠ **偏离（合理）** —— S8 fmt 在 G7 架构下只消费 CST + trivia，不依赖不可变 AST / 删 Node；证明见下 |

**偏离 5（工作 B 启动门槛）的证明与边界**

- **事实**：门槛确被绕过——触发条件是「用户裁定」，而非 §0.13.9 要求的「真实消费者（IDE / 增量编译）出现」。
- **正确性证明（为何可接受）**：实际落地被严格约束在**零行为变化子集**内。支柱 1 step1–4 仅为 ①`scope_owner` 数据模型扩展、②`scope_new_at` 把语义作用域锚定到 CST 节点、③`verify_scope_tree`（调试标志默认关闭）。门禁事实（如实记录，勿夸写）：**step1 / step2 各自跑满完整 gate L2 = 24 passed / 0 failed**；**step3+4 未跑满 24 步**——其 gate 首跑在「产物快照比对」报 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE）后 fail-fast 中止，前置 8 步（工具链/诊断/CST 清单/静态检查/预编译 std/自举一代/IR 审计/LLVM verifier）全绿；`--update` 重录基线后复跑只读快照 = **354 份产物逐字节相同（0 DIFF）**。因 `src` 未再变更，其余步骤沿用既有绿灯。而 §0.13.9 真正设防的对象——**「解析器重构」（`sym_lookup` 上溯从 `scope_parents` 链迁到 `node_scope` 树）**——即支柱 1 **step5，已 DEFERRED，未执行**。换言之：启动的是窄化到零风险的地基基建，被门槛保护的部分一根未碰。
- **边界约束（继续有效，不因本次启动而解除）**：**step5 及支柱 2/3 仍受 §0.13.9「真实消费者触发」门槛约束**；在 IDE / 增量编译出现明确需求前，不得推进 step5。

**偏离 4 的处置**：已在 §0.14.6 论证（方案 A）+ 本轮补记「S4 = PARTIAL」与「删 Node/删垫片必须在 **S8 之前**完成」的硬前置，防止该项随 S4 标"完成"而丢失。

**偏离 6 的处置（S8 与 S4 epic 解耦）**：原 §4.14.6 / §4.10.3 把「删 `base.Node` 字段 + 删 re-export 垫片」列为 S8 的硬前置。本轮在 **`base.Node` 仍存在** 下落地 S8 step1 `tc fmt`（§0.16.11），理由与证明：
- **架构解耦**：G7 架构下 `fmt` 只消费 CST + trivia（`cst_format_tokens` 归并 `toks` 与 `g_trivia_toks`），不读取 `base.Node` 载荷、不依赖不可变 AST、不需要删 Node。故 S8 step1 与 S4 收口 epic（§0.14.7）**无硬依赖关系**。
- **零语义改动**：本步仅在 lexer 加 `Tok.src` 字段（含引号/转义的逐字节源文本）+ 收紧 `tokenize` 为 append-only 契约（修 f-string 重 tokenize 越界）+ 新增 `cst_format_tokens`/`fmt` 子命令。`Tok.v` 语义值不变 ⇒ parser/codegen 行为完全不变。
- **正确性证明**：IR 快照 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE）**——纯自编译表示漂移，用户程序 IR 中性；**gate L2 = 24 passed / 0 failed**（四代不动点 `g2==g3==g4` / conformance / 双后端 / C 自举 / rls / tote 全绿）；`examples/*.tc` 全部 115 个 `tc fmt` 输出与源逐字节一致（SMOKE_FAIL=0）。
- **边界约束（继续有效）**：偏离 6 **不解除** S4 epic 的硬前置地位——S8 后续若需要基于节点的 AST 重写（如 step2 规范化重排若改走 HIR 侧表），仍可能触及 `base.Node` 载荷；届时按 §0.14.6 既定方案收口。但当前 step1/step2（纯词法/结构重排）均不依赖删 Node，S8 与 S4 epic 可并行推进，互不阻塞。

**已修正的文档错误（本轮）**

1. §0.14.6 曾断言 `g_local_decls`/`g_conpat_binds→node_conpat`「**故该项实际已闭合**」——**与代码矛盾，已撤回**；改为如实标注未闭合（见 §0.14.6 更正段与 §0.14.5 第 4b 项）。
2. §0.14.4 末仍写「**commit**：待 gate L2 全绿后提交」——实际已提交 `2bea53f` 并推送，已更新。
3. §0.14.5 第 4 项原把「访问器退役 / conpat 侧表化 / 打包 NodeRef」三事混为一条导致状态误读，已拆为 4a/4b/4c 分别标注。

**关键路径现状与下一步建议**

- 已完成：`S0 → S1 → S2 → S3(partial) → S4(partial,SoA epic 启动 pilot se) → S6 → S7 → S5(step1–5) → S8 step1(tc fmt 忠实还原) → S8 step2(规范化重排) → S8 step3(tc lint)`（S6/S7 全绿 gate L2 24/0；S5 step1/2/3 见 §0.16.5–§0.16.7；S5 step4 `.ast` 序列化 + `tc dump-ast` 纯加法已 gate L2 24/0（§0.16.8）；S5 step5 trivia 侧表 + `assign_trivia` 已 gate L2 24/0（§0.16.9）；S8 step1 见 §0.16.11（gate L2 24/0）；step2 见 §0.16.12（gate L2 24/0，2909.2s）；step3 见 §0.16.13（gate L2 **25/0**：新增 `lint_smoke` 步，见 §0.16.13「门禁新增一步」）。
  - ⚠ **门禁步数变更**：step3 起 L2 由 24 步变 **25 步**（新增 `lint_smoke`）；后续引用「gate L2 24/0」处需按此更新。
- 进行中 / 尚未启动：
  - **S4 收口 epic（删 `base.Node` 字段 = 节点载荷 SoA 外置）**：用户 2026-10-02 裁定**启动**，采用 staged bootstrap（§0.14.7）。Pilot `se` 已完成（`tc check` 0 err + g1 自举 + c_interop `@c_export` 运行验证 + IR 快照 0 NEW/0 GONE）；剩余 ~23 字段按使用量升序逐组外置，每组独立验证，全部完成后删 `Node`+`nodes[]`。（本轮主线转向 S8 step1，epic 阶段性暂停，未废弃。）
  - **S8**（`@desugar`/`@pass` + fmt/lint）：**step1 `tc fmt` 忠实还原（§0.16.11）+ step2 规范化重排（§0.16.12）+ step3 `tc lint`（§0.16.13）均已落地并 gate L2 全绿**——三步都在 `base.Node` 仍存在下实现，与 S4 epic 解耦（§0.15 偏离 6 合理）：fmt 吃词法流 + trivia、lint 吃 HIR，都不碰 `Node` 载荷。剩余 `@desugar`/`@pass` 用户扩展原语**仍受 S4 硬前置约束**（§4.10.3：插件 API 不得同时暴露新旧两套节点表示），并另受 `ModuleRef` 不存在、LLVM 后端不支持结构体字段 fn 值调用两项阻塞。S5 已在 S8 前完成（step1–5 全绿），trivia 注释保留前提就绪。
  - 工作 B 支柱 1 step5 + 支柱 2/3：仍受 §0.13.9「真实消费者触发」门槛约束（DEFERRED）。
- 当前主线位置：**S8 step1 `tc fmt` 已收口（§0.16.11，gate L2 24/0）；S4 收口 epic 阶段性暂停于 pilot `se`（§0.14.7），可随时接续**；S5 已收口。
- ⚠ **路线一致性**：S6→S7→S5 严格沿 §4.10.3 阶段表推进（S4 之后 S6，并可并行 S5），无偏离；S4 收口 epic 是 §0.14.6 已裁定 deferred 项在当前 S8 临近下的重启，属「保持偏离合理性」框架内的合理推进，非新偏离。

---

### 0.16 S6 实施记录（lower_policy 降级策略表 + SAST + DesugarPass）

> S6 范围（§4.10.3 / §4.11）：① 引入 `lower_policy[]`（cstgen 生成）；② `hir.tc` 硬编码「不透明 BLOCK」分支改查表；③ 引入 SAST 渐进降级层（§4.11.4）；④ 脱糖函数收口为 `g_desugar_passes`（按 `order`），`sema` 驱动遍历。按最小可验证增量推进。**本轮只做 ①+②**，③④ 留后续步。

#### 0.16.1 step1：`lower_policy[]` 引入 + 6 个硬编码分支改查表

**改动（3 处）**

1. `tools/cst_kinds.json`：新增 `lower_policy_opaque` 白名单（**9 个** kind）
   —— `block_expr` / `while` / `for` / `for_each` / `unit_lit` / `bitstr` / `bitstr_pat` / `import_expr` / `variant_lit`。
2. `tools/cstgen.mjs`：KINDS 生成段追加 `LOWER_DIRECT/LOWER_EXPAND/LOWER_OPAQUE` 常量、
   `pub var lower_policy: [105]i64`（默认 `LOWER_DIRECT`，白名单置 `LOWER_OPAQUE`）、
   `pub fn lower_policy_of(k: string) i64`；并对白名单做「未知 kind」校验（不在 registry/universe 即 exit 2）。
3. `src/hir.tc`：`hir_lower_expr` 内原 6 个硬编码 `else if (k == "...")` 分支（721–766）
   合并为**单个查表分支** `base.lower_policy_of(k) == base.LOWER_OPAQUE`，
   置于**原位置**（前置分支顺序一字不动）。原 6 段注释的关键坑已合并保留。

**等价性论证（决定性，三层）**

- **L1 返回一致**：原 6 个分支的 return **完全相同** —— 都是
  `return hir_emit(HIR_OP_BLOCK, -1, n, [], "", "", nd.ln);`。
- **L2 无前置遮蔽**：grep 验证这 9 个 kind 在 721 行**之前**的前置分支中**无一匹配**
  （`while/for/for_each` 另有 512/524/530 三处判断，但在**另一个函数**，不属 `hir_lower_expr` 链）。
- **L3 位置不变**：合并分支仍落在「前置分支之后、`else` RAW 逃生舱之前」，
  故命中集合与逃逸集合均与原状逐点相同 ⇒ **行为逐字节等价**。

**关键事实（备查，勿踩）**

- 目标 9 个 kind 中只有 `while`(85) / `for`(46) / `for_each`(47) 在 registry（86 项），
  其余 6 个**只在 universe**；但 cstgen 的 `NK_*` 常量覆盖 registry+universe，故**全部存在**
  （`g_nkn_count = 105`）。不要因为「不在 registry」就误判常量缺失。
- `hir.tc` 是**模块值导入** `const base = @import("src.base")`，故必须写
  `base.lower_policy_of` / `base.LOWER_OPAQUE`；`base.tc` 的 `pub @import("std.rc.cst" :: *)`
  重导出使二者可解析（与 `base.init_node_kinds()` 同理）。
- `nk_of_kind` 是 **O(105) 线性扫描**（t 无字符串序比较，无法二分）。查表分支放在原位置，
  仅「前置分支全未命中」的节点才付这次扫描，与原字符串链量级相当；未做前置快路径优化（留待性能需要时）。
- 静态定长数组初始化器用**数字字面量**（`0`/`2`）而非常量名，规避初始化器引用常量的潜在限制。

**⚠ 踩坑（本次，务必记取）**

- 用 Edit 工具替换 46 行大块时，因手工复制正文多敲一个空格（`"C  backend"`）导致精确匹配失败。
  **改用 Python 按行号精确替换**（`lines[720:766] = [...]`，二进制 `rb/wb` 读写以保行尾）。
  ⚠ 此法**仅对无 GEN 生成区的文件可用** —— `hir.tc` 无 GEN 区故安全；
  `base.tc`（GEN:node-structs）与 `lib/std/rc/cst.tc`（GEN:kinds）**绝不可**如此改（会污染生成区触发 `cstgen --check` 红灯）。

**验证（step1 门禁结果）**

- `tc check src/tc.tc`：**0 errors / 510 warnings**（预存 style warning 数一致）⇒ `base.lower_policy_of` / `base.LOWER_OPAQUE` 解析成功。
- `cstgen --check` 绿灯（kinds 105 / node-structs 91）；产物表实测 9 个 OPAQUE 全部落在预期 `NK_*` 下标。
- **gate L2（完整复跑）= 24 passed / 0 failed（2050.1s）**：自举一代、LLVM verifier、产物快照、
  conformance 诊断、**自举四代不动点 `g2==g3==g4`**、run_examples 双后端、
  **HIR AstGen 验证（emit-hir + 二进制往返）**、HIR 解释器、双轨对拍、MIR differential、
  C 后端自举、difftest tc0 外部对拍、rls 快速通道、tote 冒烟 —— 全绿。
- 首跑快照曾报 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW / 0 GONE）** ⇒ 新增 `lower_policy`
  全局数组 + `lower_policy_of` 致自编译表示变化（与 S3/S4 各步同型良性漂移，其余 351 份目标
  逐字节不变证明行为等价）；`--update` 重录基线后复跑只读快照 = **354 份逐字节相同**，完整 gate 24/0。
- 同步：`out/dbg/tc.exe ← g4`、`out/rls/tc.exe ← gr`。

#### 0.16.2 step2：`g_desugar_passes` 注册表收口（§4.11.3 第一刀）

> 注：§4.11.3 的「SAST 渐进降级层（§4.11.4）」与「节点级 `run: fn(NodeRef) NodeRef` 统一」
> 属同一延期类（见本步「偏离与边界」），本轮**只收口模块级脱糖为有序注册表**。

**改动（仅 `src/sema.tc`）**

1. 新增 `DesugarPass` 结构体（`name: string` / `order: i64` / `raw_impact: i64` —— **不含 fn 类型字段**，原因见关键事实）、
   `g_desugar_passes: []DesugarPass`、`register_desugar(p)`、`desugar_run_range(lo, hi)`（跑 `(lo, hi]` 区间、
   order 升序、由调用方切分区间避免重跑）。
2. `desugar_init()`：重置 `g_desugar_passes = []` 并注册 **4 个模块级脱糖 Pass**，顺序与 run_check
   原硬编码一致 —— `func_clauses`(1) < `lambdas`(2) < `array_len_infer`(3) < `imports`(4)。
3. `run_check` 两处调用点改写：
   - `resolve_modules/mangle_modules` 之后、register 之前：`parse__desugar_func_clauses()` +
     `parse__desugar_lambdas()` + `lower_array_len_infer()` 三连 → **`desugar_run_range(-1, 3)`**；
   - register 之后、`mark_call_callees()` 之前：`desugar_imports()` → **`desugar_run_range(3, 4)`**。
   - `g_vl_checked = []` 仍保留（现置于 range 调用之后、register 之前；`lower_array_len_infer`
     不读该标志、value_loop 在更晚的 check 期才用，位置变化无行为影响）。

**等价性论证（决定性）**

- 4 个脱糖函数的**身份、相对顺序、与 register / mb_pass / meta_pass 的交错位置**原样保留：
  range(-1,3) 覆盖 1/2/3，range(3,4) 覆盖 4，**无重跑、无漏跑**。
- 分派用 `order` 直查（`desugar_run_range` 内 `if p.order==1/2/3/4` 调对应函数），不把 fn 值存结构体字段
  （t 的 LLVM 后端不支持该调用形态，见关键事实）；被调函数即原 4 个脱糖函数，**调用语义与原 `f()` 完全相同**。
- `desugar_init()` 在 `run_check` 首行重置列表 ⇒ 多次 `run_check`（测试进程内重入）状态干净。

**关键事实（备查，勿踩）**

- **t 语言：`{ field: value }` struct 字面量语法解析器不支持**（实测 `T_PARSE_SYNTAX`）；
  结构体一律 `var x: T; x.f = v;` 逐字段赋值（与 `hir.tc::hir_emit` 同范式）。注册表构造须用后者。
- **`fn` 类型可作变量并调用（C/LLVM 双后端均通过）**，但**存进结构体字段后通过字段调用在 LLVM 后端失败**：
  自举 gen-1 报 `call void @sema___desugar_thunk_func_clauses()` → \"1 error generated\"（TClosure env 在
  结构体字段取值路径上未正确 setup 签名）。故注册表**不把 fn 值存结构体字段**，改为 `order` 直查分派。
  （`{field:value}` struct 字面量本身也不被解析器支持，须 `var x:T; x.f=v;` 逐字段赋值。）
- 仅收口**模块作用域**的 4 个脱糖入口；**逐节点**脱糖（`desugar_value_loop` / `lower_for_range` /
  `lower_for_array` / `desugar_format_call` / `lower_pipe` / `lower_range_index` / `lower_in_range`）
  仍在 infer 期就地调用 —— 它们统一为节点级签名须先有**不可变 AST 改写基础设施**（当前无），属 DEFERRED。

**偏离与边界（与 §4.11.3 原文的差异，已论证成立）**

- §4.11.3 设计 `run: fn(NodeRef) NodeRef` + 「节点级改写、不原地改入参（G2）」。当前实现保留
  `run: fn() void` + 原地改写 CST —— 因为整条脱糖管线**依赖原地改写**（sema 遍历 CST 时节点就地脱糖），
  改节点级需先建「克隆节点 / 替换子节点」基础设施，工作量与风险同 S4「删 `base.Node`」。
  与 S4 同理**延期**，且门禁真正设防的「注册表驱动 + 正向断言」已落地；未被削弱的部分一根未动。
- SAST（§4.11.4）是**瞬态中间层**，无独立数据结构：本步的 `g_desugar_passes` 按 order 渐进跑
  即实现「CST →（pass1）→ 中间态 →（pass2）→ core」；当前 4 个 pass 全部为一次性 module-level，
  中间态仅在单趟内存在，符合「不得固化成第二种 AST」约束。

**验证（step2 门禁结果）**

- `tc check src/tc.tc`：**0 errors / 510 warnings**（与基线一致）。
- **首跑 gate L2 FAIL（任务 `KfniUu`，125.6s）**：自举一代（LLVM/clang）报
  `call void @sema___desugar_thunk_func_clauses()` → "1 error generated"。**根因**：初版把
  `fn() void` 存进 `DesugarPass.run` 结构体字段、经 `p.run()` 调用，t 的 LLVM 后端不支持该形态
  （TClosure env 在结构体字段取值路径上未正确 setup）。**修复**：去掉 `run` 字段与 thunk，
  `desugar_run_range` 改用 `order` 直查分派（仍 4 函数、同顺序、同交错），行为等价；重跑 `tc check` 0 error。
- 复跑 gate L2 = **24 passed / 0 failed（2728.6s）**：自举一代、IR 静态审计、LLVM IR verifier、
  conformance、**自举四代不动点 `g2==g3==g4`**、run_examples 双后端、**HIR AstGen 验证（emit-hir +
  二进制往返）**、HIR 解释器、difftest g2↔g3、LLVM↔TIR 对拍、REPL 冒烟、MIR differential、
  C 后端自举、difftest tc0、rls 快速通道、tote 冒烟 —— 全绿。
- 首跑快照曾报 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW / 0 GONE）** ⇒ 新增 `g_desugar_passes` /
  `desugar_*` 全局符号致自编译表示变化（与 S3/S4/work-b/step1 同型良性漂移）；`--update` 重录基线后
  复跑只读快照 = **354 份逐字节相同**，完整 gate 24/0。
- 同步：`out/dbg/tc.exe ← g4`、`out/rls/tc.exe ← gr`。

#### 0.16.3 step3（S7 启动）：`Pass`/`PassManager` 框架 + 统一执行入口

> S7（§4.12）起步。当前 step1 **仅建立数据模型 + 统一执行入口**（`run_passes()` 按注册序分发），
> 行为等价于原 `run_check` 硬编码序列；拓扑排序 / 依赖失效（§4.12.3）留 step2。

**改动（仅 `src/sema.tc`）**

1. 新增 `Pass` 结构体（`name: string` / `stage: i64` / `kind: i64`）、`g_passes`、`register_pass`、
   `passes_init()`（注册 `mark_call_callees`(ANALYSIS) → `mb_pass`(TRANSFORM) → `meta_pass`(TRANSFORM)，
   顺序同原硬编码）、`run_passes()`（遍历 `g_passes`、按 `name` 直接分发到真实处理函数）。
2. `run_check` 内 `mark_call_callees(); mb_pass(); meta_pass();` 三连 → `passes_init(); run_passes();`。
   `comptime_fold_pass` / `flag_pass` / `ann_pass` 由 `src/tc.tc` 驱动在 `run_check` 之外调用，暂不入
   `run_passes()`（避免改动顶层管线结构），step2 一并纳入统一调度。

**等价性论证（决定性）**

- `run_passes()` 按**注册序**遍历，注册序 = 原硬编码序（`mark_call_callees` → `mb_pass` → `meta_pass`），
  且 `run_check` 内 `desugar_run_range(3,4)` 与 `passes_init()/run_passes()` 的相对位置、其后 `hir.hir_build`
  重建与 `check_decl_hir` 循环**一字未动** ⇒ 执行序列逐点相同 ⇒ 行为等价。
- 顺序约束（Phase D / Phase B）以注释固化进 `run_passes()`：mb_pass 须先于 check_decl（先折 `@type_*`），
  meta_pass 须紧随 mb_pass、且在 check_decl 之前（CTFE 折叠后 checker 见普通字面量）。

**关键事实（备查，勿踩）**

- **`Pass` 不存 `run: fn() void` 字段**：t 的 LLVM 后端不支持「调用存于结构体字段的 fn 值」
  （与脱糖注册表 `DesugarPass` 同坑，S6 step2 已踩）。故统一用 `name` 字符串直接分发，不存函数指针。
- `ModuleRef` 当前不存在，`Pass` 设计签名 `fn(mod: ModuleRef) void`（§4.12.2）暂以「模块级 `fn() void`、
  直接操作全局状态」等价实现（与 `run_check` 原调用一致）；待 `ModuleRef` 落地再升级。
- 仅收口 `run_check` 内的 3 个 Pass；`comptime_fold_pass`/`flag_pass`/`ann_pass` 仍在 `src/tc.tc` 驱动层调用。

**偏离与边界（与 §4.12 原文差异，已论证成立）**

- §4.12.2 `Pass` 含 `owns`/`requires`（`[]Sym32("Table")`）+ 拓扑排序 + 失效；当前 step1 **未含**
  `requires`/`owns`（无真实跨 Pass 侧表依赖需编码，且 `Sym32` 为文档伪码、真实侧表名为 `string`）。
  step2 已引入 `requires: []string` + `passes_validate()`（拓扑无环 + requires 可满足，§4.12.5「门禁即报」）。
  ⚠ `owns`（侧表失效）步因 `ModuleRef` 不存在而**仍 DEFERRED**——当前无真实消费方触发，留待 S7 后续或 S8。
- §4.12.4 要求门禁增 `g_passes` 拓扑断言 —— 随 step2 的 `passes_validate()` 落地（由 `g_verify_passes`
  调试开关在 `run_check` 末受控触发，默认关闭、零行为）。

**验证（step1 门禁结果）**

- `tc check src/tc.tc`：**0 errors / 510 warnings**（与基线一致）。
- gate L2：**24 passed / 0 failed（1706.6s）**——含自举四代不动点 `g2==g3==g4`、run_examples 双后端、
  HIR AstGen 验证（emit-hir + 二进制往返）、LLVM↔TIR 双轨对拍、C 后端自举、rls 快速通道全绿。
- 首跑快照 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE，新增全局符号致良性自编译表示漂移），
  `--update` 重录基线后复跑 **354 份逐字节相同** ⇒ 完整 gate 24/0。

#### §0.16.4 S7 step2（Pass 依赖拓扑 + 全管线注册）✅ `88c8114` 之后、`TBR` 前

**改动（`src/sema.tc`）**
- `Pass` 扩展 `requires: []string`（依赖前置 Pass）+ `auto_run: bool`（是否由 `run_passes` 自动调度）。
- `passes_init()` 注册**全部 6 个真实处理节点**，构成完整管线图：
  - `run_check` 内自动调度（`auto_run=true`）：`mark_call_callees → mb_pass → meta_pass`（requires 链逐级依赖）。
  - `run_check` 外由 `src/tc.tc` 显式调度（`auto_run=false`）：`comptime_fold_pass → flag_pass → ann_pass`（requires 链）。
- `run_passes()` 仅调度 `auto_run==true` 的 Pass（三趟，与原硬编码逐点相同）；`comptime_fold_pass` 等
  仍由 `src/tc.tc` 调用，**行为一字未变**（未改动顶层管线结构与双后端发射）。
- 新增 `passes_find` / `passes_has` / `passes_validate`（① 无重复 name ② 所有 requires 目标已注册
  ③ 依赖图无环，步数计数器判环）/ `passes_reach_depth`（递归深度 > n 即环）。
- `g_verify_passes` 调试开关（`run_check` 末受控触发，默认关闭、零行为）；与 `g_verify_scope_tree` 同构。

**等价性（为何零行为变化）**
- `run_passes` 仍只跑 `auto_run=true` 的三趟、`name` 直查分发，与原 `mark_call_callees(); mb_pass(); meta_pass();`
  顺序/调用逐点相同；`comptime_fold_pass`/`flag_pass`/`ann_pass` 调用点未从 `src/tc.tc` 移除。
- `passes_validate` 仅在 `g_verify_passes=true` 时跑，正常编译完全不触达 ⇒ 零行为。

**验证（step2 门禁结果）**
- `tc check src/tc.tc`：**0 errors / 515 warnings**（较 step1 基线 +5，来自新增 `requires`/`auto_run` 字段与校验函数，良性）。
- gate L2：**24 passed / 0 failed（1581.8s）**——含自举四代不动点 `g2==g3==g4`、run_examples 双后端、
  HIR AstGen 验证（emit-hir + 二进制往返）、LLVM↔TIR 双轨对拍、C 后端自举、rls 快速通道全绿。
- 首跑快照 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE，新增全局符号致良性自编译表示漂移），
  `--update` 重录基线后复跑 **354 份逐字节相同** ⇒ 完整 gate 24/0。

#### §0.16.5 S5 step1（Span 结构 + node_span 侧表，纯加法）✅ 已落地（`22dfefd`，gate `24/0`）

**改动（`src/base.tc`）**
- 新增 `pub struct Span { line, col, end_col: u64 }`（§4.8 结构化源码区间，取代 `ln/cl/tv` 三字段）。
- 新增 `g_node_span: []Span` 平行侧表 + `node_span(n)` / `node_set_span(n, s)` 访问器（沿用 S3 侧表范式，
  经 `nr_idx` 取裸索引；越界返回零 Span）。
- `sidetable_init()` 登记 `"node_span"`（owner=`S5`）。
- `node_new`：`append(g_node_span, Span{0,0,0})`（与 `ln/cl/tv` 零初始化锁步）。
- `node_at`：绑定 token 时同步 `node_set_span(ni, Span{ line:tk.line, col:tk.col, end_col:tk.col+str_len(tk.v) })`。
- **保留 `ln/cl/tv` 作本阶段活源**，侧表暂无任何读取方 ⇒ **零行为变化**。

**等价性（关键）**
- 仅新增一个与 `nodes[]` 平行的全局数组并锁步填充；`ln/cl/tv` 的读写路径一字未动，诊断/发射行号来源不变。
- `g_node_span` 当前无人读取，IR 发射完全不触达 ⇒ 自举不动点 `g2==g3==g4` 必保持。

**验证（step1 门禁结果）**
- `tc check src/tc.tc`：**0 errors / 515 warnings**（与 S7 step2 基线一致）。
- gate L2：**24 passed / 0 failed（1535.2s）**——含自举四代不动点 `g2==g3==g4`、run_examples 双后端、
  HIR AstGen 验证、LLVM↔TIR 双轨对拍、C 后端自举、rls 快速通道全绿。
- 首跑快照 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE，新增 `g_node_span` 全局符号致良性自编译表示漂移），
  `--update` 重录基线后复跑 **354 份逐字节相同** ⇒ 完整 gate 24/0。

#### §0.16.6 S5 step2（读方迁 `node_span_id`，跨 4 文件 ~120 处）✅ 已落地并验证（gate L2 24/0，commit `e339703`）

> 范围（§4.10.3 / §4.8）：把 `ln/cl/tv` 全部读方与「克隆/合成节点抄锚点」的写方，从 `Node` 字段切换到
> `node_span` 侧表（`node_span_id(idx)` / `node_set_span_id(idx, s)`），为 step3「删 `Node.ln/cl/tv` 字段」清场。

**根阻点与解法（关键决策）**
- `base.Node` 值**不携带自身 id**（§0.16.5 已确认 `Node` 无 `id` 字段），而 `node_span(n)` 以
> `NodeRef`（u64，tag|idx 打包）为键。逐点 `X.ln → node_span(<X 的 id>)` 需人工溯源每个 `X` 的 NodeRef，
> 跨 `hir/sema/parse/tir` 共 ~120 处、且多数为异构局部变量（`vn`/`pn`/`arm`/`en`/`f`/`m_an`/`n3`/`an`…），
> 盲目逐点改易错且每次错配需重跑整个 gate L2（~45min）才能被 conformance 诊断行号捕获。
- **解法：引入过渡字段 `Node.id: i64`（裸索引 == `nodes` 下标）**。则 `X.ln` 统一改写为
> `base.node_span_id(X.id).line`、`X.cl` → `.col`；克隆/合成抄锚点 `X.ln = Y.ln` 改写为
> `base.node_set_span_id(X.id, base.node_span_id(Y.id))`（一次写入整段 Span）。该字段与 `ln/cl/tv` 同属
> 「待退役」集合，**S4 epic 删 `base.Node` 时一并移除**（届时 `NodeRef` 即句柄，无需自存 id）。
- 新增 `node_span_id(idx: i64)` / `node_set_span_id(idx: i64, s)`（裸索引版），`node_span(n: u64)` 委托前者；
> `node_new` 在 `append(nodes, n)` 前写 `n.id = slice_len(nodes)`（即该节点下标）。

**改动（机械迁移，脚本 `tools/_s5migrate.py` 驱动）**
- 读方：`X.ln`/`X.cl` → `base.node_span_id(X.id).line`/`.col`；`base.nodes[IDX].ln/.cl` → `base.node_span_id(IDX).line/.col`。
- 写方（克隆/合成抄锚点，~11 处）：`X.ln = Y.ln` 等三连 → 单次 `base.node_set_span_id(X.id, base.node_span_id(Y.id))`
  （幂等，三连退化为同一条调用，无害）。
- `tv` 读取仅 1 处（sema `desugar_module_path` 算 `end_col`）：`str_len(n3.tv)` → `end_col - col`，等价于原 `col + len(tv)`。

**等价性（决定性）**
- 自编译表示：仅 `Node` 增一个 `id: i64` 字段 + 新增 `node_span_id`/`node_set_span_id` 两个全局符号 ⇒ 首跑快照必现
> 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE），与历次 S 步同型良性漂移。
- 运行期语义：`node_at` 仍按 `tk.line/col` 锁步填 `ln/cl/tv` 与 `node_span`（step1 已落地）；克隆/合成节点
> 抄锚点现在同步抄整段 Span ⇒ 任一节点 `node_span_id(idx)` 与其 `ln/cl/tv` **逐字节相等**。读方切换后诊断行号不变
> ⇒ conformance / run_examples 双后端对拍必保持。

**验证（gate L2 24/0 全绿）**
- `tc check src/tc.tc`：**0 errors / 515 warnings**（与 S5 step1 基线一致，无新增 warning/error）。
- 首跑快照 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE）** ⇒ 良性自编译表示漂移（新增 `Node.id` 字段 + `node_span_id`/`node_set_span_id` 两个全局符号），符合 §0.16.5 同型预测。
- `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录基线（117 targets / 354 entries）后复跑 gate L2：**24 passed / 0 failed（1666s）**，含自举四代不动点 `g2==g3==g4`、conformance、run_examples 双后端、C 后端自举、双轨对拍、rls 快速通道全绿。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`（种子编译器升到当前不动点）。

#### §0.16.7 S5 step3（删 `Node.ln/cl/tv` 字段，Span 成唯一区间载体）✅ 已落地并验证（gate L2 24/0，commit `5184382`）

> 范围（§4.10.3 / §4.8）：step2 把全部读方迁到 `node_span_id(X.id)` 后，`Node.ln/cl/tv` 成死字段，本步删除。

**改动（纯删死字段，零读方依赖）**
- `base.Node` 删除 `ln: u64` / `cl: u64` / `tv: string` 三字段（保留过渡字段 `id: i64`，待 S4 epic 删 Node 时移除）。
- `node_new`：删 `n.ln = 0; n.cl = 0; n.tv = "";` 三行零初始化（侧表零区间 `append(g_node_span, Span{0,0,0})` 保留）。
- `node_at`：删 `var n: Node = nodes[ni]; n.ln = tk.line; ...; slice_set(nodes, ni, n);` 整段（读改写节点值再写回，删字段后变空操作），仅留 `node_set_span((ni as u64), Span{...})` 写侧表。
- 注释：§4.8 区间说明与 `node_span` 侧表说明更新为「step3 起 `ln/cl/tv` 已删，Span 为唯一区间载体」。

**等价性（决定性）**
- 删字段前：`node_at` 同时写 `n.ln/cl/tv` 与 `node_set_span`；删字段后只写 `node_set_span`。两路在删前**锁步相等**（node_at 同源 tk.line/col、end_col=col+len(tv)），故任何节点 `g_node_span[idx]` 内容与删前 `ln/cl/tv` 逐字节一致。
- 读方（step2 已全切 `node_span_id(X.id)`）取 `g_node_span[X.id]`，与「取 `Node.ln/cl/tv`」逐字节相同 ⇒ 诊断行号/列不变。
- `node_new` 零区间 append 与删前 `n.ln=0` 零值对齐 ⇒ 未打 anchor 的节点 Span 仍为零区间，行为不变。
- 自编译表示：删三字段 + 删 node_new/node_at 共 7 行写 ⇒ 首跑快照必现 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE），同 §0.16.5/§0.16.6 良性漂移。

**验证（gate L2 24/0 全绿）**
- `tc check src/tc.tc`：**0 errors / 515 warnings**（与 S5 step2 基线一致，无新增 warning/error）。
- 首跑快照 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE）** ⇒ 良性自编译表示漂移（删三字段 + node_new/node_at 共 7 行写），与 §0.16.5/§0.16.6 同型。
- `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录基线（117 targets / 354 entries）后复跑 gate L2：**24 passed / 0 failed（2629.8s）**，含自举四代不动点 `g2==g3==g4`、conformance、run_examples 双后端、C 后端自举、双轨对拍、rls 快速通道全绿。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`（种子编译器升到当前不动点）。

#### §0.16.8 S5 step4（CST `.ast` 序列化 + `tc dump-ast`，纯加法）✅ 已落地并验证（gate L2 24/0，commit `c34a576`）

> 范围（§4.10.3 / §4.8 / §0.17）：S5 第四步 = CST `.ast` 序列化（供 IDE / 增量重编锚点 / `tc --format` 往返）。
> 本步交付**序列化（dump）能力 + `tc dump-ast` 子命令**；解析回填 / 往返一致性（parse-back）留待 S8 的 fmt / IDE 真实消费者出现时再接（属 §0.13.9「真实消费者触发」门槛内的合理偏离，见下方「偏离裁定」）。

**改动（纯加法，零编译行为变化）**
- `src/base.tc`：新增 `cst_to_ast_str(roots: []i64) string` + 递归 `cst_dump(role, id, depth)` + `cst_indent(depth)`，写入模块级 `g_cst_sb: StringBuilder`。
- 序列化协议：S-表达式风格文本，每行一个节点 `(role:kind id=N L行:列-终列 属性… 子节点…)`；
  - 名字子节点（`na/nb/nc/nd`）以 `role` 标注（如 `(na:scalar …)`），kids 池子节点（`la/lb/lc` 三条链）无 role；
  - 属性仅打印非空/非默认：`sa/sb/sc/se`（带引号）、`ia/ib`（≠-1）、`ba..bf`（为真）、`L行:列-终列`（来自 `node_span_id`，`line>0` 时）；
  - 模块根由调用方合成 `module`，子节点 = `lex.decl_list`（parse 后顶层声明列表）。
- `src/tc.tc`：新增 `dump-ast` 子命令（`tokenize → parse_unit → base.cst_to_ast_str(lex.decl_list)`，**不跑 sema**，与 `emit-hir` 同层但产出源忠实树而非 HIR；`--output` 落盘、否则打印）。
- `src/tote.tc`：把 `dump-ast` 加入转发列表（经 `find_tc` 委给核心 `tc`）。

**等价性 / 安全性**
- 遍历假定 CST 为树（无共享/环）：`na/nb/nc/nd` 与 kids 池指向互不相同的子节点，递归安全，无需 visited 集合。
- 仅读 `nodes`/`kids`/`node_span_id`，不触达任何发射路径；`dump-ast` 不被任何编译流程调用 ⇒ 普通编译（check/compile/examples）的 IR 不受影响。
- 自编译表示：新增 3 个全局符号（`cst_to_ast_str`/`cst_dump`/`cst_dump_chain` 等）+ `g_cst_sb`）⇒ 首跑快照必现 3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW/0 GONE），同历次 S 步良性漂移。

**手动验证（gate 不调用 `dump-ast`，故单独验证）**
- `out/dbg/g1.exe dump-ast out/_probe_ast.tc`：正确产出 `module` 根 + `FuncDecl/GlobalVarDecl/StructDecl` 子树，span 精确（`L1:4-7` 等），`na/nb/nc/nd` 与 kids 池子节点均出现、命名子节点带 role。
- `out/dbg/g1.exe dump-ast examples/fib.tc`（含 `if`/`while`/嵌套 `call`/`binary`）与 `examples/adt_list.tc`（含 `struct`/`match`）：无崩溃、无无限递归、结构正确 ⇒ 序列化对真实复杂树稳健。

**验证（gate L2 24/0 全绿）**
- `tc check src/tc.tc`：**0 errors / 515 warnings**（与 S5 step3 基线一致，无新增 warning/error）。
- 首跑快照 **5 DIFF（0 NEW / 0 GONE）**：`src/tc.tc::{c,h,ll}`（3）+ `src/tote.tc::{c,ll}`（2）。非例 3 是因 `base.tc` 新增 `cst_to_ast_str` 等函数经 `@import` 传播到 `tc.tc` 与 `tote.tc` 两个编译器模块，二者各增新符号 ⇒ 差异目标数比 step1–3 多；但 0 NEW/0 GONE 证明无函数删除、无示例 IR 变化，纯良性自编译表示漂移。
- `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录基线（117 targets / 354 entries）后复跑 gate L2：**24 passed / 0 failed（2477.8s）**，含自举四代不动点 `g2==g3==g4`、conformance、run_examples 双后端、HIR AstGen/comptime-eval、双轨对拍、difftest tc0、C 后端自举、rls 快速通道、tote 构建冒烟全绿。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`（种子编译器升到当前不动点）。
- `dump-ast` 单独验证（gate 不调用）：`g1.exe dump-ast examples/fib.tc`（含 if/while/嵌套 call/binary）与 `examples/adt_list.tc`（含 struct/match）均正确产出源忠实树、无崩溃/无限递归、span 精确。

**偏离裁定（保持合理）**
- S5 step4 在路线表（§4.10.3）列为「CST `.ast` 序列化」，验收写「IDE/格式化 smoke + `.ast` 往返一致」。本步**只交付 serialize（dump）不交付 parse-back 往返**，因为：
  1. parse-back 的真实驱动力是 `tc --format`（S8）与 IDE 增量重解析（工作 B），二者均尚未启动（§0.13.9 真实消费者门槛）；
  2. 当前交付的 `.ast` 文本是**确定性、源忠实、可机器读取**的序列化，已可作为 IDE 锚点 / 增量重编素材的直接输入（消费者只需读，不急需写回）；
  3. 补 parse-back 需改造解析器入口为「吃 `.ast` 而非吃 token 流」，属独立工作，提前做无当下收益且风险更高。
- 故本步是「序列化能力就位、往返留待消费者」的**分阶段合理偏离**，不破坏 §4.10.3 的 S5 完成判据（S5 在 S8 之前完成即可；S8 启动时再补 parse-back 并补齐 `.ast` 往返一致验收）。

#### §0.16.9 S5 step5（trivia span 间隙 leading/trailing 侧表 + `assign_trivia`）✅ 已落地并验证（gate L2 24/0，2026-10-02）

> 范围（§4.8 / §0.17）：S5 第五步 = trivia（注释/空白的 span 间隙），先于 S8 的 fmt/lint 注释保留。§4.8 裁定「先做 span 间隙（leading/trailing 指向源文本），不动 `node_visit`/`mk_*`、不增节点数」；本步在此裁定内落地。

**改动（纯加法，零编译行为变化）**
- `src/base.tc`：
  - 新增 `TriviaTok{ kind, text, line, col }` + 模块级 `g_trivia_toks: []TriviaTok`（lexer 在 `tokenize` 期逐段保留，按源序）；`kind ∈ {Ws, Newline, LineComment, BlockComment}`。
  - 新增 `Trivia{ leading: []u64, trailing: []u64 }` + 侧表 `g_node_trivia: []Trivia`（与 `nodes[]` 平行，`Trivia` 内两字段存 `g_trivia_toks` 下标列表）。
  - `node_new` 内 `append(g_node_trivia, Trivia{ leading: [], trailing: [] })`（与 `g_node_span` 等侧表对齐）。
  - 新增读方 `node_trivia(n: u64) Trivia`、写方 `assign_trivia() void`（Roslyn 式逐 token 独立归属：找 prev=位置严格 < T 的末节点 / next=位置严格 > T 的首节点；T 与 prev 同 line（无换行分隔）→ trailing of prev，否则 leading of next；仅纳入 `g_node_span.line>0` 的源码锚定节点）。
  - `cst_dump` 在节点标志后、子节点遍历前打印 `#<`(leading)/`#>`(trailing) trivia；新增 `cst_trivia_one(idx)`（转义 `\n`/`\t`/反斜杠/引号后打印 `kind[text]`）。
- `src/lex.tc`：`tokenize` 把原本 `continue` 丢弃的 4 类（空白/换行/行注释/块注释）改为 `append(base.g_trivia_toks, base.TriviaTok{…})`；开头 `base.g_trivia_toks = []` 每轮重置。实 token 流 `toks` 不变 ⇒ 解析/AST/发射零影响。
- `src/tc.tc`：`dump-ast` 子命令在 `parse.parse_unit()` 后插入 `base.assign_trivia()`，再 `cst_to_ast_str(lex.decl_list)`（仍不跑 sema）。
- `out/_probe_trivia.tc`：探针（文件前导注释 / 行尾注释 / 跨行块注释 / `// 调用` 同 line 尾注）。

**关键修复（崩溃根因）**
- `assign_trivia` 内 `var prev = -1` / `var next = -1` 被 t 推断为 `u8`（=255）；slice 下标对 `u8` 符号扩展成 `i64 -1`，致 `g_node_span[-1]` 越界崩溃（`index_out_of_bounds, index: -1`）。改为显式 `var prev: i64 = -1` / `var next: i64 = -1`，`>= 0` 哨兵判定恢复正确。

**等价性 / 安全性**
- trivia 侧表仅被 `dump-ast` 读，任何发射路径（`codegen_c`/`codegen_ll`/tir）均不触碰 ⇒ 普通编译（check/compile/examples）IR 不受影响。
- 自编译表示：新增 `TriviaTok`/`Trivia` 两类型 + `g_trivia_toks`/`g_node_trivia` 两全局 + `node_trivia`/`assign_trivia`/`cst_trivia_one` 三函数，经 `@import` 传播到 `tc.tc`；因 `assign_trivia` 仅被 `dump-ast`（`tc.tc` 命令分发）可达，对 examples/`tote.tc` 被树摇消除 ⇒ 首跑快照 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW / 0 GONE）**，同 step1–3 良性自编译表示漂移（比 step4 的 5 DIFF 少，因未触达 `tote.tc`）。

**手动验证（gate 不调用 `dump-ast`，故单独验证）**
- `out/dbg/g1.exe dump-ast out/_probe_trivia.tc`：无崩溃；`// 文件前导注释`→ `add` leading；`// 行尾注释`→ `add` trailing（同 line）；`// 计算`→ `b` ident trailing（同 line 末节点）；`// 调用`→ `2` 字面量 trailing（同 line 末节点，不再错归 `return` leading）；`/* 块注释 … */`（跨 line）→ `main` leading。归属符合 Roslyn 式。

**验证（gate L2 24/0 全绿）**
- `tc check src/tc.tc`：0 errors（warning 数随新符号微增，无新增 error）。
- 首跑快照 3 DIFF（0 NEW / 0 GONE）→ `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录基线（117 targets / 354 entries，updated 2026-10-02 10:25:54）后复跑 gate L2：**24 passed / 0 failed（2492.9s）**，含四代自举不动点 `g2==g3==g4`、conformance、run_examples 双后端、HIR AstGen/comptime-eval、双轨对拍、difftest tc0、C 后端自举、rls、tote 全绿。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`（种子升到当前不动点）。

**偏离裁定（保持合理）**
- §4.8 原写「字节范围指向源文本（不复制内容）」；本步用 `(line, col, text)` 等价表征——`text` 直接来自源文本（经 `str_slice` 取），未复制到每个节点，字节范围形式留作 S8 fmt 需要时升级为「存储源偏移区间、按需回查源文件」的紧凑形态。属 §4.8「局部扩展」裁定内的合理分阶段实现，未改变「不动 `node_visit`/`mk_*`、不增节点数、error node 留作未来可选」的约束。
- 归属采用 Roslyn 式（同 line→trailing of prev，跨 line→leading of next；文件前导→首节点 leading，文件尾部→末节点 trailing），未引入 green/red 不可变树或 error node——后者仍按 §4.8 留作未来（IDE 增量重解析真实消费者出现时再接）。

---

#### §0.16.11 S8 step1（`tc fmt` 的 trivia 感知再发射：忠实还原基础版）✅ 已落地（2026-10-02）

> 范围（§4.1 G7 / §0.17）：S8 首步 = `tc fmt` 的源码再发射基础能力——把词法 token 流（`toks`，每个 token 的精确源文本）与 trivia 流（`g_trivia_toks`，空白/换行/注释的精确文本）按 `(line,col)` 双指针归并，还原出与源**逐字符一致**的重排文本。当前为「忠实还原」基础版（不重排，仅还原）。**step2（规范化重排）已落地，见 §0.16.12** —— CLI 默认走规范化重排，`--identity` 保留本步忠实还原。
> **偏离裁定（保持合理）**：原路线 S8 的硬前置是「删 `base.Node` 字段 + 删 re-export 垫片」（§4.14.6 / §0.14.6）。本步在 **`base.Node` 仍存在** 下落地——G7 架构下 `fmt` 只消费 CST + trivia，**不依赖不可变 AST / 删 Node**，故 S8 step1 与 S4 收口 epic **解耦**。证明：本步零语义改动（仅 lexer `Tok.src` 字段 + `tokenize` append-only 契约 + `cst_format_tokens` 新函数 + `fmt` 子命令），IR 快照 3 DIFF/0 NEW/0 GONE（仅 `src/tc.tc` 自编译表示漂移），gate L2 24/0（见下）；S4 epic 仍按 §0.14.7 单独推进，不受影响。该偏离记入 §0.15 偏离 6。

**改动（纯加法 + lexer 契约收紧，零用户编译行为变化）**
- `src/base.tc`：
  - `Tok` 结构新增 `src: string` 字段——**逐字节源文本**（含引号/转义原文）；既有的 `v` 是语义值（字符串/字符已去引号、数字已规范化，供 parser 消费）。`push_tok` 默认 `src = value`（对绝大多数 token `v` 即逐字节源文本）。
  - 新增 `cst_format_tokens() string`：双指针归并 `toks` 与 `g_trivia_toks`。两者均由 lexer 按源码左→右顺序 append、内部各自按 `(line,col)` 有序、在源位置上互不重叠（trivia 占间隙），故双指针归并等价于全序列按 `(line,col)` 排序后连结各 token 精确文本，即得原始源码。发射用 `toks[i].src`（保真含引号/转义/数字原形态），trivia 发射用 `g_trivia_toks[j].text`。
- `src/lex.tc`：
  - **append-only 契约收紧（关键）**：`tokenize` 不再在入口 `base.toks = []` / `base.g_trivia_toks = []` 重置，改为**追加**。重置下放到消费方命令层（`fmt`/`dump-ast` 各自在调用前重置）。**理由**：`parse.tc::fstr_parse_expr`（f-string 插值解析）会再次 `lex.tokenize(子表达式)` 把插值子 token **追加**进 `base.toks` 尾部并改写其行列；若 `tokenize` 重置，会清空主 token 流、令外层 `pos` 越界（`index_out_of_bounds`）。`tokenize` 顶部注释固化此契约。
  - `String` / `r-string` / 字符字面量（单字节 `'A'` 与多字节 rune `'中'`）/ 数字字面量 在 `push_tok` 后，用 `str_slice(src, start, i)` 把 `tk.src` 覆盖为**含引号/转义/规范化前**的逐字节原文（`'中'`→`E4 B8 AD`、`1_000_000`/`0x1F`/`"key"` 全部保真）。
- `src/tc.tc`：新增 `fmt` 子命令。因 `parse_unit` 会经 `fstr_parse_expr` 再次 `tokenize`、把插值子 token 追加进 `toks`，破坏「token 流 == 源码 token 序列」的逐字节还原，**`fmt` 只跑词法、不调 `parse_unit`**：命令层先重置 `base.toks`/`base.g_trivia_toks`，再 `lex.tokenize(src)`，最后 `base.cst_format_tokens()`；支持 `<file.tc>` / `--example <name>` / `--output <path>`。

**关键修复（二层保真缺陷）**
- **缺陷 1（append-only 契约）**：旧 `tokenize` 入口重置 `base.toks`/`base.g_trivia_toks`。初判「fmt 丢全部空白 + 尾部 `psma`」是 toks 未重置，深挖后定位真正根因：重置打破 append-only 契约，`fstr_parse_expr` 重 tokenize f-string 插值会清空主流并令外层 `pos` 越界（崩溃表现 `index_out_of_bounds, index:39, length:2`）。修复：删重置、重置下放命令层、`fmt` 不调 `parse_unit`。
- **缺陷 2（`Tok.src` 逐字节源文本）**：`Tok.v` 是去引号/规范化值（如 `"a"` 的 `v` 为 `a`）。若 `cst_format_tokens` 用 `.v` 还原，字符串字面量会**丢引号**（`"a"`→`a`，map 键引号脱落，MATCH=NO）。修复：加 `src` 字段并在字面量 push 点覆盖为含引号原文，发射改 `.src`。

**等价性 / 安全性**
- `cst_format_tokens` 仅被 `fmt` 子命令可达；`fmt` 不跑 `sema`/`codegen`，对普通编译（check/compile/examples）IR 零影响。
- `Tok.src` 仅增加结构体字段 + lexer 写该字段，不改变 token 的语义值 `v` ⇒ parser 行为完全不变。
- 自编译表示：新增 `Tok.src` 字段 + `cst_format_tokens` 函数，经 `@import` 传播到 `src/tc.tc`；因 `fmt` 命令分发可达，对 examples/`tote.tc` 树摇后仅改变 `tc.tc` 自身 IR ⇒ 首跑快照 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW / 0 GONE）**，与 §0.16.5–§0.16.9 同型良性自编译表示漂移。

**手动验证（gate 不调 `fmt`，故单独验证字节一致性）**
- `out/_probe_trivia.tc`（文件前导/行尾/块注释，含中文）：`g1.exe fmt` 输出 `out/_fmt_probe*.txt` 与源**逐字节一致**（MATCH=YES）。
- `examples/mini.tc`（struct Point + 4 个 `!j` f-string，原 MD5 `303AF749FBFF87F86CCC6ED21FAB977B`）：fmt 输出与源 MATCH=YES（f-string 插值 + map 字符串键引号均保真）。
- 自建 `out/_fmt_edge.tc`（`'A'`/`'中'`/`1_000_000`/`0x1F`/`["key":42,"k2":7]`）：hex 确认 `'中'`=`E4 B8 AD`、`'A'`/`1_000_000`/`0x1F`/`"key"`/`"k2"` 全部逐字节保真（该探针文件因 PowerShell BOM 致 MD5 不符，真实源码不受影响）。
- `fmt` 幂等：`g1.exe fmt mini.tc` 二次输出 `mini5b` == `mini5`（YES）。
- **全量冒烟**：`examples/*.tc` 共 115 个 `tc fmt` 输出与源逐字节比对 → **SMOKE_OK=115 SMOKE_FAIL=0 TOTAL=115**。
- `tc check src/tc.tc`：0 errors（仅 T-NAM-W401/W402、T-MOD-W561 等预存风格告警）。

**验证（gate L2 24/0 全绿）**
- 首跑快照 **3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW / 0 GONE）** ⇒ 良性自编译表示漂移，人工确认无误。
- `ir_snapshot.mjs --update --compiler out/dbg/g1.exe` 重录基线（117 targets / 354 entries，2026-10-02）。
- 首跑 gate L2（基线仍陈旧）= **23 passed / 1 failed（3019.5s）**，**唯一失败项即「产物快照比对」**——因基线未更新而报 3 DIFF，**非回归**：同轮 23 步语义全绿，含自举一代、自举不动点 `g2==g3`、**自举四代不动点 `g2==g3==g4`**、conformance、run_examples 双后端、C 后端自举、rls、tote。
- 基线重录后**复跑 gate L2 = 24 passed / 0 failed（2956.1s）**：24 步全绿（工具链 / 诊断 / CST 清单 / 静态 / std 预编译 / 自举一代 / IR 审计 / LLVM verifier / **产物快照比对 0 DIFF** / conformance / UNSUPPORTED / 自举不动点 g2==g3 / run_examples dbg 双后端 / HIR AstGen / HIR CTFE / difftest g2↔g3 / 双轨对拍 / REPL 冒烟 / **四代不动点 g2==g3==g4** / MIR differential / C 后端自举 / difftest tc0 / rls 快速通道 / tote）。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`（种子升到当前不动点）。

---

#### §0.16.12 S8 step2（`tc fmt` 基于结构的规范化重排）✅ 已落地（2026-10-03）

> 范围（§4.1 G7 / §0.17）：S8 第二步 = 在 step1「忠实还原」之上做**真正的排版规范化**。CLI：`tc fmt <file>` 默认走规范化重排；新增 `--identity` 保留 step1 忠实还原（逐字节复现，用于验证归并正确性）。

**CLI 语义**
- 默认（规范化）：括号深度缩进（4 空格/级）+ 去行尾空白 + 连续空行折叠为至多 1 个空行 + 注释原样保留。
- `--identity`：step1 的 `cst_format_tokens()`，逐字节复现源码。

**改动**
- `src/base.tc`：新增 `cst_spaces(n)`（生成 n 个空格）与 `cst_format_normalized(wid)`——与 `cst_format_tokens` 同样的 `(line,col)` 双指针归并，但叠加排版状态机：`depth`（括号嵌套深度）、`at_bol`（行首）、`pend_ws`（行内待决空白，**遇换行丢弃 ⇒ 去行尾空白**）、`nl_run`（连续换行计数，折叠多空行）。闭括号 `}`/`]`/`)` 位于行首时，该行缩进按 `depth-1` 计（先减后写）。
- `src/tc.tc`：`fmt` 子命令加 `--identity` 开关；默认调 `cst_format_normalized(4)`。

**关键设计：结构信息来源 = token 流括号深度，而非 CST 节点**
- 与 step1 同源约束：`fmt` **不调 `parse_unit`**——`fstr_parse_expr` 会把 f-string 插值子 token **追加**到 `base.toks` 尾部并改写其行列，污染「token 流 == 源码序列」（见 lex.tc append-only 契约注释）。
- 故结构取自 token 流自身的 `{ [ (` / `} ] )` 嵌套深度。该信息已足够支撑「缩进 + 空行」这一层排版；**参数对齐（alignment）等更细的重排需 CST/节点信息，留作后续增强**（见下方限制）。这与 §0.15 偏离 6 同源：`fmt` 只消费词法流 + trivia。

**不变式（格式化正确性的定义）**
- **只改 trivia，绝不动 token 文本与顺序** ⇒ token 流（`type`+`value` 序列）与源逐项一致。t 是花括号语言、空白无语义，故 token 序列不变 ⇒ **语义必然不变**。
- 该不变式由 `tc lex` 序列比对守住（忽略因重排而变的 `line`/`col`，只比 `type`+`value`）。

**⚠ 致命坑（t 语言，新，必记）**
- **`unit` 是 t 的类型关键字**（P5：`unit` 为 `void` 别名，见 `parse.tc:5168`「类型关键字 string/void/map/unit」）。故 `fn f(unit: i64)` 会被解析成「类型关键字 `unit` + 期待 `)`」→ 报 `T-PAR-E101 期待 RParen，实际读到 :`。**禁止用 `unit` 作标识符/形参名**；本步已把形参重命名为 `wid`。同理需避开 `void`/`map`/`string` 等类型关键字作形参名。

**验证**
- `tc check src/tc.tc`：0 errors（531 条预存风格告警）。
- **全量 115 例三合一验证（`out/_fmt_verify.mjs`，临时脚本）**：
  - **① token 序列不变式：TOKSEQ_OK=115 / FAIL=0** —— 格式化前后 `tc lex` 的 `type`+`value` 序列全部逐项一致 ⇒ 语义不变铁证。
  - **② 幂等：IDEMPOTENT_OK=115 / FAIL=0** —— `fmt(fmt(x)) == fmt(x)`。
  - **③ step1 回归：IDENTITY_OK=115 / FAIL=0** —— `--identity` 仍逐字节复现源码。
  - **仅 3 个文件被重排、112 个原样不动** —— 反证 4 空格/级确为仓库主导风格，格式化器与既有代码风格一致。
- 3 处重排逐文件核对：`mini.tc`/`str_concat.tc` = 2 空格 → 4 空格（向主导风格收敛，正确）；`pipeline_demo.tc` = 多行调用续行 8 → 12 空格（按 `format(` 嵌套深度对齐，与作者手工对齐不同，两者皆合理，token 序列不变）。
- IR 快照：**3 DIFF（仅 `src/tc.tc::{c,h,ll}`，0 NEW / 0 GONE）** ⇒ 良性自编译表示漂移（新增 `cst_spaces`/`cst_format_normalized` 符号经 `@import` 传播到 `tc.tc`）→ `--update` 重录基线（117 targets / 354 entries）。
- **gate L2 = 24 passed / 0 failed（2909.2s）**（四代自举不动点 `g2==g3==g4`、产物快照比对 468.1s、conformance、run_examples 双后端、HIR AstGen/comptime-eval、双轨对拍、difftest tc0、C 后端自举、rls、tote 全绿）。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`。

**已知限制（如实记录，非缺陷）**
- 续行缩进按**括号深度**，不做参数对齐（alignment）；故 `println(format(...)` 这类嵌套调用的续行会比部分手工排版更深一档（见 `pipeline_demo.tc`）。
- 行内水平空白**原样保留**（仅规范化行首缩进与行尾空白），故不会破坏作者已有的对齐意图。
- 块注释内部换行原样保留，不重排。
- 上述均属「最小化结构格式化器」的既有边界；更细的重排（参数对齐、换行决策）需 CST/节点信息，与 S4 收口 epic（删 `base.Node`）无依赖关系，可独立后续增强。

#### §0.16.13 S8 step3（`tc lint`：HIR 上的结构化静态检查）✅ 已落地（2026-10-03）

> 范围（§4.1 G7 / §4.13.3）：G7 要求 fmt 与 lint **共用底层、消费层分离** —— `fmt` 只吃 CST + trivia（§0.16.11 / §0.16.12），`lint` 只吃 **HIR（+ 语义侧表）**。本步落地 `tc lint` v1。

**CLI**：`tc lint <file.tc> | --example <name> [--strict]`
- 默认退出码 0（信息性报告）；`--strict` = 有命中即退 1（供 CI 使用）。
- 输出格式 `<file>:<line>: T-LINT-Wxxx: <msg>`（可 grep / 可入 CI）。

**为何本命令可以跑 `parse_unit`（与 fmt 相反）**
- `fmt` 不能跑 `parse_unit`：`fstr_parse_expr` 把 f-string 插值 token **追加**进 `toks`，破坏「token 流 == 源码序列」的逐字节还原（§0.16.11 的 append-only 契约）。
- `lint` 不需要与源码逐字节对应——它只关心 HIR 结构，故走与 `emit-hir` **同一条前端路径**（`tokenize → parse_unit → hir_build`），**不跑 sema**（pre-type HIR），因此拿不到类型；v1 三条规则都是纯结构性的，不依赖类型。

**三条规则（v1，高置信）**
| 码 | 规则 | 实现 |
|---|---|---|
| `T-LINT-W001` | 不可达语句：`block` 内 `return`/`break`/`continue` 之后的语句（每条终结指令**只报第一条**，避免刷屏） | `hir.lint_block` |
| `T-LINT-W002` | 空块：`if` 的 then 为空且无 else（或 else 亦空）；`loop` / `for` / `for-in` 体为空 | `hir.lint_run` |
| `T-LINT-W003` | 无副作用的表达式语句（值被丢弃）；**块尾语句除外** | `hir.lint_block` |

**取舍原则：宁可漏报（false negative），不可误报（false positive）** —— 刷屏的 linter 没人看。两条由此推导出的硬约束：
- **W003 的 BINOP 只放行算术运算符 `+ - * / %`**：`<` 在 t 里既是「小于」又是 **fid 写入操作符**（`stdout < "x"`、`j < 12 < true`，见 `examples/fid_demo.tc`）—— **有副作用**。lint 是 pre-type 的（不跑 sema），**无法凭类型区分二者**，故整类排除；UNOP 同理（`&` / `*` 语义依赖上下文）。
  - ⚠ 实测证据：不排除时 examples 上的 15 条命中**全部**是 fid `<` 误报；排除后 examples 归零。
- **W003 跳过块尾语句**：t 的 value-if / value-block（`var v = if (true) { 7; } else { 9; };`）中尾表达式是**块的值**，不是丢弃。

**实测命中（115 个 examples + 21 个 `src/*.tc`）**
- `examples/`：**0 命中**（零误报）—— 已由新增门禁步锁死（见下）。
- `src/`：**5 条真阳性**：`src/hir_eval.tc:680 / 699 / 713` 与 `src/tir.tc:1182` = 空 `if` then 分支（前三条体内**只有注释**，语义上是 no-op 条件语句）；`src/sema.tc:13139` = `return -1;` 之后残留的重复分支，是**真实死代码**。
  - 处置：**本步不修**（保持提交聚焦；改 `src/` 会牵动 IR 与不动点，属独立清理任务）。记为 TODO。lint 的价值正体现于此——它在编译器自身源码里挖出了人工没注意到的死代码。

**门禁新增一步（id `lint_smoke`，lv 2）**：`node tools/lint_smoke.mjs --compiler <g1.exe>` 断言 `examples/` 命中数为 **0**。
- 判据**只覆盖 `examples/`**：`src/` 的命中是真阳性清理 TODO；若纳入断言，「先清死代码」会变成门禁的**隐藏前置条件**。

**后续（需跑 sema 的语义侧表规则）**：未使用符号、类型相关检查；以及用户 `@pass` 产出的侧表供 lint 直接消费（§4.13.3）。本步不含——pre-type HIR 拿不到类型。

**验证**
- `tc check src/tc.tc`：0 errors（531 条预存风格告警）。
- 探针：`out/_lintprobe.tc` 命中 W001(4) + W002(10)；`out/_lintprobe2.tc` 命中 W003(4)，且块尾 `a;` 与 value-if 的 `{ 7; }` **均不误报**。
- `tools/lint_smoke.mjs --compiler out/dbg/g1.exe`：`115 files / findings=0`。
- IR 快照：**3 DIFF / 0 NEW / 0 GONE**（仅 `src/tc.tc::{c,h,ll}`；`src/hir.tc` 新增符号经 `@import` 传播进 tc.tc 的 IR，属良性自编译漂移）→ `--update` 重录基线（117 targets / 354 entries）。
- **gate L2 = 25 passed / 0 failed（2823.8s）**（四代自举不动点 `g2==g3==g4`、产物快照比对 421.0s、conformance、run_examples 双后端、HIR AstGen/comptime-eval、双轨对拍、difftest tc0、C 后端自举、rls、tote、**新增 `tc lint 冒烟` 22.4s** 全绿）。
- 同步 `cp out/dbg/g4.exe out/dbg/tc.exe && cp out/rls/gr.exe out/rls/tc.exe`（种子升到当前不动点）。
- ⚠ **自此 L2 为 25 步**（step3 新增 `lint_smoke`）；历史文档中的「24/0」指 step3 之前的门禁。

---

## 0.17 S5 收口路线（step1 → stepN，P2，可并行于 S2–S4）

> S5 = `Span` 取代 `ln/cl/tv` + CST `.ast` 序列化 + trivia（span 间隙）+ error node（§4.10.3）。
> 当前完成 **step1（§0.16.5）+ step2（§0.16.6）+ step3（§0.16.7）+ step4（§0.16.8）+ step5（§0.16.9）**，S5 已全绿 gate L2 24/0，S8 fmt/lint 的注释保留前提就绪。后续步（尚未实施）：
> - step2–step5 均已完成（见 §0.16.6–§0.16.9）：step2 读方迁 `node_span_id`、step3 删 `ln/cl/tv` 字段、step4 `.ast` 序列化 + `tc dump-ast`、step5 trivia 侧表 + `assign_trivia`；S5 全绿 gate L2 24/0。
> - ⚠ S5 已完成（step1–5 全绿 gate L2 24/0），S8 fmt/lint 的 trivia 前提已满足。**S8 step1（`tc fmt` 忠实还原，§0.16.11）+ step2（规范化重排，§0.16.12）+ step3（`tc lint`，§0.16.13）均已落地并验证 gate L2 全绿**——三步都在 `base.Node` 仍存在下实现，与原路线「S8 依赖 S4 硬前置」偏离，记入 §0.15 偏离 6（合理）：fmt 只消费词法流 + trivia、lint 只消费 HIR，均不依赖删 Node。该偏离不阻塞 S4 收口 epic（§0.14.7）；S8 的 fmt/lint 部分与 S4 epic 解耦推进。
>   ⚠ **仍未落地的是 `@desugar` / `@pass` 用户扩展原语**——它们会向用户暴露节点表示，故**仍受 S4 硬前置约束**（§4.10.3）；另受 `ModuleRef` 不存在 + LLVM 后端不支持结构体字段 fn 值调用两项阻塞。当前 `owns`（侧表失效）
>   仍待 `ModuleRef`，与 S7 同阻塞。

---

## 1. 当前实现剖析（基于真实代码）

### 1.1 三层「树 / IR」现状

| 层 | 载体 | 形状 | 类型 | 可缓存 | 消费者 |
|---|---|---|---|---|---|
| **CST** | `base.nodes[]` + `base.kids[]` | 嵌套树（单体 `Node`） | 无类型，源忠实 | 否（设计上） | `parse` → 直接喂 `sema` |
| **HIR** | `hir.tc::HirInst[]` | 线性指令流（ZIR 槽位） | 未定型（pre-type） | **是**（源哈希键） | `sema` + `hir_eval`（CTFE） |
| **TIR** | `tir.tc::TIRInst[]` | 线性指令流 | 类型擦除 | 否（单态后） | `codegen_c` / `codegen_ll` |

> 用户口语里的「语法树」即 **CST**（`base.Node`）。HIR/TIR 是 IR，不是「树」。本规范主要重设计 **CST 层**，并指出它与 HIR 的边界如何收紧。

### 1.2 `base.Node` 的真实字段（节选自 `src/base.tc:39`）

```c
pub struct Node {
    kind: string;          // 种类（字符串！）
    sa, sb, sc: string;    // 字符串载荷（名/字面量/C 导出名…）
    se: string;            // C 互操作导出符号
    has_sa, has_sb, has_sc: bool;
    ia, ib: i64;           // 整型载荷（radix/bitWidth/offset），-1=null
    ba, bb, bc, bd, be, bf: bool; // isConst/isExtern/isComptime/库路径/pub/c_export/kernel
    na, nb, nc, nd: i64;   // 单子节点索引，-1=null
    memspace: i64;         // Device：指针地址空间（仅 pointer 节点用）
    la, lb, lc: i64;       // 子列表头（kids 池索引，非节点 id），-1=空，-2=null
    td: i64;               // ⚠ 类型槽：表达式节点的 TD 索引（sema 回填）
    ln: u64; cl: u64; tv: string;  // 锚点（行/列/文本）
}
```

### 1.3 当前模型的 7 个结构性弱点

1. **字符串 `kind` + `if k == "binary"` 分发**  
   全 `sema`/`hir`/`codegen` 用字符串比较分派。`base.tc` 里 `kind` 是 `string`，每次比较是字节扫描；更致命的是 **typo 不会编译失败**，只会静默落到 `else`/`RAW` —— 这正是 `hir.tc` 需要 `HIR_OP_RAW` 逃生舱、且 `hir_test.mjs` 要硬守「RAW 归零」的根因之一。

2. **字段按 kind 重载（单体结构体反模式）**  
   `binary` 用 `na/nb/sa`；`FuncDecl` 用 `sa/na/lb/lc/ba/bb`；`pointer` 用 `na/memspace`。同一个 `Node` 对每个种类只用到 3–6 个字段，却为所有节点支付全部 28 字段、且**无编译期保证「某 kind 不该读某字段」**。新增一个只给某节点用的字段（如 `memspace`）会强加给每个节点。

3. **跨切面属性散落全局平行数组**  
   `g_idecl_n/g_idecl_d`（ident→声明，线性反查 `O(n)`）、`g_seen`（作用域帧哨兵）、`g_node_mod/g_node_file`（溯源）、`g_const_decl_ids`、`g_conpat_binds`… 都是与 `nodes` 平行的全局数组 + 线性扫描。这是 `g_seen` 曾两次踩 `-O2` 自别名 `0xC0000005`、以及 `idecl_set` 必须「last-write-wins 反向扫描」的根源 —— 状态分散且查找低效。

4. **sema 原地改写 CST**  
   脱糖把节点改回 `paren`/`block`/`ident`，迫使 `hir_invalidate(n)` 断开 `node_to_hir` 映射，否则 sema 会按「改写前」语义再走一遍（`hir.tc:162` 注释）。这是脆弱的隐式契约：改一处脱糖，必须同步改另一处失效逻辑。

5. **类型信息回填进语法树**  
   `Node.td` 让类型系统的产物（TD 索引）写回语法节点，使语法树不再「纯语法」，也迫使 `Node` 为每个节点保留一个 `td` 槽（即便 90% 节点用不到）。

6. **无 trivia / 错误恢复 / 增量重解析**  
   `ln/cl/tv` 只给锚点 token；注释、空白、括号布局不保留；解析失败即终止，无 error node。这堵死了 IDE 增量重解析、富诊断（宏/agent 展开后精确 span）、`tc --format` 等工具化路径。

7. **无统一遍历/变换框架**  
   每个消费者手写 `if k == ...` + 手动走 `na/nb/la…`。新增节点种类需同步 `dagcheck` + `hir_lower_*` + `sema` + `codegen` + `hir_eval` + `tir`，缺失任一处即静默错编（见工作记忆「致命坑」清单）。无中心化的穷尽性检查。

> 但**值得保留**的：扁平 `nodes[]`/`kids[]` 的 **i64 索引 arena** 模型（可序列化、cache-friendly、无指针）；HIR 的 **未定型线性 ZIR** 思路（= Zig ZIR，已被验证可 per-file 缓存）；`.tmi` 类型化模块接口（= Rust/salsa 的 red-green 指纹）；`mk_*` 曾由数据驱动生成器 `tools/totter.tc` 从 EBNF 生成（DRY 思路本身是对的，只是生成物是单体 Node）。⚠ 但 **totter 已于 2026-09-28 删除**（`README.md:10/18/141/167/173`、`tote.toml:18`、`src/base.tc:14-16`），`src/*.tc` 的 `GEN:` 区间自此**冻结为手写维护**，DRY 事实上已失效。v2 要重新兑现 DRY，须**新建**生成器 `tools/cstgen.mjs`（§4.3 注、**不复活 totter**），风险与退路见 §7 第 7 条。

---

## 2. 现代 / 新兴语言语法树范式对照

| 语言/项目 | 节点表示 | kind 机制 | 内存/分配 | 属性存储 | 遍历/变换 | 工具化（IDE/增量） |
|---|---|---|---|---|---|---|
| **Rust** `rustc_ast`→`HIR` | 类型化 `enum Expr/Stmt/Decl`（`Box`/`P<T>`  arena） | 枚举 + 判别联合 | `rustc_ast::arena` bump + `Symbol` 驻留 | 侧表（推断结果 keyed by `NodeId`/`HirId`） | `Visitor` trait + `fold` | `Span` 全链路；salsa 查询 |
| **Swift** | `Expr/Stmt/Decl` 类层次 + `Kind` 枚举 | 枚举 | `ASTContext` bump 分配器（`TrailingObjects` 变长子） | `ASTScope` 名字解析侧表 | `ASTVisitor` | `SourceRange`；索引用「序列化 AST」 |
| **Zig** | 解析直接产 **ZIR**（线性未定型指令流，arena） | 整数 opcode | 单 arena | 侧表 | 解释器遍历 ZIR | 标准库 ZIR 磁盘缓存（源哈希键） |
| **MLIR** | `Operation`（name + regions/blocks/values + attributes） | `OperationName`（驻留字符串） | 侧表属性 + 存储唯一化 | **attribute/property 列表** 侧表 | `PatternRewriter` / `OpBuilder` | `Location` 系统；方言可插拔 |
| **Tree-sitter** | **CST**（含 trivia）+ error node | 枚举 node kind | 不可变「green tree」 | 节点自带子/字节范围 | 自动生成 visitor | **增量重解析**（复用未变子树）+ 错误恢复 |
| **Roslyn (C#)** | **红-绿树**：green（不可变、哈希共享）+ red（惰性父指针） | 枚举 `SyntaxKind` | 不可变共享 | 侧表 | `SyntaxWalker`/`CSharpSyntaxVisitor` | 增量解析、完备 IDE |
| **Go** `go/ast` | 类型化节点结构体（`*ast.BinaryExpr`…） | 数值 `tok` 枚举 | `[]` + 指针 | 侧表 | `ast.Inspect`（visitor） | `token.Pos`/`Pos` 范围 |
| **TypeScript** | `ts.Node`（`SyntaxKind` 数值枚举 + 判别） | 数值枚举 | 节点工厂不可变变换 | 侧表 | `forEachChild` + `ts.transform` | green node + 增量 |
| **Roc** | 类型化 AST，节点存 **arena（`bumpalo`）+ 按类型分表 / 索引引用** | Rust 枚举 | bump arena + 索引引用 | 侧表 | visitor / pass | 自托管，arena+索引（与 t 当前模型同源但**类型化**） |
| **Kotlin (PSI)** | 类型化元素树（`KtNamedFunction`…），源码为 backing | 枚举 | 桩树（stub）+ 缓存 | 侧表 | `KtVisitor` | 增量重解析、桩树缓存 |

### 2.1 关键可借鉴点（针对 t 的现状）

- **枚举 / 数值 `kind` 取代字符串**（TS `SyntaxKind`、Go `tok`、Rust）：消除字符串比较、启用穷尽性。
- **按 kind 分表（SoA）或判别联合，而非单体 Node**（Roc 的 arena+分表、Go 的类型化结构体、Rust 的 enum）：每节点只持本 kind 真实需要的字段，编译期类型安全。
- **字符串驻留 / interning**（Rust `Symbol`、Swift `Identifier`、MLIR `OperationName`、TS）：名字/运算符按 id 比较，省内存、快、可去重。
- **属性走侧表（SoA）而非塞进节点**（Rust `NodeId`→推断、Swift scope、MLIR attributes）：语法树保持「纯语法」，分析产物独立演进。
- **不可变源树 + 独立 typed AST/HIR**（Rust lowering、Swift、Zig ZIR）：sema 不再原地改 CST，脱糖产生新层。
- **统一 visitor / transform 框架**（TS `transform`、Go `Inspect`、Kotlin `KtVisitor`、MLIR `PatternRewriter`）：新增节点种类时一处生成、处处穷尽。
- **CST 含 trivia + error node + 增量重解析**（Tree-sitter、Roslyn 红绿树）：为 IDE/格式化/富诊断奠基。
- **Span/Range 取代裸行列**（Rust `Span`、Swift `SourceRange`、TS `TextRange`）：诊断、宏展开回溯、增量定位统一。

> **Roc 是 t 最近的同路人**：它也是自托管编译器，节点存 arena + **按类型分表/索引引用**（而非指针树），这正是 t 当前「扁平 arena + i64 索引」模型的**类型化升级版**。证明该内存模型现代且经得起自举。

---

## 3. 差距与改进点（按优先级）

| 优先级 | 现状痛点 | 改进 | 对标 |
|---|---|---|---|
| **P0** | 字符串 `kind` + `if k==` 分发，typo 静默回落 | `kind` 改 **数值枚举** `NK_*` + `nk_name()` 表；分派走 **`match`**（穷尽 + 整数跳转表 `O(1)`，§4.4.1） | TS/Go/Rust |
| **P0** | 字段按 kind 重载，无类型安全，Node 膨胀 | 改 **按 kind 分表（SoA）**：`BinaryNode{op,lhs,rhs,span}` 等 | Roc/Go |
| **P0** | 全局平行侧数组 + 线性扫描（`g_idecl`, `g_seen`…） | 跨切面属性统一为 **侧表（keyed by NodeRef）**：`node_type[]`、`node_resolve[]`、`node_mod[]`… | Rust/Swift/MLIR |
| **P1** | 名字/运算符字符串比较、重复存储 | **语言级 `Sym16/Sym32/Sym64(tag)`**（tag 即类型参数，跨池跨类型不可比较/赋值，位宽可选，整池 `sym_release`） | `examples/sym_demo.tc` |
| **P1** | sema 原地改 CST，靠 `hir_invalidate` 收口 | **CST 不可变**；脱糖产生独立 **typed AST / HIR**，sema 只消费 HIR（现状已在做，收紧契约） | Rust/Swift/Zig |
| **P1** | 无统一遍历，新增节点要同步 6+ 处 | **代码生成 visitor/transform**：`cstgen.mjs`（**新建**，取代已删除的 totter）同步生成 enum + 分表 + `mk_*` + `node_visit` 骨架 | TS/Go/Kotlin |
| **P1** | `Node.td` 把类型塞回语法树 | 类型彻底移出 Node，进 `node_type` 侧表 | 上述全部 |
| **P2** | `ln/cl/tv` 裸锚点，无 trivia/error/增量 | 引入 **`Span{file,start,end,line,col}`** +（可选）trivia 节点 + **error node + 增量重解析** | Tree-sitter/Roslyn |
| **P2** | CST 不缓存，IDE 增量无素材 | 加 **CST 序列化（`.ast`）** + 可选 green/red 增量；键=源文本（与 HIR 源哈希键不冲突） | Roslyn/Tree-sitter |
| **P1** | 脱糖散落 `parse/sema/hir` 三处 + `hir.tc` 硬编码逃生舱 + 顺序硬编码；新糖须改 3 文件 | **注册式 Desugar Pass** + `lower_policy` 表（替代硬编码逃生舱）+ **SAST 渐进降级层**（§4.11）；且锁定 `docs/design.md` 铁律（姿势 A 强制 / L2 双后端一致） | 本项目 `design.md` 铁律 |
| **P1** | 无统一 `Pass` 抽象；新增处理节点 = 手工接线、隐式顺序、易错 | **`Pass`/`PassManager`**：Analysis/Transform 区分 + `owns`/`requires` 侧表失效 + 拓扑排序（§4.12） | `compiler-pipeline-design.md` |
| **P1** | `fmt` 与 `lint` 各自实现解析 / 遍历；每加一个特性要改两处工具 | **fmt / lint 共用底层**（CST+trivia 供 fmt，HIR+侧表 供 lint），新糖/Pass 无需改工具（§4.13.3 / G7） | 本项目工具化需求 |
| **P2** | 语法 / 管线锁死在 `src/`，用户不可扩展 | 用户 **`@desugar` / `@pass`** 注册，与内置同一套 API（§4.13 / G8） | 可扩展语言趋势 |
| **P1** | 语法树代码锁死在 `src` 内联树（`base`/`lex`/`parse`），`fmt`/`lint` 无法干净引用、与编译器强耦合 | 迁入 **std 库** 命名空间 **`std.rc.cst`**（库模块、预编译 `.tlib`）；编译器与 `fmt`/`lint` 同一套引用，工具不再深入 `src` 内部（§4.14 / G9） | 本项目指令 |
| **P1** | 当前 41 项关键字**全在词法层硬保留**（`g_kw_text`→`Kw*` token），无法作变量/字段名；声明节点把 `pub`/`extern`/`comptime` 等修饰 baked 进 `ba/bb` 布尔载荷，属性关键词（align/offset）无处安放 | **关键词分类化**（强制 / 上下文（修饰+属性））；lexer 对上下文关键词输出 `Ident`，parser 上下文裁决；CST 声明节点用 `modifiers[]` / `attrs[]` 结构化字段承载（§4.15 / G10） | 《最大化标识符设计》 |

> 不改动且应强化的：**i64 索引 arena 内存模型**、**HIR 未定型线性 ZIR + per-file 缓存**、**`.tmi` 类型化模块接口**、**`mk_*` 由清单驱动的代码生成产出**（v0.1 由 EBNF + `totter` 生成，**totter 已删除**；v2 改由 `tools/cst_kinds.json` + 新建 `tools/cstgen.mjs`，§4.3 注）。

---

## 4. 重新设计技术规范

### 4.1 设计目标与不变式

- **G1 类型安全**：每个节点仅暴露其 kind 真实拥有的字段；误用编译期报错。
- **G2 自举安全**：任何改造不得破坏 `g2.ll==g3.ll==g4.ll` 自举不动点；`.ll` md5 必须逐字节不变（见工作记忆「判自举不动点只比 emit-ll 的 .ll md5」）。
- **G3 门禁安全**：每阶段独立可过 `gate L2`（23/0）+ `hir_test`（RAW 归零）；`nightly` 仍测自举出的 `g1`。
- **G4 可序列化 / cache-friendly**：保留扁平索引 arena，便于磁盘缓存与跨进程传递。
- **G5 可扩展**：新增节点种类 = 改 `tools/cst_kinds.json` + 重新生成（生成器 `tools/cstgen.mjs`，§4.3 注；不复活已删除的 totter），消费者穷尽性由门禁守住。
- **G6 工具化就绪**：Span 全链路、可增量重解析、可挂 IDE。
- **G7 工具共用底层（fmt / lint 同层）**：格式化（`tc fmt`）与静态检查（`tc lint`）共用同一套底层——lexer / parser / 不可变 CST（含 trivia）/ visitor 框架 / 侧表。**fmt 只消费 CST 的 trivia 与布局信息**，**lint 只消费 HIR 与语义侧表**；二者不各自实现解析与遍历，差异逻辑各写各的（§4.13.3）。
- **G8 用户可扩展语法与管线**：语法糖与管线处理节点对**用户开放**。用户可在自己的模块里通过编译器内建原语（`@desugar` / `@pass`）注册 `DesugarPass` / `Pass`，与编译器内置糖/Pass 走**同一套注册 API**；无需改编译器源码。用户糖仍须守 姿势 A（脱糖为既有构造）+ L2 双后端逐字节一致（§4.11.1 / §4.13）。
- **G9 语法树归属 std 库（命名空间 `std.rc.cst`）**：token 池 / `CstNode`（= 现 `Node`）/ 子列表池 / `Span` / `Diagnostics` / lexer / parser / visitor 框架迁出 `src` 内联树，迁入 **std 库模块 `std.rc.cst`**（预编译 `.tlib`）。编译器与 `tc fmt` / `tc lint` / 用户 `@desugar`/`@pass` 均 `@import("std.rc.cst")` 引用，**工具无需深入 `src` 内部**（§4.14）。
- **G10 关键词最小化 + 分类化（lexer 不下沉、parser 上下文裁决）**：token 分类遵循「最大化标识符」原则——把关键字分为 **强制关键词**（硬保留，仅歧义位置优先解析、不可回退）/ **上下文关键词**（lexer 仍输出 `Ident`，仅特定语法位置被 parser 识别为关键字，可作变量/字段名）。上下文关键词再细分为 **修饰关键词**（改变语义，如 `pub`/`extern`/`export`/`comptime`/`const`/`var`/`entry`）与 **属性关键词**（修改元数据，如 `align`/`offset`/`pack`）。CST 节点把修饰/属性关键词建模为**结构化字段**（而非 baked 进 kind），以便 `fmt` 原样还原、`lint`/反射可查（§4.15）。这同时把当前 41 项「全词法硬保留」反模式收敛为「少量强制 + 大量上下文」（参考附件《最大化标识符设计》）。
- **G11 条件编译单列机制、与 `@`-元函数正交**：条件编译（声明/块按 `CompileConfig` 谓词 0/1 纳入）与入口点选择**不混入 `@`-元函数家族**——`@import`/`@desugar`/`@pass` 是纯粹**动作型**元函数，`@entry(tc)` 是**配置门控**，二者语义不同。条件编译由 **`when` 关键词 + CfgPass + `entry` 修饰关键词** 承载，使动作型与配置门控各自纯净、入口点可多目标选择（§4.16）。

### 4.2 分层模型（收紧边界）

```
源 ──Lexer──▶ Tokens（含 trivia）
   ──Parser──▶ CST（源忠实、不可变、含 trivia + error node）        ← 本规范重设计对象；归属 std 库 `std.rc.cst`（§4.14）
        │        （CST 永不改写；所有语法糖在此保留原始形态）
        ▼
   ┌──────────── Desugar PassManager（§4.11）──────────────────┐
   │  SAST：sugar→sugar→core 渐进降级（每糖 = 1 个注册 DesugarPass）│
   │  lower_policy[NK] 表替代 hir.tc 硬编码逃生舱（§4.11.2）      │
   └────────────────────────────────────────────────────────────┘
        ▼
   ──AstGen──▶ HIR（未定型·线性·可序列化 = ZIR，源哈希缓存）        ← 保留，键不变
   ──Sema───▶ typed AST / MIR（类型/解析侧表 keyed by NodeRef）    ← 类型不再回写 Node
        ▼
   ┌──────────── IR PassManager（§4.12）───────────────────────┐
   │  mir 上：comptime 折叠 / 单态化 / borrow-verify / FDO 布局 … │
   │  （每 Pass = 1 个注册节点，Analysis / Transform 区分）       │
   └────────────────────────────────────────────────────────────┘
        ▼
   ──Lower──▶ TIR（类型擦除·线性）                                ← 保留
   ──Codegen─▶ C / LLVM / WASM / SPIR-V / RISC-V / Cranelift
        ▲
   ┌────┴──── 工具消费者（共用同一底层，§4.1 G7）────────────────┐
   │  tc fmt  ：只读 CST + trivia（注释/空白/布局还原）            │
   │  tc lint ：只读 HIR + 语义侧表（类型/作用域/数据流）          │
   │  IDE/LSP ：fmt + lint 能力按需组合                            │
   └────────────────────────────────────────────────────────────┘
        ▲
   ┌────┴──── 用户扩展（§4.13，§4.1 G8）────────────────────────┐
   │  用户模块经 @desugar / @pass 注册 DesugarPass / Pass，        │
   │  与内置糖/Pass 走同一套 API，注入上方两个 PassManager         │
   └────────────────────────────────────────────────────────────┘
```

**关键契约变更**：CST **只负责语法，永不改写**；所有语法糖的脱糖发生在 **Desugar PassManager**（产物为 SAST，最终经 AstGen 降到 HIR），而非原地改 CST——`hir_invalidate` 退场。类型（`td`）、标识符解析（`g_idecl`）、模块归属、作用域全部迁到 **Sema 阶段的侧表**，keyed by `NodeRef`。中端/分析类的处理节点统一走 **IR PassManager**（§4.12），侧表由对应 Pass `owns` 并随上游 IR 失效而失效。

### 4.3 节点表示：typed node tables（SoA）+ 枚举 kind + NodeRef

种类用**数值枚举**（非字符串）；节点按 kind 分表存储（每张表只含该 kind 真实字段）；统一引用 `NodeRef` = **tag + idx 打包成的单个 u64**（`mk_noderef` / `nr_tag` / `nr_idx` 存取）。

```c
// ── kind 枚举（cstgen.mjs 从 kind 清单生成全集 + nk_name 表）──（生成器说明见本节末注）
pub const NK_INVALID:   i64 = 0;
pub const NK_BINARY:    i64 = 1;
pub const NK_CALL:      i64 = 2;
pub const NK_FUNC_DECL: i64 = 3;
pub const NK_STRUCT_DECL:i64 = 4;
pub const NK_IDENT:     i64 = 5;
// … 全部种类

// ── 符号类型：语言级 Sym16 / Sym32 / Sym64（tag 即类型参数，见 examples/sym_demo.tc）──
// 声明形如  var x: Sym32("Ident") = "foo";
//   • 位宽 16/32/64 任选：op/kw/feature 等小集合用 Sym16，ident/file/mod/table 用 Sym32，超大语料用 Sym64
//   • tag（"Ident"）是类型的一部分：Sym32("Ident") 与 Sym32("Op") 是不同类型
//   • 赋字符串自动 intern 进以 tag 命名的池；变量仅持 uN id；sym_str 取串、sym_release("tag") 整池释放、sym_release_all() 全释放
// 跨池比较/赋值 = 类型错误（tests/conformance/fail/f15_sym_cross_pool.tc：Sym32("A") = Sym32("B") 报 T_TYPE_MISMATCH）
pub type Sym16 = ...;   // 语言内建：u16 id + tag 编译期常量
pub type Sym32 = ...;   // 语言内建：u32 id + tag 编译期常量
pub type Sym64 = ...;   // 语言内建：u64 id + tag 编译期常量

// ── 统一引用：打包为单个 u64（高 32 位 tag，低 32 位 idx）──
// 打包成单 u64 而非两字段：NodeRef 大量用作侧表下标 / map 键，单整数比较与哈希最廉价，
// 且与 §4.4.1 的「整数 match → 跳转表 O(1)」一致（可对 nr_tag(n) 直接 match）。
pub type NodeRef = u64;
pub fn mk_noderef(tag: i64, idx: i64) NodeRef { return (tag << 32) | idx; }
pub fn nr_tag(n: NodeRef) i64 { return n >> 32; }
pub fn nr_idx(n: NodeRef) i64 { return n & 0xFFFFFFFF; }

// ── 每 kind 一张表，仅含本 kind 真实字段 ──
pub struct BinaryNode {
    op: Sym16("Op"); lhs: NodeRef; rhs: NodeRef; span: Span;
}
pub struct CallNode {
    callee: NodeRef; args: NodeList; span: Span;   // 子列表仍走 kids 池（保留）
}
// 声明类节点：修饰 / 属性走结构化字段（§4.15.3），不再 baked 进布尔位（对比现状 ba/bb）
// 注：Mod / Attr / CfgPred 定义见 §4.15.3 / §4.16.6
pub struct FuncDeclNode {
    name: Sym32("Ident"); ret: TypeRef; params: NodeList; body: NodeList;
    modifiers: []Mod;      // 有序修饰：Pub / Extern / Comptime / Kernel / Entry(§4.16.5) ...
    attrs:     []Attr;     // 有序属性：Align(n) / Offset(...) / Volatile ...
    cfg_pred:  CfgPred;    // 条件编译谓词（§4.16）；空 = 无条件门控
    span: Span;
}
pub struct IdentNode { name: Sym32("Ident"); span: Span; }
// … 每种一个 struct

// ── 分表存储（arena 增长数组）──
pub var tbl_binary: []BinaryNode;
pub var tbl_call:   []CallNode;
pub var tbl_func:   []FuncDeclNode;
pub var tbl_ident:  []IdentNode;
// …

// ── 创建（cstgen 生成；与现有 mk_* 一一对应）──
pub fn mk_binary(op: Sym16("Op"), lhs: NodeRef, rhs: NodeRef, span: Span) NodeRef {
    append(tbl_binary, BinaryNode{ op, lhs, rhs, span });
    return mk_noderef(NK_BINARY, slice_len(tbl_binary) - 1);
}
```

> **生成器说明（与现实对齐，务必先读）**
> - v0.1 时代本节的枚举 / 分表 / `mk_*` 由 **`tools/totter.tc`** 从 EBNF 生成；但 **totter 已于 2026-09-28 删除**（`README.md:10/18/141/167/173`、`tote.toml:18`、`src/base.tc:14-16`）。v2 **不复活 totter**。
> - 改由**新建** Node 脚本 **`tools/cstgen.mjs`** 承担（与 `tools/gen_diag_t.mjs` 同风格：Node 生成 t 源码），输入是**手工维护的 kind 清单 `tools/cst_kinds.json`（新增，唯一真源）**：每 kind 记 `名称 / 字段列表 / 默认 lower_policy / 是否糖原 / 是否 trivia`。
> - **输出**：`NK_*` 枚举 + `nk_name[]` + 各 kind 分表 struct + `mk_*` + `node_visit`/`transform` 骨架（§4.6）+ `lower_policy[]`（§4.11.2）。
> - **为何不接 `gen_ebnf.mjs` 的产物**：`tools/gen_ebnf.mjs` 默认把 `ebnf.json` 写到 **tnote 工程** `notebook-web/data/ebnf.json`，**刻意与 t 仓库 out/ 解耦**（`README.md:133`、`tools/gen_ebnf.mjs:28-31`），不适合作构建期输入；如需交叉校验可用环境变量 `EBNF_OUT` 另存到 t 仓库内，但**不进构建依赖**。
> - **风险与退路**（生成器未落地时如何不阻塞）：见 §7 第 7 条。

**为什么选 SoA 分表而非单判别联合 / 指针树**：
- t 自托管、类型系统朴素；「多张 `[]X` 全局 + `NodeRef`」与现有 `nodes[]`/`kids[]` 同构，**迁移成本最低**，且天然可序列化（与 G4 一致）。
- Roc 用完全相同的「arena + 分表/索引引用」自举成功，验证可行。
- 单一判别联合（Rust `enum`）在 t 里表达成本高；SoA 把「判别」显式拆成 `tag` 字段，等价但更易生成。

> **兼容期双写**：迁移阶段 `mk_*` 同时写旧 `base.Node` 与新分表，消费者逐步从 `na/nb` 切到 `node_binary_lhs(n)` 之类的类型化访问器；切完后删除 `base.Node`。

### 4.4 内存与 arena / 字符串驻留

- **Arena**：保留全局增长数组（即现有 flat arena 模型），所有节点活在编译期 arena，无逐节点 GC。新增 `bump` 语义注释，明确「节点一旦创建不可原地改字段结构」（仅语义侧表可变）——支撑 G2 不可变契约。
- **符号驻留即语言特性（Sym16/Sym32/Sym64）**：不同符号集合直接建模为**不同的 `SymN(tag)` 类型**（见 §4.3 骨架）。各集合的「集合名 + 位宽」选型如下：

| 符号集合 | 类型 | 说明 |
|---|---|---|
| 普通标识符（var/field/func/param 名） | `Sym32("Ident")` | 规模大，用 32 位 |
| 运算符符号 | `Sym16("Op")` | 运算符是封闭小集，16 位足够 |
| 关键字文本（ctx_kw_role 查表） | `Sym16("Kw")` | 关键字封闭小集，16 位 |
| 编译器函数名（`@import`/`@desugar`/`@pass`） | `Sym32("CompilerFn")` | 自成命名空间，不占标识符名额 |
| 侧表名（Pass.owns/requires） | `Sym32("Table")` | 与标识符池隔离 |
| 特性标识（cfg features） | `Sym16("Feature")` | 特性封闭小集 |
| 源文件标识（Span.file） | `Sym32("File")` | |
| 模块别名 | `Sym32("Mod")` | |
| 裸标识符字面（`@"..."`） | `Sym32("Ident")` | 裸标识符本就是标识符名，落同一池 |

赋字符串即**自动 intern**（由语言在赋值处插入 `intern`），比较/赋值只在**同 tag 同类型**内合法；跨池跨类型是**类型错误**——即用户要求的「不同 sym 集不可比较、属于不同类型」，且由语言直接保证，无需手写多套 intern 表。

```c
// 编译器自身即 Sym 的「消费方」：声明各池类型，赋字符串即 intern
//   BinaryNode.op:                Sym16("Op")
//   FuncDeclNode.name / IdentNode.name: Sym32("Ident")
//   Span.file:                   Sym32("File")
//   node_mod: []Sym32("Mod")     node_file: []Sym32("File")
//   Pass.owns / requires:        []Sym32("Table")
//   cfg.features:                []Sym16("Feature")
//   CompilerFnCall.name:         Sym32("CompilerFn")
// 例：var op_id: Sym16("Op") = "+";   // 自动 intern 进 "Op" 池，op_id 仅持 u16
```

> **规则（核心，由语言保证）**：`Sym32("Ident") == Sym32("Op")` 是类型错误；`Sym32("A") = Sym32("B")` 报 `T_TYPE_MISMATCH`（见 `tests/conformance/fail/f15_sym_cross_pool.tc`）。不同集合索引空间独立、从不跨集比较——「编译器函数名不占标识符名额」「侧表名/特性名不与标识符混淆」在类型层即成立。位宽按集合规模选（op/kw/feature 小集 `Sym16`，其余 `Sym32`，超大语料 `Sym64`），兼顾内存与 perf。池生命周期：`sym_release("tag")` 整池释放、`sym_release_all()` 全释放，编译期可整体重置复用。

> 收益：消除全管线字符串比较（P0 性能 + 正确性）；为后续 red-green 哈希共享铺垫。

#### 4.4.1 Sym 的整数本质与 `match` 跳转表优化

- **整数本质**：`SymN(tag)` 在运行期就是一个**无符号整数**（u16/u32/u64 id），`tag` 只在编译期作为类型参数参与类型检查、**不进入运行期表示**。因此对 `SymN(tag)` 值做 `match`，等价于对其底层**整数 id** 做 `match`。
- **`match` 整数跳转表（O(1) 分派）**：语言对「scrutinee 是整数字面量集合」的 `match` 应生成**跳转表（jump table / 计算 goto）**，使分支分派从 `O(n)` 线性比较或哈希探测降为 **`O(1)`**（按 id 直接索引）。这适用于所有基于 Sym id 的分派热点：
  - **节点 kind 分派**（§4.3 / S1）：对 `NK_*` 整数枚举 `match` → 跳转表；
  - **关键字角色查表**（`ctx_kw_role`，§4.15）：对 `Sym16("Kw")` 的有限 id 集合 `match` → 跳转表，取代 `map` 查询；
  - **访问者 / 降级分派**：`node_to_hir` 桥的 kind 路由、HIR/TIR 指令 `match`；
  - **运算符折叠 / 重载解析**：对 `Sym16("Op")` 的有限集合 `match`。
- **与驻留的协同**：同一池内 id 由 intern **从 0 开始密集、连续**分配，跳转表可做到**无空洞紧凑索引**；即便偶发空洞，编译器亦可选取「跳转表 + 二分」混合。相比字符串 `==`（`O(字符长)`）与哈希 `map`（探测开销 + 缓存不友好），整数跳转表是确定 `O(1)` 且缓存友好。
- **约束**：跳转表优化要求 `match` 分支为**编译期已知整数常量**；跨池 `match`（如把 `Sym16("Op")` 当 `Sym32("Ident")` 比）在类型层已被拒绝，不会进入同一张表。用户扩展的新修饰/属性（`KwMod`/`KwAttr` 增项，§4.15.3）只是向既有整数枚举新增常量分支，自动并入跳转表、零额外成本。

#### 4.4.1.1 R-KIND-UNIVERSE：kind 枚举必须按「宇宙」隔离（S1 普查实证新增）

> **事实**（`tools/cst_kinds_census.mjs` 实证）：`.kind` 这个字段名在 `src/` 里被 **4 个互不相交的宇宙**共用——
> `Node.kind`（CST 节点，105 项）/ `TypeDesc.kind`（类型：Array / Map / Void / Pointer / Slice …）/ `HvValue.kind`（CTFE 值：HV_INT / HV_F64 …）/ `Tok.t`（token 类型）。
>
> **规则**：
> 1. **一个宇宙 = 一个枚举 = 一个符号池**，禁止把 TypeDesc 串并进 `NK_*`（与 `Sym16/32/64(tag)`「不同集合不可比较」**同一原则**）；
> 2. 枚举**唯一来源**是 `tools/cst_kinds.json`（实证抽取），**不是**手工维护的 `node_kind_names`——实测后者漏了 19 个真实 Node kind（见 §0.10.2）；
> 3. 判定某串属于哪个宇宙的**唯一可靠证据是「有无产生点」**（`node_new("K")` / `mk_X(`）。只出现在比较式里的串默认**不属于** Node 宇宙，须人工核定后列入 `cst_kinds_census.mjs` 的 `REWRITE_ONLY_NODE_KINDS`；
> 4. 生成物与清单的一致性由 `cstgen --check` 断言（S2a 验收项）。
>
> **为什么不用运行时类型区分**：这些宇宙在 `t` 里目前都只是 `string`，靠字段名区分只是约定；一旦合成一个枚举，越界值会静默落到 `unknown` 臂 —— 又一处「不崩溃的错编」。

### 4.5 属性侧表（SoA，keyed by NodeRef）

把当前散落的全局平行数组统一为「以 NodeRef 为键的侧表」。语法树本身不再携带类型/解析/作用域。

```c
// ── 侧表统一登记：每张侧表 =「表名(Sym32("Table")) + 存储 + 归属 Pass + 脏标记」──
// 表名是侧表的**唯一身份**，正是 §4.12.2 Pass.owns / requires 引用的东西；
// 早期草稿把侧表写成裸数组、owns 写成字符串名，两套身份对不上，§4.12.3 的「失效」无法落地，现统一。
pub struct SideTable {
    name:   Sym32("Table");   // "type" / "resolve" / "mod" / "file" / "scope" / "borrow" / "cfg" …
    owner:  Sym32("Pass");    // 产出它的 Pass（§4.12 owns）；内置由 "sema"/"hir" 等保留名持有
    dirty:  bool;             // 上游 IR 变更 → 置脏，PassManager 据此只重跑下游（§4.12.3）
}

// ── 具体侧表实例（替代 Node.td / g_idecl_* / g_node_mod / g_node_file / g_seen / g_const_decl_ids）──
pub var node_type:    []TD;             // 表达式/声明 → 类型（Sema 阶段填）
pub var node_resolve: []NodeRef;        // ident → 其声明（替代 O(n) 线性反查）
pub var node_mod:     []Sym32("Mod");   // 溯源模块别名
pub var node_file:    []Sym32("File");  // 溯源源文件
pub var node_scope:   []ScopeRef;       // 作用域归属（替代 g_seen 哨兵栈的隐式帧）

// 登记（表名 → 存储 + 归属），供 PassManager 做依赖拓扑与失效
pub var g_side_tables: []SideTable;
// 例：register_table("type", owner="sema");  register_table("borrow", owner="borrow_verify");
```

- **索引方式**：侧表一律以 **`nr_idx(n)`**（§4.3 `NodeRef` 的低 32 位）为下标，与节点分表同构；`node_resolve` 亦可用平行数组取代 `g_idecl_n/d` 的 last-write-wins 反向扫描，查找 `O(1)`。
- `node_scope` 显式存作用域链，取代 `g_seen` 的「append-only + 哨兵 + 反向扫」黑魔法，彻底规避 `-O2` 自别名 `0xC0000005`（见 `base.tc:131` 注释）。
- **与 §4.12 的闭合**：`Pass.owns` / `requires` 填的是 `SideTable.name`（`Sym32("Table")`），PassManager 据此建拓扑、置脏、重跑——用户 `@pass(owns=["myopt"])`（§4.13.1）产出的侧表自动进入同一登记，故 `tc lint` 可直接消费（§4.13.3）。

### 4.6 访问者与变换框架（代码生成）

`tools/cstgen.mjs`（新建，取代已删除的 totter，§4.3 注）在生成 enum + 分表 + `mk_*` 的同时，生成 `node_visit` 骨架与 `transform` 工厂；新增 kind 时若漏写分支，门禁（`gate L2` / 编译）即报穷尽性缺失。

```c
// cstgen 生成的访问者骨架（用户实现各 visit_X）
// ⚠ 必须生成 `match` 而非 if/else 链：kind 是整数枚举，match 才能被优化为
//    跳转表达到 O(1) 分派（§4.4.1）；if/else 链是 O(n) 线性比较，与该收益矛盾。
pub fn node_visit(n: NodeRef, v: Visitor) void {
    match (nr_tag(n)) {
        NK_BINARY => {
            var b: BinaryNode = tbl_binary[nr_idx(n)];
            v.visit_binary(b);
            node_visit(b.lhs, v); node_visit(b.rhs, v);
        }
        NK_CALL => {
            var c: CallNode = tbl_call[nr_idx(n)];
            v.visit_call(c);
            // … 遍历 args
        }
        // … 穷尽所有 kind；缺一个 → 编译告警 / 门禁失败
    }
}

// 不可变变换（脱糖产生新节点，不改旧节点）
pub fn ast_transform(n: NodeRef, f: Transform) NodeRef {
    // 递归应用 f 到子节点，再构造新节点返回
}
```

> 这直接消除「新增 AST kind 必须同步 hir_lower_expr / sema / codegen / hir_eval / tir / dagcheck」的致命坑（工作记忆）。

### 4.7 Span / 溯源 / 诊断

```c
pub struct Span {
    file: Sym32("File"); start: u32; end: u32; line: u32; col: u32;
}
```

- 替换 `ln/cl/tv` 三字段；所有节点持 `span`。
- 宏 / `comptime` / agent 展开后，保留「展开前的原始 Span → 展开后 Span」映射，富诊断可回溯（对标 `compiler-pipeline-design.md §4.2` 的富诊断需求）。
- `tc --error-format=json` / SARIF 直接从 `Span` 出，无需再拼 `ln/cl/tv`。

### 4.8 错误恢复与增量重解析（P2，工具化）

- **trivia 表示（裁定：先做「span 间隙」，子节点形态留作未来可选）**：注释 / 空白**不作为独立子节点**，而是记录在每个节点 `Span` 之间的间隙里（`leading_trivia` / `trailing_trivia` 两段字节范围，指向源文本，不复制内容）。
  - **裁定理由**：① 成本最低——不增加 CST 节点数、不动 `node_visit` 穷尽性、不动 `mk_*` 签名，S5 可独立落地；② 已足够支撑 `tc --format` 与富诊断（两者都只需「取回源文本片段」）；③ 若未来需要 trivia 参与变换/重排（如格式化时移动注释），再升级为轻量子节点——届时是**局部扩展**，不会推翻本决定。
  - 与 §4.14.2 模块布局保持一致（该处已写「trivia（S5：先做 span 间隙）」）。
- **error node**：解析失败不产生「整文件中止」，而是插入 `NK_ERROR` 节点（带诊断 + 跳过区间），使 `sema` 能继续、IDE 能标红。
- **green/red 增量**（可选，对标 Roslyn/Tree-sitter）：green = 不可变、按内容哈希共享的子树；red = 带父指针的惰性视图。源改动时只重解析受影响 green 子树，其余复用 —— 为「改一个文件只重算该文件」的增量承重墙再补一层（HIR 已是第一层）。

### 4.9 序列化与缓存

| 制品 | 键 | 用途 | 现状 |
|---|---|---|---|
| **CST `.ast`** | 源文本 | IDE 增量、格式化、`--format` 往返 | 新增（P2） |
| **HIR** | 源内容哈希 + 编译器版本戳 | per-file 缓存承重墙 | 已有（`hir_to_bin`） |
| **`.tmi`** | 模块 API 指纹 | 下游依赖跳过本模块 type-check | 已有（设计） |
| **TIR** | — | 后端桥（不缓存） | 已有 |

> 三套制品键互不冲突（CST=源文本，HIR=源哈希，`.tmi`=API 指纹），符合 `hir-design.md §3.4` 的分层失效策略。

### 4.10 兼容性 / 迁移路径（分阶段、保门禁、保自举不动点）

#### 4.10.0 验收判据（先分清两类——原规范把二者混为一谈，会导致每阶段都被误判为失败）

| 判据 | 性质 | 门禁步骤 | 变化时的**正确**动作 |
|---|---|---|---|
| **A. 自举不动点**（`g2 == g3`；L2 再要求 `g4`） | **硬门，任何阶段不可破** | `gate` 的 `boot23` / `boot4` | 破了 = 真回归 → **回滚** |
| **B. IR 基线快照**（`g1` vs `tests/ir_baseline.json`） | **软基线，预期会变** | `gate` 的 `snapshot`（lv 0） | 变了 = **重录**，不是回滚：`node tools/ir_snapshot.mjs --update --compiler out/dbg/g1.exe`，并**人工确认差异仅为预期表示变化**，基线随语义变更一同提交 |

> ⚠ **基线必须由 `g1`（LLVM 自举产物）录制，不能用 seed / `tc.exe`**。依据 `tools/gate.mjs` 的 `snapshot` 步骤注释：C 后端产物与 LLVM 自举产物因良性跨后端非确定性（结构体按布局命名、const 实参临时名/求值序）逐字节不同但运行期等价 → 用 C 产物做基线必然假红。

**结论（对原表的重要修正）**：S0 起几乎**每个阶段都会改变 IR 发射**（S0 内联→库链接、S1 加字段、S2 加全局分表、S3/S4 删字段、S5 换 `Span`）。因此「`.ll` md5 不变」是**错误的验收目标**；正确目标是「**不动点 A 成立 + 基线 B 已按预期重录**」。

#### 4.10.1 CI 与种子的硬约束（S0 最易踩的坑）

- **CI 只跑 L1**：`.github/workflows/ci.yml` 在 push 到 main 时跑 `gate L1`；**L2 是本地里程碑动作**（L2 的 `miropt` 依赖 wasmtime/riscv，CI 不跑）。`nightly.yml` 跑全量测试 + 全部示例（`run_examples --all`），被测对象是**自举出的 g1**，不是 seed。
- **种子 `ci/seed/tc.exe` 是提交进仓库的「上一稳定版」**（`out/` 被 gitignore，仓库不随附二进制）。CI 用它编译 `src/tc.tc` 得 `g1`，也用它跑 `boot_std` 预编译 std。
- ⚠ **S0 引入 `std.rc.cst` 后的「鸡生蛋」问题**：CI 用**旧 seed** 编译 `lib/std/rc/cst.tc`。故 **cst.tc 只能使用 seed 已支持的特性子集**；一旦用到 seed 不支持的语法/内建，会出现「**本地绿、CI 红**」（本地用的是新 `out/dbg/tc.exe`）。届时唯一解是**先刷新种子**（`cp out/dbg/tc.exe ci/seed/tc.exe` 并提交），再推进该阶段。

#### 4.10.2 每阶段标准操作序列（不得跳步）

1. 改代码，**然后停手** —— ⚠ 门禁一旦起跑**绝不能再改 `src/`**（要改先旁路 `--output out/_probe/...`）；
2. `node tools/gate.mjs L2`（本地里程碑）；推 main 前至少 `L1`；
3. 若 `snapshot` 红且差异为预期表示变化 → **用 g1 重录基线** → 再跑一次确认绿；
4. 同步产物：`out/dbg/tc.exe`、`out/rls/tc.exe`、`out/bridge_src/src`；
5. 若**自举契约变化**（旧 seed 编不出新 `src`）→ 刷新 `ci/seed/tc.exe` 并提交（§4.10.1）；
6. 提交 + 打阶段 tag（如 `s0-cst-namespace`）；下一阶段**从新分支**开始。

> **回滚策略**：每阶段独立分支、单提交合并，故回滚 = revert 该阶段合并提交，不牵连其它阶段。

#### 4.10.3 阶段表（含依赖 / IR 影响 / 验收）

| 阶段 | 动作 | 依赖 | IR 影响 | 风险 | 验收 |
|---|---|---|---|---|---|
| **S0（P0，最先做）** | 语法树代码从 `src` 内联迁入 **std 库模块 `std.rc.cst`**（`lib/std/rc/cst.tc`）；`src/base.tc`/`src/lex.tc`/`src/parse.tc` 暂改为 **re-export 垫片**（§4.14.4）；**同时**把 41 项关键字表按 §4.15 拆入 `std.rc.cst.lex`（强制→`Kw*`、其余→`Ident`+`ctx_kw_role`） | 无（`base` 是无 `@import` 的叶子，`lex`→`base`、`parse`→`base`+`lex`，依赖链干净） | **有**（`mangle_modules` 把符号重整为 `cst__xxx`；**即便走内联回退也重整**——rule 2 的「IR 不变」只对**入口模块**成立） | **中**（构建期循环 + 种子约束 + 库全局状态约束 §4.14.7，非原先标的「低」） | 不动点 A 绿；**基线 B 重录**且差异仅为「std 符号外部化」一类预期变化；`lib/std/rc/cst.tc` 建立并经 `@import("std.rc.cst")` 内联导入跑通（**`.tlib` 预编译按 §4.14.7.1 实测暂缓**，`build_std.mjs` 只做点分路径通用化预留）；**CI 用 seed 能编出 cst.tc**（否则先刷新种子） |
| **S1（P0）** | ① kind **宇宙普查**（`cst_kinds_census` → `cst_kinds.json`）；② 建 `tools/cstgen.mjs`（`--emit` / `--check`，S2a 前置）；③ `kind: string` → 数值枚举 `NK_*` + `nk_name()` / `nk_of_kind()`，注册表按实证从 86 扩到 **105** 并迁入 `std.rc.cst`；④ **暂不新增 `tag` 字段**（裁定见 §0.10.3：20 处构造后改写 + 3 处整节点拷贝 ⇒ 派生字段易陈旧 ⇒ 延后到 S2，随 `node_set_kind` / `node_copy` 收口）；⑤ 关键词枚举化（`KwMod`/`KwAttr`/`KwRole`）+ `KwMod::Entry` + `CfgPred` 字段（§4.16.6） | S0 | **有**（注册表迁入 cst → 符号重整；**不**改 `Node` 布局） | 低 | 不动点 A 绿；**基线 B 重录**；`conformance` 诊断码不变；`cstgen --check` 通过；`dagcheck` 无反向引用 |
| **S2（P0）** | **S2a（前置）：新建 `tools/cstgen.mjs` + `tools/cst_kinds.json`**（§4.3 注）；S2b：由生成器产出分表 `tbl_*` + `NodeRef` + 类型化 `mk_*`；`parse` 双写旧 `Node` 与新分表；新增类型化访问器 `node_X_field` | S1 | **有**（新增全局分表变量） | 中 | 不动点 A 绿；**基线 B 重录**；`hir_test` RAW 计数不变；`cstgen --check` 生成物与清单一致 |
| **S3（P0）** | 跨切面属性迁到侧表（`node_type/resolve/mod/file/scope`），删 `Node.td` 与全局平行数组；`sema` 查侧表而非节点字段；侧表统一登记 `SideTable{name,owner,dirty}`（§4.5） | S2 | **有**（删字段） | 中 | 不动点 A 绿；**基线 B 重录** |
| **S4（P1）** | 消费者逐步换用访问者（生成的 `node_visit`/`transform`）；**删除旧 `base.Node` 字段**；**删除 re-export 垫片**（§4.14.4），`src` 直接 `@import("std.rc.cst")`；`node_to_hir` 桥切到 `NodeRef` | S3 | **有**（删字段 + 去垫片） | 高 | `hir_test` 穷尽性守住（`node_visit` 分支数 == `NK_*` 数）；gate L2 + nightly 全绿；**基线 B 重录** |
| **S5（P2）** | `Span` 取代 `ln/cl/tv`；CST `.ast` 序列化；trivia（span 间隙）+ error node；可选 green/red 增量 | S1（`Span` 可并行于 S2–S4） | **有**（删 `ln/cl/tv`） | 中 | IDE/格式化 smoke；**`conformance` 诊断期望可能需同步**（行/列来源换了）；不动点 A 绿 |
| **S6（P1）** | 引入 `lower_policy[]`（cstgen 生成）；`hir.tc` 7 个硬编码「不透明 BLOCK」分支改查表；引入 **SAST 渐进降级层**（§4.11.4）；脱糖函数收口为 `g_desugar_passes`（按 `order`），`sema` 驱动遍历该表（§4.11） | S3 | **预期无**（脱糖结果应等价）；若 snapshot 红则按 §4.10.0 判据处理 | 中 | 不动点 A 绿；**`HIR_OP_RAW == 0`**（非「计数不变」）；**HIR 中无糖 kind 节点残留**（§4.11.1 正向断言）；L2 双后端逐字节一致 |
| **S7（P1）** | 引入 `Pass`/`PassManager`；comptime 折叠 / 单态化 / borrow-verify 迁为注册 `Pass`；侧表加 `owns`+`requires`+失效（§4.12）；**CfgPass**（§4.16） | S6 | 视是否触碰 IR 而定（纯框架期预期无） | 中 | 不动点 A 绿；`g_passes` 拓扑无环；action-key 含 pass 集 |
| **S8（P2）** | 暴露 `@desugar` / `@pass` 扩展原语 + 插件加载（§4.13）；`tc fmt` 与 `tc lint` 改为共用底层 CST/HIR（G7）；用户扩展与内置走同一套 `dagcheck` 断言 | **S5 + S6 + S7**（fmt 需要 S5 的 trivia 才能保留注释/空白） | — | 中 | 用户插件通过 `gate L2` 双后端一致 + fmt/lint smoke；不动点 A 绿 |

**依赖图（关键路径 = S0→S1→S2→S3→S4）**

```
S0 ──→ S1 ──┬──→ S2 (S2a 新建 cstgen → S2b 分表) ──→ S3 ──┬──→ S4（删旧字段 + 去垫片，关键路径终点）
            │                                              │
            │                                              └──→ S6（lower_policy + SAST）
            │                                                     └──→ S7（PassManager + CfgPass）──┐
            │                                                                                        │
            └──→ S5（Span / trivia / .ast，可并行于 S2–S4）────────────────────────────────────────┴──→ S8
```

- **关键路径**：`S0 → S1 → S2 → S3 → { S4 ｜ S6 → S7 } → S8`；**S5 可并行**于 S2–S4，但**必须在 S8 之前完成**（fmt 靠它的 trivia 保留注释/空白）。
- **S4 不直接进 S8**：S8 的硬依赖是 S5 + S6 + S7；但工程上应先完成 S4（删旧 `base.Node` 字段），否则 S8 的插件 API 会同时暴露新旧两套节点表示。

> **为何 S2a 必须前置到 S2、而不是放在 S4**：S2 就要产出「分表 + 类型化 `mk_*`」，若此时手写、到 S4 再改由生成器产出，等于**同一批代码写两遍**，且第二遍极易与手写版漂移。故生成器必须在 S2 之前到位（§7 第 7 条的退路已按此同步：S0/S1 可全手写，**S2 起建议生成器，最晚 S4 必须有**）。
>
> **为何 S1 不删 `base.Node` 字段**：`hir.tc`/`sema.tc`/`codegen_*` 大量读 `na/nb/la…`；双写期保留旧字段保证「改一个文件只动解析层」；S4 收口后再删，避免一次性大改触发自举回归（历史教训：改 `src/*.tc` 前须确认门禁）。注意：**保留旧字段 ≠ 字节兼容**——新增 `tag` 必然改变布局，故 S1 的 IR 基线**必须重录**，本节早先「保持字节兼容」的写法不成立，已修正。

---

## 4.11 可扩展的语法糖架构（Sugar as registered desugar passes）

> 目标：把「加一条新糖」的接入成本从 **改 3 文件 + 守 RAW 归零** 降到 **1 文件 + 1 行 `register_desugar`**，且每条糖可审计、可对其双后端一致性做门禁断言。

### 4.11.1 项目铁律（先写进规范，防 姿势 B 后门）

来自 `docs/design.md` 与 L2 门禁，v2 重设计**不削弱**这两条：

- **R-SUGAR-A（姿势 A 强制）**：任何糖语法**必须**脱糖为既有节点 / IR 构造；禁止平行另立求值 / 匹配 / 作用域机制（姿势 B = 违规）。
- **R-SUGAR-L2（双后端一致）**：脱糖产物在两后端必须逐字节一致；唯一真风险点是「动态语义不能朴素 phi」（如循环最后一次成功交付 + `else` + `break v`），须先脱糖成「累加器 + 标志」再分后端，由构造保证一致。

> **铁律的强制力落到三处接入点（防 姿势 B 后门）**：v2 重设计新增的 `lower_policy` / SAST / `DesugarPass` 是后门高发区，须逐一堵死——
> 1. **`lower_policy` 不是扩展点**：该表仅为**设计期登记的内建块式糖**（`block_expr`/`while`/`for`/`unit_lit`/`bitstr`/`import_expr`/`variant_lit`）服务，取值只能是 `LOWER_DIRECT`/`LOWER_EXPAND`/`LOWER_OPAQUE`；**用户新糖禁止新增 `LOWER_OPAQUE` 条目**——新糖必须经由 `DesugarPass` 完全脱糖为既有 core 节点，不得借 `lower_policy` 落地平行 Lowering 机制（那是 姿势 B）。`dagcheck` 门禁断言：除设计期白名单外，任何 `NK_*` 不得新增 `LOWER_OPAQUE`。
> 2. **SAST 是瞬态、非目标形态**：SAST 仅允许「尚未完全脱糖」的中间态；**最后一个 `DesugarPass` 跑完时，残留的糖节点数必须为零**（只剩 core 节点）；`AstGen` 降到 HIR 前断言「无糖 kind 节点存活」。SAST 不得被固化成「第二种 AST」长期存在（那是 姿势 B 的温床）。
> 3. **`DesugarPass.run` 的合同**：函数体只能「产出既有 core 节点 / 后续 Pass 会接着脱糖的 SAST 节点」；一旦 `run` 引入了新求值原语 / 新匹配原语 / 新作用域原语，即 姿势 B，在 code review + 门禁双重拦截。
> 4. **用户 `@desugar` 同律**：用户插件注册的脱糖与内建**同一套 API、同一套铁律**——门禁对插件产物同样断言「双后端逐字节一致 + 无糖节点残留 HIR」。

> **门禁加强（必要但不充分 → 必要且更充分）**：在既有 `HIR_OP_RAW == 0` + L2 双后端逐字节一致之外，新增**正向断言**——「HIR 中不得出现任何糖 kind 节点」（白名单之外的糖 kind 一旦存活即失败）。这把 姿势 B 从「可能蒙混」变为「结构上不可达」。`docs/design.md` 的既有 L2 不变量（`catn_check` / `conformance` / `shadow_check` / `"assign"` 节点 / `sb_catN` 实参严格 = N）是**最终兜底**，v2 重设计不得移除、不得弱化——它们是 R-SUGAR-L2 的真正执行体，不是文档声明。

> 注册式脱糖让每条糖的 `desugar` 函数集中、可审计；门禁可对每个 `DesugarPass` 断言其双后端输出一致（§4.11.3 第 4 步）。

### 4.11.2 降级策略表（替代 `hir.tc` 硬编码逃生舱）

当前 `hir.tc::hir_lower_expr` 用 7 个硬编码分支把 `block_expr`/`while`/`for`/`unit_lit`/`bitstr`/`import_expr`/`variant_lit` 当「不透明 BLOCK」。`tools/cstgen.mjs`（§4.3 注）生成 `NK_*` 时**一并生成**每 kind 的降级策略（清单里可逐 kind 覆写）：

```c
pub const LOWER_DIRECT: i64 = 0;  // 直接降级为单条 HIR op（如 binary / call / ident）
pub const LOWER_EXPAND: i64 = 1;  // 展开为子树（如 while → block + if）
pub const LOWER_OPAQUE: i64 = 2;  // 不透明承接：发 HIR_OP_BLOCK 空壳，子树交由 sema 走 CST
pub var lower_policy: []i64;      // 下标 = NK_*，值 = 上述策略；cstgen 默认 LOWER_DIRECT
// 声明式 kind（block_expr/while/for/…）在 cst_kinds.json 标注为 LOWER_OPAQUE
```

`hir_lower_expr` 改为**查表分发**：新增「块式糖」只需在 `cst_kinds.json` / `@desugar` 声明里把该 kind 标 `LOWER_OPAQUE`，**不再改 `hir.tc` 代码**。`dagcheck` 门禁断言 `lower_policy` 对全部 `NK_*` 有定义（无遗漏 = 无 RAW 逃生舱、无静默错编）。

> ⚠ **`LOWER_OPAQUE` 是过渡机制，不是永久机制**：它的存在是为了在 S6 期间**保住当前行为**（那 7 个 kind 目前由 sema 在 CST 上就地脱糖，HIR 侧只能看到不透明 BLOCK）。它与 §4.11.1 铁律第 1/2 条（糖必须全脱糖为 core、无糖节点存活到 HIR）**方向相反**，因此：
> - 该策略**仅限设计期白名单**的 7 个既有 kind（`block_expr`/`while`/`for`/`unit_lit`/`bitstr`/`import_expr`/`variant_lit`），**用户新糖禁止新增 `LOWER_OPAQUE` 条目**（§4.11.1）；
> - 随着这 7 个 kind 逐一获得真正的 `DesugarPass`（产物落 SAST、最终降为 core），对应 `LOWER_OPAQUE` 条目应**逐条退役**；
> - 目标态：**`LOWER_OPAQUE` 归零**，全部 kind 走 `LOWER_DIRECT`/`LOWER_EXPAND`，`lower_policy` 退化为纯查表优化而非语义逃生舱。门禁应跟踪 `LOWER_OPAQUE` 条目数，只减不增。

### 4.11.3 脱糖即注册式 Pass（Desugar PassManager）

把散落的 `desugar_lambdas`/`desugar_func_clauses`/`desugar_format_call`/`lower_pipe`/`lower_for_range`/`desugar_value_loop`/`desugar_imports`/`lower_array_len_infer` 统一为**有序的脱糖 Pass 列表**，每个 Pass 是一个注册项：

```c
pub struct DesugarPass {
    name: Sym32("Pass");
    order: i64;                  // 脱糖顺序（原 phase，改名以避免与 Pass.stage 混淆，见 §0.6 裁定 2）
                                 //   func_clauses(1) < lambdas(2) < imports(3) < per-node(9)
    run: fn(NodeRef) NodeRef;    // **节点级改写**：入 = 待脱糖节点，出 = 脱糖后节点（或原节点表示不变）
                                 //   统一为节点级（不再提供模块级 fn() void 变体），理由见下方
    raw_impact: i64;             // 预估对 HIR_OP_RAW 计数的影响（门禁对账用）
}
pub var g_desugar_passes: []DesugarPass;
pub fn register_desugar(p: DesugarPass) void { append(g_desugar_passes, p); }
// sema 驱动：按 order 升序跑 g_desugar_passes（取代 sema.tc:13235 的硬编码顺序）
```

> **`run` 形态裁定：统一为节点级 `fn(NodeRef) NodeRef`（删掉模块级 `fn() void` 变体）**
> - **依据 §4.11.1 铁律第 3 条**：该条把 `run` 的合同描述为「产出既有 core 节点 / 后续 Pass 会接着脱糖的 SAST 节点」——这**只能**是节点级改写语义，模块级 `fn() void` 无法表达「该节点变成了什么」，也就无法被门禁断言「是否姿势 A」。
> - **依据 §4.13.1 用户 API**：用户糖写作 `pub fn desugar_my_sugar(n: NodeRef) NodeRef`，本就是节点级；保留模块级变体会让内置与用户两套形态不一致。
> - **不可变契约**：`run` 返回**新节点**，不原地改入参（G2 / §4.2「CST 永不改写」）——这与现状 sema 原地改 CST 是根本区别，也是 `hir_invalidate` 得以退场的前提。
> - 需要「整趟扫描后再改写」的糖（如 import 收集）可注册为 `order` 靠前的 Pass 做**分析写侧表**，真正的改写仍由节点级 `run` 完成——避免开模块级改写的口子。

**新糖的接入流程（取代「改 3 文件 + 守 RAW」）**：

1. 在 `tools/cst_kinds.json` 加 kind → `cstgen` 生成 `NK_*` + 分表 + `mk_*` + `node_visit` 分支 + `lower_policy` 项。
2. 写 `desugar_<sugar>`：把新 CST 节点改写成既有节点（**姿势 A**，落 SAST）。
3. `register_desugar({name, order, run})`；若为块式，在 `cst_kinds.json` 标 `LOWER_OPAQUE`。
4. 门禁自动守：`node_visit` 穷尽性 + `lower_policy` 全覆盖（且除白名单外无新增 `LOWER_OPAQUE`）+ `HIR_OP_RAW == 0` + **HIR 中无糖 kind 节点残留** + L2 双后端逐字节一致断言（§4.11.1 铁律）。

### 4.11.4 SAST（Sugared AST）渐进降级层

为支撑「糖 → 糖 → core」的**可组合**脱糖，在 CST 与 HIR 间引入 SAST：仍是分表 typed 节点，但允许保留「尚未完全脱糖」的中间形态。每个脱糖 Pass 消费 SAST、产出更靠近 core 的 SAST，**最终由 AstGen 一次性降到 HIR 前，SAST 中的糖 kind 节点必须已归零**（只剩 core 节点；约束见 §4.11.1 铁律第 2 条）。这把 `compiler-pipeline-design.md` 的「渐进降级（progressive lowering）」哲学前移到前端，且让单元测试可单独验证某条糖的降级结果（不必每次跑全管线）；SAST 是**瞬态中间层**，不得被固化成长期存在的「第二种 AST」。

---

## 4.12 管线处理节点（Pass）框架

> 目标：把「加一个处理节点（分析 / 优化 / 变换）」的接入成本从 **手工塞进 sema 驱动或 codegen** 降到 **1 文件 + 1 行 `register_pass`**，且 Pass 间依赖、排序、侧表失效由框架托管。

### 4.12.1 动机

`compiler-pipeline-design.md` 已规划 mir 上的 borrow-verify pass（G-7）、comptime 折叠、泛型单态化、IR 级 FDO 布局（G-11）等处理节点；未来还会加内联、常量传播、DCE、循环变换、自动向量化（G3 中端优化）。v2 原 §4.2 是线性图，无 `Pass` 抽象——新增节点 = 手工接线、隐式顺序、运行期才暴露错序。本规范补齐。

### 4.12.2 Pass 抽象

```c
pub const PASS_ANALYSIS:  i64 = 0;  // 只读 IR，产出侧表（类型 / 借用 / 可达性）
pub const PASS_TRANSFORM: i64 = 1;  // 改写 IR（comptime 折叠 / 内联 / DCE）
pub struct Pass {
    name: Sym32("Pass");
    stage: i64;             // 作用 IR 层：HIR=1, MIR=2, TIR=3, TMIR=4
    kind: i64;             // ANALYSIS | TRANSFORM
    owns: []Sym32("Table");      // 本 Pass 负责的侧表名（如 "borrow" / "reach"）
    requires: []Sym32("Table");  // 依赖的其它侧表（未就绪则先跑依赖 Pass）
    run: fn(mod: ModuleRef) void;
}
pub var g_passes: []Pass;
pub fn register_pass(p: Pass) void { append(g_passes, p); }
```

### 4.12.3 PassManager（排序 + 依赖 + 失效）

- **排序**：同 `stage` 内按注册顺序；跨 `stage` 按管线阶段（HIR → MIR → TIR → TMIR）。
- **依赖**：`requires` 未满足则自动前置该 Pass（拓扑序），取代 `sema.tc` 的隐式手写顺序。
- **失效（增量关键）**：每个侧表记「由哪层 IR + 哪趟 Pass 产出」。当上游 IR 因编辑 / 重解析改动，PassManager 仅重跑**受影响 stage 及下游**且 `owns` 该侧表的 Pass，其余复用缓存——直接支撑 `compiler-pipeline-design.md` 的 per-file / per-API 增量与 `.tmi` 指纹。
- **可观测**：`passes-ran`、`side-tables-dirty` 计入 `perf-baseline` 与 `ci-gate-design.md` 的 action-key（含 `pass 集` + 工具链版本）。

### 4.12.4 与既有模块的接口

- **新建 `tools/cstgen.mjs`**（取代已删除 totter，§4.3 注）：「kind 清单 → enum + 分表 + `mk_*` + visitor + **`lower_policy`** + **`pass` 骨架**」。
- **`src/hir.tc`**：`hir_lower_expr` 改查 `lower_policy` 表（§4.11.2），删 7 个硬编码分支。
- **`src/sema.tc`**：脱糖驱动改为遍历 `g_desugar_passes`（按 `order`），删 `sema.tc:13235` 硬编码顺序。
- **`src/mir.tc` / 未来 `codegen_*`**：comptime 折叠 / 单态化 / borrow-verify 迁为注册 `Pass`，而非散落调用。
- **`tools/dagcheck.mjs` / `hir_test.mjs`**：门禁增两条断言——
  - `lower_policy` 全覆盖（无 RAW 后门）；
  - `g_passes` 拓扑无环 + 新 `Pass` 必在 `compiler-pipeline-design.md` 登记（防止幽灵 Pass）。

### 4.12.5 验收

- 新增一条糖：仅新增 1 文件 + 1 行 `register_desugar`，`gate L2` 全绿 + `HIR_OP_RAW == 0` + L2 双后端逐字节一致。
- 新增一个处理节点：仅新增 1 文件 + 1 行 `register_pass`，`nightly` 自举 `g1` 不动点 `.ll` md5 不变。
- 任一 `requires` 缺失或成环：门禁即报（取代运行期隐式顺序错）。

---

## 4.13 用户可扩展语法与编译管线（§4.1 G8）

> 目标：把 §4.11 的注册式脱糖、§4.12 的 Pass 框架从「编译器内置能力」提升为「用户可编程的扩展点」——用户不改 `src/`，就能给语言加糖、给管线加处理节点。这与 t 的自托管特性天然契合：扩展点本身就是 t 代码。

### 4.13.1 扩展原语（编译器内建）

用户提供两个声明属性（compiler intrinsic），在模块加载期触发注册：

```c
// 用户模块 mylang.tc
@desugar(order = 3)
pub fn desugar_my_sugar(n: NodeRef) NodeRef {
    // 姿势 A：把 my_sugar 节点改写成既有核心构造（落 SAST）
    ...
}

@pass(stage = MIR, kind = TRANSFORM, owns = ["myopt"], requires = ["reach"])
pub fn my_opt_pass(mod: ModuleRef) void {
    // 中端优化 / 分析，写回侧表 myopt
    ...
}
```

`@desugar` / `@pass` 在语义期前由编译器扫描并调用 `register_desugar` / `register_pass`（§4.11.3 / §4.12.2），与内置糖/Pass **完全同一套 API、同一套排序与失效机制**。

### 4.13.2 作用域与 ABI 边界

- **默认模块局部**：用户糖/pass 仅在本模块可见，不影响语言全局语法；导出须显式 `pub` + 在模块 API（`.tmi` 指纹）登记——下游依赖因指纹变化自动重查。
- **零 姿势 B**：用户 `@desugar` 仍只能脱糖为既有核心构造（姿势 A），禁止引入平行求值/匹配机制；门禁对插件同样守 `docs/design.md` 铁律（L2 双后端逐字节一致）。
- **自举一致性**：用户插件是普通 t 模块，随模块一起被 `tc.exe` 编译；其 desugar/Pass 在 `sema`/`mir` 阶段插入，受 `gate L2` 双后端对拍约束，不会因「用户扩展」绕过一致性校验。

### 4.13.3 与 fmt / lint 共用底层的关系（§4.1 G7）

用户扩展、内置糖/Pass、`tc fmt`、`tc lint` 四者**共享同一套底层**（lexer / parser / 不可变 CST / SAST / HIR / visitor / 侧表）：

- `tc fmt` 只消费 **CST + trivia**（注释/空白/布局），对糖语法「原样保留、按规范重排」——无论该糖是内置还是用户 `@desugar` 引入，格式化都不关心其语义。
- `tc lint` 只消费 **HIR + 语义侧表**（类型/作用域/数据流），可对糖「展开后检查」或「按糖语义规则检查」；用户 `@pass` 产出的侧表（如 `myopt`）也能被 lint 直接读取。
- 因此新增糖/Pass 时，`fmt` 与 `lint` **无需任何改动**即可获得对新语法的覆盖（这正是 G7 要消除的「每加一个特性工具各改一遍」）。

### 4.13.4 验收

- 用户加一条糖：新建模块 + `@desugar` 函数，`gate L2` 全绿 + `HIR_OP_RAW == 0` + 双后端一致；`tc fmt` 能原样格式化、`tc lint` 能识别。
- 用户加一个 Pass：新建模块 + `@pass` 函数，nightly 自举 `g1` 不动点 `.ll` md5 不变；其侧表可被 `tc lint` 消费。
- 插件与内置**同一套** `dagcheck` 断言（穷尽性 / `lower_policy` 覆盖 / 拓扑无环）。

---

## 4.14 命名空间归属：std.rc.cst（库模块）

> 指令（本设计阶段）：具体语法树相关代码迁入 **std 库**，具体路径 **`std.rc.cst`**，使 `tc fmt` / `tc lint` 引用方便（§4.1 G9）。本阶段只定规范，不改 `src/` 代码。

### 4.14.1 为什么是库模块、不是 `src` 内联

`docs/reference.md` 已定义两套导入规则，语义截然不同：

- `@import("src.x")` → `<src_root>/x.tc`：**内联、单命名空间、随编译器整体编译**。
- `@import("std.mem")` → `out/lib/std/mem.tlib`：**库模块、预编译 `.tlib`、跨项目/工具共享**。

当前 `base`/`lex`/`parse` 全在 `src` 内联树；若工具要复用，只能 `@import("src.base")` —— 既污染工程命名空间，又使工具与编译器强耦合、无法独立编译。而 token 池 / `Node`（CST）/ 子列表池 / `Span` / `Diagnostics` / lexer / parser / visitor 本质是**编译器自身可复用设施**，天然属于 std 库。迁入 `std.rc.cst` 后，编译器与 `fmt`/`lint` 用**同一份**引用，工具零耦合 —— 这正是 G7（fmt/lint 共用底层）得以成立的物理前提。

### 4.14.2 模块布局

```
lib/std/rc/cst.tc        ← 库模块 std.rc.cst（单一伞模块，pub 导出全部 CST 子系统）
  pub:
    Tok, CstNode(=Node), Child, kids 池, g_cur_mod / g_node_mod / g_node_file
    Span, Diagnostics(错误码 + 收集器)
    lex_*(lexer，依赖 Tok / Diagnostics)
    kw(关键词分类：TokKind 强制词 / ctx_kw_role 上下文角色表 / KwMod / KwAttr / RawIdent，§4.15)
    parse_* / mk_*(parser，依赖 lex / kw / CstNode)
    accept_name()                      ← 标识符专用上下文统一入口（§4.15.4），8 类位置共用
    node_visit / transform(visitor 框架，fmt / lint / desugar 共用)
    trivia（S5：先做 span 间隙，见 §4.8 裁定）
    SideTable / register_table(侧表登记，§4.5)
  // 未来同级可加 std.rc.hir / std.rc.tir 供 lint / 后端工具复用（不在本指令范围）
```

> **`accept_name()` 为何必须导出**：§4.15.4 的 8 类「标识符专用上下文」（点号后 / `let`·`var` 后 / 字段名 / 模式绑定 / 命名参数 / `::` 后 / `as` 别名 / 标注属性名）要靠同一个函数接收**任意 token 作名字**。若各 parser 分支手写，必然出现「某处忘了接受关键字」的静默错编（正是 §1.3 第 7 条的老坑）。导出后，内置 parser 与用户 `@desugar` 走同一实现，门禁可用「8 类位置全覆盖」断言守住。

`rc` = **reflection / compiler** 子系统命名空间，用于承载编译器自身可复用设施；缩写以团队约定为准（此处采用用户指定路径 `std.rc.cst`）。

### 4.14.3 导出面（供 fmt / lint / 编译器消费）

| 消费者 | 引用 | 用到什么 |
|---|---|---|
| 编译器 `src/*.tc` | `const cst = @import("std.rc.cst")` | `CstNode` / `Tok` / `lex_*` / `parse_*` / `Diagnostics`（替代原 `src.base`/`src.lex`/`src.parse`） |
| `tc fmt` | `const cst = @import("std.rc.cst")` | `CstNode` + trivia + `Span`（只读布局/注释/空白） |
| `tc lint` | `const cst = @import("std.rc.cst")`（+ 后续 `std.rc.hir`） | `CstNode` + HIR + 语义侧表 |
| 用户 `@desugar` / `@pass` | `const cst = @import("std.rc.cst")` | `node_visit` / `transform` / `CstNode` 构造 / `accept_name()`（`§4.15.4` 名字接收，与内置 parser 同一实现） |

### 4.14.4 过渡垫片（保自举不动点）

- `src/base.tc` 暂不直接删除，改为 **`std.rc.cst` 的 re-export 垫片**：`pub use std.rc.cst::*;`（或逐符号 `pub const Node = cst.CstNode;` 等），使所有 `base.Node` / `base.nodes` / `base.idecl_*` 等既有引用**字节级不变** → `.ll` 指纹不变。
- `src/lex.tc` / `src/parse.tc` 同理暂留 re-export 垫片（或直接改为 thin wrapper 调 `std.rc.cst` 的 `lex_*`/`parse_*`）。
- 过渡期内 `src` 内联版与 `std.rc.cst` 库版**指向同一份定义**，避免双份实现漂移（这正是当前 `base` 被多处 import 的坑：一旦两份就静默错编）。

### 4.14.5 自举构建顺序（bootstrap 影响）

- `std.rc.cst` 是库，须先编译为 `.tlib` 再被编译器引用。构建顺序：
  1. 种子/当前编译器先用其内置副本（或冻结快照）产出 `out/lib/std/rc/cst.tlib`；
  2. 再编译 `src/tc.tc` 等（它们 `@import("std.rc.cst")`），链接该 `.tlib`。
- 与 `docs/reference.md` 的 `tools/build_std.mjs`（std 预编译）同构；`tools/bootstrap.mjs` 在 S0 阶段把「先建 `std.rc.cst.tlib`」纳入前置步骤。
- ⚠ **（已证伪并修正）**「因 `src/base.tc` 等仅作 re-export 垫片 ⇒ 自举 `g1` 的 `.ll` md5 **逐字节不变**」**不成立**：跨包库导入经 `mangle_modules` **必然重整**符号（`g_kw_text` → `cst__g_kw_text`），**即便走内联回退也重整**（rule 2 的「IR 不变」只对**入口模块**成立）。故 S0 **必改 IR、必按 §4.10.0 重录基线 B**，判据 A（自举不动点）才是硬门。
- **S0 落地清单（与现实文件对齐；第 2 项已按实测改写）**：
  1. 新建目录 **`lib/std/rc/`**（当前 `lib/std/` 下只有扁平 `*.tc`，**无 `rc/` 子目录**），落 `lib/std/rc/cst.tc`；—— ✅ 已完成
  2. **`tools/build_std.mjs:32` 的 `MODULES` ——暂不加 `"rc.cst"`**（早先设计写「必须加入」，**已按实测推翻**）。原因见 §4.14.7：库模式（a）不发射运行时 shim 声明 → `tll_alloc` undefined；（b）跳过 `t.__ginit` → 带初始化器的全局**永久为零且静默**。在编译器侧补上这两点前，`std.rc.cst` 走**源码内联导入**（无 `.tlib` 时编译器自动内联），**功能与门禁均不受影响**（gate L1 15/0 已验证）。
     - 已做的**通用化改造**（不改语义、为将来嵌套模块预留）：`MODULES` 支持**点分逻辑名**，由 `dots_to_slashes` 同时推出源路径（`lib/std/rc/cst.tc`）与产物路径（`out/lib/std/rc/cst.tlib`），并 `mkdir -p` 父目录。将来解除阻塞时**只需往 `MODULES` 里加一项**。
  3. 路径映射沿用 `dots_to_slashes` 规则：`std.rc.cst` → **`out/lib/std/rc/cst.tlib`**（多层点路径自然成立，与 `std.mem` → `out/lib/std/mem.tlib` 同构），**不要**退回旧的扁平 `out/lib/<mod>.tlib`。

### 4.14.6 与 S1–S8 的关系

- 命名空间迁移（S0）与 S1（kind 枚举）/ S4（分表）/ S6（糖架构）**正交**：S0 只搬位置、不改内部结构，可**最先执行**。⚠ 但风险并非原先标的「最低」——见 §4.14.7 的库全局状态约束。
- S4 删除旧 `base.Node` 字段时，一并删掉 §4.14.4 的 re-export 垫片，让 `src` 全部直接 `@import("std.rc.cst")`。

### 4.14.7 std 库模块的全局状态约束（S0 编码期间核对发现的硬约束）

> 本节为 **S0 实施期间**核对 `docs/reference.md` rule 6b 后新增。它直接决定「什么能搬进 `std.rc.cst`」，是原规范遗漏的关键可行性前提。

- **事实**：`.tlib` 是**独立编译**的产物（`clang -c` → `.o` → `llvm-ar rcs` 归档）。reference.md rule 6b 明确：**库独立编译时跳过进程级全局**（`t__ginit` / `t_atom_table` / `t_atom_count`，由主程序提供，避免重复符号）。
- **推论**：凡带**运行期初始化器**的全局状态（非编译期常量的全局 `var`——如 `var nodes: []Node = []`、map 字面量、需运行期 intern 的字符串），其构造会被搬进 `t__ginit`（C 文件作用域不允许函数调用，见 `codegen_c.tc:5104-5123`）；而库的 `t__ginit` 在链接模式下**不会被执行** ⇒ **这些全局不会被初始化** → 运行期未定义行为。
- **因此 S0 拆两步**：
  1. **S0a（先做，低风险）**：只搬**无运行期全局初始化**的设施——编译期常量表（如 `[41]string` 定长数组）、纯函数、类型定义。**当前试点 = 关键字表 + `kw_lookup`**（原 `src/lex.tc` 的 `GEN:kw_lookup` 区间；已核实其他 `src` 文件对它**零引用**，影响面完全隔离）。
  2. **S0b（后置，需先验证）**：`base`/`parse` 的节点池（`nodes[]` / `kids[]` / `g_idecl_*`）**暂缓**搬入 `.tlib`，直至「库全局初始化」被专门验证或支持。候选解法：① 由主程序显式调用库的显式 init 函数（约定名 + 驱动层调用）；② 让链接模式保留并执行库的 `t__ginit`。二者都需要编译器侧改动，**不属 S0 范围**。
- **工具可读性目标（G9）不受影响**：即便 S0b 未做，`tc fmt` / `tc lint` 仍可 `@import("std.rc.cst")` 引用已搬入的部分；尚未搬入的部分短期内仍走 `src` 内联，G7「共用底层」的**方向**已确立。
- **IR 必变（再次确认）**：跨包库导入经 `mangle_modules` 把符号重整为 `cst__xxx`（`g_kw_text` → `cst__g_kw_text`）。⚠ 注意 **rule 2 的「IR 逐字节不变」只对入口模块成立**（入口别名 `""` 永不重整）；跨模块 import 库**必然重整**，**即便走内联回退也重整**。故 S0a 就需按 §4.10.0 重录基线。

#### 4.14.7.1 实测证据：库模式的两个失效点（`node tools/build_std.mjs` 直接观测）

> 把 `rc.cst` 加入 `MODULES` 后实测（编译器 `out/dbg/tc.exe`），得到**两条独立证据**，均**可复现**：

```llvm
; out/lib/std/rc/cst.ll（--lib 产物，节选）
%cst__kw_lookup.t2 = call ptr @tll_alloc(i64 %cst__kw_lookup.t2.bytes)   ; ← ① 调用了…
…
declare i32 @tll_str_eq(ptr, ptr)                                       ; ← 只有按需声明
@cst__g_kw_text = global [41 x %TStr] zeroinitializer                   ; ← ② 真值全部丢失
```

| 失效点 | 机制 | 证据 | 后果 |
|---|---|---|---|
| ① **shim 声明缺失** | `tll_alloc` / `t_runtime_init` / `t_arena_new` 等由 `src/tir_to_ll.tc::ll_emit_main_wrapper` 发射，首行 `if (g_has_main == false) { return; }`（:4993） | `clang -c` 报 `use of undefined value '@tll_alloc'` | **响亮失败**（链接期中断，不会静默） |
| ② **全局初始化丢失** | 带初始化器的全局**一律**发成 `zeroinitializer`，真值由 `t.__ginit` 逐元素回填（`g1.ll:662834` 回填、`664915` 定义）；库模式**不发射 `t.__ginit`** | 对比 `g1.ll`（主程序）有 `define void @t.__ginit()` 且含 41×3 条 store，而 `cst.ll`（库）无此函数 | **静默错编**：链接后关键字表恒为全零，`kw_lookup` 恒返回 `""` |

对照组：`std.mem` / `std.math` **无全局状态** ⇒ 两条失效点都不触发 ⇒ 现状预编译安全。**这就是 R-LIB-PURE 的经验来源。**

#### 4.14.7.2 R-LIB-PURE：`.tlib` 模块的准入规则（新增硬规则）

> **规则**：一个模块可被预编译为 `.tlib` 并被链接消费，**当且仅当**它满足：
> 1. **零初始化全局**——不发任何带初始化器的模块级 `var`/`const`（判据是**发射产物是否依赖 `t.__ginit`**，不是源码看起来是否常量：`const` 同样发 `zeroinitializer`）；
> 2. **纯/自包含**——不依赖主程序才有的进程级全局（`t_atom_table` / `t_atom_count` / arena）；
> 3. **可选**：确需堆分配时，须先解除失效点 ①（库模式补发 shim 声明）。
>
> **违反后果不对称**：违反 ① ⇒ **静默全零**（最危险，门禁可能照样绿）；违反 ③ ⇒ 链接期报错（安全）。
> **建议的护栏（未落地，登记为待办）**：在 `--lib` 路径上，对「带初始化器的全局」发**诊断（warning→ 后续可升 error）**或至少在 `build_std.mjs` 里做静态扫描，把静默失败变成响亮失败。

#### 4.14.7.3 S0b 的前置（解锁条件）

S0b（`base`/`parse` 节点池迁入 `.tlib`）**必须先**解决：
1. **库模式 shim 声明**（小改：`ll_emit_main_wrapper` 的 declare 段抽成 `ll_emit_runtime_declares()`，库模式也调）——**不改动任何成功路径的 IR**，风险低；
2. **全局静态初始化器发射**（中改：把常量初始化器直接发成 LLVM `global … [ ... ]`，让全局不再依赖 `t.__ginit`）——顺带是主程序优化（省掉 ginit 中每条 store），但**会大幅改变 IR**，须**单独立项 + 整体重录基线 B**，不可与 S0/S1 混在同一提交。

---

## 4.15 关键词分类体系与 CST 表示（参考《最大化标识符设计》）

> 核心命题：**最大化标识符 = 引起最少关键词 + 最少字面量值**。当前 `t` 的 `src/lex.tc` 有 41 项关键字（`g_kw_text`/`g_kw_kind`），全部在**词法层**预分类为 `Kw*` token——这正是附件所批评的「词法硬保留过多、lexer 吞掉本该下沉到 parser 的上下文判定」反模式。本规范把关键词重分类并落到 `std.rc.cst` 的 lexer / CST 节点上。

### 4.15.1 三级分类

```
关键词
├─ 强制关键词 (Forced / 硬保留)
│     歧义位置（语句起始 / 表达式起始）优先解析为关键字，不可回退为标识符；
│     但「标识符专用上下文」（见 §4.15.4）仍可作为名字。
│     最小硬保留集合（按附件推导 + t 语法骨架实测）：**fn, let, var, const, if, else, return**
│     ⚠ 绑定类关键字（let / var / const）形状完全同构（`var x=1`、`let r=&a`、`const X=...`），
│       按本节判定规则必须**同进同出**：要么都强制，要么都上下文（见下方「裁定」）。
│
└─ 上下文关键词 (Contextual) —— lexer 一律输出 Ident，仅特定语法位置被 parser 识别为关键字
   ├─ 修饰关键词 (Modifier)   改变语义：pub, extern, export, comptime（值层面编译期求值）, meta, kernel, overload, extend, entry（候选入口点，§4.16.5）, when（声明层面条件编译门控，§4.16）...
   └─ 属性关键词 (Attribute)  修改元数据（布局 / ABI / 对齐）：align, offset, pack, volatile, bitpack ...
```

**为什么这样分**（附件论据）
- **强制关键词**：当且仅当某语法位置既能解析为关键字、又能解析为标识符起始，且有限前瞻（LL(k) / 固定 token 数）内无法区分时，才硬保留。例如 `let x = 1` 与「变量 let 乘 x」无法靠上下文消除 → `let` 强制；`fn foo()` 与「变量 fn 调用 foo」同理 → `fn` 强制。
- **修饰关键词**（改变语义）：如 `pub fn` 改变可见性、`extern fn` 改变链接语义、`comptime` 改变求值时机。它们只附着在声明/项上、在特定位置生效，故可作变量/字段名（如 `struct S { extern: i32 }` 合法）。
- **属性关键词**（修改元数据）：如 `align(16)`、`offset(...)`、`pack` 只影响内存布局/ABI，不改变语义，更不应占用命名能力，纯元数据 → 进侧表，不进语义。

> **裁定：`var` / `const` 归强制，不归修饰（修正本规范早先的错误归类）**
> - **依据一（本节自身规则）**：`let` 因 `let x = 1` 与「变量 `let` 参与表达式」在有限前瞻内无法区分而强制；`var x: T = 1`、`const X = ...` 与之**完全同构**，故同样强制。本节早先括号「如同时保留 var 则需同步硬保留」已暗示此结论，但修饰列表却把 `var/mut`、`const` 列为上下文——**自相矛盾**，现统一。
> - **依据二（t 实测）**：`src/lex.tc:39` 的 41 项关键字表同时含 `var`/`const`/`let`；examples + conformance 中 `var` 出现 **1208 次**（主绑定词）、`let` 仅 4 次（只读引用 `let r = &a`）、`const` 用于模块级常量。把使用量最大的绑定词降级为「可作变量名的上下文词」风险最高，且对标识符最大化收益最小。
> - **`mut` 从列表中移除**：t 现有 41 项关键字表**不含** `mut`，不应列为 t 关键词；若未来引入可变性修饰，再按本节规则归类。
> - **未来选项（不本轮做）**：若 t 采纳附件主张的**全局禁 juxtaposition**（并列/粘连不作为合法表达式），则 `let`/`var`/`const`/`if`/`for`/`while`/`match`/`return` 均可安全降为上下文，硬保留集可收敛到极小。此路径走 §4.15.6 的三阶段演进，不本轮一次性切换。

### 4.15.2 Token 层（std.rc.cst.lex）

lexer 不再对上下文关键词发 `Kw*` token，改为：

```c
enum TokKind {
    // 强制关键词 → 仍专有 token（歧义位置优先、不可回退）
    // 集合与 §4.15.1 裁定一致：绑定三兄弟 let/var/const 同构同进同出，必须同时出现
    KwFn, KwLet, KwVar, KwConst, KwIf, KwElse, KwReturn,
    // 其余一切 → Ident（含全部上下文关键词：修饰 + 属性）
    // ⚠ 注意：此处**不含** KwPub/KwExtern/KwComptime/KwWhen/KwEntry 等——它们已降为上下文词
    Ident,
    Int, Float, Str, /* ... 字面量 ... */
    // ...
}

// 上下文关键词表：Ident 文本 → 角色（仅 parser / 工具查询用，lexer 不消费）
enum KwRole { None, Modifier(KwMod), Attribute(KwAttr) }
fn ctx_kw_role(text: Sym16("Kw")) -> KwRole   // 对有限 Kw id match → 跳转表 O(1)（§4.4.1）；非关键字返回 None

// 字面量值（最少字面量集合，按附件）：true/false/null/undefined
// 方案 A（推荐，与 true/false 统一）：当作字面量 token，不占标识符名额歧义
```

要点：
- **lexer 与 parser 分层不变**：lexer 不感知语法上下文（不依赖前 token 是否为 `.` 等），可独立/并行/增量；「上下文判定」是 parser 层概念（附件明确反对 lexer 依赖上下文输出不同 token 种类，会破坏增量词法 + 给工具链加同步成本）。
- 点号后成员名（`s.fn` / `s.pub`）由 **parser 提供统一的 `accept_name()`** 在标识符专用上下文接收任意 token（含 `Kw*` 与 `Ident`），避免各处手写分支。

### 4.15.3 CST 节点层（std.rc.cst.cst）—— 修饰 / 属性结构化

声明类节点不再把 `pub`/`extern`/`comptime` 烤进布尔载荷（`ba/bb`），而是：

```c
struct CstNode {
    kind: NK,
    span: Span,
    // ...kind 专属字段（SoA 分表后拆出）...
}

// 声明节点（FuncDecl / StructDecl / GlobalVarDecl / ...）共享：
modifiers: []Mod,   // 修饰关键词，有序
attrs:     []Attr,  // 属性关键词，有序

struct Mod  { kind: KwMod;    span: Span }      // Pub / Extern / Export / Comptime / Mut / Const / Kernel / ...
struct Attr { kind: KwAttr;   args: []CstNode; span: Span }  // Align(n) / Offset(...) / Pack / Volatile / ...
```

收益：
- **fmt 原样还原**：`pub extern comptime fn` 直接按 `modifiers[]` 顺序 emit，不依赖布尔载荷位组合；`align(16)` 按 `attrs[]` 还原。
- **lint / 反射可查**：`lint` 可查询「此声明是否 `extern`」「字段 `align` 是否 ≤ 结构体 `align`」；反射返回元数据（layout/ABI）来源自 `attrs`，与语义侧表解耦。
- **新增修饰/属性零侵入**：加 `kernel`/`volatile` 只需扩 `KwMod`/`KwAttr` 枚举 + 在 `ctx_kw_role` 注册，**不改 `CstNode` 结构、不改 mk_* 签名**（对比当前加一个布尔载荷要动 `mk_FuncDecl` 参数、所有调用方、`.tlib` 接口）。

### 4.15.4 标识符专用上下文清单（parser 接收任意关键字为名字）

以下位置 parser 一律接受任意 token 作名字（实现为 `accept_name()` 复用）：
1. 点号之后的成员名（`s.fn` / `s.pub`）：点号后**不存在歧义**——语法只允许成员名，故 `fn`/`pub` 等强制/上下文关键词在此**直接降级为字段标识名**，无需任何前缀。
2. 变量绑定位（`let` / `var` 之后）
3. 结构体字段声明名
4. 模式绑定位
5. 命名参数名位
6. 路径 `::` 之后
7. `as` 别名位
8. 标注 / 属性名位

补充规则（附件）：以上位置接受任意关键字 token；与之相对，**歧义位置（语句起始 / 表达式起始）**关键字优先、不可回退。当关键字出现在歧义位置被解析为关键字而用户本意是变量引用时，错误信息应**同时给出「作为关键字」与「作为标识符」两种解释**。

**歧义位置的变量兜底**：在歧义位置（如语句/表达式起始）要把强制关键词当变量引用时，采用参考文档《最大化标识符设计》的**裸标识符（raw identifier）方案**：`@"let"`、`@"if"`、`@"return"` 等（即 `@` 前缀 + **字符串字面量**，字符串内容即标识符名）。它与 `@name(...)` 编译器函数调用**不冲突**——`@` 后紧跟**字符串**即裸标识符，`@` 后紧跟**标识符**即编译器函数，lexer 据此二义性判定（详见 §4.15.5）。无歧义上下文（§4.15.4 第 1–8 条）则直接收关键字作名、无需任何前缀。

### 4.15.5 `@` 前缀 = 编译器函数调用（编译期，非 runtime）

`@name(args)` 在 `t` 中表示**编译器函数调用**：在编译期（meta / 编译管线阶段）由编译器直接执行、**不产生运行时调用**。这与 runtime 函数调用是两类不同的语法/语义实体。

- **与 runtime 函数调用区分**：`foo()` 是运行时函数调用（落入 value 命名空间、进 codegen、有运行时帧）；`@foo(...)` 是**编译器函数**（落入 compiler 命名空间，在编译管线某阶段执行，产物是编译期效果——模块加载 / Pass 注册 / 编译期求值等），不直接生成运行时调用代码。
- **lexer（`std.rc.cst.lex`）**：
  - `@` 后紧跟标识符 → 产出 `TokCompilerFn(name)`（`name` 为 **`Sym32("CompilerFn")`**，**不进入普通标识符（`Sym32("Ident")`）歧义判定**）；其后为 `(` 与实参。
  - 编译器函数名自成命名空间，**不占用标识符名额**：`import`/`desugar`/`pass` 等仍可作普通标识符（如 `let import = 1` 合法）。
- **CST（`std.rc.cst.cst`，§4.15.3）**：专用节点 `CompilerFnCall { name: Sym32("CompilerFn"); args: []NodeRef; span }`，与运行时 `Call` 节点**类型区分**——便于 `fmt` 原样还原、`lint` 区分编译期/运行期、下游 Pass 识别。
- **已落地的编译器函数**（§4.13）：`@import("std.mem")`（模块加载）、`@desugar(order)`（注册脱糖 Pass）、`@pass(stage, ...)`（注册管线 Pass）。未来增列走**封闭登记制**（编译器枚举 + `ctx_compiler_fn` 表），与「最小化保留字」原则一致。
- **`@`-家族只含动作型元函数**：条件编译 / 入口点**不在此列**——`@entry`/`@main` 已从 `@`-家族撤回，改由 **`when`（条件编译关键词）+ `entry`（修饰关键词）+ CfgPass** 表达（§4.16），避免动作型与配置门控混为一谈。
- **裸标识符（raw identifier）与编译器函数不冲突**：参考文档《最大化标识符设计》的裸标识符采用 `@` 前缀 + **字符串字面量**（`@"..."` / `@"""..."""`），与 `@name(...)` 编译器函数调用**共用 `@` 但形态互斥**，lexer 可无歧义判定：
  - `@` 后紧跟**字符串** → 裸标识符 `RawIdent { text: Sym32("Ident") }`，字符串内容即标识符名（含空格/引号/与强制关键词同形均可；落 `Ident` 池，与普通标识符同命名空间）。
  - `@` 后紧跟**标识符** → 编译器函数 `CompilerFnCall`（见上）。
  - 因此 `@"let"` 是「名为 `let` 的变量引用」，`@import("std.mem")` 是「编译器函数调用」，二者绝不混淆，`@` 前缀不占用标识符名额也不被编译器函数占用。
  - 用途：① 歧义位置引用以强制关键词为名的变量（`@"let"`、`@"return"`）；② 名字含空格/标点/引号等标识符专用上下文也无法承载的字符。
  - 约束：`@"..."` 后不能紧跟 `(`（那会被解析为编译器函数而非裸标识符）；字符串内容做 NFC 归一化保证反射一致性；建议禁止空字符串名。

### 4.15.6 演进策略（降硬保留为上下文，不破坏旧码）

未来若要把某个强制关键词降级为上下文：
- 第一阶段：降为「上下文 + 弃用警告」（原位置仍按关键字解析，作标识符使用发警告）；
- 第二阶段：收紧为纯上下文（移除警告，所有位置按上下文规则解析，依赖旧行为代码小幅调整）；
- 第三阶段：提供 **裸标识符 `@"..."`**（参考文档方案）覆盖剩余边界——歧义位置引用强制关键词为变量名时用 `@"let"`/`@"if"`，与 `@name(...)` 编译器函数不冲突（`@` 后接字符串 vs 标识符的形态互斥，详见 §4.15.5）。
- **禁止**一次性从硬保留直接跳普通标识符（大面积破坏）。

### 4.15.7 与现有 41 项表的迁移映射（落到 S0/S1）

`src/lex.tc` 当前 41 项 → 重分类示例：

| 原 `Kw*` | v2 类别 | 处理 |
|---|---|---|
| fn, if, else, return | 强制 | 保留 `Kw*` token |
| let, var, const（绑定三兄弟，同构同进同出） | **强制** | 保留 `Kw*` token；裁定依据见 §4.15.1（var 为 t 主绑定词，1208 次；不降上下文） |
| struct, enum, union, variant, flag, type, map, string, StringBuilder, unit, void, any, auto | 上下文（修饰/类型构造） | 改 `Ident` + parser 位置判定 |
| pub, extern, export, comptime, meta, kernel, overload, extend, when, entry | 上下文·修饰 | `Ident` + `ctx_kw_role` → `KwMod`（`const` 已移出本行→见上方强制行；`entry` 为新增修饰，§4.16.5） |
| import, as, in, defer, match, for, while, break, continue, true, false, null | 上下文·修饰 / 字面量 | 见附件（match/defer/break/continue 依赖「禁 juxtaposition」才安全留上下文） |
| align, offset, pack（若存在） | 上下文·属性 | `Ident` + `ctx_kw_role` → `KwAttr` |

- 迁移动作归到 **S0**（命名空间搬迁时一并把关键字表拆入 `std.rc.cst.lex`，lexer 改为「强制→`Kw*`、其余→`Ident` + `ctx_kw_role` 表」）+ **S1**（kind 枚举化时把 `KwMod`/`KwAttr`/`KwRole` 一并枚举化）。
- 该改动**不改 `.ll` 指纹**：lexer 输出 token 流对既有合法代码无变化（本来就解析为对应关键字），只是把「词法硬保留」改为「语法上下文裁决」；CST 节点把 `ba/bb` 布尔载荷挪到 `modifiers[]`/`attrs[]` 是内部表示变化，经 re-export 垫片与 S1 字节兼容字段布局（§4.10）保证自举不动点。

---

## 4.16 条件编译（Conditional Compilation）与入口点归属

### 4.16.1 问题：`@entry(tc)` 与 `@`-元函数不是一套东西

`@import` / `@desugar` / `@pass` 是**动作型元函数**：在编译管线某阶段执行一个副作用（加载模块 / 注册 Pass），结果确定、与目标配置无关。而 `@entry(tc)` 本质是**配置门控（config-gating）**——「当目标为 `tc` 时，此函数为入口点」。它不是「执行一个动作」，而是「按编译配置决定一个声明是否参与编译 / 选谁做入口」。两语义不同，硬塞进同一 `@`-家族会混淆：

- 元函数**求值时机**（何时执行副作用）与 cfg **判定时机**（整个声明是否纳入）不同；
- 入口点的**唯一性 / 多目标选择**（各目标各一个 `@entry`）无法用「动作」表达；
- 会污染 `@`-元函数这个本应「纯粹动作」的封闭登记命名空间（§4.15.5）。

故**条件编译单列一个机制**，与 `@`-元函数正交；`@entry`/`@main` 从 `@`-家族撤回，重归声明修饰 + cfg 谓词。

### 4.16.2 编译配置（CompileConfig）

- 定义 `CompileConfig`：`target`（标识，如 `tc`/`wasm`/`nvptx`）、`features: []Sym16("Feature")`、`mode`（`dbg`/`rls`）、`os`、`arch` 等；来源 = 命令行 / `.tconfig` / 模块属性。
- `CompileConfig` 是只读 meta 值，在 **CfgPass**（§4.12）前由 driver 注入，对所有 cfg 谓词可见。

### 4.16.3 谓词（Cfg Predicate）

布尔 meta 表达式，操作数仅限 `CompileConfig` 字段 + 字面量 + `&&` / `||` / `!` / `==` / `!=`；例：`target == "tc"`、`"gpu" in features && mode == "dbg"`。

> 注：`feature("gpu")` 若写作函数形式，仅作为 **`"gpu" ∈ features` 的语法糖**（脱糖为集合包含判定），**不引入真实函数调用**——否则与本句「操作数仅限字段 + 字面量」矛盾，也会撞 §4.11.1 姿势 A（不得新增求值原语）。

**`CfgPred` 类型定义**（§4.3 `cfg_pred` 字段与 §4.16.6 引用至此，此前全文未定义，现补齐）：

```c
// 受限谓词 AST：刻意**不是**通用表达式——禁止函数调用 / 副作用 / 递归，
// 保证 CfgPass 可在「无语义分析」前提下纯编译期求值（O(字面量规模)）。
pub const CFG_TRUE:  i64 = 0;  // 无条件门控（缺省）
pub const CFG_NOT:   i64 = 1;
pub const CFG_AND:   i64 = 2;
pub const CFG_OR:    i64 = 3;
pub const CFG_EQ:    i64 = 4;  // == / != 由 neg 位区分
pub const CFG_IN:    i64 = 5;  // "gpu" in features（集合包含，替代 feature("gpu")）
pub const CFG_FIELD: i64 = 6;  // 引用 CompileConfig 某字段
pub const CFG_LIT:   i64 = 7;  // 字面量（string / i64 / bool）

pub struct CfgPred {
    op:   i64;        // 上述 CFG_* 之一
    neg:  bool;       // 取反（供 == / != 共用 CFG_EQ）
    field: Sym32("Table");  // CFG_FIELD：CompileConfig 字段名（驻留，比较 O(1)）
    lit:  CfgLit;     // CFG_LIT：字面量值
    kids: []CfgPred;  // 子谓词（AND/OR/NOT/EQ/IN 的操作数）
    span: Span;
}
```

- **求值**：`CfgPass` 持 `CompileConfig`，对 `CfgPred` 做纯递归求值 → `bool`；无副作用、无回溯、不依赖类型/作用域侧表，故可在 **Desugar 之前**安全运行（§4.16.6）。
- **禁止扩展**：用户不得新增 `CFG_*` 操作码（封闭登记制，与 §4.15.5 的 `ctx_compiler_fn` 同理）；新增比较形态须走提案，避免谓词退化为通用表达式而破坏「编译期可判定」这一根本性质。

在 **CfgPass** 阶段求值；`false` 的声明/项被**整体剔除**（不进 HIR/codegen），报错按「未参与编译」而非「未定义」。

### 4.16.4 语法：条件编译关键词 `when`

`when` 是**上下文修饰关键词**（加入 §4.15.2 修饰表；§4.15.7 映射里已列 `when`）。两形态：

- 块门控：`when <pred> { ...decls... }` —— 块内声明按 `pred` 决定是否纳入；
- 声明门控：`fn foo() when <pred> { ... }` —— 仅该声明受门控。

与 `comptime` 区分：`comptime` 触发**值层面**编译期求值；`when` 触发**声明层面** 0/1 选择，二者可组合（`comptime fn foo() when feature("x")`）。

### 4.16.5 入口点 `@main` / `@entry` 重新归属

入口点标记**不再是 `@`-元函数**，拆为两部分，分别落入既有结构：

- **`entry`**：新增**修饰关键词**（进声明节点 `modifiers[]`，与 `pub`/`extern` 同级），表达「此函数为候选入口点」。
- **`when <pred>`**：携带目标/特性谓词，由 **CfgPass** 按目标解析。

即 `@entry(tc)` → **`entry fn main() when target == "tc" { ... }`**：
- `@`-元函数家族保持纯粹动作型（`import` / `desugar` / `pass` + 未来封闭登记的新动作）；
- 条件编译由 `when` 关键词 + CfgPass 统一承载；
- 入口点选择由 CfgPass 在多 `entry` 各带 `when` 时解析唯一命中者（与现 `codegen_c` 的 `f.name == "main" || "@main"` 字符串约定向后兼容：默认 `main`/`@main` 视为 `entry when target==默认`）。

### 4.16.6 与现有机制对接

- **CfgPass（§4.12）**：新增 Analysis/Transform，运行于 Desugar 前/后（视脱糖是否依赖被剔除声明）；`owns` = `cfg` 侧表，`requires` = `CompileConfig`。
- **lexer/parser**：`when` 已在 §4.15 上下文修饰关键词；`entry` 加入 `KwMod` 枚举；谓词解析复用 comptime 表达式子树（共享语法）。
- **CST（§4.15.3）**：声明节点 `modifiers[]` 增 `Entry` 项；新增结构化 `cfg_pred: CfgPred` 字段（与 `modifiers[]`/`attrs[]` 一致）。
- **fmt / lint**：`when`/`entry` 按源顺序原样还原 / 可查「声明是否受 cfg 门控」「目标下是否参与」「entry 唯一性」。
- **迁移**：归 **S1**（枚举化时增 `KwMod::Entry` + `CfgPred` 节点）；CfgPass 框架归 **S7**；与 S0/S1 正交、不动 `.ll` 指纹。

---

## 5. 与现有模块的接口

- **`src/lex.tc`**：lexer 实现迁入 **`std.rc.cst`**；本文件降级为 `std.rc.cst.lex_*` 的 re-export 垫片（S0，§4.14.4）；S4 收口时删除垫片。同时把当前 41 项「全词法硬保留」关键字表按 §4.15 重分类为「强制 `Kw*` + 上下文 `Ident` + `ctx_kw_role` 角色表」，**不改动既有合法代码的 token 流**（不影响 `.ll` 指纹）。
- **`src/parse.tc`**：parser 实现迁入 **`std.rc.cst`**；`mk_*` 改为写新分表（S2）；本文件降级为 re-export 垫片（S0，§4.14.4）。
- **`src/base.tc`**：降级为 **`std.rc.cst`** 的 re-export 垫片（S0，§4.14.4）——`Node`/`nodes`/`idecl_*` 等经 `pub use` 透传，既有引用字节不变；新增 `NodeRef`/`Span`/**语言级 `Sym16/Sym32/Sym64(tag)` 符号池**/侧表容器落在 `std.rc.cst` 内；S4 收口时删除垫片，全工程直接 `@import("std.rc.cst")`。
- **`src/hir.tc`**：`HirInst.op` 已是枚举（良好）；`HirInst.nd`（源节点 id）升级为 `NodeRef`；`node_to_hir` 桥用 `NodeRef` 索引；RAW 逃生舱保留但目标最终归零。
- **`src/sema.tc`**：读侧表而非节点字段；`infer_expr` 仍走 HIR，但不再需要 `hir_invalidate`（CST 不可变）。
- **`src/tir.tc` / `codegen_*`**：`TIRInst` 已是枚举（良好）；与 CST 解耦不变。
- **新建 `tools/cstgen.mjs`**（§4.3 注）：「kind 清单 → enum + 分表 + `mk_*` + visitor + `lower_policy`」一站式生成；旧 `tools/totter.tc` **已于 2026-09-28 删除**，不复活。
- **`tools/dagcheck.mjs` / `hir_test.mjs`**：新增 kind 时门禁守住穷尽性（visitor 分支数 == kind 数；RAW 计数）。
- **`tools/fmt.tc` / `tools/lint.tc`（规划中）**：直接 `const cst = @import("std.rc.cst")` 引用，**无需经 `src`**——这正是 G7 / §4.14 的要义。`fmt` 只遍历 `CstNode + trivia`（注释/空白/布局还原，对糖原样保留），`lint` 只消费 `CstNode + HIR + 语义侧表`；新增糖/Pass（内置或用户 `@desugar`/`@pass`）时二者**无需改动**即获得覆盖（§4.1 G7 / §4.13.3 / §4.14.3）。
- **插件加载器（S8）**：在 `sema` 期前扫描用户模块的 `@desugar`/`@pass` 并将它们 `register_*` 进对应 PassManager（§4.13.1），与内置糖/Pass 同套排序与失效。

---

## 6. 验收与门禁

- **结构正确性**：`gate L2` 23/0 全绿；自举**不动点**成立（`g2==g3`，L2 再要求 `g4`）。
- **IR 基线（软）**：`snapshot` 步骤比对 `g1` vs `tests/ir_baseline.json`；凡改变 IR 发射的改动**必须重录基线**（`--update --compiler out/dbg/g1.exe`，**不能用 seed/C 产物**），并人工确认差异仅为预期表示变化。**两类判据不可混淆——详见 §4.10.0。**
- **穷尽性**：新增 kind 后，`node_visit` 分支数 == `NK_*` 数（门禁断言）；`hir_lower_*`/`sema`/`codegen`/`hir_eval`/`tir` 不得遗漏。
- **性能基线**：字符串比较消失（`SymN(tag)` 的 uN id 比较）；基于 Sym id 的 `match` 分派由跳转表优化至 **`O(1)`**（§4.4.1）；`node_resolve` 查找 `O(1)`；对齐 `perf-baseline.md` 不回退。
- **序列化**：`hir_to_bin`/`from_bin` 往返一致；新增 `.ast` 往返一致（`tc --format` 幂等）。

---

## 7. 风险与开放问题

1. **SoA 分表 vs 判别联合**：t 类型系统能否优雅表达「`NodeRef` → 取对应分表元素」？建议 S2 先用 `tag + 多 []X` 实装，验证自举后再评估是否引入更紧的判别联合。
2. **双写期内存翻倍**：S2/S3 过渡期旧 `Node` + 新分表并存，arena 峰值上升；需监控 `out/` 资源（见工作记忆「残留进程锁 exe」类环境坑）。
3. **`kids` 链表池是否保留**：子列表（params/body/arms）仍走 `kids` 池最稳；若改 `[]NodeRef` 连续数组需评估 HIR 降级与序列化影响。
4. ~~**intern 池跨模块**~~ —— **已裁定（不再是开放问题）**：多模块编译单元下，**按 tag 全局共享同一池**（`Sym32("Ident")` 等全局唯一），与 `g_node_mod` 解耦，名字比较不再依赖模块前缀；`sym_release("tag")` 仅释放该 tag 池、`sym_release_all()` 全释放。
   - **依据**：§4.4「规则（核心，由语言保证）」已要求不同 tag 索引空间独立、跨池比较即类型错误；若同 tag 池再按模块分裂，则「跨模块同名同 id」不成立，跨模块比较会静默失效——与语言保证直接冲突。故**全局唯一**是唯一自洽解。
   - 落地归 S0/S1；风险：整池释放须确认无跨模块悬挂引用（编译器为单进程批处理，编译结束即全释放，风险可控）。
5. **green/red 增量是否本期做**：S5 为 P2，可视 IDE 需求优先级后置；CST `.ast` 序列化是更低成本的工具化起点。
6. **§4.15 的 `let`/`var`/`const` 若未来采纳「全局禁 juxtaposition」**（附件主张），三者可一并降为上下文词，硬保留集可收敛到极小——走 §4.15.6 三阶段演进，不本轮切换（§4.15.1 裁定）。
7. **生成器 `tools/cstgen.mjs` 的引入成本（新增， blocker 级前置依赖）**
   - **事实**：v2 的 DRY 承诺（新增 kind 只改一处）依赖代码生成，而原承载者 **`tools/totter.tc` 已于 2026-09-28 删除**（`README.md:10/18/141/167/173`、`tote.toml:18`、`src/base.tc:14-16`），`GEN:` 区间现为**冻结手写**。故 S4/S6 的「生成 enum + 分表 + `mk_*` + visitor + `lower_policy`」**当前无工具可依**。
   - **风险**：① 新增一个 Node 生成器本身是工程量；② 生成器一旦再次「跑一次就冻结」，会重演 totter 的结局——DRY 名存实亡，§1.3 第 7 条「同步 6 处」的老坑回归；③ 生成物进 `src/` 会让自举构建多一层前置依赖。
   - **缓解**：a) 生成器进 `tools/`（**Node 脚本，不进 `src/`**），产物以 `// >>> GEN:cst(kinds) ... <<<` 区间写入 `std.rc.cst`，**不参与 tc 自举循环**，故不动 `.ll` 指纹；b) `tools/cst_kinds.json` 为唯一真源、可 review、可 diff；c) 门禁增「生成物与清单**一致**」断言（`node tools/cstgen.mjs --check` 失败即红），防止冻结漂移。
   - **退路（生成器未落地时如何不阻塞，与 §4.10.3 的依赖图一致）**：**S0/S1 可全手写**（只搬位置 + 枚举化，无样板代码）；**S2 起强烈建议生成器，最晚 S4 必须有**（S2 要产出分表 + `mk_*`，手写等于与 S4 的生成物写两遍）。临时退路 = S2/S4 手写 + 门禁断言兜底：`cstgen --check`（若已有生成器）或 `dagcheck.mjs` 断言 `node_visit` 分支数 == `NK_*` 数、`lower_policy` 长度 == `NK_*` 数 —— 与生成器**等价的穷尽性保证**，只是不再自动生成样板代码。

---

## 8. 与 v0.1 的差异速查

| 维度 | v0.1（现状） | v2（本规范） |
|---|---|---|
| kind | 字符串 | 数值枚举 `NK_*` |
| 节点存储 | 单体 `Node`（字段重载） | 按 kind 分表（SoA）+ `NodeRef` |
| 名字比较 | 字符串 | 语言级 **`Sym16/Sym32/Sym64(tag)`**：tag 即类型参数，各集合独立池、位宽可选；跨池跨类型比较/赋值 = 类型错误（`f15_sym_cross_pool.tc`），整池 `sym_release`；编译器自身即消费方（§4.4 / G10） |
| 类型/解析/作用域 | `Node.td` + 全局平行数组 | 侧表 keyed by `NodeRef` |
| 遍历 | 手写 `if k==` | 生成 `node_visit` + `transform` |
| 树可变性 | sema 原地改写 | **不可变 CST** + 独立 HIR/typed-AST |
| 诊断 | `ln/cl/tv` | `Span{file,start,end,line,col}` |
| 工具化 | 无 | trivia + error node + `.ast` + 增量重解析 |
| 糖语法落点 | 散落 `parse/sema/hir` 三处 + `hir.tc` 硬编码逃生舱 + 顺序硬编码 | 注册式 **Desugar Pass** + `lower_policy` 表 + **SAST** 渐进降级；锁定 姿势 A / L2 双后端一致铁律 |
| 管线处理节点 | 手工塞进 sema 驱动 / codegen | **`Pass`/`PassManager`** + Analysis/Transform + 侧表 `owns`/`requires` 失效 |
| fmt / lint 底层 | fmt 与 lint 各自实现解析/遍历 | **共用同一底层**（CST+trivia 供 fmt，HIR+侧表 供 lint）；新糖/Pass 无需改工具（§4.13.3） |
| 用户可扩展 | 语法/管线锁死在 src/，用户不可加 | **用户 `@desugar` / `@pass` 注册**，与内置同一套 API（§4.13） |
| 语法树代码归属 | `src/base.tc`/`src/lex.tc`/`src/parse.tc` 内联源码树，工具无法干净引用 | **`std.rc.cst` 库模块**（预编译 `.tlib`）；编译器与 `fmt`/`lint` 同一套引用，工具零耦合（§4.14 / G9） |
| 关键词分类 | 41 项全在**词法层**硬保留（`g_kw_text`→`Kw*`，不可作名） | **强制 / 上下文（修饰+属性）** 三级分类；lexer 对上下文词发 `Ident` + `ctx_kw_role` 角色表；声明节点用 **`modifiers[]`/`attrs[]`** 结构化承载（§4.15 / G10） |
| `@` 前缀语义 | 无（`@` 未体系化） | `@name(args)` = **编译器函数调用**（编译期执行、非 runtime）：`@import`/`@desugar`/`@pass` 等，自成 compiler 命名空间、与运行时 `Call` 类型区分（§4.15.5 / G10） |
| 裸标识符（歧义位置变量兜底） | 无 | 参考文档《最大化标识符设计》方案：**`@"..."` 前缀 + 字符串字面量**（如 `@"let"` / `@"return"` / 多行 `@"""..."""`) 在歧义位置引用强制关键词为变量名；与 `@name(...)` 编译器函数**共用 `@` 但形态互斥**（`@` 后接字符串=裸标识符，接标识符=编译器函数），**不冲突**；无歧义上下文（点号后成员名/`let` 后等）则直接收关键字作名、无需任何前缀（§4.15.4 / §4.15.5 / G10） |
| 条件编译 / 入口点 | `@main`/`@entry` 字符串约定（`codegen_c` 查 `f.name=="main"||"@main"`），无独立机制；`@entry(tc)` 硬塞进 `@`-元函数家族，与动作型 `@import`/`@desugar`/`@pass` 不一套 | **单列条件编译机制**：`when`（上下文修饰关键词）门控声明/块 + `CompileConfig` 谓词 + **CfgPass**（§4.12）剔除未命中声明；入口点改 `entry`（修饰关键词）+ `when target=="tc"`，**撤出 `@`-元函数家族**（§4.16 / G10） |
| 保留项 | — | 索引 arena、HIR ZIR、`.tmi`、清单驱动代码生成（`cst_kinds.json` + 新建 `cstgen.mjs`；**旧 totter 已删除、不复活**） |

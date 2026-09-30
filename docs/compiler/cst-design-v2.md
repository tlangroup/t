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

原方案：S1「新增 `tag` 字段；`Node` 布局变化」。**实施期改为延后到 S2**，理由：

1. **陈旧状态风险**：`tag` 是 `kind` 的**派生值**；既然有 20 处构造后改写 + 3 处 `dst.kind = src.kind` 整节点拷贝，任何一处漏同步 ⇒ `tag` 与 `kind` 不一致，且**不报错**（正是 §1.3 第 7 类「静默错编」）。
2. **当前零消费者**：字段在 S2 分表落地前无人读取，纯属负担。
3. **S2 有条件安全落地**：S2 会重写 `mk_*`/节点写入路径，届时可统一收口为 **`node_set_kind(ni, k)`**（同时写 `kind`+`tag`）+ **节点拷贝走 `node_copy()`**，并用 `grep "\.kind = "` 断言「零裸写」——这才是可验证的穷尽性，而不是靠人肉记住 20 处。
4. **能力无损**：S2 的访问者在进入节点时算一次 `nk_of_kind`（此时 kind 已稳定），之后全整数分派，与原方案的 O(1) 等价。

> 过渡实现取舍：`nk_of_kind` 目前是**线性扫描**（105 次串比较）。原因：t 语言层**没有暴露字符串序比较**（runtime 只有 `tll_str_eq`，无 `strcmp`），无法二分；且它当前只在 `is_node_kind` 内部被调用（死代码路径）。S2 落地 `tag` 后该开销自然消失。

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

> 状态：**S2 pilot 已落地并达成自举不动点**；**S2b（种子语义分析失控递归）已修复**（见 §0.12.5），全量铺开（per-kind `tbl_*` + `cst_register_*`）现已可在修复后种子下推进。

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

**后续待办**：
1. **全量铺开**：105 kind 的 `tbl_<kind>_<field>` 切片 + `cst_register_X` 生成 + 92 个 `mk_*` 双写挂接（本 pilot 仅含 `g_node_nref`，未挂接）。S2b 已修复，现在可在种子下编译有意义的 S2 增补。
2. **重录基线 + 跑 gate L0/L1**（按 §4.10.2 序列），合并到 `wb/main` 触发 CI。
3. **同步修复后种子**：`out/dbg/tc_new.exe`（含 S2b 循环断路器）= 当前有效种子，需决定是否替换 `out/dbg/tc.exe` 或提交为新的 `ci/seed`。

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

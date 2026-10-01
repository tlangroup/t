# 工作 B 设计文档（sema 统一词法作用域树 / 增量编译 / IDE / 相位 CTFE walker）

> 状态：规划中（2026-10-01 启动）。来源：cst-design-v2.md §0.13.9 / §0.14.6（S4 收口判定工作 B 为独立 R&D epic）。
> 触发：用户裁定「进工作 B」。本文档为进入前的规划，待裁定首支柱后拆 step。

## 0. 定位与铁律

- 工作 B ≠ 单一任务，而是 **4 个量级悬殊、风险各异的 epic**，共享一条地基（统一词法作用域树）。
- 文档 cst-design-v2.md 已明确：工作 B「会破坏 IR 变化=0 纪律」「只在出现真实消费者（IDE / 增量编译）时才启动」。本设计据此把 4 支柱按「地基 → 消费者」排序，且每支柱的首增量必须做到 **零 IR 变化 / gate L2 全绿 / 可双跑对拍**。
- 既有红线（沿用 S4）：每步 → `tc build src/tc.tc` → `gate L2`（24 步）→ 仅 `src/tc.tc` 漂移则 `--update` 重录 → `git commit -F` → 快进推送 `s2-noderef:main`。

## 1. 当前作用域机制（侦察事实，sema.tc:1114–1177）

```
pub var syms: []Sym;            // 扁平数组；Sym{name,kind,ti,decl,scope}
pub var scope_parents: []i64;   // scope 索引 → 父 scope 索引（parent 链）
pub fn scope_new(parent)        // append(scope_parents,parent); 返回新索引
pub fn sym_find_in(scope,name)  // 线性全扫 syms，命中 (s.scope==scope && s.name==name)
pub fn sym_define(scope,...)    // append 到 syms，写 s.scope=scope
pub fn sym_lookup(scope,name)   // sym_find_in 命中则返回；否则 sc=scope_parents[sc] 上溯
pub var global_scope / cur_scope / cur_ret;
```

- `cur_scope` 由 **~30+ 处** `cur_scope = scope_new(prev)`（进块/函数/闭包建子作用域）与 `cur_scope = prev`（退出还原）手动维护。
- 查找成本 = O(符号总数) 线性扫描（无哈希），当前规模可接受，但增量/IDE 放大后会成为瓶颈。
- 发射侧 `node_scope` 侧表（S3 step5，`base.tc:1889 node_scope` / `node_set_scope` / `g_node_scope`）原只建于 `g_seen_push` 路径；**工作 B 支柱 1 step1–3 已让语义侧 `scope_new_at` 也写入 `node_scope`**（语义侧覆盖写、发射侧后跑，终态以语义侧为准），两套作用域表示开始并轨 —— 这是「统一」的第一步，真正读取源切换见 step 5（DEFERRED）。

## 2. 四支柱拆解（规模 / 风险 / 首增量）

### 支柱 1 — sema 统一词法作用域树（地基，必做）
- **目标**：把语义侧作用域也锚定到 `node_scope` 树：每个 block/function/closure 节点 `node_set_scope(node, scope_id)`，scope 树的 parent 链与 AST 节点树对齐；`sym_lookup` 改走 `node_scope(node).parent` 而非 `scope_parents[sc]`。
- **规模**：中。核心改动集中在 `sema.tc` 作用域 API（~6 函数）+ `cur_scope` 维护点（~30 处，但可用封装 `scope_enter(node)`/`scope_leave()` 一次性收敛）。
- **风险**：中（破坏 IR=0 纪律的元凶来源）；但首增量可 **双跑对拍**：先让 `scope_new` 同时 `node_set_scope(owner_node, new_id)` 且 `scope_parents[new_id]` 指向 `node_scope(prev_node)` 的 scope，再在 `sym_lookup` 里**同时走两条链**并断言相等，零行为变化 → 行为证明后再切读取源。此协议与 S3 step5 的 `g_seen` 双跑完全同构。
- **首增量（建议第一步）**：`node_scope` 语义侧填充 + `sym_lookup` 双跑断言（零 IR 变化）。验收闭合后再做「读取源切换」。

### 支柱 2 — 增量编译（最大基础设施）
- **目标**：query-based 依赖图 + 内容寻址缓存，改一行只重编受影响函数；`.tmi` 缓存键 + per-file HIR 缓存。
- **规模**：极大（新增 Driver/Query 层、缓存失效键、HIR 序列化落盘、依赖指纹采集）。
- **风险**：极高（横跨驱动层、IR 落盘、缓存一致性）；且当前 `HIR` 已是可序列化 ZIR 槽位（hir-design.md），但 per-file 缓存键与跨文件常量依赖尚未实现。
- **首增量**：仅做「数据模型可扩展」—— 在 HIR 节点加 `fingerprint` 字段占位 + 缓存键类型定义（零行为）；真正的 query 调度留待后续。
- **现实判断**：当前 t 编译器是全量一次性编译，ERP monorepo 若未出现「改一行重编全仓」的实际痛点，此支柱孤立推进收益不兑现。建议作为**真实消费者触发**时才启动。

### 支柱 3 — IDE / 工具链
- **目标**：LSP 服务、`tc --format`、富诊断（span 全链路）、`diagnostic-ir-design.md` 的 SARIF/JSON 输出接 LSP。
- **规模**：大（需独立 LSP 进程 / stdio 协议、span 取代 `ln/cl/tv`、CST `.ast` 序列化供增量重解析）。
- **风险**：中（诊断/格式是增量叠加，不破 IR；但 span 替换 `ln/cl/tv` 会牵动 conformance 诊断期望的行/列来源）。
- **首增量**：先做**纯诊断输出**——把现有诊断经 `diagnostic-ir-design.md` 的 JSON/SARIF 通道导出（零编译逻辑改动）；`tc --format` 与 span 体系留作后续（cst-design-v2.md S5）。
- **现实判断**：若用户要的是「编辑器里写 t 能报错/补全」，此支柱价值最高；但需先有支柱 1 的词法树 + span 体系才稳。

### 支柱 4 — 相位 CTFE walker
- **目标**：在统一词法树里给符号加 `phase`（runtime/comptime/both），CTFE 走 comptime 子树求值；复用 `is_comptime`/`closure_capture` 雏形。
- **规模**：小–中。`hir_eval.tc` 已解释 HIR 指令流；CTFE 已在语义期跑（comptime_fold.tc / meta_eval）。
- **风险**：低–中（纯语义附加，不碰发射）；但「按相位拆 scope」已被 cst-design-v2.md 明确否定（会复制词法相同 scope、引发不一致解析），故相位**挂符号不拆 scope**。
- **首增量**：给 `Sym` 加 `phase` 字段 + `is_comptime` 派生 `phase` 的归一函数（零行为）；CTFE 在统一树里按相位裁剪留待支柱 1 闭合后。

## 3. 推荐进入顺序

1. **先落支柱 1（统一词法树）** —— 它是 2/3/4 的共同地基，且首增量可零 IR 变化双跑对拍，风险可控。
2. **支柱 4（相位 CTFE walker）** 紧随其后 —— 依赖支柱 1 的词法树，规模小、风险低，可顺手收口。
3. **支柱 3（IDE）** 与 **支柱 2（增量编译）** 作为「真实消费者触发」型 epic：出现明确需求（编辑器支持 / monorepo 重编痛点）时再启动，避免孤立推进收益不兑现。

## 4. 与 S4 收口的关系

- S4 已把 `node_*`/`mk_*`/`HirInst.nd` 全部升 `u64 NodeRef`，且 `node_scope` 侧表已就位（发射侧）。支柱 1 直接复用这张侧表，把语义侧也接入，无需新建数据模型 —— 这是 S4 收口留下的「可借之势」。
- 删 `base.Node` 单结构体（S4 deferred）与支柱 1 正交：支柱 1 改的是「作用域表示」，不是「节点存储」，二者可独立推进。

## 5. 支柱 1 实施步骤（统一词法作用域树）

> 原则：每步 → `tc build src/tc.tc` → `gate L2`（24 步）→ 仅 `src/tc.tc` 漂移则 `--update` 重录 → commit（`-F`）→ 快进推送 `s2-noderef:main`。零行为变化是每步硬指标。

- **step 1（数据模型扩展）✅ commit `a244377`**：`sema.tc` 加 `scope_owner: []i64` 平行数组（与 `scope_parents` 锁步 append）；`scope_new(parent)` 保持旧签名、内部 `append(scope_owner,-1)`（22 处调用点零改动）；新增 `scope_new_at(parent, owner)` 在建立 scope 同时 `node_set_scope(owner, id)` 把节点→scope 写进侧表。**自此语义侧也开始写入 `node_scope`**（与发射侧 `g_seen_push` 并存，但语义侧覆盖写、发射侧后跑，终态以语义侧为准）。纯加法，零行为变化；gate 24/0。
- **step 2（全站点迁移，17 处）✅ commit `b91182f`**：把 17 处非根 `scope_new(prev)` 改为 `scope_new_at(prev, owner)`，owner 取正确 CST 节点 id（块/表达式/函数体 `e`/`d`/`s`、循环 `L`、match-arm `m_k.val`、HIR 块指令 `hir.hir_inst_node(bi)` 等）。仅根作用域 `global_scope = scope_new(-1)`（13304，无 CST owner）保留。零行为变化；gate 24/0。
- **step 3（参数作用域站点收尾）✅ commit `<this>`**：`infer_lambda_ret_from_decl`(4152) 内 `cur_scope = scope_new(global_scope)` → `scope_new_at(global_scope, d)`（owner=`d` 函数声明节点，第 18 处可锚定站点），完成全部可锚定站点迁移。
- **step 4（校验函数 + 不变量）✅ commit `<this>`**：新增 `verify_scope_tree(): bool`（校验 `node_scope[scope_owner[S]]==S` round-trip + `scope_parents` 链无环），由 `g_verify_scope_tree` 调试标志在 `run_check` 末受控触发（默认关闭，正常编译零行为）。注：原设计的「`sym_lookup` 并行双跑」未做——因它要求 `node_scope` 树可上溯，而**上溯需 `node_parent` 侧表（CST 父指针）**，该结构尚不存在；当前 `node_scope` 仅提供 节点→scope 反向查，已足够支撑 IDE/增量消费。
- **step 5（读取源切换 → 真正统一）⬇ DEFERRED**：把 `sym_lookup`/`sym_define` 内部从 `scope_parents` 链切到 `node_scope` 树。这一步才真正「统一」，但**依赖 `node_parent` 侧表**（每个 CST 节点的父指针），属 IDE/增量编译的共同地基。在出现真实消费者（IDE 跳转/增量重编）或模块系统搬迁时，与 `node_parent` 一并建设更划算；当前孤立切换收益不兑现、且会引入静默错编风险。故 pillar 1 的安全交付 = step 1–4（作用域树数据已锚定 + 校验钩子就位），step 5 降为 deferred。

## 6. 裁定记录

- **首支柱**：已裁定 **支柱 1 统一词法作用域树**（地基，复用 S3 step5 `g_node_scope` 侧表）。
- **节奏**：采用「step 1→4 逐簇迁移 + 每步 gate L2」保守节奏；零行为变化是每步硬指标（仅 `src/tc.tc` 自编译表示漂移则 `--update` 重录基线）。
- **step 5 裁定**：DEFERRED。真正「统一」需 `node_parent` 侧表（CST 父指针），当前 `node_scope`（节点→scope 反向查）已满足 IDE/增量消费所需，孤立切换 step 5 收益不兑现且引入风险；待真实消费者（IDE 跳转 / 增量重编 / 模块搬迁）出现时与 `node_parent` 一并建设。
- **优先级触发**：若出现「现在就要 IDE 支持」或「monorepo 增量重编痛点」等真实消费者，顺序可调（支柱 3/2 提前）。

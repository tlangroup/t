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
- 发射侧 `node_scope` 侧表（S3 step5，`base.tc:1889 node_scope` / `node_set_scope` / `g_node_scope`）**只建于 `g_seen_push` 路径**，语义侧 **未使用** `node_scope` —— 两套作用域表示并存，是工作 B「统一」要消除的裂隙。

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

- **step 1（数据模型扩展，已落地，gate 跑中）**：`sema.tc` 加 `scope_owner: []i64` 平行数组（与 `scope_parents` 锁步 append）；`scope_new(parent)` 保持旧签名、内部 `append(scope_owner,-1)`（30 处调用点零改动）；新增 `scope_new_at(parent, owner)` 在建立 scope 同时 `node_set_scope(owner, id)` 把节点→scope 写进侧表。纯加法，零行为变化。
- **step 2（函数/闭包站点迁移）**：把 `infer_func_ret`(4127) 等**函数/闭包参数作用域**的 `scope_new(prev)` 改为 `scope_new_at(prev, owner_node)`，传入 FuncDecl/closure 节点。每簇迁移后 gate。
- **step 3（块/循环/match 站点迁移）**：把 `infer_block_expr`(5534) 等**语句块/for/for_each/match 臂**的 `scope_new(prev)` 改为 `scope_new_at(prev, owner_node)`，传入对应 block/loop/match-arm 节点。每簇 gate。
- **step 4（双跑对拍 + 不变量）**：`sym_lookup` 增加并行分支——沿 `scope_owner`→`node_scope` 树走的查询结果，与现行 `scope_parents` 链结果断言相等（仅当 `scope_owner` 已锚定）；加 `scope_tree_invariant()` 在 `run_check` 末校验 `node_scope[scope_owner[S]]==S`。零行为变化前提下证明两套表示等价。
- **step 5（读取源切换，可选）**：确认等价后，把 `sym_lookup`/`sym_define` 的内部索引从 `scope_parents` 链切换到 `node_scope` 树（此时 `scope_parents` 可退役）。这一步才真正「统一」，且因 step 4 已证明等价，IR 仍 0 变化。

## 6. 待裁定

- 从哪个支柱开局？（已裁定：**支柱 1 统一词法作用域树**，step 1 已落地）
- 是否有**真实消费者**驱动优先级（如：现在就要 IDE 支持 / monorepo 增量重编痛点）？若有，顺序可调。
- 支柱 1 是否接受上述「step 1→5 逐簇迁移 + 每步 gate」的保守节奏？

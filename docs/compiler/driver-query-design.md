# Driver / Query / Scheduler —— 管线引擎层规格（G-1 P0）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §5.1/§5.2` 节点 0）
> 关联：`docs/compiler/compiler-pipeline-design.md`（总设计 §5）、`docs/compiler/hir-design.md`（HIR 缓存）、`docs/compiler/tmi-design.md`（`.tmi` 缓存）、`docs/compiler/persistent-session-design.md`（持久会话入口）

## 1. 定位：它是"跑管线的引擎"，不是一层 IR

Driver/Query/Scheduler 是**横贯全管线**的基础设施，被所有 IR 层消费，自身不产出 IR：

```text
        ┌──────── Driver / Query / Scheduler（贯穿引擎）────────┐
源文件 ─┤  query 依赖图 · red-green 指纹 · 分片内容寻址缓存      ├─▶ 各 IR 层
        │  work-stealing 调度（函数/CGU/模块级并行）· 持久会话    │
        └──────────────────────────────────────────────────────┘
```

- **G-1（P0）**：增量与并行在现有文档里只是横切 bullet，**没有建模**。本层是把"改一行只编一行""多核并行"从口号变成机制的真正地基。没有它，HIR 缓存/`.tmi` 只是死数据。
- 对位：Rust 2024 并行前端（`rustc` query 系统 + red-green 指纹 + 分片缓存 + 每线程分配池；单线程仅 1–3% 开销，8 线程 +30~50%）。

## 2. Query 依赖图（salsa 式）

- 每个编译产物是一个 **query**：`hir_of(file)`、`sema_of(file)`、`tir_of(file)`、`object_of(file)`、`tmi_of(file)` …
- query 之间声明依赖；引擎据此构建**依赖 DAG**。
- **纯函数语义**：query(f) 只依赖其输入（源 + 依赖 query 结果），无隐藏状态 ⇒ 可缓存、可重算、可并行。
- **记忆化**：query 结果按**输入指纹**缓存；输入不变 ⇒ 直接返回，不重算。

## 3. red-green 指纹（失效传播）

- **green（稳定）**：内容指纹（内容寻址哈希）。源/中间产物变了 ⇒ green 变。
- **red（脏）**：依赖子树中任一 green 变 ⇒ 该节点标红 ⇒ 重算。
- 传播：改 `b.tc` ⇒ `b` 的 green 变 ⇒ 仅依赖 `b` 的下游标红；`a.tc` 未变 ⇒ `a` 保持绿 ⇒ 不重编。
- 这把"增量"从"按文件缓存"升级为"按 query/按声明"——配合 `.tmi` 指纹（见 `tmi-design.md §3`）实现声明级失效。

## 4. 分片内容寻址缓存

- 缓存键 = query 名 + 输入指纹（content-addressed）。
- **分片**：缓存按 query 类型/模块分片，避免单锁竞争（对标 Rust 分片缓存，支持多线程并发读）。
- **多级**：内存（本会话）+ 磁盘（`zig-cache`/`target/` 式）+ **远程**（CI 共享，见 `compiler-pipeline-design.md §5.2`，G-6 hermetic）。
- HIR 缓存（pre-type）与 `.tmi`（typed）都走这套缓存，键不同（见 `tmi-design.md §1`）。

## 5. 调度（work-stealing 三档并行）

| 并行档 | 单位 | 说明 |
|---|---|---|
| 函数级 | mir 优化 / 单态化实例 | 最细；各函数独立优化 |
| CGU 级 | codegen（TIR→目标） | 编译单元分组并行发射 |
| 模块级 | 链接 / 全局优化 | 整个模块并行处理 |

- **work-stealing**：全局任务队列 + 每线程本地队列；空闲线程偷取任务，避免负载倾斜。
- 每线程独立分配池（对标 Rust），避免分配器锁。
- 复刻 Zig 经验：**自托管/快速后端必须并行化 codegen**（否则多核机器上调试构建反而慢）。

## 6. 与持久会话的关系（G-4）

- Driver/Query 是**持久会话/JIT** 的入口（见 `persistent-session-design.md`）：REPL/Notebook 持有一个长期运行的 Driver 实例，query 缓存跨"输入"保留，下一条输入只重算受影响的 query 子树 ⇒ 热重编、增量代码替换。
- 即：HIR 缓存/`.tmi` 的"第二消费者"是持久会话，第一消费者是普通编译。

## 7. 确定性（G-12 hermetic）

- query 纯函数 ⇒ 同输入同输出 ⇒ bit-identical 产物（利于缓存命中、可审计、远程缓存安全）。
- 禁止在 query 内读时钟/随机/绝对路径；需要确定性顺序的遍历用指纹排序。

## 8. 落地（对应 `compiler-pipeline-design.md §9` A 阶段三件套）

- **A 阶段三件套 = `AstGen(HIR)` + `Driver/Query 层` + `.tmi`**。Driver/Query 与 HIR 同期落地：HIR 作为首个 query 接入依赖图，缓存/失效/调度机制从第一天就位。
- 分期：先单线程 query + 内存缓存（验证正确性）→ 加磁盘缓存 + red-green → 加 work-stealing 并行 → 加远程缓存。
- 门禁：改实现不改签名 ⇒ 下游 query 全绿（零重编）；多核 clean build 提速（对标 Rust +30~50%）。
## 9. 增量正确性验证（D7-8 绑定，P0 交付门槛）

增量机制（G-1/G-2）只有在"增量产物位等价 clean 产物"时才算优化，否则它就是**误编译源（陈旧构建）**。本层必须把正确性验证作为与缓存同等的一等地基：

- **red-green 失效完备性**（机制面）：依赖图任一节点变更后，所有下游必须正确标红、所有无关节点必须保持绿。写**失效完备性测试**——构造「改 `b.tc` 只动实现 / 只动签名 / 引入泛型新实例」三类最小变更，断言受影响 query 闭包精确。
- **clean ≡ incremental 等价门禁**（验证面，纳入 CI）：对同一源，跑「全量 clean 编译」与「先 full 再改一行增量」两条路径，比对最终产物（对象文件 / `.tir` md5 / `.tmi` 指纹）**逐字节相同**；不一致即阻断。这一条把 D3-B（增量）与 D7（正确性）钉死，也是 D8-4（远程缓存信任）成立的前提——缓存命中的前提就是"命中即等价于 clean"。
- **缓存键闭合性**：缓存键必须覆盖一切影响产物的输入（源 + 依赖 `.tmi` 指纹 + 编译器版本 + 目标三元组 + flags + 启用 pass 集）；任何漏列的隐式输入都会击穿等价门禁。联动 §5.5 hermetic、§5.3 action-key。
- **分期**：与 A 阶段三件套同期落地失效完备性测试；等价门禁作为 gate 的独立步（类比 `tir_roundtrip.mjs`），先离线验证、再进 CI 阻断。


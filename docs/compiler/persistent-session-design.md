# 持久会话 / JIT 规格（REPL · Notebook 增量, G-4）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §4` 节点 7）
> 关联：`docs/compiler/driver-query-design.md`（持久 Driver/Query 入口）、`docs/compiler/hir-design.md`（HIR 缓存）、`docs/compiler/tmi-design.md`（`.tmi`）、`docs/compiler/compiler-pipeline-design.md §5.4`（持久会话/JIT 横切）

## 1. 定位

普通编译是"一次性、进程退出即丢缓存"。**持久会话**让 Driver/Query 实例长期存活，跨多次"输入"保留 query 缓存 ⇒ REPL/Notebook 的**热重编、增量代码替换**。

```text
普通编译: 源 ──▶ [Driver 启动→全量 query→退出]  （每次冷启动）
持久会话: 源₁ ─▶ [Driver 常驻] ──缓存── 源₂(只差一行) ─▶ 只重算受影响 query 子树
```

目标（G4）：REPL/Notebook 体验对标 Julia/Swift/Lean 4——"改一行，瞬间重编那一行"，而非每次重跑全量。

## 2. 消费方：HIR 缓存 + `.tmi`

- 持久会话是 HIR 缓存（pre-type）与 `.tmi`（typed）的**第二消费者**（第一消费者是普通编译，见 `driver-query-design.md §6`）。
- 会话内：已编译模块驻留 query 缓存；新输入只触发"新增/修改声明"的 query 重算，未变声明直接复用。
- 跨输入一致性：red-green 指纹（见 `driver-query-design.md §3`）保证"只重编真脏的声明"。

## 3. 增量代码替换（hot reload）

- **REPL**：每条输入重编"decls + 该输入"→ 跑（沿用现有 REPL 的 clean-subprocess 模型，但跳过未变 decl 的 re-lower）。
- **Notebook（Stage1）**：cell 间依赖图；改 cell N ⇒ 仅重算 N 及其下游 cell（对标 Jupyter 但编译期增量，非运行时）。
- **热替换**：对已运行进程，用新 codegen 产物替换旧函数体（需运行时支持函数指针表/符号重绑；细节归 runtime 设计，本层只定义"增量边界"）。

## 4. 会话状态

- **持久查询上下文**：已解析 HIR、`.tmi`、类型环境跨输入保留。
- **错误恢复**：单条输入编译失败 ⇒ 会话不崩，沿用上一成功状态（对标 Lean 4 的"错误即类型洞"体验）。
- **内存边界**：会话可设上限；超阈值的冷模块可换出到磁盘缓存（HIR/`.tmi` 二进制）。

## 5. 与现有 REPL 的关系

- 现有 `repl.tc` 是 clean-subprocess（每条重编），已能跑；持久会话是**增量升级**——同接口、更强内部，不破坏现有元命令(`:help/:quit/:reset/:dump/:load`)。
- 落地前提：依赖 A 阶段三件套（HIR 缓存 + Driver/Query + `.tmi`）先就位；否则"增量"无缓存可吃。

## 6. 落地路线

- **先决**：A 阶段三件套 + HIR/`.tmi` 缓存（见 `compiler-pipeline-design.md §9`）。
- **PS 阶段**：REPL 接入持久 Driver/Query（跳过未变 decl 的 re-lower）；门禁：连续输入 N 条，总重编时间 << N×全量。
- **PS' 阶段（Notebook）**：cell 依赖图增量（见 `docs/notebook.md` 现有 Notebook Stage1）。
- **PS'' 阶段（可选）**：运行时热替换（需 runtime 配合）。

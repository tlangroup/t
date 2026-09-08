# 链接与全局优化规格（CGU · ThinLTO · PGO · BOLT · 跨模块摘要, G-5/G-7/G-11）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §4.6`）
> 关联：`docs/compiler/tir-design.md`（TIR 快照/IR 级 FDO）、`docs/compiler/driver-query-design.md`（CGU 并行）、`docs/compiler/target-desc-design.md`（目标特征）

## 1. 定位

TIR/后端产出**对象文件**后、生成可执行/库前的全局优化层。与前序 IR 层解耦——它消费对象文件/bitcode，不关心 TIR 语义。

```text
TIR ──各后端──▶ 对象文件/bitcode ──▶ [本层] ──▶ 可执行/库/插件
```

目标（G7）：跨模块内联、过程间优化、Profile 驱动布局、死代码剔除。

## 2. CGU 划分（Code Generation Unit）

- 把程序切成若干 CGU（编译单元分组），**并行 codegen**（对接 Driver/Query 的 CGU 级并行）。
- 划分策略：按模块/按依赖层级；热点模块可独立成 CGU 以便单独重编/单独 PGO。
- 与 TIR 拆快照键（`tir-design.md §4.2.1`）协同：CGU 边界 ≈ TIR 模块边界（1:1 `.tc`），实例区 `.tir.inst` 单独成 CGU 或并入定义点 CGU。

## 3. ThinLTO（跨模块优化，G-5）

- 各 CGU 先发**摘要（summary）**而非全量 IR；链接期用摘要做跨模块内联/去虚化，**不要求全程序 IR 常驻内存**。
- **跨模块摘要缓存（增量 LTO, G-5）**：摘要按 `.tmi` 指纹缓存；仅变更 CGU 的摘要重算，其余复用 ⇒ 增量 LTO。
- 对位：LLVM ThinLTO（分布式/精简摘要，避免 FullLTO 的全程序内存峰值）。

## 4. PGO（Profile-Guided Optimization）

| 模式 | 方法 | 用途 |
|---|---|---|
| 插桩（instrumentation） | 编译期插计数 ⇒ 跑负载 ⇒ 收集 `.profdata` | 精确分支/调用热度 |
| 采样（sample，如 Linux perf） | 不改二进制，采生产负载 | 低开销、近生产路径 |

- PGO 数据驱动：内联决策、分支权重、函数/基本块布局。

## 5. IR 级 FDO 布局（G-11，T 特有补充）

- 标准 BOLT 是 **post-link** 工具，需特殊工具链（重读二进制+重排）。
- T 额外在 **TIR/MIR 级用 PGO 数据做基本块/函数布局**（G-11）：`tir-design.md §4.6` 已纳入。
- 收益：拿 BOLT 大部分 icache/TLB 收益，**而无需 post-link 工具链**——更可移植（对标 BOLT 但内置于编译器）。
- 二者关系：IR 级 FDO 是默认/可移植路径；BOLT 作为"极致布局"的可选补充。

## 6. BOLT（后链接重排）

- 对最终二进制重排基本块/函数，榨取 icache/TLB（尤其大型服务/长运行进程）。
- 作为**可选**后处理；与 IR 级 FDO（§5）二选一或叠加。

## 7. 死代码 / 重复剔除

- `--gc-sections`（删未用段）/ `/OPT:REF`（链接器 COMDAT 去重）。
- 与 TIR `linkonce_odr` 单态实例（`tir-design.md §4.2.1`）协同：ODR 去重交给链接器，IR 层零重复。

## 8. 与 TIR 快照的关系

- TIR 快照（`tir-design.md §12`）验证"降级正确性"（双后端一致）；本层优化不改变 TIR 语义，故 TIR 快照在优化**之前**判定，二者正交。
- IR 级 FDO（G-11）读取的 PGO 数据，由本层 PGO 采集、回灌给 TIR 布局 pass。

## 9. 落地路线

- **L 阶段**：先 CGU 并行 codegen（Driver/Query 已支持）+ `--gc-sections` 基础剔除。
- **L' 阶段**：ThinLTO + 跨模块摘要缓存（增量 LTO, G-5）。
- **L'' 阶段**：PGO（插桩+采样）+ IR 级 FDO 布局（G-11）。
- **L''' 阶段（可选）**：BOLT 后链接重排。
- 每阶段不破坏 `gate L2`；全局优化层独立于自举不动点。

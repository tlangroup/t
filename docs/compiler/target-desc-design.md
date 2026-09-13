# `target_desc` —— 目标特征矩阵规格（G-10）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §4.3b`）
> 关联：`docs/compiler/mir-design.md`（优化读取）、`docs/compiler/tir-design.md`（ABI 生成）、`docs/compiler/backend-design.md`（后端选择）、`docs/compiler/linker-opt-design.md`（目标相关布局）

## 1. 定位

`target_desc` 是**单一数据源（SSoT）**，描述"某目标平台能做什么、长什么样"。所有需要目标知识的层都读它，而不是各自 hardcode：

```text
              ┌────────── target_desc（特征矩阵）──────────┐
   mir 优化 ──┤ 向量宽度 / 对齐 / 指令集                   ├──▶ 自动向量化决策
   TIR ABI ───┤ 调用约定 / 结构体对齐 / 指针宽度            ├──▶ 存储类型布局
   后端选择 ──┤ ISA / 地址空间 / 可用扩展                  ├──▶ 发射目标
   链接布局 ──┤ 页大小 / 对齐 / 缓存行                    ├──▶ FDO 布局
              └───────────────────────────────────────────┘
```

目标（G10）：消除"目标知识散落各后端"的漂移源（这正是双后端漂移的近亲问题）。

## 2. 特征矩阵字段

| 类别 | 字段 | 例（x86-64） | 例（wasm32） | 例（nvptx64） |
|---|---|---|---|---|
| ISA | 指令集/扩展 | SSE4.2/AVX2/AVX512 | SIMD128 | PTX ISA |
| 宽度 | 指针位宽 | 64 | 32 | 64 |
| 向量 | 原生向量宽度(lanes) | 4(f32,AVX2)/8(AVX512) | 4 | 取决于 compute cap |
| 对齐 | 标量/聚合对齐规则 | 8/16 | 4/8 | 按 cap |
| 调用约定 | ABI/参数传递 | System V AMD64 | wasm 栈式 | PTX kernel 参数 |
| 地址空间 | 可用 aspace | 0(host) | 0 | 0/1/3/5(global/shared/local) |
| 浮点 | 软/硬浮点、精度 | 硬 f32/f64 | 硬 | 硬 |
| 端序 | endianness | LE | LE | LE |
| 内存 | 页大小/缓存行 | 4K/64B | — | — |

## 3. 读取方职责

- **mir 自动向量化**：读 `向量宽度` + `ISA 扩展` 决定合 `vec` 的 lanes 与可用指令；读 `对齐` 决定 spill/对齐。
- **TIR ABI 生成**：读 `调用约定`/`对齐`/`指针宽度` 计算 struct 字段偏移、参数寄存器/栈布局（产出 TT 条目中的 `align`/`offset`）。
- **后端选择**：`backend-design.md` 按 `ISA`/`地址空间` 选定发射目标（如 device 走 nvptx64）。
- **链接布局（G-11）**：读 `页大小`/`缓存行` 做 IR 级 FDO 基本块对齐。

## 4. 表示与来源

- 内存结构：`TargetDesc` 结构体 + 每目标的 `instance`（如 `x86_64_desc`、`wasm32_desc`、`nvptx64_desc`）。
- 来源优先级：**显式 `--target=<triple>`** > 宿主默认；可覆盖单字段（`--target-feature=+avx512`）。
- 对位：LLVM **target triple** + `TargetTransformInfo`/`DataLayout`；MLIR **target descriptor**（可序列化的目标描述，供 codegen 与优化共用）。

## 5. 与 TIR `ST` 的关系

- `ST`（存储类型，见 `tir-design.md §5`）描述"值如何搬运比特"；`target_desc` 描述"目标如何摆放这些比特"。
- 例：`ST = struct{ptr,len}`（TIR 侧固定）的**实际对齐/填充**由 `target_desc.对齐` 决定，而非写死在 TIR 里 ⇒ TIR 跨目标可复用，布局决策外置。

## 6. 落地

- **T 阶段**（与 mir 同期）：先定义 `TargetDesc` 结构 + `x86_64`/`wasm32` 两个实例；mir 向量化与 TIR ABI 读取之。
- 后续：补 `nvptx64`（device）、`aarch64`（未来原生后端）；支持 feature 覆盖。
- 门禁：同份 TIR + 不同 `target_desc` ⇒ 产出不同但**各自正确**的 ABI 布局（验证 SSoT 生效）。

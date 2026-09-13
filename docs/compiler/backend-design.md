# 后端层 / `BackendTraits` 规格（多目标 codegen, G-1/G-6）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §4.5`）
> 关联：`docs/compiler/tir-design.md`（TIR 后端桥）、`docs/compiler/target-desc-design.md`（目标特征）、`docs/compiler/device-design.md`（GPU 路径）、`docs/compiler/linker-opt-design.md`（CGU 并行）

## 1. 核心抽象：`BackendTraits`（对标 `rustc_codegen_ssa`）

TIR 是**后端无关**的（G1）。每个后端只实现一组 `BackendTraits`，**不碰 TIR 语义**：

```text
tmir 模块 ──▶ 通用遍历机（遍历指令/基本块）──▶ 调用 BackendTraits 钩子
                                                    │
                       ┌────────────────────────────┼───────────────────┐
                  tmir→c           tmir→ll          tmir→cranelift      tmir→wasm      tmir→spirv(device)
                  (C 文本)        (.ll)            (机器码/对象)       (.wasm+.wit)  (GPU dialect)
```

- **通用遍历机**只负责"走指令、收集基本块、处理控制流"，把"如何发射每种指令"委托给 traits。
- 加新后端 = 实现一份 `BackendTraits` + 注册，**不碰 TIR 定义、不碰其他后端**（根治双后端漂移 Bug1/Bug2 的结构性解法，G1）。
- 对位：Rust `rustc_codegen_ssa` + `BuilderMethods`（官方数据：LLVM/Cranelift/GCC 三后端复用约 10,000 LOC）。T 因无 trait 单态化能力，用**数据化 TIR + traits 钩子**而非 Rust 式 trait。

## 2. 各后端职责（薄翻译器）

| 后端 | 触发 | 职责 | 状态 |
|---|---|---|---|
| **tmir→c** | 便携/自举/无 LLVM | tmir slot→C 局部变量(`mem2reg` 推给 C 编译器)；`ST→C 类型`(`int64_t`/`uint64_t`/`T*`)；`ptr<ST>` 取 pointee | 重写(原 codegen_c) |
| **tmir→ll** | release/native | tmir→LLVM IR；`alloca/load/store`→LLVM 自动 `mem2reg`；`ST` 映射(`iN/uN/f32`/`ptr`)；`ptr<ST,as>` opaque 丢弃 aspace | 重写(原 codegen_ll) |
| **tmir→cranelift** | profile=dev | tmir→Cranelift IR→机器码/对象；codegen 约 **10× 快于 LLVM**(Rust 实测 ~20% 省代码生成时间) | 新增 |
| **tmir→wasm** | Web/沙箱/插件 | tmir→LLVM wasm **或** 独立发射；生成 `.wasm` + `.wit`(Component Model, G-3) | 新增 |
| **tmir→spirv** | GPU | `kernel fn`→tmir→Device Dialect→SPIR-V/NVVM/ROCDL(见 `device-design.md`) | 沿用 device 路径 |

## 3. WASM：Component Model + WIT（G-3，ERP 价值）

- 目标双形态：`wasm32-wasip1`(legacy, 直接 wasm) + `component`(新, **Component Model**)。
- Component Model 输出 **`.wit`** 接口描述 + `wasm-tools component new` 封装 ⇒ sub-1ms 冷启、强沙箱、多语言组合。
- **对 seesaw-erp 的直接故事**：核心不重编、业务以 WASM 组件插件化（"核心编译一次，业务动态加载"）。
- TIR 是这一路径的天然输入：组件边界 = TIR 模块边界（1:1 `.tc`），`linkonce_odr` 实例区处理跨组件泛型。


> ⚠ **WASM Component 交付包 = 接口发射 + 沙箱隔离验证（须同一交付，D4-3 ⊕ D7-10）**：Component Model 对 seesaw-erp 的价值（"核心不重编、业务以组件插件化"）只在「产物无法逃逸沙箱」时才成立。故 `tmir→wasm` 不能只产出 `.wit` + `.wasm`，还须定义并验证**沙箱隔离属性**（vWasm 式：组件仅经声明的 import/export ABI 与宿主交互、无非法访存、内存边界由 Canonical ABI 约束）——这是 D7-10 的"安全边界保持"二分项，与 D8（插件供应链信任）同源。当前 `backend-design.md` 仅给出 `.wit` 发射的轮廓，**WIT 发射细则 + 隔离属性验证规格待独立文档 `wasm-component-design.md` 落编**（ERP 插件化的关键路径，建议列为 P1 与 G-3 同批）。
## 4. 后端选择（读 `target_desc`）

- 由 `target_desc` 的 `ISA`/`地址空间` 选定发射目标；`--profile=dev` 优先 Cranelift（快调），`--profile=release` 优先 LLVM（质量）。
- 同一 TIR 喂不同后端 ⇒ 多目标一份输入（强化单 `.tir` md5 快照，见 `tir-design.md §12`）。

## 5. 与 TIR 的契约

- 后端**只消费 tmir**：不遍历 AST、不推类型、不做中端优化（那些在 mir/HIR）。
- 后端**只读 `ST` 与 TT**（ABI 事实已集中）；布局细节来自 `target_desc`（见 `target-desc-design.md`）。
- 后端**不引入 φ**（TIR 已 memory-first，φ 在 mir 展开，见 `tir-design.md §2.4`）。

## 6. 落地（对应 `compiler-pipeline-design.md §9`）

- **B–F 阶段**：`tmir→c`/`tmir→ll` 先重写为薄翻译器（tmir 落地）；通过 `gate L2`（双后端共享降级 ⇒ Bug1/Bug2 根除）。
- **C 阶段(新增)**：`tmir→cranelift`（profile=dev 默认）。
- **W 阶段(新增)**：`tmir→wasm` + Component Model/WIT。
- **device 路径**：沿用 `device-design.md`（tmir→Device Dialect）。
- 门禁：每加一个后端，单 `.tir` md5 仍驱动全后端一致（快照维度不变）。

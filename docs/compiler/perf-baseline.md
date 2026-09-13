# T 编译性能基线（D3-A vs D2 张力证据）

> 状态：基线 v0.1（2026-09-04，落实 `pipeline-review.md §9.2`「单次编译性能基线（原型量化）」）
> 关联：`ci-gate-design.md` G-CI-10、`compiler-pipeline-design.md §5`（增量/查询·并行）、审查维度 D3-A（工程性能）vs D2（IR 架构）
> 约束：仅为测量，不触碰编译器实现；测量工具 `tools/bench_compile.mjs` 仅驱动 `tc` 计时。

---

## 0. 目的

D3-A（工程性能）与 D2（IR 架构）存在张力：新增 mir 层（类型化 CFG + SSA，中端优化）会把「HIR→后端」改为「HIR→mir→TIR→后端」，延长编译期。要论证 mir 落地「值得」，须先有**当前管线（无 mir）单次编译耗时的硬基线**，供落地前后做回归 / 持平 / 增益对比——把张力转为可量化、可阻断的 CI 证据（G-CI-10）。

---

## 1. 方法学

- **工具**：`tools/bench_compile.mjs`（Node，驱动 `tc` 子命令并 `performance.now()` 计时；不碰实现）。
- **编译器**：`out/rls/tc.exe`（release 构建，2026-09-03 产物）。
- **样本**：`examples/*.tc` 全部 87 例，排除 `_z_*` 预期错误夹具（需 `--example` 或预期编译失败）。
- **重复**：每文件每模式 3× 取中位数（消抖）。
- **模式**：
  - `check` = 前端 + 语义分析（HIR→sema），即 mir 将插入的环节；
  - `emit-ll` = LLVM 代码发射（codegen），表征后端成本。
- **复跑**：`node tools/bench_compile.mjs --modes check,emit-ll --repeat 3`（产物 `out/perf_baseline.json` / `.md`）。

---

## 2. 基线实测（2026-09-04）

### 2.1 前端 + 语义（`tc check`，全量 86/87 成功）

| 指标 | 值 |
| --- | --- |
| 样本数 | 86 |
| 总耗时 | 1125 ms |
| 中位 | 13 ms |
| p90 | 15 ms |
| 最大 | 17 ms |

### 2.2 代码发射（`tc emit-ll`，20 例子集表征）

| 指标 | 值 |
| --- | --- |
| 样本数 | 20 |
| 总耗时 | 2362 ms |
| 中位 | 116 ms |
| p90 | 134 ms |
| 最大 | 170 ms |

---

## 3. 解读

- **前端 + sema 极廉价**：中位 13ms、最大 17ms。说明当前「HIR→TIR→双后端」前端不是瓶颈。
- **codegen 主导**：`emit-ll` 中位 116ms，约为前端的 **~9×**。编译耗时集中在 LLVM 发射，而非语言前端。
- **对 mir 决策的启示**：mir 层插入在「前端→后端」之间，主要增加前端 / 中端工作量（绝对量小，~十毫秒级），而 codegen 主导项不受 mir 影响（mir→TIR 降级成本亦在十毫秒级）。故 mir 落地**预期为小幅、可接受的前端增量**，换来中端优化（常量传播 / 内联 / DCE）可能反哺 codegen 质量的净增益——但须以 G-CI-10 实证而非假设。
- **D3-A vs D2 张力定性结论**：张力真实但量级可控；是否值得取决于中端优化带来的端到端收益，须 mir 落地后复跑本基线比对中位 / p90 验证。

---

## 4. mir 落地后的对比接入（G-CI-10）

1. mir 阶段 PR 须复跑 `tools/bench_compile.mjs --modes check,emit-ll --repeat 3`。
2. 比对维度：前端中位 / p90、codegen 中位 / p90、总耗时。
3. **阻断阈值**：回归 > 10%（初设，由本基线实证；可在 `ci-gate-design.md` 调整）即触发 G-CI-10 阻断 `perf-baseline` job。
4. 若 codegen 因中端优化而下降，则记录为「净增益」并附端到端（含运行期）证据；门禁只卡编译期回归，运行期收益单独量化。

---

## 5. 已知局限（留待后续回合）

- `emit-ll` 仅子集表征（20 例）；全量 codegen 基线可在 CI `perf-baseline` job 内补全（`--modes check,emit-ll --repeat 3`，约 2–3 分钟）。
- 未含 `tc build`/`tc run`（链接 + 运行）耗时——属运行期，非编译期瓶颈，暂不纳入。
- 样本为 `examples/`，不含真实 ERP 大规模模块；mir 决策前应补大规模单模块样本。

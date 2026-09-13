# T 诊断 IR 设计（G-9：跨层 span 贯通）

> 状态：规格 v0.1（2026-09-04，落实 `compiler-pipeline-design.md §5.6`）
> 关联：`compiler-pipeline-design.md §5.6`、`cst-design.md`（锚点）、`hir-design.md`（HIR 源锚）、`tir-design.md`（TIR 回指）、审查维度 D5-1 / D7

---

## 0. 定位与审查结论

诊断质量直接决定开发者体验（D5-1）与误编译定位效率（D7）。当前父文档仅一句「富诊断 + 机器可读」（§5.6）；本设计把它扩为**贯穿全层的诊断 IR**（SARIF/JSON），span 跨层贯通。建议从原 P4 **提前到 P1**——它是 D7 误编译精准定位与 D5 体验的**低成本高杠杆**基础（见 `pipeline-review.md §8.4` 重排建议）。

---

## 1. 诊断 IR 形态

- 每条诊断 = 结构化记录：`{ code, severity, message, spans[], notes[], related[] }`，可序列化为 **SARIF** 或 T 自有 JSON。
- `code` 沿用 `diag_table.gen.h` 的诊断码（`T-SEM-E*` / `T-mir-E*` / `T-TIR-E*` …），覆盖全层，与 `tools/diag_defs.json` 单一真相源对齐。
- 机器可读：供 GitHub/CI 注解、LSP、LLM 辅助修复统一消费。

---

## 2. 跨层 span 贯通（核心机制）

- CST 锚点（`ln/cl/tv`，见 `cst-design.md §2.3`）是 span 起点。
- HIR 保留源锚（pre-sema 惰性诊断已可定位）；Sema / mir / TIR 每级 lowering **携带 HIR 锚** → **TIR 级错误能回指源码 span**（见 `tir-design.md` 回指设计）。
- 降级链：`src position → CST node → HIR instr → TIR slot`，每级记录原始 span；emitting 时沿链回溯到最精确源码位置。
- WASM 组件隔离验证失败（见 `wasm-component-design.md §2`）也回指源码 span，使安全门禁报错可读。

---

## 3. 诊断质量要素（D5-1）

- 错误恢复：单错误不终止，收集**多错误**；warning 与 error 互补（候选建议、修复提示）。
- 降级友好：TIR / C 后端错误回指源码（非 IR 内部位置），降低「误编译」定位成本（D7-2/D7-4）。
- 编译期求值（CTFE）错误精确回指 comptime 调用栈（见 `comptime-design.md` 安全小节）。

---

## 4. 与 CI / LLM 集成

- SARIF 输出对接 GitHub Code Scanning；JSON 供自研 LSP / IDE。
- LLM 辅助修复：结构化诊断 + span 作为上下文，提升修复建议准确率；误编译定位（D7）因 span 贯通而可自动归因到低级 IR。

---

## 5. 落地（P1 前置）

§5.6 升为子文档；诊断 IR 在 HIR→TIR 降级链打通 span 回指；SARIF 导出接入 `gate` 的编译测试层（见 `pipeline-review.md` D5-6）。与 WASM 组件隔离门禁（P1）同期，因二者共享跨层 span 机制。

### 5.1 CI SARIF 门禁（D5-1 / D7）

- **导出**：编译器以 `--sarif <path>` 产出 SARIF；CI `diagnose` job（见 `ci-gate-design.md` G-CI-6）上传至 GitHub Code Scanning，LSP/IDE 消费同一 JSON。
- **门禁语义**：P1 前为**告警**（不阻断，先建立消费链路）；P1 起诊断 IR 贯穿全层后升为**阻断**——要求 HIR→TIR 降级链 span 回指 100% 贯通、WASM 隔离验证失败与 CTFE 错误均可回指源码 span。
- **误编译定位**：SARIF `relatedLocations` 携带跨层 span（CST→HIR→TIR），使 D7 误编译可自动归因到低级 IR（联动 `driver-query-design.md` 诊断消费）。

# T 编译 CI 门禁矩阵设计（实现与 CI 接入）

> 状态：规格 v0.1（2026-09-04，落实 `pipeline-review.md §9.2`「实现与 CI 接入」）
> 关联：三项新设计文档（`wasm-component-design.md` / `diagnostic-ir-design.md` / `supply-chain-design.md`）+ `comptime-design.md §5.1` + `driver-query-design.md §9` + `tir-design.md`（round-trip）+ `gate.mjs`（自举）
> 约束：本文件与 `ci.yml` 为「CI 接入」的设计/配置层，不触碰编译器实现（沿用「不要编码」裁定）；门禁脚本接口已定义，其具体实现列入「待实现接口」。

---

## 0. 定位

把 BP-1 / BP-2 / BP-3「性能/机制 ⊕ 正确性 ⊕ 信任」三向绑定，从设计层落到 CI 阻断层。每个门禁对应一个审查维度与一份设计文档，CI 失败即交付失败——这正是「综合考量达到最佳结合点」的硬落地。

---

## 1. 门禁矩阵

| 门禁 | 设计文档 / 锚点 | 审查维度 | 阻断性 | CI job |
| --- | --- | --- | --- | --- |
| G-CI-1 自举不动点（gate L2） | `gate.mjs` | D7 基础 | 阻断 | `bootstrap` |
| G-CI-2 IR round-trip 双序列化 | `tir-design.md` | D2-7 / D7 | 阻断 | `ir-roundtrip` |
| G-CI-3 增量正确性等价（clean≡incremental） | `driver-query-design.md §9` | D3-B / D7-8 / D8-4 | 阻断 | `incrementality` |
| G-CI-4 缓存键闭合性自检 | `driver-query-design.md §9` | D8-4 | 阻断 | `incrementality` |
| G-CI-5 CTFE fuzz 门禁 | `comptime-design.md §5.1.1` | D6-1 / D7-3 / D7-10 | 阻断 | `ctfe-fuzz` |
| G-CI-6 诊断 SARIF 门禁 | `diagnostic-ir-design.md §5.1` | D5-1 / D7 | 告警 → P1 阻断 | `diagnose` |
| G-CI-7 SBOM / 审计 / 签名 | `supply-chain-design.md §7.1` | D8-1/2/3/5 | 发布阻断 | `supply-chain` |
| G-CI-8 WASM 组件隔离验证 | `wasm-component-design.md §4.1` | D4-3 / D7-10 / D8 | W 阶段起阻断 | `wasm-component-verify` |
| G-CI-9 hermetic 缓存信任校验 | `supply-chain-design.md §4` | D8-4 | 阻断 | `supply-chain` |
| G-CI-10 性能基线回归 | `perf-baseline.md` | D3-A vs D2 | 回归>X% 阻断 | `perf-baseline` |

---

## 2. 执行顺序（DAG）

```
bootstrap (L2, G-CI-1)
   ├─> ir-roundtrip            (G-CI-2)
   ├─> incrementality          (G-CI-3/4) ──> supply-chain (G-CI-7/9)
   ├─> ctfe-fuzz               (G-CI-5)
   ├─> diagnose                (G-CI-6, 告警)
   ├─> perf-baseline           (G-CI-10)
   └─> wasm-component-verify   (G-CI-8, W 阶段起启用)
```

- `bootstrap` 是其余门禁的前置——产物须先达自举不动点（IR 漂移归零）。
- `incrementality` 与 `supply-chain` 串联：缓存键闭合性（G-CI-4）是远程缓存信任（G-CI-9）的前提。
- `wasm-component-verify` 在 W 阶段前以 `continue-on-error` 占位，落地即转阻断。
- `diagnose` 在 P1 前 `continue-on-error`（先建立消费链路），P1 起转阻断。

---

## 3. hermetic action cache（D8-4 实体化）

- action-key = 内容哈希 + 编译器版本 + 目标三元组 + flags + pass 集 + 工具链版本（D8-2）。
- 远程缓存条目写入即签名、读取即校验；信任边界仅密钥不通道（防中间人投毒）。
- 与 `driver-query-design.md §9` 缓存键闭合性自检共用同一 key 定义，避免双份真理。

---

## 4. 与性能基线（D3-A vs D2）的衔接

- `perf-baseline.md` 建立的单文件编译耗时基线是 mir 层（D3-A）落地前后的回归参照。
- mir 阶段 PR 须复跑 `tools/bench_compile.mjs` 并比对中位 / p90；回归 > 阈值（由基线实证确定，初设 10%）即阻断 G-CI-10。
- 这是把「D3 工程性能」与「D2 IR 架构」的张力，转为可量化、可阻断的 CI 证据。

---

## 5. 待实现接口（本回合未编码，定义契约）

| 脚本 | 职责 | 对应门禁 |
| --- | --- | --- |
| `tools/incremental_check.mjs` | clean≡incremental 双路径产物比对 + 缓存键闭合性自检 | G-CI-3/4 |
| `tools/ctfe_fuzz.mjs` | 畸形 comptime 语料生成 + 断言（不崩溃/超预算诊断/双后端互证） | G-CI-5 |
| `tools/diag_sarif.mjs` | 驱动编译器 `--sarif` 产出并汇总 | G-CI-6 |
| `tools/supply_chain.mjs` | SBOM 生成 + 漏洞审计 + 签名 + 缓存信任校验 | G-CI-7/9 |
| `tools/wasm_component_verify.mjs` | 组件隔离验证（ABI 闭环/内存边界/无裸指针逃逸） | G-CI-8 |

> 已存在的可直跑工具：`tools/gate.mjs`(L2)、`tools/ir_snapshot.mjs`(round-trip)、`tools/bench_compile.mjs`(性能基线)。其余为后续实现回合的契约接口，本回合仅完成设计与 CI 接入（配置层）。

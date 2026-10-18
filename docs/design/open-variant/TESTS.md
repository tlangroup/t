# 开放变体 · 测试清单（阶段三验收用）

> 设计文档：`DESIGN.md`（§7 概述）｜示意代码：`EXAMPLES.tc`、`EXAMPLES_extend_a.tc`、`EXAMPLES_extend_b.tc`
> 本文件是**可勾选的执行清单**，落地时逐项建文件；命名前缀对齐既有 conformance 惯例（`p_` pass / `f_` fail）。

## A. conformance · pass（应 0 error 且运行产出符合期望）

- [ ] `tests/conformance/pass/p_variant_overload_extend_ok.tc`
      组声明 + 同文件追加单元/载荷 case；构造 + `match` + 合成 helper（`V_from_C` / `V_is_C` / `V_as_C`）
      全部可用。对应 EXAMPLES.tc 的骨架。

- [ ] `tests/conformance/pass/p_variant_overload_extend_multi_payload.tc`
      追加**多载荷** case（`Wheel(i64, bool)`），验证 `V_as_C` 的多字段回落形态（`as_fK`）。

- [ ] `tests/conformance/pass/p_variant_overload_multi_extend.tc`
      **多处** extend 同一组（验证 D2 的连续重编号与 case 链可多次拼接）。

- [ ] `tests/conformance/pass/p_variant_overload_abstract.tc`
      开放组同时写 `_`（抽象）：可追加 + match 免穷尽，验证 `overload` 与 `_` 的正交性（§2 表格第 3 行）。

- [ ] `tests/conformance/pass/p_variant_overload_recursive_ptr.tc`
      追加带指针自引用的 case（沿用 `Rec(i64, *V)`），验证递归检查 `T-SEM-E213` 对追加 case 同样生效。

## B. conformance · fail（应报指定诊断码）

- [ ] `tests/conformance/fail/f_variant_extend_no_group.tc`
      extend 到一个从未 `overload` 的普通 variant ⇒ `T-OVL-E980`

- [ ] `tests/conformance/fail/f_variant_extend_dup_case.tc`
      组声明与 extend（或两个 extend）出现同名 case ⇒ `T-OVL-E981`（本设计新增）

- [ ] `tests/conformance/fail/f_variant_extend_missing_case_match.tc`
      追加后 `match` 未列新 case ⇒ `T-MAT-E742`（**验证决策 D5：开放 ≠ 免穷尽**）

- [ ] `tests/conformance/fail/f_variant_extend_syntax.tc`
      裸 `extend variant X { ... }`（缺 `overload`）⇒ 解析错（对齐 struct 的 `T-PAR-E102` 口径）

## C. 运行级（examples · 双后端 golden）

- [ ] `examples/open_variant_a.tc` + `examples/cross/open_variant_b.tc`
      跨文件 pair（照搬 `struct_extend_a` / `cross/struct_extend_b` 惯例）
      + `examples/open_variant_a.expected.txt`
      双后端各自跑通、输出比对 golden 且双后端一致

- [ ] IR 快照：`tools/ir_snapshot.mjs` 目标集新增上述示例 ⇒ 双后端 IR **新增条目**，既有条目**不得漂移**

## D. 全链路（每个子任务的强制完成定义）

- [ ] `tc check src/tc.tc` → 0 error
- [ ] 自举不动点：`out/dbg/g2` == `g3` == `g4`
- [ ] `node tools/gate.mjs L2` 全绿
- [ ] IR 基线随源码同提交（`tests/ir_baseline.json`，必要时用 g1 `--update` 重录）
- [ ] `npm run seed:check`（改了 src ⇒ 必须跑；种子变则 `--src out/dbg/g4.exe` 刷新并**同提交**）
      ——按 2026-10-18 立律：面向 main 的 PR 开出之前，种子必须已同代

## E. 已知不测（本 epic 范围外，仅登记）

- 载荷重载（D1 否）
- variant 构造器进 `TypeInfo` 反射
- `@derive` 支持 variant
- C 侧 `uint32_t` vs LLVM 侧 `i64` 的 tag 宽度不一致（既有事实，记录进 known-issues）

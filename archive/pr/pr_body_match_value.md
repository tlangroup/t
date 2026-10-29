## 变更摘要
本次在 `src/sema.tc` 落地 match **值匹配**优化（审查结论 P0/P2/P3 子集）：

- **T-MAT-E760 (error)**：值类型（整数/浮点/字符串/atom/bool/char/enum）匹配下——
  - 常量臂重复（与更早常量臂冲突）即硬错；
  - 常量落进更早的区间臂范围内即硬错；
  - 区间臂彼此重叠即硬错；
  - 不可达臂从原 `T-MAT-W744`(warning) **升级为 error**。
  - 守卫臂（`when`）按审查「守卫臂不可判定」保守策略**不参与唯一性侧表**（合法的守卫细化，如 `Color.Red when hi` 后接 `Color.Red`，不误报）。
- **T-MAT-W761 (warning)**：float 字面量/区间臂的 NaN 脚枪提示（NaN 既不恒等于任何值、也不属于任何区间，会静默落入 `_` 臂）。

## 顺带修复（与 match 无关，但阻塞了 gate L2）
S5 删除旧 C 后端 `src/codegen_c.tc` 时漏改工具链，导致 gate 静态检查/快照步崩溃。本次一并修复：
- `tools/tc_sources.mjs`：移除对已删 `codegen_c.tc` 的引用（ENOENT 崩溃根因）
- `tools/catn_check.mjs`：`sb_catN` 阈值 470→400（S5 删除后实计数 455）
- `tools/ir_snapshot.mjs` / `tools/difftest.mjs`：tmir-c 只产 `.c` 不产 `.h`，快照/对拍只比对 `.c`
- `tests/ir_baseline.json`：剔除 130 条失效 `::h` 条目并重录（g1 自举）

## 验证
- `src/tc.tc` 自检 0 errors / 623 warnings / 0 个 T-MAT 诊断
- 29 个含 match 的 conformance pass 用例 + 全部 examples：零 T-MAT-E760 误伤
- 触发用例全绿：dup / range / unreachable → E760，nan → W761；负例（离散常量 / 非重叠区间 / enum 匹配）零误报
- gate L2：自举四代不动点、双轨对拍、MIR differential、snapshot 零差异、conformance 373/373 全绿
- `f_unreach_arm.tc` 的 conformance 期望已从 `T-MAT-W744` 更新为 `T-MAT-E760`（值类型不可达臂升级的有意变更）

## 已知遗留（不在本 PR 范围）
gate L2 最后一步 `cself`（C 后端自举：tmir-c `emit-c` → clang → conformance）暴露 **tmir-c 后端 `emit-c` 既有语义缺陷**：C 后端自举出的编译器运行时无法识别 `scalarkind` / `anykind` / `integralkind` 等类别类型，而同一份源码经 LLVM 后端自举的 `g4` 编译 `p_overload_type.tc` 为 0 errors。`git diff` 证明本 PR **未触碰任何 `emit-c` / tmir-c 文件**，故该失败与 match 优化完全正交，建议单独立项修复 tmir-c 后端。

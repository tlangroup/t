# df5cd06-six-fixes 功能清单 vs main（移植基线）

> 目的：记录 df5 分支相对 main 做过的全部功能，作为「在 main 上重做一遍」的基线。
> 记录时间：2026-08-29。df5 = orphan `b511bd6`（707 文件快照）；main = `69dc766`（688 文件）。

## 0. 两条线的关系
- 无共同祖先（orphan）；`git diff --stat` = **367 文件，+3546/−5598**。
- 核心源差异规模（df5 → main）：
  - `src/sema.tc`   +687 / −1678（最大，语义层分歧最深）
  - `src/parse.tc`  +241 / −330
  - `src/base.tc`   +280 / −353
  - `src/codegen_ll.tc` +176 / −269
  - `src/codegen_c.tc`  +116 / −113
  - `src/test.tc`   +7 / −7
- 两端都**已具备**：closure（TClosure ABI）、f-string、import/.tlib、comptime、variant 多载荷(#5)、match 返回结构体(#8)、agent/colony。

## 1. df5 领先 / main 缺失的功能（按 df5 独有 conformance 用例归类）
### A. variant 体系增强
- 递归指针变体 `p53_variant_recursive_ptr`
- 抽象变体 `p50_variant_match_abstract` / `p55_variant_abstract`
- match 解构 `p49_variant_match_destructure`
- match 缺 case / 未知 case / pattern arity 校验 `f133`/`f134`/`f135`
- 抽象 bad underscore `f136`、递归值 `f137`、多载荷 arity `f138`、abstract marker `f139`
- 多载荷 mixed types `p54`、unit+payload 共存 `p51_variant_match_unit_and_payload`

### B. 格式化串（f-string）校验
- `f112_fmt_no_template` `f113_fmt_too_many_args` `f114_fmt_arg_type` `f115_fmt_bad_template`
- `f116_fmt_named_field` `f117_fmt_mixed_numbering` `f118_fmt_index_range` `f119_fmt_spec_type`

### C. ref / 只读语义
- `f100_const_ref_var` `f101_const_ref_let` `f140_ref_write_readonly`
- `p56_ref_basic` `p57_const_ref_const` `p58_let_ref_var_readonly_ok` `p59_let_ref_param_readonly_ok`

### D. 编译期计算（comptime）增强
- `p50_const_fold` `p51_if_prune`
- `p43_typeval_cmp` `p44_typeval_generic` `p45_typeof`
- `p41_enum_comptime` `p42_bool_comptime` `p60_comptime_closure_escape`
- meta 错误用例 `f141`/`f142`/`f143`/`f144`（浮点除零/取模零/inf-nan 操作数/fn 体逃逸）

### E. meta 校验增强
- `f124_meta_comptime_arg_not_type` `f125_meta_arity` `f126_meta_no_return`
- `f127_meta_not_type` `f128_meta_not_const` `f129_annotation_case`

### F. import 增强
- `f10_import_header` `f11_import_value` `f12_import_io` `f13_import_context`
- `f105_removed_import` `f131_import_conflict`

### G. 其它语义/校验
- annotation `f120_annotation_invalid_arg` `f129_annotation_case`
- forward type ref `p43_forward_type_ref`
- pipeline/foreach `p45_pipeline_ok` `p46_pipe_result_unused` `p49_pipe_apply_void_foreach`
- match arm type `f122_match_arm_type`、struct tagid 重复/混合 `f109`/`f110`
- c_keyword_ident `f130`、variant abstract bad underscore `f136`
- range 不纯操作数/无 end `f101`/`f102`、in rhs 非 range `f102`、escape return/global `f102`/`f103`/`f104`

### H. 额外 examples
- `examples/fmt_json_a1a.tc` `examples/mini.tc` `examples/mini2.tc` `examples/match_return_struct.tc`(+`.expected.txt`)

## 2. 已具备、无需移植（main 已有）
LL(1) 声明（已 `69dc766`）、#7 array→slice（已 `54d9cd6`）、多载荷 variant #5、match 返回结构体 #8、f-string、import/.tlib、comptime、closure TClosure、agent/colony。

## 3. 移植策略（在 main 上逐个重做，保持 gate 绿）
- 每移植一个功能：重建自举链（g1→g4）+ 跑 conformance/gate，确认绿。
- 建议顺序（先易后难、依赖少优先）：
  1. **D comptime 增强**（const-fold / typeval / typeof / enum·bool comptime / if_prune / comptime 闭包逃逸 / meta 浮点错误）
  2. **A variant 增强**（递归/抽象/match 解构/用例校验）
  3. **C ref 只读语义**
  4. **B f-string 校验**
  5. **E/F/G meta/import/其它校验**
- 注意：df5 用新方言 `fn name`；main 已含 LL(1) 桥接可解析，移植时 df5 源码可直接被 main 编译器读，但 sema/codegen 实现需按 main 现有结构重写（不能整文件覆盖，会冲掉 #7 等 main 工作）。
- 风险：sema.tc 分歧最大（+687/−1678），逐功能小步移植并重建验证，避免一次性大改破坏 main 绿态。

## 4. 实测状态（更新于 P5 完成，2026-08-29 末）
- **conformance 现状：239 passed / 0 failed / 239 total**（g1 自 seed `out/dbg/tc.exe` 重建，BUILD_EXIT=0）。
- **D 类（comptime 增强）全绿**：p41 enum·p42 bool·p43 typeval_cmp·p44 typeval_generic·p45 typeof·p50 const_fold·p51 if_prune·p60 comptime 闭包逃逸 + meta 浮点错误 f141 除零/f142 取模零/f143 inf-nan/f144 fn 体逃逸 全部通过。
- **P4 `@type_of`**：已落地并过 conformance。
- **P5 comptime 闭包逃逸**：main 无 df5 的 `CVal` 设施，按「节点即值」模型重设计（`mk_closure_capval` + `meta_eval_closure_make` + codegen 透明透传 + `meta_fold_expr` 保 `sb`）；无捕获闭包经 ident 节点逃逸，捕获闭包经物化 `closure_make` 逃逸。另顺修 main 既有「简写 lambda 捕获参数」bug（`infer_lambda_ret_from_decl` 漏登 `closure_capture` 绑定 + `infer_expr` 的 `closure_make` 分支未就地推断 `infer_ret`）。
- **A(variant)/C(ref)**：main 现有 p49–p59 已全绿，判定「main 已具备」，无需重写。
- **未回归**：所有同步进来的 df5 用例 + 既有 main 用例合计 239 全过，无回归。

## 5. 关键更正（2026-08-29 实测）：B/E/F/G 早已在 main，仅 P4/P5 是真缺口
- **更正**：本节（及 §1「df5 领先/main 缺失」分类）前提有误。实证：main 的 `tests/conformance/fail/` 已含
  f112–f119（B f-string）、f124–f129（E meta）、f10/f11/f12/f13/f105/f131（F import）、
  f109/f110/f120/f122/f130/f136 及 range/escape（G）等用例——与 df5 **同名同 EXPECT 码**，仅改写为 main 新方言
  （`fn name` + `struct Name`，df5 是旧方言 `name fn` / `Name struct`）。这些用例已计入 239/0 绿态，说明 main **早已具备** B/E/F/G 的校验能力。
- **df5 真正比 main 多、需在 main 重做的只有两项**：
  1. **P4 `@type_of`**（内建 + p45_typeof 用例）—— 已落地、过 conformance、已提交 `b70f3fb` 并 push。
  2. **P5 comptime 闭包逃逸**（详见 §4）—— 已落地、过 conformance（p60 + 直接 build/run 退出码 0）、已提交 `b70f3fb` 并 push。
- **结论**：「在 main 重做 df5 全部功能」实质已完成。A(variant)/B(f-string)/C(ref)/D(comptime)/E(meta)/F(import)/G(other)
  七类功能 main 均具备且 conformance 239/0 全绿；唯一 df5 独有、main 缺失的两项（@type_of、comptime 闭包逃逸）已移植、提交、推送。
- **残留小项（非阻塞）**：df5 的 `mini.tc`/`mini2.tc`/`fmt_json_a1a.tc`/`match_return_struct.tc` 已在 `b70f3fb` 同步进 main 的 `examples/`（与 main 既有 examples 并存）；如需严格对齐可后续清理，但不影响功能与门禁。

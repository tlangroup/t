# tools/ 工具目录

分层原则：**根目录只放"活的"脚本**（被 CI / 门禁 / npm script / 日常手跑链路引用），
一次性脚本一律下沉到 `_attic/`，只留档、不再维护。

## 根目录（活的）

| 分组 | 文件 | 触发方式 |
| --- | --- | --- |
| 门禁主入口 | `gate.mjs` | `node tools/gate.mjs L1` / `L2`（CI 亦调用） |
| 规范符合性 | `conformance.mjs` | CI nightly；本地 `node tools/conformance.mjs --compiler out/dbg/tc.exe` |
| 自举 | `bootstrap.mjs`、`bootstrap_tc.mjs` | 手工自举 / 种子验证 |
| 构建 | `build_runtime.mjs`、`build_std.mjs`、`toolchain.mjs`、`msvc_env.mjs`、`_build_tc.mjs` | CI + 改 runtime/std 后手跑 |
| 种子 | `refresh_seed.mjs` | `npm run seed:check` / `npm run seed:refresh`（禁手工 cp） |
| 示例对拍 | `run_examples.mjs`、`run_examples_tmir.mjs`（golden，双后端）、`_diffpipe.mjs` | nightly + gate |
| 快照 | `ir_snapshot.mjs` | 改前端后重录基线（**必须用 gate 的 g1 录**） |
| 校验步 | `difftest.mjs`、`ir_verify.mjs`、`llvm_verify.py`、`m1_difftest.py`、`lint_smoke.mjs`、`catn_check.mjs`、`shadow_check.mjs`、`dagcheck.mjs` | 由 `gate.mjs` 调度 |
| 生成器 | `cstgen.mjs`、`gen_diag.mjs`、`gen_diag_t.mjs`、`gen_tint.py`、`gen_xid.mjs`、`gen_ebnf.mjs` | 改 `src/base.tc` / 诊断码 / 词法表后重生成 |
| 数据（生成器输入） | `cst_kinds.json`、`cst_nodes.json`、`diag_defs.json` | 由对应生成器读写，勿手改 |
| 测试 | `hir_test.mjs`、`hir_eval_test.mjs`、`repl_test.mjs` | CI nightly |
| 排障 | `mempeak.py`、`mihist_resolve.py` | 内存峰值 / `T_MIHIST=1` 调用点解析 |
| 源码清单 | `tc_sources.mjs` | 被 `catn_check` / `shadow_check` / `dagcheck` import |
| git 钩子 | `hooks/commit-msg`（入库）、`hooks/msgfilter.sh` | 新 clone 需 `cp tools/hooks/commit-msg .git/hooks/` |
| 子项目 | `notebook-web/` + `notebook.mjs`、`mlir-t-device/` | npm `notebook:web`；`.vscode` CMake 指向 |

## `_attic/`（归档，不再维护）

- `_attic/migrate/` —— 一次性源码迁移脚本（SoA 搬迁、drop-node、字段清理等），迁移已完工，仅留档。
- `_attic/probe/` —— 临时探针/诊断驱动（TIR-LLVM 调试、旧版 fixed-point 驱动 `fb*`、覆盖率扫描等）。
- `_attic/experimental/` —— 实验品（性能基准 `bench_compile.mjs`、TIR 快照、LLM 桥接）。

> 归档脚本**未被任何 CI / 门禁引用**，删除它们不会让任何测试变红。
> 如需复活：移回根目录，并在上表中登记。

## 判活方法（防误删）

不要只用文件名 grep —— `gate.mjs` 通过 `node("run_examples.mjs")` 之类的**字符串拼接**调用，
字面量 grep 会漏。正确做法：以 `gate.mjs` / `.github/workflows/*.yml` / `package.json` 为根做引用可达性分析，
再人工核对「引用者是脚本调用还是文档/记忆顺带提及」。

# ci/ — CI 配套（合并门禁 + 每日全量）

本目录存放 GitHub Actions 两套流程所需的配套资源：

| workflow | 触发 | 目的 | 内容 |
|---|---|---|---|
| `.github/workflows/ci.yml` | push 到 `main`（合并提交） | 快反馈的合并门禁 | `gate L1` |
| `.github/workflows/nightly.yml` | 每日 UTC 18:00 定时 + 手动 | 广覆盖的每日全量 | **全部测试 + 全部示例**（dbg/rls 双模式） |

两者共享 `seed/tc.exe` 与 LLVM 安装缓存（同一 cache key `llvm-windows-latest-v1`）。

## `seed/tc.exe` —— 自举引导编译器

`t` 是自托管编译器，自举链为 `seed → g1 → g2 → g3 → g4`。
仓库的 `out/` 被 `.gitignore` 忽略，因此不随附任何编译器二进制。
为了让 CI（干净 runner）能跑 `tools/gate.mjs`，这里提交一份**上一稳定版**
`tc.exe` 作为引导种子：

- CI 启动后将其复制到 `out/dbg/tc.exe`；
- gate 用它编译 `src/tc.tc` 得到 `g1`，再完成全部自举与门禁步骤。

### 何时需要刷新种子

当编译器自举契约发生变化、导致旧种子**编不出新 `src`** 时，必须刷新：
本地的 `out/dbg/tc.exe` 已能正常自举当前源码后执行

```bash
cp out/dbg/tc.exe ci/seed/tc.exe
git add ci/seed/tc.exe && git commit -m "ci: refresh bootstrap seed"
```

> 仅当合并到 main 出现「seed 无法编译 src / 自举不动点漂移」类失败时，
> 才需要刷新；正常演进下种子长期有效。

## 分支与触发约定

- **CI 触发**：仅 `push` 到 `main`（合并提交）。
- **工作分支**：`wb`。日常开发与文档撰写都在 `wb` 上进行，其提交 / PR
  不会触发本流程，避免频繁跑重型门禁。
- **合并时机**：设计文档（`docs/design.md`）在 `wb` 上完成并确认后，
  合并 `wb → main`，由合并提交自动触发 CI 对合并结果做完整验证。

## CI 跑的等级

CI 默认运行 `node tools/gate.mjs L1`（提交前 / 合并门禁级）：
工具链断言、诊断不变量、静态检查(catn/shadow/dag)、预编译 std、
一代自举、IR 审计、LLVM verifier、产物快照比对、conformance、
自举不动点(g2==g3)、examples 双后端、HIR、双轨对拍、REPL。

L2 的 `miropt` 步依赖 `wasmtime` 与 riscv clang 目标（实验性 M 轨），
不在 CI 跑；里程碑级验证请在本地执行 `node tools/gate.mjs L2`。

也可在 Actions 页面手动 `workflow_dispatch`，通过 `gate_level` 输入
临时跑 `L2`（需 runner 额外具备 wasmtime / riscv 工具链）。

## 每日全量（nightly.yml）

与合并门禁互补：合并门禁只在 push 到 main 时跑，捕获不到「不随合并发生的退化」
（工具链漂移、非确定行为、依赖老化）。nightly 每天把**全部测试与全部示例**跑一遍：

- **全部测试**：`conformance.mjs`（tests/conformance/\*\*，316 用例）、
  `hir_test.mjs`、`hir_eval_test.mjs`、`repl_test.mjs`。
- **全部示例**：`run_examples.mjs --all`，dbg 与 rls 各一轮。
  - 有 `.expected.txt` 的示例：双后端各自跑通 + 比对 golden + 双后端输出一致。
  - 无 `.expected.txt` 但有 `@main` 的示例：**smoke 模式** —— 双后端各自跑通且
    输出逐字节一致（没有 golden 文件，跨后端对拍就是判据）。
  - 无 `@main` 的是库模块（agentkit / physics / c_interop_lib 等），build/run
    无入口，编译期覆盖由 `ir_snapshot` 与导入它的示例间接保证。
- **被测编译器**是自举出的 `g1`（种子编 `src/tc.tc`），不是种子本身 ——
  否则测的是上一稳定版而非当前源码。

### `--all` 的排除名单（`tools/run_examples.mjs` 的 `SMOKE_SKIP`）

smoke 判据是「双后端跑通且输出一致」，故两类示例必须排除，且都要带原因登记：

1. **输出天然非确定**（时间戳 / 随机 / 地址）：两次运行必然不一致 → 假红。
2. **未实现的语言特性**：双后端都跑不通 → 天天红，掩盖真实回归。
   目前仅 `bitflags`（flag 位域的 runtime 符号 `t_flag_get` / `t_flag_set` 未实现，
   已登记 `tests/known-issues/KI-003_flag_bitfield_runtime.tc`）。

修好后从该表移除、恢复覆盖。

`run_examples.mjs` 对未知参数一律硬失败（`--mode --compiler --all --only --jobs` 之外的
任何参数都会 exit 2），避免笔误退回默认编译器/模式造成假绿。

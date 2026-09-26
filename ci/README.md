# ci/ — 合并门禁 CI 配套

本目录存放 GitHub Actions 合并门禁（`../.github/workflows/ci.yml`）所需的配套资源。

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

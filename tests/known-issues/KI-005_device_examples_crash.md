# KI-005 · device 示例运行期崩溃（cpu-emu 路径）

> 本目录不被 conformance/difftest 自动扫描，仅作为已知缺陷的复现/修复回归记录。
> 与其他 KI 不同，本条**不新增 .tc 复现文件**：现成的两个 `examples/` 就是稳定复现，
> 且 device 子系统的崩溃点取决于 `runtime/t_runtime_gpu.c` 的桩实现，
> 再造一份最小 .tc 只会多一个需要同步维护的副本。

实测环境：2026-09-28，`out/dbg/tc.exe` = g4（`d6291a3`），Windows，本机**无 CUDA / 无 GPU**
（device 子系统按设计走 `t_runtime_gpu.c` 的 cpu-emu 桩）。

## 现象

| 示例 | LLVM 后端 | C 后端 |
|---|---|---|
| `examples/_cpuemu_check.tc` | **segfault（exit 139 / 0xC0000005）** | **segfault（exit 139）** |
| `examples/vecadd_device_full.tc` | **segfault（exit 139 / 0xC0000005）** | exit 0，按设计优雅降级 |

`_cpuemu_check` 在崩溃前只来得及打印（C 后端可见，LLVM 后端连这行都没 flush）：

```
device: tll_gpu_launch("vec_add") cpu-emu OK (256 threads)
```

`vecadd_device_full` 的 C 后端能完整走到：

```
device: tll_gpu_launch("vec_add") cpu-emu OK (256 threads)
device.launch(vec_add) -> rc=0
```

## 判读

- **两个后端都崩**（`_cpuemu_check`）⇒ 不是单后端的代码生成问题，而是
  **device 运行时桩本身**在 cpu-emu 路径上不可靠（`vec_add` 之后还有
  `reduce_atomic`，用到 `shared_alloc` / `barrier`，共享内存与屏障的桩最可疑）。
- **只有 LLVM 崩**（`vecadd_device_full`）⇒ 该示例的 host 侧 device 调用序列
  在 LLVM 后端有独立的发射/ABI 问题（C 后端同源码能优雅降级）。

## 为什么此前没人发现

这两个示例都没有 `examples/<name>.expected.txt`，而 `tools/run_examples.mjs`
**历来只跑有 expected 文件的示例** —— 它们长期处于「能编译、从不运行」的状态，
只在产物快照（`ir_snapshot`，只看 .ll/.c/.h 字节）层面被覆盖。
新增的 `--all` smoke 模式把它们纳入运行验证后才立即暴露。

## 影响面与当前处置

两个示例已被 `tools/run_examples.mjs` 的 `SMOKE_SKIP` 表排除，
否则每日全量 CI（`.github/workflows/nightly.yml`）会天天红、掩盖真实回归。

## 修复验收

1. `_cpuemu_check` 与 `vecadd_device_full` 在**无 GPU 机器**上双后端均不再 segfault；
2. 二者输出在双后端之间逐字节一致；
3. 从 `SMOKE_SKIP` 删除对应条目后，`node tools/run_examples.mjs --all` 仍全绿。

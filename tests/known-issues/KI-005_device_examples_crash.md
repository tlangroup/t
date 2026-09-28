# KI-005 · device 示例端到端对拍失败（分阶段修复记录）

> 本目录不被 conformance/difftest 自动扫描，仅作为已知缺陷的复现/修复回归记录。
> 与其他 KI 不同，本条**不新增 .tc 复现文件**：现成的两个 `examples/` 就是稳定复现。

实测环境：2026-09-28，`out/dbg/tc.exe` = g4（`d6291a3`），Windows，本机**无 CUDA / 无 GPU**
（device 子系统按设计走 `t_runtime_gpu.c` 的 cpu-emu 桩）。

## 现象（修复前）

| 示例 | LLVM 后端 | C 后端 |
|---|---|---|
| `examples/_cpuemu_check.tc` | **segfault（exit 139）** | **segfault（exit 139）** |
| `examples/vecadd_device_full.tc` | **segfault（exit 139）** | exit 0，按设计优雅降级 |

## 根因与修复（已完成 · device 子系统本体）

原崩溃**不是单后端代码生成问题，而是 LLVM 后端根本没接 device 子系统 + cpu-emu 桩几处解析 bug**：

1. **LLVM 后端缺失 device 发射**（KI-005 真凶）：`device.launch/alloc_bytes/free/h2d/d2h`
   被错误编译成对伪全局 `@device` 的 TClosure 成员调用 → 加载野指针 → segfault；
   且 `__t_devmod_blob`（内核 Dialect 文本）完全没发射。已在 `src/tir.tc`
   `tir_emit_call` 加 `device.*` 分支（对齐 C 后端 `c_device_call`），并在
   `src/tir_to_ll.tc` `ll_emit_module` 注入 `@__t_devmod_blob` 全局常量
   （复用 `codegen_dev.emit_device_module()`）。
2. **cpu-emu 解释器 `find_kernel_body` 括号配对错误**：用 `strchr(ob,'}')` 命中函数体内
   `{dim = 0 : i32}` / `{elem = f32}` 的内嵌 `}`，把 kernel 体截断到首条指令之前 →
   内核等于空跑（结果垃圾）。改为括号配对找真正闭合 `}`。
3. **cpu-emu `parse_entry_args` 指针参数识别 off-by-one**：`strncmp(t,"!llvm.ptr",10)`
   字面量仅 9 字符，比第 10 个时与 `\0` 比较必不等 → 所有指针参数被当 i32，
   64 位指针高 32 位被截 → segfault / 垃圾。改为 `strncmp(t,"!llvm.ptr",9)`。
4. **cpu-emu `device.atomic_add` 值名解析**：`strchr(pa,'%')` 重新命中同一 `%`（指针名）
   而非值名 → 写回/读取错 SSA。改为 `strchr(pa+1,'%')`。
5. **KI-003 顺带修复**：`flag_set` 在 LLVM 后端缺写回（`tir_emit_call` 补 `tir_addr_of`+`tir_emit_store`）。

修复后：**两个示例内核都能执行、rc=0、不再 segfault**（双后端）。

## 剩余拦路（独立 KI · 非 device 子系统范围）

示例 host 侧用 `[256]f32` 定长数组初始化并 h2d 拷入。实测 LLVM 后端对**堆分配的定长
数组元素赋值 `ha[k] = x` 实际不落盘**——读回为 mimalloc 残留模式 `0x200`（≈float
`1.43e-42`），h2d 因此拷不进真数据，端到端输出对拍失败。纯 host 最小复现
（`var ha:[256]f32; while{ha[k]=(k as f32)}; print(ha[0])`）即触发，`const=1.5` 等
字面量打印正常 ⇒ 是 LLVM 后端**堆数组元素 store** 的通用 bug，与本 KI 的 device 代码生成
无关。该 bug 会同时影响常规程序，需单独立 KI 修复并过 gate 验证。

> 注：C 后端在 device 示例上另有独立编译错误（`t_slice_at` 相关），同样需另立 KI，
> 不在本 KI 范围。

## 当前处置

- device 代码生成 + 解释器已修（内核可跑、rc=0），作为 KI-005 的**子系统本体**完成。
- 两个示例因上述独立 LLVM 堆数组 store bug 仍无法端到端对拍，保留在
  `tools/run_examples.mjs` 的 `SMOKE_SKIP`，理由更新为「host 定长数组元素赋值不落盘」。
- `KI-003` 的 `bitflags` 已修，已从 `SMOKE_SKIP` 移除。

## 修复验收（分阶段）

**KI-005 子系统本体（已达成）：**
1. `_cpuemu_check` 与 `vecadd_device_full` 双后端均不再 segfault，内核执行 rc=0；
2. `out/dbg/<name>.ll` 含 `@__t_devmod_blob` 且 `device.launch` 发射为 `@tll_gpu_launch`
   而非对 `@device` 的野调用。

**端到端对拍（待独立 KI：LLVM 堆数组 store bug 修复后）：**
1. 二者输出在双后端之间逐字节一致；
2. 从 `SMOKE_SKIP` 删除对应条目后，`node tools/run_examples.mjs --all` 仍全绿。

# T 语言 Device 子系统设计（v1：NVIDIA PTX / NVPTX）

> 底层设计文档。范围：Host(CPU) 已成熟（自托管编译器 + C/LLVM 双后端 + gate L2 不动点）；
> Device 目标：GPU / TPU / NPU，**v1 仅 NVIDIA PTX（经 NVPTX）**。
> 本文档待确认后进入实现。

---

## 0. 工具链现状与约束（实测，2026-09-02）

| 组件 | 本机状态 | 说明 |
|------|----------|------|
| `clang` / `llvm` | ✅ 已装 | `C:\Program Files\LLVM` |
| `nvptx64` LLVM 后端 | ✅ 已装 | `clang --print-targets` 含 `nvptx64 - NVIDIA PTX 64-bit` → `emit LLVM IR → clang -target nvptx64-nvidia-cuda -S → PTX` 本机可验证（⚠ bundle `llc` **无** nvptx64 后端，须用系统 `clang`）|
| **MLIR** | ✅ 已装 | `C:/tools/mlir`（portable-mlir-toolchain 22.1.8）：含 `mlir-opt`/`mlir-translate`/`mlir-cpu-runner` + 开发库（`LLVM_DIR`/`MLIR_DIR`）|
| **CUDA toolkit** | ❌ 未装 | 无 `NVIDIA GPU Computing Toolkit`、无 `nvcc`/`ptxas` |
| **CUDA 驱动 / GPU** | ❌ 无 | `System32/SysWOW64` 均无 `nvcuda.dll` |

**结论**：自定义 Device Dialect + bytecode 序列化 + MLIR-JIT 引擎**本机无法编译/运行**；
`cuLaunchKernel` 执行必须在装有 MLIR + CUDA 的机器上完成。本机仅能验证：
(1) M1 的 host 类型路径（gate）；(2) `LLVM IR → PTX` 的 lowering 窄段（`llc -march=nvptx64`）。

---

## 1. 已确认决策（设计分叉锁定）

| # | 分叉 | 决策 |
|---|------|------|
| 1 | PTX 代码生成路线 | 复用 LLVM IR→NVPTX（在运行时 MLIR-JIT 引擎内，而非编译期 `codegen_ll`） |
| 2 | 设备指针语法 | 具名类型 `dev_ptr[T]`(global/as1) / `shared[T]`(as3) / `local[T]`(as5) |
| 3 | 显存模型 | 显式传输（`device.alloc` / `h2d` / `d2h`） |
| 4 | v1 内核能力 | 受限安全子集（禁闭包/递归/动态分配/字符串格式化） |
| 5 | 设备代码落点 | 双模式：**JIT（默认）**内嵌序列化 Device MLIR bytecode；**AOT（`--aot-gpu`，未来）**落 `.tpu`（NVIDIA 实为 ptx/cubin） |
| 6 | host 启动绑定 | 内核句柄直传 `device.launch(kernel, grid, block, args)` |
| 7 | 默认计算能力 | JIT 运行时定（默认 sm_70）；AOT 编译期必须指定 arch |
| 8 | MLIR 形态 | **bytecode (.mlirb)**（编译期 T 出 Dialect 文本，C 侧序列化） |
| 9 | Dialect | **自定义 target-independent Device Dialect** |
| 10 | MLIR-JIT 引擎 | 对标 Mojo **KGEN** + **SYCL**(open-sycl/hipSYCL) + **XLA**(TensorFlow) |
| 11 | 实现起点 | **垂直切片优先**（M0 spike + M1+M2+M3 `vec_add` 端到端） |

---

## 2. 分层架构（L0–L6）

- **L0 Device/Target 抽象**：Device MLIR Dialect 是 target-independent 设备 IR；`nvptx` 是第一个 lowering 后端；未来 `tpu`/`npu` 加 `Device→X` lowering，上层（L1–L3）不动。
- **L1 类型系统**：`pointer.as` 字段（默认 0=host）；`dev_ptr[T]/shared[T]/local[T]` ↔ `pointer(as=1/3/5)`。MLIR 侧对应 `llvm.ptr` 带 `memory_space` attr。
- **L2 内核模型**：`kernel fn` 限定符；device-only 内建映射到 **Device Dialect ops**（非直连 `llvm.nvvm.*`）。
- **L3 启动 API**：`device.launch(kernel, grid, block, args)` 句柄直传；底层传 kernel 名 + 序列化 Device MLIR 模块。
- **L4 Device MLIR 发射层（`codegen_dev`）**：device 函数图 emit Device Dialect 文本 → C 侧序列化 bytecode → 内嵌（JIT）或落 `.tpu`（AOT）。
- **L5 运行时 MLIR-JIT 引擎（C/C++ 侧，`t_runtime_gpu`）**：加载 bytecode → lowering（Device→NVVM→LLVM-NVVM IR→PTX）→ CUDA 驱动 JIT（PTX→cubin）→ `cuModuleLoadData`/`cuLaunchKernel`。
- **L6 构建/门禁**：`tc` 检测 kernel → `codegen_dev`；JIT 默认内嵌、arch 运行时定；gate 增 device 示例（无 GPU 跳过 run，仍 snapshot/compile）；devmlir 文本 md5 进 IR 快照。

---

## 3. Device MLIR Dialect 规格（自定义，target-independent）

### 3.1 Types
- `!device.ptr<memspace, T>`，`memspace ∈ {global=1, shared=3, local=5, constant=4}` ↔ T `dev_ptr[T]/shared[T]/local[T]`。
- 设备标量/向量复用 `arith`/`math`；控制流复用 `scf`/`cf`。**Dialect 刻意做小**。

### 3.2 Ops
- `device.func @f(...)`：设备可调用函数。
- `device.kernel_func @f(...)`：grid 入口（launch 时给定 grid/block，非函数属性）。
- `device.thread_id<x|y|z>` / `device.block_id<x|y|z>` → `nvvm sreg.tid/ctaid` 系列。
- `device.block_dim<x|y|z>` / `device.grid_dim<x|y|z>` → `nvvm sreg.ntid/nctaid`。
- `device.barrier` → `nvvm.barrier0`。
- `device.shared_alloc<T, [N]>` 或 `!device.ptr<shared>` backing `__shared__`。
- `device.atomic_add / atomic_exch / atomic_cas`（作用于 `!device.ptr<global>`）→ `atomicrmw` / nvvm atomic。
- `device.addrspace_cast`：设备地址空间间转换（host↔device 严禁）。
- `device.load` / `device.store`：带 memspace 的访存（lowering 到 `llvm.load/store` 带 `addrspace`）。

### 3.3 示例（vec_add kernel 的 Device Dialect 草稿）
```mlir
device.kernel_func @vec_add(%a: !device.ptr<global, f32>,
                            %b: !device.ptr<global, f32>,
                            %c: !device.ptr<global, f32>,
                            %n: i32) {
  %tid = device.thread_id x : i32
  %i   = arith.extsi %tid : i32 to i64
  %n64 = arith.extsi %n   : i32 to i64
  %ok  = arith.cmpi ult, %i, %n64 : i64
  scf.if %ok {
    %la = device.load %a[%i] : f32
    %lb = device.load %b[%i] : f32
    %s  = arith.addf %la, %lb : f32
    device.store %s, %c[%i]
  }
  device.barrier
  return
}
```

---

## 4. 编译期流水线（`codegen_dev`）

- T 侧 `codegen_dev` 把 **从 kernel 出发可达的所有 `fn`（传递闭包、排除纯 host）** emit 成 Device Dialect **文本**（T 不碰 MLIR C++，保自托管干净）。
- C 侧序列化器（链接 MLIR）文本 → **bytecode (.mlirb)**，作为字符串常量内嵌 host 二进制（JIT 模式）。
- AOT 模式（`--aot-gpu`，未来）：bytecode → PTX/cubin，落 `.tpu`（必须指定 arch）。

---

## 5. 运行时 MLIR-JIT 引擎（KGEN / SYCL / XLA 映射）

组件：`t_runtime_gpu`（C/C++），随 host 二进制链接/动态加载。

- **KGEN 式运行时编译器**：`MLIRContext` 注册 device/nvvm/llvm/arith/math/scf 等 dialect；
  加载 bytecode → 反序列化为 `ModuleOp`。
- **Pass 流水线**：`device-to-nvvm`（自定义 pass：device.*→nvvm.*/llvm.*）
  → `nvvm-lower-to-llvm`（MLIR 内置）→ `mlir-to-llvmir`
  → **LLVM NVPTX 后端**（`nvptx64`, `mcpu=` 运行时 arch，默认 sm_70）→ PTX 汇编。
- **JIT（XLA 式 executable cache）**：`cuModuleLoadData(ptx)` → `cuModuleGetFunction`，
  按 `(kernel 名, arch, module_hash)` 缓存 `CUfunction`，避免重复编译。
- **设备内存（SYCL 式）**：`cuMemAlloc`/`cuMemcpyHtoD`/`cuMemcpyDtoH` 包成 `device.alloc/h2d/d2h/free`。
- **Launch**：`cuLaunchKernel` 带 grid/block + 打包 `void*` 参数（v1 同步）。
- **依赖**：运行时链接 **MLIR + CUDA driver (libcuda)**。

---

## 6. Host 启动 API 与 trampoline

- `device.launch(kernel, grid, block, args...)`：T 为每个 kernel 生成 host trampoline
  → `tll_gpu_launch(__t_devmod_blob, "<kernel>", grid, block, argv)`；
  `argv` 由 `dev_ptr` 值（CUdeviceptr）+ 标量打包。
- 模块装载：`__t_ginit` 时 `tll_gpu_module_load(__t_devmod_blob)` 一次（或首次 launch lazy）。
- `device` 模块（内建或 `lib/device.tc`）：`alloc[T](n)->dev_ptr[T]`、`h2d`、`d2h`、`free`、`launch`。

---

## 7. 类型系统改动（M1）

- `pointer` 节点（AST）加 `as: i64` 字段（默认 0=host）。`base.mk_pointer(na, ti)` → `mk_pointer(na, ti, as)`。
- `TD`（sema 侧）指针类别带 addrspace；`resolve_type_desc` 识别 `dev_ptr[T]/shared[T]/local[T]`
  → `td_elem_mk("pointer", ..., as=1/3/5)`。
- `codegen_ll.ll_td()`：`t.cat=="pointer"` 按 `t.as` 输出 `ptr addrspace(1)/(3)/(5)`，host(0) 仍 `ptr`。
- **AS 校验（sema）**：kernel 形参必须是 device 指针；host `&T` 不能传进设备。
- host 路径零语义变化 → gate L2 不动点仍成立（IR 漂移归零规则不变）。

---

## 8. 设备安全子集（M4，sema 校验）

`kernel fn` 体禁止：
- 闭包（`closure_make`/`closure_capture`）、递归（device 模块内调用图成环）；
- 动态分配 / 动态 slice 增长（append）；
- 字符串格式化 / host runtime 调用（printf 走 nvvm 特殊通道，单独处理）；
- 调用纯 host 函数（仅 device 模块内函数可达）。
device-only 内建仅允许出现在 device 上下文。

---

## 9. 构建 / 门禁 / 自举影响

- `tc` driver：模块含 `kernel` → `codegen_dev` → 序列化内嵌；host 仍 `codegen_ll/.c → clang`。
- gate：增 device 示例集；**无 GPU 的 CI 跳过 run、仅 snapshot/compile**；devmlir 文本 md5 进 IR 快照。
- **自举不动点不受影响**：`tc.tc` 本身不含 kernel → device 路径不触发 → bootstrap/gate L2 零改动。
- ⚠ 工具链新增依赖：device 路径编译期需 MLIR（序列化），运行时需 MLIR + CUDA driver；host 普通编译不受影响。

---

## 10. 实现计划（三档）

### 10.1 马上就要实现（immediate / 垂直切片）
- **M0 运行时栈 spike**：手写 Device/NVVM MLIR，验证 `MLIR → PTX → cuLaunchKernel` 全栈（C 侧）。
  ⚠ 本机无 MLIR/CUDA，仅产出代码、在他机编译运行验证。
- **M1 T 类型系统**：`pointer.as` + `dev_ptr[T]/shared[T]/local[T]` 解析 + `ll_td` addrspace（host 路径 gate 可验证）。
- **M2 `codegen_dev`**：单 kernel `vec_add` emit Device Dialect 文本 + C 侧序列化 bytecode。
- **M3 `device` 模块 + trampoline + `t_runtime_gpu` launch**：`vec_add` 真在 GPU 跑通（垂直切片闭环）。

### 10.2 准备实现（planned）
- **M4** device-only 内建（atomic/barrier/math 映射）+ 安全子集 sema 校验（§8）。
- **M5** gate 接入 device 示例集；devmlir 文本 md5 进 IR 快照；无 GPU CI 跳过 run。
- **AOT 模式 `--aot-gpu`**：编译期 Device MLIR → PTX/cubin 落 `.tpu`（必须指定 arch）。

### 10.3 规划内容（roadmap / future）
- **TPU/NPU 后端**：`Device→TPU/Triton/...` lowering（复用 Device Dialect，上层不变）。
- **SYCL 式 async streams / queues / events**：多流并发、异步拷贝。
- **Tensor Core / WMMA 内建**（sm_70+）。
- **统一内存（managed）**作为可选模式（v1 仅显式传输）。
- **执行缓存细化**（XLA 式签名+arch 缓存、AOT 预载）。
- **多设备 / 多 GPU 拓扑、peer-to-peer**。
- **comptime 受限常量折叠进设备**（中间档范围）。
- **profiler / occupancy 工具**。

---

## 11. 里程碑与验收

| 里程碑 | 验收标准 | 本机可验证 |
|--------|----------|------------|
| M0 | MLIR→PTX→launch 全栈跑通（他机） | ❌ 需 MLIR+CUDA |
| M1 | `dev_ptr[T]` 解析 + `ll_td` addrspace + host gate 全绿 | ✅ |
| M2 | `vec_add` emit Device Dialect 文本 + 序列化 bytecode | △ 文本可查；bytecode 需 MLIR |
| M3 | `vec_add` 真在 GPU 算出正确结果 | ❌ 需 GPU |
| M4 | atomic/barrier/math + 安全子集拦截 | △ 拦截本机可验；运行需 GPU |
| M5 | gate device 示例 + IR 快照 | △ snapshot 本机可验 |

## 12. 本地验证工具链（2026-09-02 增补）

### 12.1 推荐工具
- **主工具：`setup-mlir`（portable-mlir-toolchain，预编译 MLIR for Windows）** — 原生 Windows 一行 PowerShell 装好 `mlir-opt` / `mlir-translate` / `mlir-cpu-runner` + 完整 MLIR 开发库（`LLVM_DIR` / `MLIR_DIR`）。无需 Docker、无需源码编译 LLVM。支持**自定义 dialect 的 out-of-tree 注册**，正好满足本设计（Godbolt 等在线工具加载不了 `device.*`）。
- **版本选择（2026-09-02 实测 GitHub API 核实）**：本机 host LLVM 为 **22.1.8**（`clang`/`llc`），而 portable-mlir-toolchain 恰好提供 `llvmorg-22.1.8`（release tag `2026.08.11`）→ **选 22.1.8，与 host 零版本漂移**（`mlir-translate` 出的 LLVM IR 与 host `llc` 完全同版本，避免 IR 文本/属性不兼容）。仓库另有 `23.1.0`（tag `2026.08.31`）但会与 host llc 跨大版本，不推荐。
- **辅工具：Godbolt Compiler Explorer** — 浏览器零安装，直接写 `arith/math/scf/gpu/nvvm` MLIR 看 lowering→PTX 中间产物（含 MLIR Opt Pipeline 可视化）。**不支持自定义 dialect**，仅陪练快速验证标准 dialect 片段。

### 12.2 安装（在装有网络的本机 Windows 执行）

**方式 A — 手动下载单个包（推荐，实测最省事）**

只需下载 **一个** 文件（Windows 自带 `tar` 已内建 libzstd，无需额外装 zstd）：

| 项 | 值（2026-09-02 HEAD 实测） |
|---|---|
| 直链 | `https://github.com/munich-quantum-software/portable-mlir-toolchain/releases/download/2026.08.11/llvm-mlir_llvmorg-22.1.8_x86_64-pc-windows-msvc.tar.zst` |
| 大小 | `398,146,906` 字节（379.7 MB） |
| 断点续传 | ✅ `Accept-Ranges: bytes`（`curl -C -` / IDM / 迅雷均可续） |
| Release 页 | `https://github.com/munich-quantum-software/portable-mlir-toolchain/releases/tag/2026.08.11` |

解压（**用 Windows 自带 bsdtar**，实测 `C:\Windows\System32\tar.exe` = bsdtar 3.8.8，含 `libzstd/1.5.7`，可直接解 `.tar.zst`）：
```powershell
mkdir C:\tools\mlir
tar -xf <下载路径>\llvm-mlir_llvmorg-22.1.8_x86_64-pc-windows-msvc.tar.zst -C C:\tools\mlir
```
> ⚠ Git Bash 下 `tar -f C:/...` 会把 `C:` 当远程 host 报 "Cannot connect to C:"，须用 `/c/...` 路径；PowerShell / cmd 用 `C:\...` 正常。
> ⚠ 若包内含顶层目录（如 `llvm-mlir_.../`），解压后把该层内容上提到 `C:\tools\mlir\`，保证最终为 `C:\tools\mlir\bin\mlir-opt.exe`。

**方式 B — 一键脚本**（需能访问 `raw.githubusercontent.com`，沙箱不可达）
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://github.com/munich-quantum-software/setup-mlir/releases/latest/download/setup-mlir.ps1 | iex; setup-mlir.ps1 -llvm_version 22.1.8 -install_prefix C:/tools/mlir"
```

装完验证：
```powershell
C:/tools/mlir/bin/mlir-opt --version        # 应显示 22.1.8
C:/tools/mlir/bin/mlir-translate --version
ls C:/tools/mlir/lib/cmake/mlir             # out-of-tree 构建必需（MLIR_DIR）
```
脚本方式通常会把 `C:/tools/mlir/bin` 加入 PATH；手动方式需自行加。

### 12.3 `t-device` 自定义 dialect（out-of-tree 项目骨架）
为把 `codegen_dev` 出的 Device Dialect 文本在本地验 lowering，建最小 out-of-tree MLIR 项目，注册 `device` dialect + `device-to-nvvm` pass。目录 `tools/mlir-t-device/`（脚手架已落地：含 `device` dialect ODS、`device-to-nvvm` pass、`t-device-opt` 驱动与 `test/vec_add.mlir` 示例，构建/运行见其 README.md；尚未在本机编译，需先装 MLIR）：
- `CMakeLists.txt`：`find_package(LLVM REQUIRED CONFIG)` + `find_package(MLIR REQUIRED CONFIG)`，构建 `t-device-opt` 可执行，链接 `MLIRIR` / `MLIRNVVMIR` / `MLIRGPUIR` / `MLIRTransforms` 等。
- `include/t-device/Dialect.h` + `lib/Dialect.cpp`：定义 `device` dialect 与 §3 的 ops（`device.func` / `device.kernel_func` / `device.thread_id` / `device.barrier` / `device.atomic_add` / `!device.ptr<memspace,T>`）。
- `lib/DeviceToNVVM.cpp`：自定义 pass，把 `device.*` 降到 `nvvm.*` / `llvm.*`（逻辑与 §5 运行时引擎的 lowering 段 1:1 一致，先在此预演）。
- 已验证用法：见 §12.7 的 5 段 pipeline（或 `tools/mlir-t-device/run_vecadd.sh`）。⚠ bundle 内 `llc` **无 nvptx64 后端**（报 `invalid target 'nvptx64'`），末段须用系统 `clang -target nvptx64-nvidia-cuda`。

### 12.4 本地可验证边界（重申）
- ✅ Device Dialect 文本 → `device-to-nvvm` → NVVM → LLVM IR → `clang -target nvptx64-nvidia-cuda -S` → PTX（纯软件，无 GPU）。⚠ bundle 内 `llc` 缺 nvptx64 后端，须用系统 clang（见 §12.7）。
- ❌ `cuLaunchKernel` 真执行、SASS 反汇编 —— 无 GPU / 无 CUDA 驱动，只能在有 MLIR+CUDA 的机器验。

### 12.5 对接垂直切片
该 out-of-tree 项目即 §5 `t_runtime_gpu` 引擎里 lowering 段的 1:1 预演；先在本地验绿，再回填到 C 侧 JIT 引擎，风险最低。

### 12.6 受限网络 / 代理下的安装注意（2026-09-02 实测）
本沙箱 Bash 走本地代理，实测放行规律：
- ✅ `github.com`（含 releases 302 跳转）、`api.github.com`（可读 release 资产清单/大小）。
- ✅ `release-assets.githubusercontent.com` 的 **HEAD** 与**小文件 GET**（如 300 KB 的 zstd 包）。
- ❌ 同 CDN 的**大文件 GET**：`curl (7) CONNECT tunnel failed, response 502`；`-r` Range 分块同样失败。
- ❌ `raw.githubusercontent.com`：TLS 直接中断（`exit 56`）→ `setup-mlir` 一键脚本的 `version-manifest.json` 不可达（可改走 `api.github.com/repos/.../contents/version-manifest.json` 读 base64 绕过）。

**结论：几百 MB 的 MLIR 包须在直连网络的真机下载**（沙箱只能核实直链与体积）。本机与沙箱共享 `C:/`，装到 `C:/tools/mlir` 后沙箱立即可用。

**持久性更正（2026-09-02 复测）**：早前"`/c/tools` 在沙箱 overlay 不跨命令持久"的判断**有误**——沙箱先前解出的 `C:\tools\_mlir_tmp\zstd.exe`（745,984 字节）在后续会话仍在，`C:/tools` 实际是持久的真实盘路径。此前失败的真实原因只有一个：**大文件 GET 被代理 502**。

**解压手段更正**：无需 `zstd.exe`——Windows 自带 `C:\Windows\System32\tar.exe` 为 **bsdtar 3.8.8，内建 `libzstd/1.5.7`**，`tar -xf xxx.tar.zst` 直接可解。故手动安装只需下载 llvm 包这一个文件（见 §12.2 方式 A），zstd 包可忽略。

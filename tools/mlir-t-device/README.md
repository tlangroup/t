# tools/mlir-t-device — T `device` dialect + `device-to-nvvm` pass

Out-of-tree MLIR project that implements the **target-independent Device Dialect**
and its lowering to NVVM / LLVM, exactly as specified in `docs/compiler/device-design.md §3`
and §12.3. This is the 1:1 pre-play of the lowering stage that will later live
inside the `t_runtime_gpu` JIT engine (§5).

> **Scaffold status.** Written before `setup-mlir` was installed on this machine,
> so it has **not been compiled here**. It follows the MLIR `standalone` example
> conventions and should build once MLIR 22.x is present. Fix any small API drift
> against your installed MLIR headers, then run the verification below.

## Prerequisites

Install the prebuilt MLIR for Windows (see `docs/compiler/device-design.md §12.2 / §12.6`):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://github.com/munich-quantum-software/setup-mlir/releases/latest/download/setup-mlir.ps1 | iex; setup-mlir.ps1 -llvm_version 22.1.1 -install_prefix C:/tools/mlir"
```

You also need `cmake` and a C++17 compiler (the host LLVM 22 clang works). The
LLVM NVPTX backend (`llc -march=nvptx64`) comes from the host LLVM install
(`C:/Program Files/LLVM/bin/llc.exe`), not from this project.

## Build

```bash
cmake -B build -S . \
  -DMLIR_DIR=C:/tools/mlir/lib/cmake/mlir \
  -DLLVM_DIR=C:/tools/mlir/lib/cmake/llvm \
  -DCMAKE_C_COMPILER="C:/Program Files/LLVM/bin/clang.exe" \
  -DCMAKE_CXX_COMPILER="C:/Program Files/LLVM/bin/clang++.exe"
cmake --build build --target t-device-opt -j
```

This produces `build/bin/t-device-opt`.

## Verify the lowering → PTX

```bash
# 1) device.* -> func.func + llvm.inline_asm
build/bin/t-device-opt test/vec_add.mlir --device-to-nvvm

# 2) MLIR -> LLVM IR
build/bin/t-device-opt test/vec_add.mlir --device-to-nvvm \
  | mlir-translate --mlir-to-llvmir -o vec_add.ll

# 3) LLVM IR -> PTX (host NVPTX backend)
"C:/Program Files/LLVM/bin/llc.exe" -march=nvptx64 -mcpu=sm_70 \
  -o vec_add.ptx vec_add.ll

# 4) inspect
cat vec_add.ptx
```

You should see PTX with `mov.u32` from `%tid.x`/`%ntid.x`/`%ctaid.x`, a
`bar.sync 0;`, and the `add.f32` reduction. The `nvvm.kernel` attribute marks
`@vec_add` as a kernel entry.

## Files

| File | Purpose |
|------|---------|
| `include/t-device/Dialect.td` | device dialect + ops + `!device.ptr` type (ODS) |
| `include/t-device/Passes.td`  | `device-to-nvvm` pass registration (ODS) |
| `lib/Dialect.cpp`             | dialect/op/type registration |
| `lib/DeviceToNVVM.cpp`        | the lowering patterns (func/return/index/barrier/atomic) |
| `tools/t-device-opt.cpp`      | `mlir-opt`-compatible driver |
| `test/vec_add.mlir`           | sample `vec_add` kernel in Device Dialect |

## Mapping to the design

- `device.thread_id/block_id/block_dim/grid_dim` → `nvvm.read.ptx.sreg.*`
  (emitted here as `llvm.inline_asm` `mov.u32 $0, %tid.x;` etc. — equivalent,
  and avoids depending on exact NVVM op class names).
- `device.barrier` → `llvm.inline_asm "bar.sync 0;"`.
- `device.atomic_add` → `llvm.atomic_rmw add`.
- `device.kernel_func` → `func.func` with the `nvvm.kernel` attribute.
- `!device.ptr<memspace, T>` → `!llvm.ptr<memspace>` is a **TODO** (wired via a
  full dialect conversion); the scaffold keeps kernel params as `!llvm.ptr<as>`
  so the PTX smoke test runs without a TypeConverter.

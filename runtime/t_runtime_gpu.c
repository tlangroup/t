// ═══════════════════════════════════════════════════════════════════════════
// runtime/t_runtime_gpu.c — Device 子系统 host 运行时（docs/device-design.md §5/§6 M3）
//
// JIT 引擎（MLIR → NVVM → LLVM-NVVM IR → PTX → cuLaunchKernel）在装有
// MLIR + CUDA driver 的机器上实现（HAVE_CUDA 编译分支，留作在他机填充）。
//
// 本机（无 CUDA toolkit / 无 GPU）编译为「桩」：所有符号均可链接，程序可正常
// 构建与运行；launch 返回 -1 错误码并打一行说明，由宿主程序决定降级行为。
// 这样 M3 垂直切片在缺 GPU 的机器上也能端到端验证「host 发射 → 链接 → 运行」。
// ═══════════════════════════════════════════════════════════════════════════

#include <stdint.h>
#include <stdio.h>
#include "t_runtime_gpu.h"   // 单一真相源：tll_gpu_* FFI 声明（与编译器发射对齐）

#ifndef HAVE_CUDA

int64_t tll_gpu_alloc(int64_t bytes) {
    (void)bytes;
    fprintf(stderr, "device: tll_gpu_alloc(%lld) stub — no CUDA runtime linked\n", (long long)bytes);
    return 0;  // NULL 设备句柄（桩：不真正分配显存）
}

void tll_gpu_free(int64_t p) {
    (void)p;
}

void tll_gpu_h2d(int64_t dst, int64_t src, int64_t bytes) {
    (void)dst; (void)src; (void)bytes;
    fprintf(stderr, "device: tll_gpu_h2d stub — no CUDA\n");
}

void tll_gpu_d2h(int64_t dst, int64_t src, int64_t bytes) {
    (void)dst; (void)src; (void)bytes;
    fprintf(stderr, "device: tll_gpu_d2h stub — no CUDA\n");
}

int32_t tll_gpu_launch(const char* blob, const char* name,
                       int32_t grid, int32_t block, int32_t nargs, int64_t* argv) {
    (void)blob; (void)grid; (void)block; (void)nargs; (void)argv;
    fprintf(stderr,
        "device: tll_gpu_launch(\"%s\") stub — no CUDA runtime available on this machine\n",
        name ? name : "");
    return -1;  // 错误码：宿主程序据此降级（如跳过 GPU 计算、报「需要 GPU」）
}

#else /* HAVE_CUDA —— 真实 MLIR-JIT 引擎（在 MLIR+CUDA 机器上编译填充） */

// 真实实现依赖 MLIR（序列化 bytecode 反序列化 → device-to-nvvm pass →
// NVVM→LLVM-NVVM IR → LLVM NVPTX 后端 → PTX → cuModuleLoadData/cuLaunchKernel）。
// 本机无 CUDA，留作在他机（docs/device-design.md §5）落地；此处给出符号占位，
// 保证 HAVE_CUDA 分支也能通过编译。
#error "HAVE_CUDA path not yet implemented on this machine (see docs/device-design.md §5)"

#endif

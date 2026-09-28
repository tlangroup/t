// ═══════════════════════════════════════════════════════════════════════════
// runtime/t_runtime_gpu.h — Device 子系统 host 运行时 FFI 声明（docs/compiler/device-design.md §6 M3）
//
// 单一真相源：所有 t 编译器发射的 `device.*` host 调用（alloc / free / h2d /
// d2h / launch）都通过这里声明的符号链接到 runtime/t_runtime_gpu.c。
//
// 注意：无 CUDA 的机器上这些是「桩」实现（见 t_runtime_gpu.c 的 #ifndef
// HAVE_CUDA 分支），可正常链接、运行，launch 返回 -1 由宿主决定降级行为。
// ═══════════════════════════════════════════════════════════════════════════

#ifndef T_RUNTIME_GPU_H
#define T_RUNTIME_GPU_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// 设备显存分配 / 释放：返回设备指针句柄（i64，= CUdeviceptr），桩返回 0。
int64_t tll_gpu_alloc(int64_t bytes);
void    tll_gpu_free(int64_t p);

// 主机 ↔ 设备 数据传输：dst/src 为设备指针句柄（i64），bytes 为字节数。
void tll_gpu_h2d(int64_t dst, int64_t src, int64_t bytes);
void tll_gpu_d2h(int64_t dst, int64_t src, int64_t bytes);

// 发射内核：blob 由编译器内嵌为模块级全局 @__t_devmod_blob（本函数经 extern 引用，
// 避免 host 双后端各自传 blob 指针），name = 内核名（char*，运行时取 TStr 的 data 字段），
// grid/block = 1D 配置，nargs = 变长实参数目，argv = i64[] 句柄数组。
// 返回 0 成功，-1 失败（桩）。grid/block/nargs 用 int64 与 host 双后端（TIR 整型一律 i64）逐字对齐。
int64_t tll_gpu_launch(const char* name, int64_t grid, int64_t block, int64_t nargs, int64_t* argv);

#ifdef __cplusplus
}
#endif

#endif /* T_RUNTIME_GPU_H */

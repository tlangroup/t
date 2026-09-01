# fdlibm 回落库（drop-in 目录）

本目录用于放置 **fdlibm**（Free/NetBSD 双精度/单精度数学库，netlib 经典实现）
的 C 源码，作为 **无系统 libm 目标（如 WASM、bare-metal）** 的编译期数学回落。

## 为什么需要它

`t` 的数学内建（`@sin` / `sin` / `sinf` …）在代码生成时：

- **LLVM 后端、目标支持硬件 FPU intrinsic**（`g_fp_hw == true`，如 x86-64 / ARM）：
  `sin/cos/exp/exp2/log/log2/log10/pow/sqrt/fabs/floor/ceil/trunc/round`
  直接映射 `@llvm.<op>.<ty>` 硬件指令；其余（tan/atan/asin/acos/atan2/sinh/cosh/tanh/
  log1p/expm1/hypot/cbrt/fmod）回落到 `t_runtime` 中的 `t_math_*` 包装函数。
- **回落路径**：`runtime/t_runtime.c` 里的 `t_math_*(...)` 包装直接调用平台 libm
  （`#include <math.h>` 的 `sin` / `sinf` / `hypot` / `atan2` …）。

在 **WASM 等没有系统 libm** 的目标上，`g_fp_hw` 被置为 `false`，**全部**数学函数
都走 `t_math_*` 回落。此时只要把 fdlibm 源码编进 `t_runtime.lib`，
`t_math_*` 就会链接到 fdlibm 提供的同名符号，无需改任何包装代码。

## 如何放入 fdlibm

1. 从 netlib 获取 fdlibm 源码：
   `https://netlib.org/fdlibm/`（或发行版 `musl`/`newlib` 的 `math/` 子集）。
2. 把下列 **`.c` 文件**复制进本目录 `runtime/fdlibm/`：

   | 符号（double） | fdlibm 源文件（参考） |
   |---|---|
   | sin / cos / tan | `s_sin.c` `s_cos.c` `s_tan.c` `k_sin.c` `k_cos.c` `k_tan.c` `k_rem_pio2.c` `e_rem_pio2.c` |
   | atan / asin / acos | `s_atan.c` `e_asin.c` `e_acos.c` |
   | atan2 | `e_atan2.c` |
   | exp / exp2 / log / log2 / log10 | `e_exp.c` `e_exp2.c` `e_log.c` `e_log2.c` `e_log10.c` |
   | pow | `e_pow.c` `e_powf.c` |
   | sinh / cosh / tanh | `e_sinh.c` `e_cosh.c` `e_tanh.c` |
   | sqrt | 平台通常内联；无则加 `e_sqrt.c` |
   | fmod / fabs / floor / ceil / trunc / round | `e_fmod.c` `s_fabs.c` `s_floor.c` `s_ceil.c` `s_trunc.c` `s_round.c` |
   | log1p / expm1 | `s_log1p.c` `s_expm1.c` |
   | hypot | `e_hypot.c` |
   | cbrt | `s_cbrt.c` `e_cbrt.c` |

   单精度变体（`sinf`/`cosf`/`tanf`/`atan2f`/`powf`/`hypotf`/`cbrtf` …）由 fdlibm 的
   浮点宏文件提供（`s_sinf.c` 等，内部 `#include "s_sin.c"` 并 `#define float`），
   一并放入本目录即可。

3. 编译 fdlibm 通常需要的宏（加在 `tools/build_runtime.mjs` 的 `fdlibm` 编译参数里，
   或直接在源码顶部）：`-D_IEEE_LIBM -D__STDC__ -D_POSIX_SOURCE`。
   具体以所取 fdlibm 版本的 `Makefile` / `README` 为准。

## 构建接线

`tools/build_runtime.mjs` 在编 `t_runtime.lib` 时，会 **自动 glob 本目录下的 `*.c`**
（`runtime/fdlibm/*.c`），与 `t_runtime.c` / `t_shim_ll.c` 一起编进归档。

- 目录为空（默认）：回落到系统 libm（宿主 clang 自带 compiler-rt / MSVC CRT 的 libm）。
- 目录有 fdlibm 源码：回落到 fdlibm 提供的同名符号。

无需修改任何 `t_math_*` 包装代码——链接器按符号名解析。

## 验证

```bash
# 1) 放入 fdlibm 源码后重建运行时库
node tools/build_runtime.mjs

# 2) 跑双后端示例 + 自举门禁（WASM 目标需另设 g_fp_hw=false 并切到 WASM 工具链）
node tools/gate.mjs L2
```

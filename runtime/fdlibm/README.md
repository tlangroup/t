# fdlibm —— t 运行时的浮点数学实现（已启用，替代系统 libm）

本目录是 **fdlibm**（Sun 1993/2004 版，netlib 自由分发实现）的 C 源码，
自 2026-09-26 起作为 **t 运行时唯一的浮点数学来源**：`runtime/t_runtime.c` 已
**移除 `#include <math.h>`**，全部 `t_math_*` 包装改为调用本目录提供的实现。

> ⚠ 本文件曾描述过一套「`g_fp_hw` 双分派 + LLVM `@llvm.sin.*` intrinsic 直映射 +
>   drop-in 免改名回落」的方案。该方案**从未真正存在**：`src/` 里没有 `g_fp_hw`
>   这个符号，也没有任何 `@llvm.sin.*` 发射。旧文档是设想稿，已按现状重写。

## 为什么用它

- 系统 libm 是实现-defined 的：同一份 `t` 源码在 glibc / MSVC CRT / musl 上可能得到
  末位不同的结果，破坏「双后端 + 跨平台逐字节可比」的不变式。
- fdlibm 是 IEEE-754 的参考级实现，自带全部内核（`__ieee754_*` / `__kernel_*`），
  不依赖宿主 libm，结果可复现。

## 符号重命名（关键机制）

fdlibm 的公开符号（`sin` / `pow` / `sqrt` …）与系统 libm **同名**。若不处理：
宿主 `<math.h>` 常把这些名字声明为 intrinsic / 内联，可能在编译期就绕开我们的实现。

故 `tools/build_runtime.mjs` 用 `-D` 在预处理期把 45 个公开名改写成 **`tfd_*` 前缀**
（内部内核 `__ieee754_*` / `__kernel_*` 保持原名，不与 CRT 相撞）：

```
-Dsin=tfd_sin -Dcos=tfd_cos ... -Dsqrt=tfd_sqrt ... -Dsigngam=tfd_signgam
```

`t_runtime.c` 里 `extern double tfd_*(...)` 声明后直接调用。
`s_matherr.c` 被排除（提供 `matherr`，与 CRT 冲突）。

## ⚠ 两个必知的坑（都踩过）

1. **字节序探测失效（曾导致全库静默算错）**
   `fdlibm.h` 只认 1990 年代的 `i386` / `__alpha` / `__osf__` 宏。现代编译器
   （clang/gcc/MSVC on x86-64 / arm64 / riscv64）**一个都不命中**，于是静默落到
   「大端」分支，`__HI(x)/__LO(x)` 取反 → double 高/低 32 位字互换：
   `tfd_fabs(-3.5) == -3.5`、`tfd_sqrt(2.0) == 0.0`、`tfd_pow(2,10) == inf`。
   已在 `fdlibm.h` 补上现代字节序宏（`__x86_64__` / `_M_X64` / `__aarch64__` /
   `__BYTE_ORDER__` 兜底）。**换目标平台务必重验 `math_stdlib_demo`。**

2. **类型双关需要 `-fno-strict-aliasing`**
   `__HI(x)` 展开是 `*(int*)&x`，严格别名规则下是 UB，`-O2` 会重排「先写 `__HI`
   再读 `x`」，导致发布态与调试态结果不一致。`build_runtime.mjs` 已为 fdlibm 单元
   统一加上该标志。

## fdlibm 没有、由 t 自行补的 8 个函数

`s_` / `e_` 系列里没有（或版本太老没有）的，在 `t_runtime.c` 中基于 `tfd_*` 实现：

| 函数 | 实现方式 |
|---|---|
| `trunc` | `x >= 0 ? tfd_floor(x) : tfd_ceil(x)` |
| `round` | `x >= 0 ? tfd_floor(x+0.5) : tfd_ceil(x-0.5)` |
| `exp2` | `tfd_pow(2.0, x)` |
| `log2` | `tfd_log(x) / ln2` |
| `fmin` / `fmax` / `fdim` | 手写 + NaN 传播 |
| `fma` | Dekker two-product + two-sum（无需硬件 FMA） |

单精度变体（`t_math_*f`）一律「双精度计算后再窄化」：`(float)tfd_*((double)x)`。

## 验证

```bash
node tools/build_runtime.mjs          # 重建 out/{dbg,rls}/deps/t_runtime.lib
node tools/run_examples.mjs --only math_stdlib_demo,format_demo
node tools/gate.mjs L2
```

对拍探针 `out/_probe/probe_libs.c`（fdlibm vs 系统 libm，13 个探针值 × 30 个函数）
应报 `0 mismatch(es)`。

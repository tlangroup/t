# runtime 第三方库（vendored）总览

自 2026-09-26 起，t 运行时**不再依赖系统 libm**，堆分配**不再直接用 libc malloc**。
四个库已 vendored 进本目录，由 `tools/build_runtime.mjs` 一起编进
`out/<mode>/deps/t_runtime.lib`（dbg: 79 fdlibm + 16 mimalloc + 1 imath + 3 ryu
+ 3 t runtime = 102 个成员）。

| 目录 | 库 | 许可证 | 接管了 t 的什么 | 未接管 / 说明 |
|---|---|---|---|---|
| `fdlibm/` | fdlibm (Sun, netlib) | 自由分发 | 全部 73 个 `t_math_*` 浮点函数 | `trunc/round/exp2/log2/fmin/fmax/fdim/fma` 库里没有，t 自行基于 `tfd_*` 实现；详见 `fdlibm/README.md` |
| `mimalloc/` | mimalloc (Microsoft) | MIT | `t_alloc`/`t_free/arena` 底层大块 | **不替代 arena**：arena 仍是 bump 分配器（不支持单块回收），mimalloc 只作为底层大块的来源 |
| `imath/` | IMath (creachadair) | MIT | 任意宽度整数（i128/u128/u256…）的十进制/十六进制/二进制格式化 | `mp_int` 是 `mpz_t*`（指针 typedef），不是值类型——取地址时别再写 `&bz` |
| `ryu/` | Ryu (ulfjack) | Apache-2.0 / Boost | 浮点 → 字符串（`%e` / `%f` / `%g`） | 未用 `d2s`（最短往返）：它恒输出科学计数法且 `0.0 → "0E0"`，与 t 既有 `%g` 语义不兼容 |

## 三个必知的坑（都踩过，代价不小）

1. **fdlibm 字节序探测失效** → 全库静默算错（`fabs(-3.5) == -3.5`）。
   已修 `fdlibm/fdlibm.h`。细节见 `fdlibm/README.md`。

2. **Ryu 的 `*_buffered_n` 不写结尾 NUL**（只有 `d2s_buffered` / `d2fixed_buffered`
   这类便利封装才补 `'\0'`）。漏了它 → 下游 `t_str_from_c` 按 `strlen` 取长度会吃到
   上一次调用残留的字节（实测 `format_demo` 打出 `3.14]`、`50.00000e+03<垃圾>%`）。
   **必须按返回值显式 `num[n] = 0`**。

3. **分配器必须成双成对**。`sym_pool_new` 曾用 libc `calloc` 分配而 `sym_pool_free`
   用 `mi_free` 释放 → 堆损坏，`sym_demo` 在 `sym_release` 后静默截断输出。
   改 mimalloc 时 **`calloc` 极易漏网**（`grep -rn '\bcalloc\|\bmalloc(\|\brealloc(\|\bfree('`）。

## 改了这些之后要做什么

```bash
node tools/build_runtime.mjs        # 必须：deps lib 不会自动重建
node tools/run_examples.mjs         # 88 个示例，LLVM/C 双后端逐字节对拍
node tools/gate.mjs L2
```

C 后端与 gate 的 cself 步都**链接预编译的 `t_runtime.lib`**，不再从源码编
`t_runtime.c`（它现在缺 `-I mimalloc/include` 和那 100 个 .obj 就编不过）。

// C 互操作导出：C 侧驱动（按 clean C 名链接 t 导出的函数）
// 链接：clang out/dbg/cio.ll runtime/t_runtime.c runtime/t_shim_ll.c examples/c_interop_driver.c -I runtime -o out/dbg/cio_driver
// 注意：t 产出的是 C（非 C++），故此处用普通 C 声明（无 extern "C"）；t 侧导出入口已是 C ABI（ccc / C 链接）。
#include <stdio.h>

long long add(long long a, long long b);
long long fib(long long n);

int main(void) {
    printf("%lld\n", add(2, 3));   // 期望 5
    printf("%lld\n", fib(10));     // 期望 55
    return 0;
}

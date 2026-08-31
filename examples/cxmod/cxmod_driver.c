// 模块化 C 互操作导出：C 驱动按 clean 名链接 t 库导出的函数（转发器桥接重整名）。
#include <stdio.h>

long long madd(long long a, long long b);
long long mfib(long long n);

int main(void) {
    printf("%lld\n", madd(2, 3));   // 期望 5
    printf("%lld\n", mfib(10));     // 期望 55
    return 0;
}

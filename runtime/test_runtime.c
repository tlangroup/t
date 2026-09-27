// ═══════════════════════════════════════════════════════════════
// test_runtime.c — t_runtime C 单元测试（边界 + 功能）
// 编译（⚠ 2026-09-26 起 t_runtime.c 依赖 vendored 的 mimalloc/fdlibm/imath/Ryu，不可直编源码）：
//   先用 `node tools/build_runtime.mjs` 产出 out/dbg/deps/t_runtime.lib，再执行 runtime\build_test.bat
//   （等价命令：clang -std=c11 -O0 -I . -I mimalloc\include test_runtime.c ..\out\dbg\deps\t_runtime.lib -o test_runtime.exe）
// 退出码 0 = 全部通过；非 0 = 有失败。
// ═══════════════════════════════════════════════════════════════

#include "t_runtime.h"
#include <stdio.h>
#include <string.h>

static int g_fail = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { printf("FAIL: %s\n", msg); g_fail++; } \
    else { printf("ok  : %s\n", msg); } \
} while (0)

int main(void) {
    TArena* a = t_arena_new();
    t_runtime_set_arena(a);   // t_cstr / t_slice_append 依赖全局 arena

    // ── TStr ──
    TStr s = TSTR_LIT("hello");
    CHECK(t_str_len(s) == 5, "t_str_len");
    CHECK(t_str_byte_at(s, 0) == 'h', "t_str_byte_at");
    CHECK(t_str_eq(s, TSTR_LIT("hello")), "t_str_eq equal");
    CHECK(!t_str_eq(s, TSTR_LIT("world")), "t_str_eq not equal");
    TStr sub = t_str_slice(s, 1, 4);
    CHECK(t_str_eq(sub, TSTR_LIT("ell")), "t_str_slice");
    char* c = t_cstr(s);
    CHECK(strcmp(c, "hello") == 0, "t_cstr");

    // ── StringBuilder ──
    TSb* b = t_sb_new(a);
    t_sb_append_str(b, TSTR_LIT("n="));
    t_sb_append_i64(b, -42);
    t_sb_append_char(b, ' ');
    t_sb_append_u64(b, 100);
    TStr out = t_sb_to_str(b);
    CHECK(t_str_eq(out, TSTR_LIT("n=-42 100")), "stringbuilder");

    // ── TSlice<int64> ──
    TSlice nums = t_slice_new((int64_t)sizeof(int64_t));
    for (int64_t i = 0; i < 100; i++) t_slice_append(&nums, &i);
    CHECK(t_slice_len(nums) == 100, "slice len");
    int64_t* p = (int64_t*)t_slice_at(nums, 50);
    CHECK(*p == 50, "slice at");
    int64_t v = 999; t_slice_set(nums, 10, &v);
    CHECK(*(int64_t*)t_slice_at(nums, 10) == 999, "slice set");

    // ── TMap<string,int64> ──
    TMap* m = t_map_new(a, 0, (int64_t)sizeof(int64_t));
    TStr k1 = TSTR_LIT("apple");
    TStr k2 = TSTR_LIT("banana");
    int64_t one = 1, two = 2;
    t_map_put(m, &k1, &one);
    t_map_put(m, &k2, &two);
    CHECK(t_map_len(m) == 2, "map len");
    int64_t got = 0;
    CHECK(t_map_get(m, &k1, &got) && got == 1, "map get 1");
    CHECK(t_map_get(m, &k2, &got) && got == 2, "map get 2");
    CHECK(t_map_has(m, &k1), "map has");
    TStr kmissing = TSTR_LIT("zzz");
    CHECK(!t_map_has(m, &kmissing), "map has not");
    // 插入序迭代
    CHECK(t_str_eq(t_map_key_str_at(m, 0), k1), "map iter order 0");
    CHECK(t_str_eq(t_map_key_str_at(m, 1), k2), "map iter order 1");
    // 更新
    int64_t three = 3; t_map_put(m, &k1, &three);
    CHECK(t_map_len(m) == 2, "map update keeps len");
    t_map_get(m, &k1, &got); CHECK(got == 3, "map update value");

    // ── TMap<int64,int64> ──
    TMap* mi = t_map_new(a, 1, (int64_t)sizeof(int64_t));
    int64_t keyA = 7, keyB = 100, valB = 555;
    t_map_put(mi, &keyA, &one);
    t_map_put(mi, &keyB, &valB);
    CHECK(t_map_has(mi, &keyB), "int map has");
    int64_t g2 = 0; t_map_get(mi, &keyB, &g2);
    CHECK(g2 == 555, "int map get");

    t_arena_free_all(a);

    if (g_fail == 0) { printf("\nALL RUNTIME TESTS PASSED\n"); return 0; }
    printf("\n%d RUNTIME TEST(S) FAILED\n", g_fail);
    return 1;
}

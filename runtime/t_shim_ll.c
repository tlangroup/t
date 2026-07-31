// ═══════════════════════════════════════════════════════════════
// t_shim_ll.c — t 语言 LLVM IR 后端的 runtime 桥接层
//
// 设计要点：
//   * LLVM 后端生成的 .ll 与 C runtime 之间的全部聚合类型（TStr 16B、
//     TSlice 32B）交互统一走指针，彻底规避 Win64 聚合传值/返回的
//     ABI 匹配问题（>8 字节聚合按隐藏指针传递的 lowering 细节）。
//   * 生成的 IR 只出现 ptr 与标量参数；out 参数由调用方 alloca。
//   * 与 t_runtime.c 一起用 clang 编译链接。
// ═══════════════════════════════════════════════════════════════

#include "t_runtime.h"

// ── string ─────────────────────────────────────────────────────
void    tll_print(TStr* s)                  { t_print(*s); }
void    tll_eprint(TStr* s)                 { t_eprint(*s); }
int64_t tll_str_len(TStr* s)                { return t_str_len(*s); }
int64_t tll_str_at(TStr* s, int64_t i)      { return (int64_t)t_str_byte_at(*s, i); }
int32_t tll_str_eq(TStr* a, TStr* b)        { return t_str_eq(*a, *b) ? 1 : 0; }
void    tll_str_slice(TStr* s, int64_t a, int64_t b, TStr* out) { *out = t_str_slice(*s, a, b); }

// ── StringBuilder ──────────────────────────────────────────────
TSb*    tll_sb_new(void)                    { return t_sb_new(t_arena_current()); }
void    tll_sb_append_str(TSb* b, TStr* s)  { t_sb_append_str(b, *s); }
void    tll_sb_append_char(TSb* b, int64_t c) { t_sb_append_char(b, (uint8_t)c); }
void    tll_sb_append_u64(TSb* b, uint64_t v) { t_sb_append_u64(b, v); }
void    tll_sb_append_i64(TSb* b, int64_t v)  { t_sb_append_i64(b, v); }
void    tll_sb_to_str(TSb* b, TStr* out)    { *out = t_sb_to_str(b); }
void    tll_sb_clear(TSb* b)                { t_sb_clear(b); }
void    tll_int_to_str(int64_t v, TStr* out) { *out = t_int_to_str(v); }

// ── slice ──────────────────────────────────────────────────────
void    tll_slice_new(int64_t esz, TSlice* out)              { *out = t_slice_new(esz); }
void    tll_slice_append(TSlice* s, void* elem, int64_t esz) { t_slice_append_sized(s, elem, esz); }
void*   tll_slice_at(TSlice* s, int64_t i)                   { return t_slice_at(*s, i); }
void    tll_slice_set(TSlice* s, int64_t i, void* elem)      { t_slice_set(*s, i, elem); }
int64_t tll_slice_len(TSlice* s)                             { return t_slice_len(*s); }

// ── map ────────────────────────────────────────────────────────
TMap*   tll_map_new(int64_t key_kind, int64_t val_size) { return t_map_new(t_arena_current(), key_kind, val_size); }
int32_t tll_map_get(TMap* m, void* key, void* out)      { return t_map_get(m, key, out) ? 1 : 0; }
void    tll_map_put(TMap* m, void* key, void* val)      { t_map_put(m, key, val); }
int32_t tll_map_has(TMap* m, void* key)                 { return t_map_has(m, key) ? 1 : 0; }
int64_t tll_map_len(TMap* m)                            { return t_map_len(m); }

// ── I/O 与进程 ─────────────────────────────────────────────────
void    tll_file_read_all(TStr* path, TStr* out)     { *out = t_file_read_all(t_cstr(*path)); }
int32_t tll_file_exists(TStr* path)                  { return t_file_exists(t_cstr(*path)) ? 1 : 0; }
int32_t tll_file_write_all(TStr* path, TStr* c)      { return t_file_write_all(t_cstr(*path), *c) ? 1 : 0; }
void    tll_path_resolve(TStr* path, TStr* out)      { *out = t_path_resolve(t_cstr(*path)); }
void    tll_args(TSlice* out)                        { *out = t_args(); }
void    tll_exit(int32_t code)                       { t_exit(code); }
int32_t tll_system(TStr* cmd)                        { return t_system(*cmd); }

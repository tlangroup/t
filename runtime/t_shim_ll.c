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
#include <stdint.h>
#include <string.h>

// 内存诊断探针（仅 T_MIHIST=1 启用；见 t_runtime.c 的 mi_malloc 调用方直方图）。
// tll_alloc 是 LLVM 后端 new 的最外层包装；记录其调用方即可定位 21GB 的真凶。
extern void mih_record(unsigned long long ra, unsigned long long sz);
extern int  g_in_tll;

// ── string ─────────────────────────────────────────────────────
void    tll_print(TStr* s)                  { t_print(*s); }
void    tll_eprint(TStr* s)                 { t_eprint(*s); }
void    tll_println(TStr* s)                { t_println(*s); }

// ── 测试内建 shim（@panic / @assert / @assert_eq）──
// 与 tll_eprint 同：聚合（string）按指针传，解引用转调 t_runtime.c 的实现。
void    tll_panic(TStr* msg)                        { t_panic(*msg); }
void    tll_assert(int8_t cond, TStr* msg)          { t_assert(cond, *msg); }
void    tll_assert_eq_i64(int64_t a, int64_t b, TStr* msg) { t_assert_eq_i64(a, b, *msg); }
void    tll_assert_eq_u64(uint64_t a, uint64_t b, TStr* msg) { t_assert_eq_u64(a, b, *msg); }
void    tll_assert_eq_f64(double a, double b, TStr* msg)    { t_assert_eq_f64(a, b, *msg); }
void    tll_assert_eq_f32(float a, float b, TStr* msg)      { t_assert_eq_f32(a, b, *msg); }
void    tll_assert_eq_b(int8_t a, int8_t b, TStr* msg)      { t_assert_eq_b(a, b, *msg); }
void    tll_assert_eq_s(TStr* a, TStr* b, TStr* msg)        { t_assert_eq_s(*a, *b, *msg); }

int64_t tll_str_len(TStr* s)                { return t_str_len(*s); }
int64_t tll_str_at(TStr* s, int64_t i)      { return (int64_t)t_str_byte_at(*s, i); }
int32_t tll_str_eq(TStr* a, TStr* b)        { return t_str_eq(*a, *b) ? 1 : 0; }
// 字符串拼接：在全局 arena 上分配 len_a+len_b+1 字节，拷贝两端，补 \0（UTF-8 视图，
// 不依赖 \0 结尾但保留以便需要 cstr 的 C API）。返回聚合走末位 out 指针（与 tll_str_slice 同构）。
void    tll_str_concat(TStr* a, TStr* b, TStr* out) {
    int64_t n = a->len + b->len;
    uint8_t* buf = (uint8_t*)t_arena_alloc(t_arena_current(), (size_t)(n + 1));
    if (a->len > 0) { memcpy(buf, a->ptr, (size_t)a->len); }
    if (b->len > 0) { memcpy(buf + a->len, b->ptr, (size_t)b->len); }
    buf[n] = 0;
    TStr r; r.ptr = buf; r.len = n; *out = r;
}
void    tll_str_slice(TStr* s, int64_t a, int64_t b, TStr* out) { *out = t_str_slice(*s, a, b); }

// ── 硬件 SIMD @cpu_has 后端 ────────────────────────────────────
// TStr 按指针传（避开 Win64 聚合传值 ABI），返回 0/1；实现见 t_runtime.c 的 CPUID。
int32_t tll_cpu_has(TStr* s)                { return (int32_t)t_cpu_has_n(s->ptr, s->len); }

// ── 可选类型 ?T（可空指针模型，与 C 后端共享 t_opt_some / t_opt_unwrap）──
void*   tll_opt_some(const void* src, int64_t sz)  { return t_opt_some(src, sz); }
void*   tll_opt_unwrap(const void* p)              { return t_opt_unwrap(p); }

// ── StringBuilder ──────────────────────────────────────────────
TSb*    tll_sb_new(void)                    { return t_sb_new(t_arena_current()); }
void    tll_sb_append_str(TSb* b, TStr* s)  { t_sb_append_str(b, *s); }
void    tll_sb_append_char(TSb* b, int64_t c) { t_sb_append_char(b, (uint8_t)c); }
void    tll_sb_append_u64(TSb* b, uint64_t v) { t_sb_append_u64(b, v); }
void    tll_sb_append_i64(TSb* b, int64_t v)  { t_sb_append_i64(b, v); }
void    tll_sb_to_str(TSb* b, TStr* out)    { *out = t_sb_to_str(b); }
void    tll_sb_clear(TSb* b)                { t_sb_clear(b); }
void    tll_sb_free(TSb* b)                 { t_sb_free(b); }
void    tll_int_to_str(int64_t v, TStr* out) { *out = t_int_to_str(v); }

// ── 格式化（Python 格式规范迷你语言子集）──
void tll_format_int(TStr* spec, int64_t v, TStr* out)        { *out = t_format_int(*spec, v); }
void tll_format_uint(TStr* spec, uint64_t v, TStr* out)      { *out = t_format_uint(*spec, v); }
void tll_format_float(TStr* spec, double v, TStr* out)       { *out = t_format_float(*spec, v); }
void tll_format_str(TStr* spec, TStr* v, TStr* out)          { *out = t_format_str(*spec, *v); }
void tll_format_bool(TStr* spec, int8_t v, TStr* out)        { *out = t_format_bool(*spec, v); }
void tll_format_char(TStr* spec, int64_t v, TStr* out)       { *out = t_format_char(*spec, (uint8_t)v); }
void tll_sb_append_fmt_int(TSb* b, TStr* spec, int64_t v)    { t_sb_append_fmt_int(b, *spec, v); }
void tll_sb_append_fmt_uint(TSb* b, TStr* spec, uint64_t v)  { t_sb_append_fmt_uint(b, *spec, v); }
void tll_sb_append_fmt_float(TSb* b, TStr* spec, double v)   { t_sb_append_fmt_float(b, *spec, v); }
void tll_sb_append_fmt_str(TSb* b, TStr* spec, TStr* v)      { t_sb_append_fmt_str(b, *spec, *v); }
void tll_sb_append_fmt_bool(TSb* b, TStr* spec, int8_t v)    { t_sb_append_fmt_bool(b, *spec, v); }
void tll_sb_append_fmt_char(TSb* b, TStr* spec, int64_t v)       { t_sb_append_fmt_char(b, *spec, (uint8_t)v); }
void tll_sb_append_fmt_str_conv(TSb* b, TStr* spec, TStr* v, TStr* mode)   { t_sb_append_fmt_str_conv(b, *spec, *v, *mode); }
void tll_sb_append_fmt_int_conv(TSb* b, TStr* spec, int64_t v, TStr* mode) { t_sb_append_fmt_int_conv(b, *spec, v, *mode); }
void tll_sb_append_fmt_uint_conv(TSb* b, TStr* spec, uint64_t v, TStr* mode){ t_sb_append_fmt_uint_conv(b, *spec, v, *mode); }
// 任意位宽整数（>64）格式化：spec 按值经指针传入（LLVM byval），值按地址传
void tll_sb_append_fmt_big(TSb* b, TStr* spec, const void* p, int64_t nbits, int8_t is_signed) {
    t_sb_append_fmt_big(b, *spec, p, nbits, (int)is_signed);
}

// ── 时间格式化 / 解析（M56 / M57）──
int64_t tll_now(void) { return t_now(); }
void    tll_format_time(TStr* spec, int64_t t_us, int64_t use_local, TStr* out) { *out = t_format_time(*spec, t_us, (int)use_local); }
void    tll_format_time_tz(TStr* spec, int64_t t_us, int64_t tz_min, TStr* out) { *out = t_format_time_tz(*spec, t_us, tz_min); }
int64_t tll_parse_time(TStr* spec, TStr* s, int64_t use_local) { return t_parse_time(*spec, *s, (int)use_local); }

// ── 通用堆分配（定长数组槽用；栈 alloca 在数组地址流入逃逸 TSlice 并返回时会悬空，
//     故改走持久堆，堆是栈的超集，对全部用例安全。基于 t_alloc（持久 malloc，非 arena）──
__attribute__((noinline)) void* tll_alloc(int64_t size) {
    g_in_tll = 1;
    void* p = t_alloc((size_t)size);
    g_in_tll = 0;
    mih_record((unsigned long long)(uintptr_t)__builtin_return_address(0), (unsigned long long)size);
    return p;
}
// 通用字节拷贝（变体全局常量：构造器在 t.__ginit 栈上物化 %V，需拷到堆以跨 ginit 栈帧持久化；
// payload 自身已堆分配，故整体浅拷贝即安全）。
void    tll_memcpy(void* dst, const void* src, int64_t n)   { if (n > 0) memcpy(dst, src, (size_t)n); }

// ── slice ──────────────────────────────────────────────────────
void    tll_slice_new(int64_t esz, TSlice* out)              { *out = t_slice_new(esz); }
void    tll_slice_append(TSlice* s, void* elem, int64_t esz) { t_slice_append_sized(s, elem, esz); }
void*   tll_slice_at(TSlice* s, int64_t i)                   { return t_slice_at(*s, i); }
void    tll_slice_set(TSlice* s, int64_t i, void* elem)      { t_slice_set(*s, i, elem); }
int64_t tll_slice_len(TSlice* s)                             { return t_slice_len(*s); }
// 子切片：聚合入参与返回一律走指针，out 排末位（与 tll_str_slice 同构）
void    tll_slice_sub(TSlice* s, int64_t a, int64_t b, TSlice* out) { *out = t_slice_sub(*s, a, b); }
// 切片合并 `++`（§15.6）：聚合入参/返回一律走指针，out 排末位（与 tll_str_concat 同构）。
void    tll_slice_concat(TSlice* a, TSlice* b, TSlice* out) { *out = t_slice_concat(*a, *b); }
// map 合并 `++`（§15.6）：聚合入参/返回一律走指针，out 排末位（与 tll_str_concat 同构）。
TMap*   tll_map_concat(TMap* a, TMap* b) { return t_map_concat(a, b); }
// 定长数组合并 `++`（§15.6）：out 由调用方 alloca（[N+M x T]），按字节数复制两段。
// ⚠ 不复用 t_array_concat（它 arena 分配新缓冲）—— LLVM 侧 dst 槽已有存储，直接写入即可。
void    tll_array_concat(void* a, int64_t abytes, void* b, int64_t bbytes, void* out) {
    if (abytes > 0 && a != NULL) memcpy(out, a, (size_t)abytes);
    if (bbytes > 0 && b != NULL) memcpy((uint8_t*)out + abytes, b, (size_t)bbytes);
}
// 定长数组 → 切片零拷贝视图（聚合返回走指针，out 排末位）
void    tll_slice_from_raw(void* ptr, int64_t len, int64_t elem_size, TSlice* out) { *out = t_slice_from_raw(ptr, len, elem_size); }

// ── map ────────────────────────────────────────────────────────
TMap*   tll_map_new(int64_t key_kind, int64_t val_size) { return t_map_new(t_arena_current(), key_kind, val_size); }
int32_t tll_map_get(TMap* m, void* key, void* out)      { return t_map_get(m, key, out) ? 1 : 0; }
void    tll_map_put(TMap* m, void* key, void* val)      { t_map_put(m, key, val); }
int32_t tll_map_has(TMap* m, void* key)                 { return t_map_has(m, key) ? 1 : 0; }
int64_t tll_map_len(TMap* m)                            { return t_map_len(m); }
void*   tll_map_val_ptr(TMap* m, void* key)            { return t_map_val_ptr(m, key); }
int32_t tll_map_del(TMap* m, void* key)                { return t_map_del(m, key) ? 1 : 0; }
// 迭代（按插入序）：count + 按下标取键
int64_t tll_map_count(TMap* m)                          { return t_map_count(m); }
void    tll_map_key_str_at(TMap* m, int64_t i, TStr* out) { *out = t_map_key_str_at(m, i); }
int64_t tll_map_key_int_at(TMap* m, int64_t i)          { return t_map_key_int_at(m, i); }
void*   tll_map_val_at(TMap* m, int64_t i)              { return t_map_val_at(m, i); }

// ── Sym ────────────────────────────────────────────────────────
// 聚合参数(TStr)按指针传入；返回聚合(string)用末位 out 指针；返回标量(id)直接返回。
// 16/32 位 Sym 走 tll_sym_intern/tll_sym_str（i32 id，与既有 IR 契约一致）；
// 64 位 Sym 走 tll_sym_intern64/tll_sym_str64（i64 id）。
uint32_t tll_sym_intern(TStr* tag, TStr* str, int64_t bits)  { return (uint32_t)t_sym_intern(*tag, *str, bits); }
uint64_t tll_sym_intern64(TStr* tag, TStr* str, int64_t bits){ return t_sym_intern(*tag, *str, bits); }
void     tll_sym_str(TStr* tag, uint32_t id, TStr* out)      { *out = t_sym_str(*tag, (uint64_t)id); }
void     tll_sym_str64(TStr* tag, uint64_t id, TStr* out)    { *out = t_sym_str(*tag, id); }
void     tll_sym_release(TStr* tag)                          { t_sym_release(*tag); }
void     tll_sym_release_all(void)                           { t_sym_release_all(); }

// ── Atom ─────────────────────────────────────────────────────────
// 返回聚合(string)用末位 out 指针；id 为标量直接传入。
void     tll_atom_str(int64_t id, TStr* out)                { *out = t_atom_str(id); }

// ── Fid：文件描述符 + 序列化操作符（M51）────────────────────────
// 句柄/格式码均为标量直接传；聚合参数(TStr)按指针传入。
int64_t tll_fopen(TStr* path, int32_t mode)                 { return t_fopen(t_cstr(*path), mode); }
void    tll_fclose(int64_t f)                               { t_fclose(f); }
void    tll_fflush(int64_t f)                               { t_fflush(f); }
int32_t tll_fid_is_open(int64_t f)                          { return t_fid_is_open(f); }
void    tll_fid_error(int64_t f, TStr* out)                 { *out = t_fid_error(f); }
int32_t tll_fseek(int64_t f, int64_t off)                   { return t_fseek(f, off); }
int64_t tll_ftell(int64_t f)                                { return t_ftell(f); }
int64_t tll_fid_format(int64_t f, int64_t a_text, int64_t a_json, int64_t a_raw, int64_t a_pb) {
    return t_fid_format(f, a_text, a_json, a_raw, a_pb);
}
void    tll_fmt_register(int32_t kind, TStr* suffix, int32_t fmt) { t_fmt_register(kind, t_cstr(*suffix), fmt); }
int64_t tll_ser_int(int64_t f, int64_t v, int32_t bits, int32_t sgn) { return t_ser_int(f, v, bits, sgn); }
int64_t tll_ser_f64(int64_t f, double v, int32_t bits)      { return t_ser_f64(f, v, bits); }
int64_t tll_ser_bool(int64_t f, int8_t v)                   { return t_ser_bool(f, v); }
int64_t tll_ser_atom(int64_t f, int64_t id)                 { return t_ser_atom(f, id); }
int64_t tll_ser_str(int64_t f, TStr* s)                     { return t_ser_str(f, *s); }
int32_t tll_fid_eof(int64_t f)                              { return t_fid_eof(f); }
int64_t tll_deser_int(int64_t f, int32_t bits, int32_t sgn) { return t_deser_int(f, bits, sgn); }
double  tll_deser_f64(int64_t f, int32_t bits)              { return t_deser_f64(f, bits); }
int8_t  tll_deser_bool(int64_t f)                           { return t_deser_bool(f); }
int64_t tll_deser_atom(int64_t f)                           { return t_deser_atom(f); }
void    tll_deser_str(int64_t f, TStr* out)                 { *out = t_deser_str(f); }

// ── I/O 与进程 ─────────────────────────────────────────────────
// REPL 交互输入（M-REPL）：read_line 返回聚合 TStr（out-pointer），stdin_eof 返回标量 i32。
void    tll_read_line(TStr* out)                     { *out = t_read_line(); }
int32_t tll_stdin_eof(void)                          { return t_stdin_eof() ? 1 : 0; }
void    tll_file_read_all(TStr* path, TStr* out)     { *out = t_file_read_all(t_cstr(*path)); }
void    tll_getenv(TStr* name, TStr* out)            { *out = t_getenv(t_cstr(*name)); }
int32_t tll_file_exists(TStr* path)                  { return t_file_exists(t_cstr(*path)) ? 1 : 0; }
int32_t tll_file_write_all(TStr* path, TStr* c)      { return t_file_write_all(t_cstr(*path), *c) ? 1 : 0; }
void    tll_path_resolve(TStr* path, TStr* out)      { *out = t_path_resolve(t_cstr(*path)); }
void    tll_args(TSlice* out)                        { *out = t_args(); }
void    tll_exit(int32_t code)                       { t_exit(code); }
int32_t tll_system(TStr* cmd)                        { return t_system(*cmd); }

// ── 位串 bitstr（§15）─────────────────────────────────────────
// 与 TStr 同策略：聚合按指针传，out 排在末位；用内联实现规避 24 字节 TBitStr 的 sret ABI 歧义。
void tll_bitstr_new(TBitStr* out, int64_t bit_len) {
    int64_t bytes = (bit_len + 7) / 8;
    uint8_t* buf = (uint8_t*)t_arena_alloc(t_arena_current(), (size_t)bytes);
    if (bytes > 0) { memset(buf, 0, (size_t)bytes); }
    out->ptr = buf; out->bit_len = 0; out->cap = bytes;
}
void tll_bitstr_append_val(TBitStr* dst, uint64_t val, int64_t bits, int little) {
    t_bitstr_append_val(dst, val, bits, little);
}
void tll_bitstr_concat(TBitStr* out, TBitStr* a, TBitStr* b) {
    int64_t total = a->bit_len + b->bit_len;
    int64_t bytes = (total + 7) / 8;
    uint8_t* buf = (uint8_t*)t_arena_alloc(t_arena_current(), (size_t)bytes);
    if (bytes > 0) { memset(buf, 0, (size_t)bytes); }
    TBitStr r; r.ptr = buf; r.bit_len = 0; r.cap = bytes;
    // 复制 a 的位（读 *a 发生在写 *out 之前，out==a 重叠安全）
    for (int64_t i = 0; i < a->bit_len; i++) {
        int bit = (a->ptr[i / 8] >> (7 - (i % 8))) & 1;
        if (bit) { r.ptr[i / 8] |= (uint8_t)(1 << (7 - (i % 8))); }
    }
    // 复制 b 的位
    for (int64_t i = 0; i < b->bit_len; i++) {
        int64_t dsti = a->bit_len + i;
        int bit = (b->ptr[i / 8] >> (7 - (i % 8))) & 1;
        if (bit) { r.ptr[dsti / 8] |= (uint8_t)(1 << (7 - (dsti % 8))); }
    }
    r.bit_len = total;
    *out = r;
}
uint64_t tll_bitstr_extract(TBitStr* s, int64_t bit_off, int64_t bits, int little) {
    return t_bitstr_extract(*s, bit_off, bits, little);
}
void tll_bitstr_sub(TBitStr* out, TBitStr* s, int64_t bit_off) {
    *out = t_bitstr_sub(*s, bit_off);
}


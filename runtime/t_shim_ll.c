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
void    tll_println(TStr* s)                { t_println(*s); }

// ── type_info(T) accessor shim（M36）──
// 约定：返回聚合（string）用 out-pointer，且 out 排在末位——与
//       tll_file_read_all / tll_str_slice / tll_sb_to_str 一致，顺序不可颠倒；
//       返回标量/指针直接返回（与 str_len / slice_at 一致）。
void       tll_ti_name(TTypeInfo* ti, TStr* out)      { *out = t_ti_name(ti); }
int64_t    tll_ti_size(TTypeInfo* ti)                 { return t_ti_size(ti); }
int64_t    tll_ti_kind(TTypeInfo* ti)                 { return t_ti_kind(ti); }
int64_t    tll_ti_field_count(TTypeInfo* ti)          { return t_ti_field_count(ti); }
TFieldInfo* tll_ti_field(TTypeInfo* ti, int64_t i)    { return t_ti_field(ti, i); }
void       tll_fi_name(TFieldInfo* fi, TStr* out)     { *out = t_fi_name(fi); }
int64_t    tll_fi_offset(TFieldInfo* fi)              { return t_fi_offset(fi); }
void       tll_fi_type_name(TFieldInfo* fi, TStr* out){ *out = t_fi_type_name(fi); }
int64_t    tll_fi_type_size(TFieldInfo* fi)           { return t_fi_type_size(fi); }
int8_t     tll_fi_is_ptr(TFieldInfo* fi)              { return t_fi_is_ptr(fi); }
int64_t    tll_fi_tag(TFieldInfo* fi)                { return t_fi_tag(fi); }
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

// ── 时间格式化 / 解析（M56 / M57）──
int64_t tll_now(void) { return t_now(); }
void    tll_format_time(TStr* spec, int64_t t_us, int64_t use_local, TStr* out) { *out = t_format_time(*spec, t_us, (int)use_local); }
void    tll_format_time_tz(TStr* spec, int64_t t_us, int64_t tz_min, TStr* out) { *out = t_format_time_tz(*spec, t_us, tz_min); }
int64_t tll_parse_time(TStr* spec, TStr* s, int64_t use_local) { return t_parse_time(*spec, *s, (int)use_local); }

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
void*   tll_map_val_ptr(TMap* m, void* key)            { return t_map_val_ptr(m, key); }
int32_t tll_map_del(TMap* m, void* key)                { return t_map_del(m, key) ? 1 : 0; }
// 迭代（按插入序）：count + 按下标取键
int64_t tll_map_count(TMap* m)                          { return t_map_count(m); }
void    tll_map_key_str_at(TMap* m, int64_t i, TStr* out) { *out = t_map_key_str_at(m, i); }
int64_t tll_map_key_int_at(TMap* m, int64_t i)          { return t_map_key_int_at(m, i); }
void*   tll_map_val_at(TMap* m, int64_t i)              { return t_map_val_at(m, i); }

// ── Sym ────────────────────────────────────────────────────────
// 聚合参数(TStr)按指针传入；返回聚合(string)用末位 out 指针；返回标量(id)直接返回。
uint32_t tll_sym_intern(TStr* tag, TStr* str, int64_t bits)  { return t_sym_intern(*tag, *str, bits); }
void     tll_sym_str(TStr* tag, uint32_t id, TStr* out)      { *out = t_sym_str(*tag, id); }
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
void    tll_file_read_all(TStr* path, TStr* out)     { *out = t_file_read_all(t_cstr(*path)); }
int32_t tll_file_exists(TStr* path)                  { return t_file_exists(t_cstr(*path)) ? 1 : 0; }
int32_t tll_file_write_all(TStr* path, TStr* c)      { return t_file_write_all(t_cstr(*path), *c) ? 1 : 0; }
void    tll_path_resolve(TStr* path, TStr* out)      { *out = t_path_resolve(t_cstr(*path)); }
void    tll_args(TSlice* out)                        { *out = t_args(); }
void    tll_exit(int32_t code)                       { t_exit(code); }
int32_t tll_system(TStr* cmd)                        { return t_system(*cmd); }

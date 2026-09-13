// ═══════════════════════════════════════════════════════════════
// t_runtime.h — t 语言 C 后端运行时库 (bootstrap M1)
//
// 设计要点 (对应 docs/bootstrap.md §2.1)：
//   * 编译器是「一次性批处理」进程，采用 Arena 整体分配、进程退出统一释放，
//     完全回避 GC 与所有权系统（这是把自举提前数月的关键取舍）。
//   * 此库为长期资产：tc0 生成的 C 与未来 compiler.tc 生成的 C 都链接它。
//   * 纯 C99，无第三方依赖，gcc / clang / msvc 均可编译。
//   * 任何越界/非法访问都打印 JSON 诊断并 exit(1)，支撑 AI Agent 自动修复闭环。
// ═══════════════════════════════════════════════════════════════

#ifndef T_RUNTIME_H
#define T_RUNTIME_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Arena 分配器 ───────────────────────────────────────────────
// 编译器一次性批处理：整体 bump 分配，结束统一释放。
typedef struct TArena TArena;

TArena* t_arena_new(void);
void*   t_arena_alloc(TArena* a, size_t size);
void    t_arena_free_all(TArena* a);   // 编译结束一次性释放

// ── 通用堆分配（闭包 env / TClosure record；不走 arena，可直接 free）──
// v2 闭包按值捕获：创建闭包时 malloc 一份「记录 + 环境」块；v2 暂不 free（泄漏），
// 留作后续引用计数增强。
void*   t_alloc(size_t size);
void    t_free(void* p);

// 闭包值：指向 {fnptr, env} 记录的指针（见 FuncType v2 / M46）。
// fn 字段统一为 (void* env, Args...) -> Ret 的函数指针（首参为环境）。
typedef struct { void* fn; void* env; } TClosure;

// ── 运行时生命周期（由生成的 C main() 调用）─────────────────────
void    t_runtime_init(int argc, char** argv);  // 保存 argc/argv 供 t_args()
void    t_runtime_set_arena(TArena* a);         // 注入全局 arena
TArena* t_arena_current(void);                  // 取全局 arena（供 sb_new 等内置）
void    t_runtime_done(void);                   // 释放全局 arena（main 返回前调用）

// ── string：不可变 UTF-8 视图 ──────────────────────────────────
// 注意：不是以 \0 结尾的 C 字符串，必须用 .len 访问长度。
typedef struct { const uint8_t* ptr; int64_t len; } TStr;

// 字符串字面量 → TStr（编译期计算长度，不含结尾 \0）
#define TSTR_LIT(s) ((TStr){ .ptr = (const uint8_t*)(s), .len = (int64_t)(sizeof(s) - 1) })

TStr    t_str_from_c(const char* s);
TStr    t_str_slice(TStr s, int64_t start, int64_t end);   // 越界 → panic + JSON 诊断
TStr    t_str_concat(TStr a, TStr b);                       // 拼接（arena 分配，补 \0）
uint8_t t_str_byte_at(TStr s, int64_t i);                   // 越界 → panic + JSON 诊断
bool    t_str_eq(TStr a, TStr b);
int64_t t_str_len(TStr s);
// 运行期 CPU 特性探测（@cpu_has 后端）：本机 CPU 是否支持给定 ISA 扩展（见 t_runtime.c）。
// @cpu_has 后端：三个入口同一份 CPUID 实现
//   t_cpu_has(TStr)                    —— C 后端（t 的 string 就是 TStr）
//   t_cpu_has_n(const uint8_t*, int64) —— LLVM 后端（ptr/len 拆开传，避开聚合体 ABI）
//   t_cpu_has_cstr(const char*)        —— 运行时内部 / 手写 C 调用
int     t_cpu_has(TStr feat);
int     t_cpu_has_n(const uint8_t* p, int64_t n);
int     t_cpu_has_cstr(const char* feat);
// 返回以 \0 结尾的 C 字符串副本（全局 arena 分配），用于需要 cstr 的 C API（如 fopen）。
char*   t_cstr(TStr s);

// ── StringBuilder：可变拼接 ───────────────────────────────────
typedef struct { uint8_t* buf; int64_t len; int64_t cap; TArena* arena; } TSb;

TSb* t_sb_new(TArena* a);
void t_sb_append_str(TSb* b, TStr s);
void t_sb_append_cstr(TSb* b, const char* s);
void t_sb_append_u64(TSb* b, uint64_t v);
void t_sb_append_i64(TSb* b, int64_t v);
void t_sb_append_char(TSb* b, uint8_t c);
TStr t_sb_to_str(TSb* b);          // 返回以 \0 结尾的 TStr（arena 分配）
void t_sb_clear(TSb* b);
void t_sb_free(TSb* b);   // TSb 由 arena 拥有，无法单独释放（no-op）

// int_to_str(v: i64) -> string —— 整数转十进制字符串（arena 分配）
TStr t_int_to_str(int64_t v);

// ── 格式化（Python 格式规范迷你语言子集）──────────────────────────────
// 语法: [[fill]align][sign][#][0][width][grouping][.precision][type]
// spec 可带 "{}" / ":" 外壳，解析时自动剥除。
TStr t_format_int(TStr spec, int64_t v);
TStr t_format_uint(TStr spec, uint64_t v);
TStr t_format_float(TStr spec, double v);
TStr t_format_str(TStr spec, TStr v);
TStr t_format_bool(TStr spec, int v);
TStr t_format_char(TStr spec, uint8_t v);
// StringBuilder 直写变体
void t_sb_append_fmt_int(TSb* b, TStr spec, int64_t v);
void t_sb_append_fmt_uint(TSb* b, TStr spec, uint64_t v);
void t_sb_append_fmt_float(TSb* b, TStr spec, double v);
void t_sb_append_fmt_str(TSb* b, TStr spec, TStr v);
void t_sb_append_fmt_bool(TSb* b, TStr spec, int v);
void t_sb_append_fmt_char(TSb* b, TStr spec, uint8_t v);
// 转换字段 !s/!r/!a/!j（字符串）与 !c/!p（整数）：先转文本形态，再套 spec
void t_sb_append_fmt_str_conv(TSb* b, TStr spec, TStr v, TStr mode);
void t_sb_append_fmt_int_conv(TSb* b, TStr spec, int64_t v, TStr mode);
void t_sb_append_fmt_uint_conv(TSb* b, TStr spec, uint64_t v, TStr mode);
// 任意位宽整数（>64）格式化：p 指向值的小端字节，nbits 为位宽，is_signed 为符号
void t_sb_append_fmt_big(TSb* b, TStr spec, const void* p, int64_t nbits, int is_signed);

// ── 时间格式化（strftime / Python datetime.strftime 的 % 风格子集，M56/M57）──
// now() -> 当前时刻微秒 epoch；format_time(spec, t_us, use_local) 按 UTC / 本地时区展开。
// use_local != 0 时按本地时区（localtime），否则 UTC（gmtime）。
int64_t t_now(void);
TStr    t_format_time(TStr spec, int64_t t_us, int use_local);
// M57：固定时区偏移（分钟，东为正）。%z 输出 ±HHMM，%Z 输出 "UTC" / "UTC±HH:MM"。
TStr    t_format_time_tz(TStr spec, int64_t t_us, int64_t tz_min);
// M57：strptime 子集。成功返回微秒 epoch；失败返回 T_TIME_INVALID（INT64_MIN）。
// use_local != 0 且串内无 %z 时，按本机本地时区解释；否则按 UTC / 串内偏移。
int64_t t_parse_time(TStr spec, TStr s, int use_local);
#define T_TIME_INVALID INT64_MIN

// ── 测试内建（@panic / @assert / @assert_eq）──
void    t_panic(TStr msg);
void    t_assert(int8_t cond, TStr msg);
void    t_assert_eq_i64(int64_t a, int64_t b, TStr msg);
void    t_assert_eq_u64(uint64_t a, uint64_t b, TStr msg);
void    t_assert_eq_f64(double a, double b, TStr msg);
void    t_assert_eq_f32(float a, float b, TStr msg);
void    t_assert_eq_b(int8_t a, int8_t b, TStr msg);
void    t_assert_eq_s(TStr a, TStr b, TStr msg);

// ── 切片 []T：泛型经元素宽度单态化 ─────────────────────────────
// t 语言层不暴露 void*；类型安全由 tc 类型检查器在编译期保证。
// emitter 规则：tokens[i] → *(Token*)t_slice_at(tokens, i)
//              append(tokens, tok) → t_slice_append(&tokens, &tok)
// 所有分配经全局 g_arena（由 t_runtime_set_arena 在 main 入口注入），函数体无需透传 arena。
typedef struct { void* ptr; int64_t len; int64_t cap; int64_t elem_size; } TSlice;

TSlice t_slice_new(int64_t elem_size);
TSlice t_slice_from_raw(void* ptr, int64_t len, int64_t elem_size); // 定长数组 → 切片零拷贝视图
void   t_slice_append(TSlice* s, const void* elem);
void   t_slice_append_sized(TSlice* s, const void* elem, int64_t elem_size);
void*  t_slice_at(TSlice s, int64_t i);        // 越界 → panic + JSON 诊断；返回元素地址
void   t_slice_set(TSlice s, int64_t i, const void* elem); // 越界 → panic
int64_t t_slice_len(TSlice s);
void*  t_slice_ptr(TSlice s);                  // 底层数组首地址（供 memset/序列化）
TSlice t_slice_sub(TSlice s, int64_t a, int64_t b); // s[a..b] 子切片视图；越界 → panic

// ── map[K]V：开放寻址，K 限定 string / 整数 ───────────────────
// key_kind: 0 = TStr, 1 = int64
typedef struct TMap TMap;

TMap* t_map_new(TArena* a, int64_t key_kind, int64_t val_size);
bool  t_map_get(TMap* m, const void* key, void* out_val);   // key: TStr* 或 int64*
void  t_map_put(TMap* m, const void* key, const void* val);
bool  t_map_has(TMap* m, const void* key);
int64_t t_map_len(TMap* m);
void* t_map_val_ptr(TMap* m, const void* key);   // 返回存储值字节指针；未命中返回零缓冲（val_size 字节）
bool  t_map_del(TMap* m, const void* key);        // 删除键，返回是否曾存在

// 按插入序迭代（保证确定性，对应 bootstrap.md 风险项）
int64_t t_map_count(TMap* m);
TStr    t_map_key_str_at(TMap* m, int64_t i);
int64_t t_map_key_int_at(TMap* m, int64_t i);
void*   t_map_val_at(TMap* m, int64_t i);        // 第 i 个插入序键对应的值字节指针

// ── Sym：字符串驻留符号池（ECS Component 专用，M40）─────────────
// Sym32("tag") / Sym16("tag")：Component 字段仅存 u32 / u16 id；真实字符串
// 按 tag 分池存储（不定长）。同一 tag 内相同字符串去重返回同一 id。
// 生命周期为「区域释放」，无引用计数：
//   sym_release(tag)   —— 释放该 tag 整个池（真正 free 内存，其后 id 全部失效）
//   sym_release_all()  —— 释放所有池
// 池内存独立 malloc/free，不走 arena，以支持运行期真正回收；
// 一个轻量全局注册表（Symbols）按 tag 索引所有池，仅用于查找/释放，不在热路径分配。
uint32_t t_sym_intern(TStr tag, TStr str, int64_t bits);  // 驻留字符串→id（去重；bits=16/32 校验上限）
TStr     t_sym_str(TStr tag, uint32_t id);                // id→字符串（无效 id 返回空串）
void     t_sym_release(TStr tag);                         // 释放该 tag 整池
void     t_sym_release_all(void);                         // 释放所有池

// ── Atom：Erlang 式全局原子���编译期 intern 的稳定 i64 id）────────────
// atom 值在 IR 中即为 i64（id）；名字表由编译器发射到生成代码中（见 tc 的
// emit_c_atom_table / emit_ll_atom_table），此处仅作 extern 声明与还原函数。
// atom_str(id) 还原原子名（无效 id 返回空串）。
extern TStr    t_atom_table[];                            // 编译器发射：index 0 占位空串
extern int64_t t_atom_count;                              // 编译器发射：表长（含占位）
TStr     t_atom_str(int64_t id);                          // id→原子名（1-based，越界空串）

// ── 文件 I/O 与进程 ───────────────────────────────────────────
// 对应 t 语言内置：
//   file_read_all(path: string) -> string
//   file_exists(path: string) -> bool
//   file_write_all(path: string, content: string) -> bool
//   args() -> []string
//   exit(code: i32)
//   print(s: string) / eprint(s: string)
TStr    t_file_read_all(const char* path);          // 失败 → panic + exit(1)
TStr    t_getenv(const char* name);                 // getenv(name) -> string；未设置返回空串
TStr    t_read_line(void);                          // REPL：从 stdin 读一行（去 \r\n），EOF 返回空串
int     t_stdin_eof(void);                          // REPL：read_line 遇 EOF 后置位，供 stdin_eof() 查询
bool    t_file_exists(const char* path);            // file_exists(s) -> 可读性探测（fopen 试探）
bool    t_file_write_all(const char* path, TStr content); // 失败 → panic + exit(1)
TStr    t_path_resolve(const char* path);           // path_resolve(s) -> 绝对路径（_fullpath/realpath）
TSlice  t_args(void);                               // 返回 []TStr（复制进 arena）
void    t_exit(int32_t code);
void    t_print(TStr s);
void    t_eprint(TStr s);
void    t_println(TStr s);

// ── type_info(T) 编译期自省（M36）──
// TypeInfo / FieldInfo 是编译器在编译期合成的常量结构；用户通过 accessor
// 内建（ti_name / ti_field / fi_*）读取，type_info(T) 返回指向常量的指针。
typedef struct { TStr name; int64_t size; int64_t kind; int64_t field_count; TSlice fields; } TTypeInfo;
//  tag：字段 tagID（@N 显式 / 全显式时按声明序自动分配，1 基）。编译期元数据，
//       运行时零内存成本（不进 struct 内存布局，只活于此 FieldInfo 常量）。fid v2
//       字段级版本化将据此做前向兼容。
typedef struct { TStr name; int64_t offset; TStr type_name; int64_t type_size; int8_t is_ptr; int64_t tag; } TFieldInfo;

TStr        t_ti_name(TTypeInfo* ti);
int64_t     t_ti_size(TTypeInfo* ti);
int64_t     t_ti_kind(TTypeInfo* ti);
int64_t     t_ti_field_count(TTypeInfo* ti);
TFieldInfo* t_ti_field(TTypeInfo* ti, int64_t i);
TStr        t_fi_name(TFieldInfo* fi);
int64_t     t_fi_offset(TFieldInfo* fi);
TStr        t_fi_type_name(TFieldInfo* fi);
int64_t     t_fi_type_size(TFieldInfo* fi);
int8_t      t_fi_is_ptr(TFieldInfo* fi);
int64_t     t_fi_tag(TFieldInfo* fi);
int32_t t_system(TStr cmd);                         // sys_run(cmd) -> 子进程退出码
#define sys_run(cmd) t_system(cmd)                  // 兼容旧版 C 后端把 sys_run 按普通调用发射

// ── Fid：文件描述符句柄 + 序列化操作符（M51）───────────────────
// fid 在 IR 中即为 i64（句柄）。0/1/2 恒为 stdin/stdout/stderr，由运行时预置；
// 其余句柄由 t_fopen 分配。打开方式与格式在**编译期**降为小整数码（见 tc 的
// fid_code_of），运行时不做字符串比较、不依赖 atom 名表。
//   mode: 0=read 1=write 2=append 3=read_binary 4=write_binary 5=append_binary
//   kind: 0=text 1=binary
//   fmt : 0=text 1=json 2=rawbin 3=protobuf
// 格式在 t_fopen 时按 (kind, 后缀) 查注册表一次性解析并冻结进句柄记录。
int64_t t_fopen(const char* path, int32_t mode);    // 失败返回 -1（用 fid_is_open 显式检测）
void    t_fclose(int64_t f);                        // 重复关闭 / 关闭标准流 → panic
void    t_fflush(int64_t f);
int32_t t_fid_is_open(int64_t f);
// fid_error(f) -> string：查询句柄最近一次错误描述；无错误返回空串。
// f == -1（fopen 失败的哨兵值）时返回最近一次 fopen 的失败原因。
TStr    t_fid_error(int64_t f);
// fid_format(f) -> atom：运行时只持有格式码，atom id 由编译期 intern 后传入
int64_t t_fid_format(int64_t f, int64_t a_text, int64_t a_json, int64_t a_raw, int64_t a_pb);
void    t_fmt_register(int32_t kind, const char* suffix, int32_t fmt);  // 后缀挂靠（后注册覆盖先注册）
// 定位：均**不 panic**，失败写 err 供 fid_error 取因。
int32_t t_fseek(int64_t f, int64_t off);            // 成功 1 / 失败 0（负偏移、不可定位、已关闭）
int64_t t_ftell(int64_t f);                         // 当前偏移；不可定位返 -1
// fid_eof(f) -> bool：是否已到结尾或出错（读路径探针）。无效/已关闭句柄或流错误返 1；单纯 EOF 不写 fid_error。
int32_t t_fid_eof(int64_t f);

// 序列化：一律**返回目标 fid**，故 `f < a < b` 直接落成嵌套调用，无需临时量。
int64_t t_ser_int(int64_t f, int64_t v, int32_t bits, int32_t sgn);
int64_t t_ser_f64(int64_t f, double v, int32_t bits);
int64_t t_ser_bool(int64_t f, int8_t v);
int64_t t_ser_atom(int64_t f, int64_t id);
int64_t t_ser_str(int64_t f, TStr s);

// 反序列化（读路径，Option B：裸 T + fid_eof 探针）。EOF/错误返回默认值（0 / 空串），调用方用 fid_eof / fid_error 探测。
int64_t t_deser_int(int64_t f, int32_t bits, int32_t sgn);   // bits: 静态位宽；sgn: 1=有符号
double  t_deser_f64(int64_t f, int32_t bits);               // bits: 32 或 64
int8_t  t_deser_bool(int64_t f);
int64_t t_deser_atom(int64_t f);
TStr    t_deser_str(int64_t f);

// ── 诊断 panic ────────────────────────────────────────────────
// 越界等运行时非法访问：打印 JSON 诊断包后退出，供 AI Agent 消费。
void    t_panic_bounds(int64_t index, int64_t len, const char* ctx);

// ── 可选类型 ?T（可空指针模型）──────────────────────────────
// none = NULL；some(x) 在 arena 上拷贝 x 并返回其指针；unwrap(p) 做 null 检查后返回 p。
void*   t_opt_some(const void* src, int64_t sz);
void*   t_opt_unwrap(const void* p);


// ── 数学内建运行时包装（t_math_*；对应 @sin / sin 等编译期内建）──
// 仅在此处经由 t_runtime.c 间接 include <math.h>；生成的用户 .c 不会引入 libc 数学名。
// f64 名 = t_math_<base>，f32 名 = t_math_<base>f；2 元函数 arity=2。
double t_math_sin(double);
float  t_math_sinf(float);
double t_math_cos(double);
float  t_math_cosf(float);
double t_math_tan(double);
float  t_math_tanf(float);
double t_math_atan(double);
float  t_math_atanf(float);
double t_math_atan2(double, double);
float  t_math_atan2f(float, float);
double t_math_acos(double);
float  t_math_acosf(float);
double t_math_asin(double);
float  t_math_asinf(float);
double t_math_exp(double);
float  t_math_expf(float);
double t_math_log(double);
float  t_math_logf(float);
double t_math_log10(double);
float  t_math_log10f(float);
double t_math_pow(double, double);
float  t_math_powf(float, float);
double t_math_sinh(double);
float  t_math_sinhf(float);
double t_math_cosh(double);
float  t_math_coshf(float);
double t_math_tanh(double);
float  t_math_tanhf(float);
double t_math_sqrt(double);
float  t_math_sqrtf(float);
double t_math_fmod(double, double);
float  t_math_fmodf(float, float);
double t_math_fabs(double);
float  t_math_fabsf(float);
double t_math_floor(double);
float  t_math_floorf(float);
double t_math_ceil(double);
float  t_math_ceilf(float);
double t_math_trunc(double);
float  t_math_truncf(float);
double t_math_round(double);
float  t_math_roundf(float);
double t_math_exp2(double);
float  t_math_exp2f(float);
double t_math_log2(double);
float  t_math_log2f(float);
double t_math_log1p(double);
float  t_math_log1pf(float);
double t_math_expm1(double);
float  t_math_expm1f(float);
double t_math_hypot(double, double);
float  t_math_hypotf(float, float);
double t_math_cbrt(double);
float  t_math_cbrtf(float);

// ── 扩展数学内建（推荐补充集）── 与上文 54 个遵循同一包装约定（间接 include <math.h>，用户 .c 不引入 libc 数学名）
// 双目浮点→浮点：copysign / nextafter / remainder / fmin / fmax / fdim（各带 f32 变体）
double t_math_copysign(double, double);
float  t_math_copysignf(float, float);
double t_math_nextafter(double, double);
float  t_math_nextafterf(float, float);
double t_math_remainder(double, double);
float  t_math_remainderf(float, float);
double t_math_fmin(double, double);
float  t_math_fminf(float, float);
double t_math_fmax(double, double);
float  t_math_fmaxf(float, float);
double t_math_fdim(double, double);
float  t_math_fdimf(float, float);
// 三目浮点→浮点：fma（融合乘加，精确单舍入）
double t_math_fma(double, double, double);
float  t_math_fmaf(float, float, float);
// 一元浮点→整型谓词（IEEE-754 分类 / 符号位）：返回 int32（0 / 非 0）。无 f 后缀变体（C 库为类型泛型宏）
int32_t t_math_signbit(double);
int32_t t_math_isnan(double);
int32_t t_math_isinf(double);
int32_t t_math_isfinite(double);
int32_t t_math_isnormal(double);

#ifdef __cplusplus
}
#endif

#endif // T_RUNTIME_H

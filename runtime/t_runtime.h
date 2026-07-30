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
uint8_t t_str_byte_at(TStr s, int64_t i);                   // 越界 → panic + JSON 诊断
bool    t_str_eq(TStr a, TStr b);
int64_t t_str_len(TStr s);
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

// ── 切片 []T：泛型经元素宽度单态化 ─────────────────────────────
// t 语言层不暴露 void*；类型安全由 tc 类型检查器在编译期保证。
// emitter 规则：tokens[i] → *(Token*)t_slice_at(tokens, i)
//              append(tokens, tok) → t_slice_append(&tokens, &tok)
// 所有分配经全局 g_arena（由 t_runtime_set_arena 在 main 入口注入），函数体无需透传 arena。
typedef struct { void* ptr; int64_t len; int64_t cap; int64_t elem_size; } TSlice;

TSlice t_slice_new(int64_t elem_size);
void   t_slice_append(TSlice* s, const void* elem);
void   t_slice_append_sized(TSlice* s, const void* elem, int64_t elem_size);
void*  t_slice_at(TSlice s, int64_t i);        // 越界 → panic + JSON 诊断；返回元素地址
void   t_slice_set(TSlice s, int64_t i, const void* elem); // 越界 → panic
int64_t t_slice_len(TSlice s);
void*  t_slice_ptr(TSlice s);                  // 底层数组首地址（供 memset/序列化）

// ── map[K]V：开放寻址，K 限定 string / 整数 ───────────────────
// key_kind: 0 = TStr, 1 = int64
typedef struct TMap TMap;

TMap* t_map_new(TArena* a, int64_t key_kind, int64_t val_size);
bool  t_map_get(TMap* m, const void* key, void* out_val);   // key: TStr* 或 int64*
void  t_map_put(TMap* m, const void* key, const void* val);
bool  t_map_has(TMap* m, const void* key);
int64_t t_map_len(TMap* m);

// 按插入序迭代（保证确定性，对应 bootstrap.md 风险项）
int64_t t_map_count(TMap* m);
TStr    t_map_key_str_at(TMap* m, int64_t i);
int64_t t_map_key_int_at(TMap* m, int64_t i);

// ── 文件 I/O 与进程 ───────────────────────────────────────────
// 对应 t 语言内置：
//   file_read_all(path: string) -> string
//   file_exists(path: string) -> bool
//   file_write_all(path: string, content: string) -> bool
//   args() -> []string
//   exit(code: i32)
//   print(s: string) / eprint(s: string)
TStr    t_file_read_all(const char* path);          // 失败 → panic + exit(1)
bool    t_file_exists(const char* path);            // file_exists(s) -> 可读性探测（fopen 试探）
bool    t_file_write_all(const char* path, TStr content); // 失败 → panic + exit(1)
TStr    t_path_resolve(const char* path);           // path_resolve(s) -> 绝对路径（_fullpath/realpath）
TSlice  t_args(void);                               // 返回 []TStr（复制进 arena）
void    t_exit(int32_t code);
void    t_print(TStr s);
void    t_eprint(TStr s);
int32_t t_system(TStr cmd);                         // sys_run(cmd) -> 子进程退出码
#define sys_run(cmd) t_system(cmd)                  // 兼容旧版 C 后端把 sys_run 按普通调用发射

// ── 诊断 panic ────────────────────────────────────────────────
// 越界等运行时非法访问：打印 JSON 诊断包后退出，供 AI Agent 消费。
void    t_panic_bounds(int64_t index, int64_t len, const char* ctx);

#ifdef __cplusplus
}
#endif

#endif // T_RUNTIME_H

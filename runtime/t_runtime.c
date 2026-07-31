// ═══════════════════════════════════════════════════════════════
// t_runtime.c — t 语言 C 后端运行时库实现 (bootstrap M1)
// 纯 C99，无第三方依赖。详见 t_runtime.h 头部说明。
// ═══════════════════════════════════════════════════════════════

#define _CRT_SECURE_NO_WARNINGS
#include "t_runtime.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

// 全局 arena：编译器单 arena 策略，由 t_runtime_set_arena 在 main 入口注入。
static TArena* g_arena = NULL;

// ── 内部工具 ───────────────────────────────────────────────────
static void t_fatal(const char* msg) {
    fprintf(stderr, "{\"error\":\"runtime_fatal\",\"message\":\"%s\"}\n", msg);
    exit(1);
}

void t_panic_bounds(int64_t index, int64_t len, const char* ctx) {
    fprintf(stderr,
        "{\"error\":\"index_out_of_bounds\",\"context\":\"%s\","
        "\"index\":%lld,\"length\":%lld}\n",
        ctx ? ctx : "", (long long)index, (long long)len);
    exit(1);
}

// ── Arena 分配器 ───────────────────────────────────────────────
struct TArena {
    uint8_t* base;
    size_t   size;
    size_t   used;
};

TArena* t_arena_new(void) {
    TArena* a = (TArena*)malloc(sizeof(TArena));
    if (!a) t_fatal("arena: malloc failed");
    a->size = 512 * 1024 * 1024; // 512 MB：自举编译 12k+ 行（含 XID 表）需要更大 arena
    a->base = (uint8_t*)malloc(a->size);
    if (!a->base) t_fatal("arena: base malloc failed");
    a->used = 0;
    return a;
}

void* t_arena_alloc(TArena* a, size_t size) {
    // 16 字节对齐
    size_t aligned = (size + 15) & ~(size_t)15;
    if (a->used + aligned > a->size) t_fatal("arena: out of memory");
    void* p = a->base + a->used;
    a->used += aligned;
    return p;
}

void t_arena_free_all(TArena* a) {
    if (a) { a->used = 0; } // 进程退出时 OS 回收 base
}

void t_runtime_done(void) {
    if (g_arena) { t_arena_free_all(g_arena); }
}

// ── string ────────────────────────────────────────────────────
TStr t_str_from_c(const char* s) {
    TStr r; r.ptr = (const uint8_t*)s; r.len = (int64_t)strlen(s); return r;
}

TStr t_str_slice(TStr s, int64_t start, int64_t end) {
    if (start < 0 || end < start || end > s.len)
        t_panic_bounds(start < 0 ? start : end, s.len, "t_str_slice");
    TStr r; r.ptr = s.ptr + start; r.len = end - start; return r;
}

uint8_t t_str_byte_at(TStr s, int64_t i) {
    if (i < 0 || i >= s.len) t_panic_bounds(i, s.len, "t_str_byte_at");
    return s.ptr[i];
}

bool t_str_eq(TStr a, TStr b) {
    if (a.len != b.len) return false;
    if (a.len == 0) return true;
    return memcmp(a.ptr, b.ptr, (size_t)a.len) == 0;
}

int64_t t_str_len(TStr s) { return s.len; }

char* t_cstr(TStr s) {
    if (g_arena == NULL) t_fatal("t_cstr: arena not initialized");
    char* p = (char*)t_arena_alloc(g_arena, (size_t)(s.len + 1));
    if (s.len > 0) memcpy(p, s.ptr, (size_t)s.len);
    p[s.len] = '\0';
    return p;
}

// ── StringBuilder ─────────────────────────────────────────────
TSb* t_sb_new(TArena* a) {
    TSb* b = (TSb*)t_arena_alloc(a, sizeof(TSb));
    b->arena = a;
    b->len = 0;
    b->cap = 0;
    b->buf = NULL;
    return b;
}

static void sb_reserve(TSb* b, int64_t need) {
    if (b->cap >= need) return;
    int64_t ncap = b->cap < 16 ? 16 : b->cap * 2;
    while (ncap < need) ncap *= 2;
    uint8_t* nb = (uint8_t*)t_arena_alloc(b->arena, (size_t)ncap);
    if (b->len > 0) memcpy(nb, b->buf, (size_t)b->len);
    b->buf = nb;
    b->cap = ncap;
}

void t_sb_append_str(TSb* b, TStr s) {
    sb_reserve(b, b->len + s.len);
    if (s.len > 0) memcpy(b->buf + b->len, s.ptr, (size_t)s.len);
    b->len += s.len;
}

void t_sb_append_cstr(TSb* b, const char* s) {
    t_sb_append_str(b, t_str_from_c(s));
}

void t_sb_append_char(TSb* b, uint8_t c) {
    sb_reserve(b, b->len + 1);
    b->buf[b->len++] = c;
}

void t_sb_append_u64(TSb* b, uint64_t v) {
    char tmp[24]; int n = 0;
    if (v == 0) { tmp[n++] = '0'; }
    else { while (v) { tmp[n++] = (char)('0' + (v % 10)); v /= 10; } }
    for (int i = n - 1; i >= 0; i--) t_sb_append_char(b, (uint8_t)tmp[i]);
}

void t_sb_append_i64(TSb* b, int64_t v) {
    if (v < 0) { t_sb_append_char(b, '-'); v = -v; }
    t_sb_append_u64(b, (uint64_t)v);
}

TStr t_sb_to_str(TSb* b) {
    // 复制到 arena：string 在 t 中不可变，调用方持有的结果不能被后续
    // sb_clear + append 破坏（src lexer 复用 tmp builder 的关键前提）。
    uint8_t* copy = (uint8_t*)t_arena_alloc(b->arena, (size_t)b->len + 1);
    if (b->len > 0) memcpy(copy, b->buf, (size_t)b->len);
    copy[b->len] = '\0';
    TStr r; r.ptr = copy; r.len = b->len; return r;
}

void t_sb_clear(TSb* b) { b->len = 0; }

// int_to_str(v: i64) -> string —— 十进制文本（负数带前导 '-'）。
// 走 arena，语义与 sb_new + sb_append_i64 + sb_to_str 完全一致。
TStr t_int_to_str(int64_t v) {
    TSb* b = t_sb_new(t_arena_current());
    t_sb_append_i64(b, v);
    return t_sb_to_str(b);
}

// ── 字符串拼接 cat2..cat6(a, b, ...) -> string ──────────────────
// 各实参均为 string（TStr）。需要拼接非字符串类型时，先 int_to_str/...
// 注意：返回值是 arena 中副本，调用方持有的 TStr 不会因后续 arena 写入而失效。
TStr t_cat2(TStr a, TStr b) {
    TSb* b_ = t_sb_new(t_arena_current());
    t_sb_append_str(b_, a);
    t_sb_append_str(b_, b);
    return t_sb_to_str(b_);
}
TStr t_cat3(TStr a, TStr b, TStr c) {
    TSb* b_ = t_sb_new(t_arena_current());
    t_sb_append_str(b_, a);
    t_sb_append_str(b_, b);
    t_sb_append_str(b_, c);
    return t_sb_to_str(b_);
}
TStr t_cat4(TStr a, TStr b, TStr c, TStr d) {
    TSb* b_ = t_sb_new(t_arena_current());
    t_sb_append_str(b_, a);
    t_sb_append_str(b_, b);
    t_sb_append_str(b_, c);
    t_sb_append_str(b_, d);
    return t_sb_to_str(b_);
}
TStr t_cat5(TStr a, TStr b, TStr c, TStr d, TStr e) {
    TSb* b_ = t_sb_new(t_arena_current());
    t_sb_append_str(b_, a);
    t_sb_append_str(b_, b);
    t_sb_append_str(b_, c);
    t_sb_append_str(b_, d);
    t_sb_append_str(b_, e);
    return t_sb_to_str(b_);
}
TStr t_cat6(TStr a, TStr b, TStr c, TStr d, TStr e, TStr f) {
    TSb* b_ = t_sb_new(t_arena_current());
    t_sb_append_str(b_, a);
    t_sb_append_str(b_, b);
    t_sb_append_str(b_, c);
    t_sb_append_str(b_, d);
    t_sb_append_str(b_, e);
    t_sb_append_str(b_, f);
    return t_sb_to_str(b_);
}

// ── 切片 []T ──────────────────────────────────────────────────
TSlice t_slice_new(int64_t elem_size) {
    TSlice s;
    s.elem_size = elem_size;
    s.len = 0;
    s.cap = 0;
    s.ptr = NULL;
    return s;
}

void t_runtime_set_arena(TArena* a) { g_arena = a; }
TArena* t_arena_current(void) { return g_arena; }

static void slice_grow(TSlice* s) {
    if (g_arena == NULL) t_fatal("t_slice: arena not initialized");
    int64_t ncap = s->cap < 4 ? 4 : s->cap * 2;
    void* np = t_arena_alloc(g_arena, (size_t)(ncap * s->elem_size));
    if (s->len > 0 && s->ptr) memcpy(np, s->ptr, (size_t)(s->len * s->elem_size));
    s->ptr = np;
    s->cap = ncap;
}

void t_slice_append(TSlice* s, const void* elem) {
    if (g_arena == NULL) t_fatal("t_slice: arena not initialized");
    if (s->len >= s->cap) slice_grow(s);
    memcpy((uint8_t*)s->ptr + s->len * s->elem_size, elem, (size_t)s->elem_size);
    s->len++;
}

// 与 t_slice_append 相同，但携带元素大小：允许零初始化的全局切片
// （elem_size==0）在首次 append 时自动定型。codegen 统一走这个入口。
void t_slice_append_sized(TSlice* s, const void* elem, int64_t elem_size) {
    if (s->elem_size == 0) s->elem_size = elem_size;
    t_slice_append(s, elem);
}

void* t_slice_at(TSlice s, int64_t i) {
    if (i < 0 || i >= s.len) t_panic_bounds(i, s.len, "t_slice_at");
    return (uint8_t*)s.ptr + i * s.elem_size;
}

void t_slice_set(TSlice s, int64_t i, const void* elem) {
    if (i < 0 || i >= s.len) t_panic_bounds(i, s.len, "t_slice_set");
    memcpy((uint8_t*)s.ptr + i * s.elem_size, elem, (size_t)s.elem_size);
}

int64_t t_slice_len(TSlice s) { return s.len; }
void*  t_slice_ptr(TSlice s) { return s.ptr; }

// ── map[K]V ──────────────────────────────────────────────────
typedef struct {
    uint8_t state;        // 0 empty, 1 occupied, 2 tombstone
    TStr    key_str;
    int64_t key_int;
    void*   value;
} TMapSlot;

struct TMap {
    TArena* a;
    int64_t key_kind;     // 0 = TStr, 1 = int64
    int64_t val_size;
    TMapSlot* slots;
    int64_t  cap;         // 2 的幂
    int64_t  used;        // 含 tombstone 的占用槽数
    int64_t  count;       // 实际键值对数
    TStr*    order_str;   // 插入序（string key）
    int64_t  order_str_len, order_str_cap;
    int64_t* order_int;   // 插入序（int key）
    int64_t  order_int_len, order_int_cap;
};

static uint64_t map_hash_str(TStr s) {
    uint64_t h = 1469598103934665603ULL;
    for (int64_t i = 0; i < s.len; i++) { h ^= s.ptr[i]; h *= 1099511628211ULL; }
    return h;
}
static uint64_t map_hash_int(int64_t k) {
    uint64_t h = 1469598103934665603ULL;
    uint8_t b[8];
    for (int i = 0; i < 8; i++) b[i] = (uint8_t)(k >> (i * 8));
    for (int i = 0; i < 8; i++) { h ^= b[i]; h *= 1099511628211ULL; }
    return h;
}

TMap* t_map_new(TArena* a, int64_t key_kind, int64_t val_size) {
    TMap* m = (TMap*)t_arena_alloc(a, sizeof(TMap));
    m->a = a;
    m->key_kind = key_kind;
    m->val_size = val_size < 1 ? 1 : val_size;
    m->cap = 16;
    m->used = 0;
    m->count = 0;
    m->slots = (TMapSlot*)t_arena_alloc(a, sizeof(TMapSlot) * (size_t)m->cap);
    for (int64_t i = 0; i < m->cap; i++) m->slots[i].state = 0;
    m->order_str = NULL; m->order_str_len = 0; m->order_str_cap = 0;
    m->order_int = NULL; m->order_int_len = 0; m->order_int_cap = 0;
    return m;
}

static int64_t map_probe(TMap* m, uint64_t h) { return (int64_t)(h & (uint64_t)(m->cap - 1)); }

static void map_rehash(TMap* m) {
    int64_t oldcap = m->cap;
    TMapSlot* old = m->slots;
    m->cap *= 2;
    m->slots = (TMapSlot*)t_arena_alloc(m->a, sizeof(TMapSlot) * (size_t)m->cap);
    for (int64_t i = 0; i < m->cap; i++) m->slots[i].state = 0;
    m->used = 0;
    for (int64_t i = 0; i < oldcap; i++) {
        if (old[i].state == 1) {
            int64_t idx = map_probe(m, m->key_kind == 0 ? map_hash_str(old[i].key_str) : map_hash_int(old[i].key_int));
            while (m->slots[idx].state == 1) idx = (idx + 1) & (m->cap - 1);
            m->slots[idx] = old[i];
            m->used++;
        }
    }
}

void t_map_put(TMap* m, const void* key, const void* val) {
    if (g_arena == NULL) g_arena = m->a;
    uint64_t h = (m->key_kind == 0)
        ? map_hash_str(*(const TStr*)key)
        : map_hash_int(*(const int64_t*)key);
    int64_t idx = map_probe(m, h);
    // 是否已存在
    int64_t first_tomb = -1;
    int64_t i = idx;
    while (m->slots[i].state != 0) {
        bool match = false;
        if (m->key_kind == 0 && m->slots[i].state == 1)
            match = t_str_eq(m->slots[i].key_str, *(const TStr*)key);
        else if (m->key_kind == 1 && m->slots[i].state == 1)
            match = (m->slots[i].key_int == *(const int64_t*)key);
        if (match) {
            void* vb = t_arena_alloc(m->a, (size_t)m->val_size);
            memcpy(vb, val, (size_t)m->val_size);
            m->slots[i].value = vb;
            return;
        }
        if (m->slots[i].state == 2 && first_tomb < 0) first_tomb = i;
        i = (i + 1) & (m->cap - 1);
        if (i == idx) break; // 满（理论不会，因有 rehash）
    }
    int64_t target = (first_tomb >= 0) ? first_tomb : idx;
    while (m->slots[target].state == 1) target = (target + 1) & (m->cap - 1);

    m->slots[target].state = 1;
    if (m->key_kind == 0) {
        m->slots[target].key_str = *(const TStr*)key;
        // 记录插入序
        if (m->order_str_len >= m->order_str_cap) {
            int64_t nc = m->order_str_cap < 4 ? 4 : m->order_str_cap * 2;
            TStr* no = (TStr*)t_arena_alloc(m->a, sizeof(TStr) * (size_t)nc);
            if (m->order_str_len > 0) memcpy(no, m->order_str, sizeof(TStr) * (size_t)m->order_str_len);
            m->order_str = no; m->order_str_cap = nc;
        }
        m->order_str[m->order_str_len++] = *(const TStr*)key;
    } else {
        m->slots[target].key_int = *(const int64_t*)key;
        if (m->order_int_len >= m->order_int_cap) {
            int64_t nc = m->order_int_cap < 4 ? 4 : m->order_int_cap * 2;
            int64_t* no = (int64_t*)t_arena_alloc(m->a, sizeof(int64_t) * (size_t)nc);
            if (m->order_int_len > 0) memcpy(no, m->order_int, sizeof(int64_t) * (size_t)m->order_int_len);
            m->order_int = no; m->order_int_cap = nc;
        }
        m->order_int[m->order_int_len++] = *(const int64_t*)key;
    }
    void* vb = t_arena_alloc(m->a, (size_t)m->val_size);
    memcpy(vb, val, (size_t)m->val_size);
    m->slots[target].value = vb;
    m->used++;
    m->count++;

    if (m->used * 10 >= m->cap * 7 && m->cap < (1LL << 40)) map_rehash(m);
}

static int64_t map_find_slot(TMap* m, const void* key) {
    if (m->key_kind == 0) {
        uint64_t h = map_hash_str(*(const TStr*)key);
        int64_t i = map_probe(m, h);
        while (m->slots[i].state != 0) {
            if (m->slots[i].state == 1 && t_str_eq(m->slots[i].key_str, *(const TStr*)key)) return i;
            i = (i + 1) & (m->cap - 1);
        }
    } else {
        uint64_t h = map_hash_int(*(const int64_t*)key);
        int64_t i = map_probe(m, h);
        while (m->slots[i].state != 0) {
            if (m->slots[i].state == 1 && m->slots[i].key_int == *(const int64_t*)key) return i;
            i = (i + 1) & (m->cap - 1);
        }
    }
    return -1;
}

bool t_map_get(TMap* m, const void* key, void* out_val) {
    int64_t i = map_find_slot(m, key);
    if (i < 0) return false;
    memcpy(out_val, m->slots[i].value, (size_t)m->val_size);
    return true;
}

bool t_map_has(TMap* m, const void* key) {
    return map_find_slot(m, key) >= 0;
}

void* t_map_val_ptr(TMap* m, const void* key) {
    int64_t i = map_find_slot(m, key);
    if (i >= 0) return m->slots[i].value;
    void* z = t_arena_alloc(m->a, (size_t)m->val_size);
    memset(z, 0, (size_t)m->val_size);
    return z;
}

bool t_map_del(TMap* m, const void* key) {
    int64_t i = map_find_slot(m, key);
    if (i < 0) return false;
    m->slots[i].state = 2;  // tombstone
    m->count--;
    if (m->key_kind == 0) {
        for (int64_t o = 0; o < m->order_str_len; o++) {
            if (t_str_eq(m->order_str[o], *(const TStr*)key)) {
                memmove(&m->order_str[o], &m->order_str[o + 1], sizeof(TStr) * (size_t)(m->order_str_len - o - 1));
                m->order_str_len--;
                break;
            }
        }
    } else {
        for (int64_t o = 0; o < m->order_int_len; o++) {
            if (m->order_int[o] == *(const int64_t*)key) {
                memmove(&m->order_int[o], &m->order_int[o + 1], sizeof(int64_t) * (size_t)(m->order_int_len - o - 1));
                m->order_int_len--;
                break;
            }
        }
    }
    return true;
}

int64_t t_map_len(TMap* m)  { return m->count; }
int64_t t_map_count(TMap* m) { return m->count; }

TStr    t_map_key_str_at(TMap* m, int64_t i) { return m->order_str[i]; }
int64_t t_map_key_int_at(TMap* m, int64_t i) { return m->order_int[i]; }

// 第 i 个插入序键对应的值字节指针（越界或键已删返回零缓冲，语义与 t_map_val_ptr 一致）
void* t_map_val_at(TMap* m, int64_t i) {
    if (i < 0 || i >= m->count) {
        void* z = t_arena_alloc(m->a, (size_t)m->val_size);
        memset(z, 0, (size_t)m->val_size);
        return z;
    }
    if (m->key_kind == 0) return t_map_val_ptr(m, &m->order_str[i]);
    return t_map_val_ptr(m, &m->order_int[i]);
}

// ── 文件 I/O 与进程 ───────────────────────────────────────────
TStr t_file_read_all(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "{\"error\":\"io\",\"op\":\"read\",\"path\":\"%s\"}\n", path); exit(1); }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    if (sz < 0) { fclose(f); t_fatal("file_read_all: ftell failed"); }
    fseek(f, 0, SEEK_SET);
    uint8_t* buf = (uint8_t*)malloc((size_t)sz + 1);
    if (!buf) { fclose(f); t_fatal("file_read_all: malloc failed"); }
    size_t rd = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    if ((long)rd != sz) { free(buf); t_fatal("file_read_all: read mismatch"); }
    buf[sz] = '\0'; // 便于当作 cstr 使用
    TStr r; r.ptr = buf; r.len = (int64_t)sz; return r; // 注意：此处用 malloc，由调用方持有至进程结束
}

TStr t_path_resolve(const char* path) {
    char buf[4096];
#ifdef _WIN32
    if (_fullpath(buf, path, sizeof(buf)) == NULL) t_fatal("path_resolve: _fullpath failed");
#else
    if (realpath(path, buf) == NULL) t_fatal("path_resolve: realpath failed");
#endif
    size_t n = strlen(buf);
    uint8_t* p = (uint8_t*)t_arena_alloc(g_arena, n + 1);
    memcpy(p, buf, n + 1);
    TStr r; r.ptr = p; r.len = (int64_t)n; return r;
}

bool t_file_exists(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) return false;
    fclose(f);
    return true;
}

bool t_file_write_all(const char* path, TStr content) {
    FILE* f = fopen(path, "wb");
    if (!f) { fprintf(stderr, "{\"error\":\"io\",\"op\":\"write\",\"path\":\"%s\"}\n", path); exit(1); }
    size_t w = fwrite(content.ptr, 1, (size_t)content.len, f);
    fclose(f);
    if (w != (size_t)content.len) t_fatal("file_write_all: write mismatch");
    return true;
}

// 进程参数：由 t_runtime_init 在生成的 main 入口处注入。
static int   g_argc = 0;
static char** g_argv = NULL;
void t_runtime_init(int argc, char** argv) {
    g_argc = argc; g_argv = argv;
#ifdef _WIN32
    // stdout/stderr 切二进制模式：禁止 \n → \r\n 翻译。
    // 自举确定性要求：src 工具输出必须与 tc0 (Node) 逐字节一致。
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
}

TSlice t_args(void) {
    TSlice s = t_slice_new((int64_t)sizeof(TStr));
    for (int i = 0; i < g_argc; i++) {
        TStr arg = t_str_from_c(g_argv[i]);
        t_slice_append(&s, &arg);
    }
    return s;
}

void t_exit(int32_t code) { exit(code); }

void t_print(TStr s)  { if (s.len > 0) fwrite(s.ptr, 1, (size_t)s.len, stdout);  fflush(stdout); }
void t_eprint(TStr s) { if (s.len > 0) fwrite(s.ptr, 1, (size_t)s.len, stderr);  fflush(stderr); }
void t_println(TStr s){ if (s.len > 0) fwrite(s.ptr, 1, (size_t)s.len, stdout); fputc('\n', stdout); fflush(stdout); }

// ── type_info(T) accessor 内建（M36）──
TStr        t_ti_name(TTypeInfo* ti)        { return ti->name; }
int64_t     t_ti_size(TTypeInfo* ti)        { return ti->size; }
int64_t     t_ti_kind(TTypeInfo* ti)        { return ti->kind; }
int64_t     t_ti_field_count(TTypeInfo* ti) { return ti->field_count; }
TFieldInfo* t_ti_field(TTypeInfo* ti, int64_t i) {
    return (TFieldInfo*)ti->fields.ptr + i;
}
TStr        t_fi_name(TFieldInfo* fi)        { return fi->name; }
int64_t     t_fi_offset(TFieldInfo* fi)      { return fi->offset; }
TStr        t_fi_type_name(TFieldInfo* fi)   { return fi->type_name; }
int64_t     t_fi_type_size(TFieldInfo* fi)   { return fi->type_size; }
int8_t      t_fi_is_ptr(TFieldInfo* fi)      { return fi->is_ptr; }

// sys_run(cmd)：执行外部命令，返回退出码。
// Windows cmd.exe 引号剥离怪癖：整串命令以引号开头时需再包一层。
int32_t t_system(TStr cmd) {
    const char* c = t_cstr(cmd);
#ifdef _WIN32
    if (cmd.len > 0 && c[0] == '"') {
        size_t n = strlen(c);
        char* wrapped = (char*)t_arena_alloc(t_arena_current(), n + 3);
        wrapped[0] = '"';
        memcpy(wrapped + 1, c, n);
        wrapped[n + 1] = '"';
        wrapped[n + 2] = 0;
        c = wrapped;
    }
#endif
    int r = system(c);
    return (int32_t)r;
}

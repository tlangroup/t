// ═══════════════════════════════════════════════════════════════
// t_runtime.c — t 语言 C 后端运行时库实现 (bootstrap M1)
// 纯 C99，无第三方依赖。详见 t_runtime.h 头部说明。
// ═══════════════════════════════════════════════════════════════

#define _CRT_SECURE_NO_WARNINGS
#include "t_runtime.h"
// mimalloc：t 运行时的通用堆分配器（t_alloc / t_free 与 arena 底层大块）。
// ⚠ 只在运行时实现里引入，t_runtime.h 保持「零第三方头」，生成的 .c 不受影响。
#include <mimalloc.h>
#ifdef _WIN32
// mimalloc 的 Windows 大页路径用到 advapi32（OpenProcessToken / LookupPrivilegeValueA /
// AdjustTokenPrivileges）。把这条依赖写进本 .obj 的 .drectve 段，下游链接自动携带，
// 不必逐个改链接命令（LLVM 后端的 clang 链接、C 后端 clang 链接、门禁脚本各自一份）。
#pragma comment(lib, "advapi32.lib")
#endif
// imath：任意精度整数（大整数格式化）；imath 自身的 malloc/realloc/free 在编译期
// 被 -D 重定向到 mimalloc（见 tools/build_runtime.mjs），全运行时只有一套分配器。
#include "imath/imath.h"
// Ryu：double → 字符串（最短 / 定点 / 科学计数），替代 printf 的浮点格式化路径。
#include "ryu/ryu.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <ctype.h>
#include <time.h>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#include <intrin.h>
#include <windows.h>
#endif

// 全局 arena：编译器单 arena 策略，由 t_runtime_set_arena 在 main 入口注入。
static TArena* g_arena = NULL;

// REPL 交互输入（M-REPL）：read_line 遇 EOF 后置位，供 stdin_eof() 查询。
static int g_stdin_eof = 0;

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

// ── 可选类型 ?T（可空指针模型）──────────────────────────────
// none = NULL；some(x) 在 arena 上拷贝 x 并返回其指针；unwrap(p) 在 p==NULL 时 panic。
void* t_opt_some(const void* src, int64_t sz) {
    void* p = t_arena_alloc(g_arena, (size_t)sz);
    memcpy(p, src, (size_t)sz);
    return p;
}

void* t_opt_unwrap(const void* p) {
    if (p == NULL) {
        fprintf(stderr,
            "{\"error\":\"unwrap_none\",\"message\":\"unwrap of `none` value\"}\n");
        exit(1);
    }
    return (void*)p;
}

// ── Arena 分配器 ───────────────────────────────────────────────
struct TArena {
    uint8_t* base;
    size_t   size;       // 预留虚拟空间容量
    size_t   used;       // 已分配（含对齐）字节数
    size_t   committed;  // 已提交物理页的字节数（仅 Windows 预留模式使用）
};

TArena* t_arena_new(void) {
    TArena* a = (TArena*)mi_malloc(sizeof(TArena));
    if (!a) t_fatal("arena: malloc failed");
#ifdef _WIN32
    // 预留大虚拟空间（不占物理内存），tir 降低超大模块（如完整 tc.tc）时按需提交。
    // 单一连续虚拟区域保证 a->base + a->used 指针语义与旧 malloc 实现一致。
    a->size = (size_t)16 * 1024 * 1024 * 1024; // 16 GB 虚拟预留（仅占地址空间，无物理成本）
    a->base = (uint8_t*)VirtualAlloc(NULL, a->size, MEM_RESERVE, PAGE_READWRITE);
    if (!a->base) t_fatal("arena: virtual reserve failed");
    a->committed = 0;
#else
    // POSIX 等：保持原单一大块预提交行为（自举在 Windows 上完成）；大块走 mimalloc。
    // ⚠ arena 本身仍是 bump 分配器（不支持单块回收），mimalloc 只作为底层大块来源，
    //   并非 arena 的替代品——两者语义不同，不可互换。
    a->size = 512 * 1024 * 1024;
    a->base = (uint8_t*)mi_malloc(a->size);
    if (!a->base) t_fatal("arena: base malloc failed");
    a->committed = a->size;
#endif
    a->used = 0;
    return a;
}

void* t_arena_alloc(TArena* a, size_t size) {
    // 16 字节对齐
    size_t aligned = (size + 15) & ~(size_t)15;
    if (a->used + aligned > a->size) t_fatal("arena: out of memory");
#ifdef _WIN32
    // 按需提交：仅把真正用到的区间从预留转为物理页（64KB 分配粒度对齐）
    if (a->used + aligned > a->committed) {
        size_t need = (a->used + aligned) - a->committed;
        size_t gran = (size_t)64 * 1024;
        size_t commit = (need + gran - 1) & ~(gran - 1);
        void* r = VirtualAlloc(a->base + a->committed, commit, MEM_COMMIT, PAGE_READWRITE);
        if (!r) t_fatal("arena: commit failed");
        a->committed += commit;
    }
#endif
    void* p = a->base + a->used;
    a->used += aligned;
    return p;
}

void t_arena_free_all(TArena* a) {
    if (a) {
        a->used = 0;
#ifdef _WIN32
        a->committed = 0; // 物理页留待进程退出由 OS 回收；下次分配从预留基址重新提交
#endif
    }
}

// ── 通用堆分配（闭包 env / TClosure record）── 走 mimalloc
void* t_alloc(size_t size) {
    void* p = mi_malloc(size);
    if (!p) t_fatal("t_alloc: malloc failed");
    return p;
}

void t_free(void* p) {
    if (p) mi_free(p);
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

// 字符串拼接：在全局 arena 上分配 len_a+len_b+1 字节，拷贝两端，补 \0（UTF-8 视图）。
TStr t_str_concat(TStr a, TStr b) {
    int64_t n = a.len + b.len;
    uint8_t* buf = (uint8_t*)t_arena_alloc(t_arena_current(), (size_t)(n + 1));
    if (a.len > 0) { memcpy(buf, a.ptr, (size_t)a.len); }
    if (b.len > 0) { memcpy(buf + a.len, b.ptr, (size_t)b.len); }
    buf[n] = 0;
    TStr r; r.ptr = buf; r.len = n; return r;
}

// ── 位串 bitstr（§15）─────────────────────────────────────────
TBitStr t_bitstr_new(int64_t bit_len) {
    // 创建**空**容器：分配足以容纳 bit_len 位的字节，初始 bit_len=0。
    // 语义调用方（字面量用 t_bitstr_append_val 逐段填充；t_bitstr_concat 显式写 bit_len）
    // 都从 0 开始累积，避免「new 已填 + append 再叠」造成的越界（§15）。
    int64_t bytes = (bit_len + 7) / 8;
    uint8_t* buf = (uint8_t*)t_arena_alloc(t_arena_current(), (size_t)bytes);
    if (bytes > 0) { memset(buf, 0, (size_t)bytes); }
    TBitStr r; r.ptr = buf; r.bit_len = 0; r.cap = bytes; return r;
}

TBitStr t_bitstr_concat(TBitStr a, TBitStr b) {
    int64_t total = a.bit_len + b.bit_len;
    TBitStr r = t_bitstr_new(total);
    for (int64_t i = 0; i < a.bit_len; i++) {
        int bit = (a.ptr[i / 8] >> (7 - (i % 8))) & 1;
        if (bit) { r.ptr[i / 8] |= (uint8_t)(1 << (7 - (i % 8))); }
    }
    for (int64_t i = 0; i < b.bit_len; i++) {
        int64_t dst = a.bit_len + i;
        int bit = (b.ptr[i / 8] >> (7 - (i % 8))) & 1;
        if (bit) { r.ptr[dst / 8] |= (uint8_t)(1 << (7 - (dst % 8))); }
    }
    r.bit_len = total;
    return r;
}

void t_bitstr_append_val(TBitStr* dst, uint64_t val, int64_t bits, int little) {
    int64_t cur = dst->bit_len;
    for (int64_t i = 0; i < bits; i++) {
        int64_t srcbit = little ? i : (bits - 1 - i);
        int bit = (int)((val >> srcbit) & 1);
        int64_t pos = cur + i;
        if (bit) { dst->ptr[pos / 8] |= (uint8_t)(1 << (7 - (pos % 8))); }
        else { dst->ptr[pos / 8] &= (uint8_t)~(1 << (7 - (pos % 8))); }
    }
    dst->bit_len = cur + bits;
}

void t_bitstr_append_bitstr(TBitStr* dst, TBitStr src) {
    for (int64_t i = 0; i < src.bit_len; i++) {
        int bit = (src.ptr[i / 8] >> (7 - (i % 8))) & 1;
        int64_t pos = dst->bit_len + i;
        if (bit) { dst->ptr[pos / 8] |= (uint8_t)(1 << (7 - (pos % 8))); }
    }
    dst->bit_len += src.bit_len;
}

int64_t t_bitstr_bitlen(TBitStr s) { return s.bit_len; }

uint64_t t_bitstr_extract(TBitStr s, int64_t bit_off, int64_t bits, int little) {
    uint64_t v = 0;
    for (int64_t i = 0; i < bits; i++) {
        int64_t srcbit = little ? i : (bits - 1 - i);
        int64_t logical = bit_off + i;
        int bit = (s.ptr[logical / 8] >> (7 - (logical % 8))) & 1;
        v |= ((uint64_t)bit) << (uint64_t)srcbit;
    }
    return v;
}

TBitStr t_bitstr_sub(TBitStr s, int64_t bit_off) {
    int64_t total = s.bit_len - bit_off;
    if (total < 0) { total = 0; }
    TBitStr r = t_bitstr_new(total);
    for (int64_t i = 0; i < total; i++) {
        int bit = (s.ptr[(bit_off + i) / 8] >> (7 - ((bit_off + i) % 8))) & 1;
        if (bit) { r.ptr[i / 8] |= (uint8_t)(1 << (7 - (i % 8))); }
    }
    r.bit_len = total;
    return r;
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

// sb_free：TSb 与其 buf 都由 arena 拥有，不可单独释放，故 no-op。
void t_sb_free(TSb* b) { (void)b; }

// int_to_str(v: i64) -> string —— 十进制文本（负数带前导 '-'）。
// 走 arena，语义与 sb_new + sb_append_i64 + sb_to_str 完全一致。
TStr t_int_to_str(int64_t v) {
    TSb* b = t_sb_new(t_arena_current());
    t_sb_append_i64(b, v);
    return t_sb_to_str(b);
}

// ── format-spec mini-language（Python 子集）──────────────────────────────
// 语法: [[fill]align][sign][#][0][width][grouping][.precision][type]
//   align   : '<' '>' '=' '^'
//   sign    : '+' '-' ' '
//   '#'     : 替代形式（0b/0o/0x 前缀、浮点强制小数点）
//   '0'     : 零填充（等价于 fill='0' align='='）
//   width   : 十进制整数
//   grouping: ','（十进制千分位）或 '_'（b/o/x 每 4 位、d 每 3 位）
//   precision: '.' 后的整数
//   type    : 'b' 'c' 'd' 'e' 'E' 'f' 'F' 'g' 'G' 'n' 'o' 's' 'x' 'X' '%'
// spec 可带 "{}" / ":" 外壳（如 "{:>10}"），解析时自动剥除。

typedef struct {
    int     fill;     // 填充字符，<0 表示用空格
    char    align;    // '<' '>' '=' '^'，0 = 按类型默认
    char    sign;     // '+' '-' ' '，0 = 无
    int     alt;      // '#'
    int     zero;     // '0'
    int64_t width;
    char    group;    // ',' '_'，0 = 无
    int     has_prec;
    int64_t prec;
    char    type;     // 转换类型，0 = 无
} FmtSpec;

static FmtSpec fmt_parse(TStr spec) {
    FmtSpec f;
    f.fill = -1; f.align = 0; f.sign = 0; f.alt = 0; f.zero = 0;
    f.width = 0; f.group = 0; f.has_prec = 0; f.prec = 0; f.type = 0;

    char buf[256];
    int64_t n = 0;
    for (int64_t k = 0; k < spec.len && n < 255; k++) buf[n++] = (char)spec.ptr[k];
    buf[n] = '\0';
    // 剥外壳：去掉首尾 {}，再取最后一个 ':' 之后的内容（兼容 "{0:>10}" 这种字段写法）
    if (n >= 2 && buf[0] == '{' && buf[n-1] == '}') {
        memmove(buf, buf + 1, (size_t)(n - 2));
        buf[n - 2] = '\0'; n -= 2;
    }
    char* lc = strrchr(buf, ':');
    if (lc != NULL) {
        int64_t off = (int64_t)(lc - buf) + 1;
        memmove(buf, lc + 1, (size_t)(n - off + 1));
        n -= off;
    }

    int64_t i = 0;
    if (n - i >= 2 && (buf[i+1] == '<' || buf[i+1] == '>' || buf[i+1] == '=' || buf[i+1] == '^')) {
        f.fill = (uint8_t)buf[i]; f.align = buf[i+1]; i += 2;
    } else if (n - i >= 1 && (buf[i] == '<' || buf[i] == '>' || buf[i] == '=' || buf[i] == '^')) {
        f.align = buf[i]; i += 1;
    }
    if (n - i >= 1 && (buf[i] == '+' || buf[i] == '-' || buf[i] == ' ')) { f.sign = buf[i]; i += 1; }
    if (n - i >= 1 && buf[i] == '#') { f.alt = 1; i += 1; }
    if (n - i >= 1 && buf[i] == '0') { f.zero = 1; i += 1; }
    while (n - i >= 1 && buf[i] >= '0' && buf[i] <= '9') { f.width = f.width * 10 + (buf[i] - '0'); i += 1; }
    if (n - i >= 1 && (buf[i] == ',' || buf[i] == '_')) { f.group = buf[i]; i += 1; }
    if (n - i >= 1 && buf[i] == '.') {
        f.has_prec = 1; i += 1; f.prec = 0;
        while (n - i >= 1 && buf[i] >= '0' && buf[i] <= '9') { f.prec = f.prec * 10 + (buf[i] - '0'); i += 1; }
    }
    if (n - i >= 1) { f.type = buf[i]; i += 1; }
    return f;
}

static TStr t_str_view(const uint8_t* p, int64_t n) { TStr r; r.ptr = p; r.len = n; return r; }

// 把 content 按 align/width/fill 补白，返回新 TStr（arena）。
static TStr fmt_pad(TSb* content, char align, int64_t width, char fillc, int64_t clen) {
    if (width <= clen) return t_sb_to_str(content);
    TSb* out = t_sb_new(t_arena_current());
    int64_t pad = width - clen;
    TStr cv = t_str_view(content->buf, clen);
    if (align == '<') {
        t_sb_append_str(out, cv);
        for (int64_t k = 0; k < pad; k++) t_sb_append_char(out, (uint8_t)fillc);
    } else if (align == '^') {
        int64_t left = pad / 2, right = pad - left;
        for (int64_t k = 0; k < left; k++) t_sb_append_char(out, (uint8_t)fillc);
        t_sb_append_str(out, cv);
        for (int64_t k = 0; k < right; k++) t_sb_append_char(out, (uint8_t)fillc);
    } else {
        for (int64_t k = 0; k < pad; k++) t_sb_append_char(out, (uint8_t)fillc);
        t_sb_append_str(out, cv);
    }
    return t_sb_to_str(out);
}

// '=' 对齐：prefix 留在最左，fill 插在 prefix 与 body 之间。
static TStr fmt_pad_eq(TStr prefix, TStr body, int64_t width, char fillc) {
    int64_t inner = width - prefix.len;
    if (inner < body.len) inner = body.len;
    TSb* out = t_sb_new(t_arena_current());
    t_sb_append_str(out, prefix);
    int64_t pad = inner - body.len;
    for (int64_t k = 0; k < pad; k++) t_sb_append_char(out, (uint8_t)fillc);
    t_sb_append_str(out, body);
    return t_sb_to_str(out);
}

// 把 mag 以 base 进制写出：min_digits 最少位数（前导零）、按 group 插入分隔符。
static void append_int_digits(TSb* b, uint64_t mag, int base, int upper, int64_t min_digits, char group) {
    char digits[128]; int dn = 0;
    if (mag == 0) digits[dn++] = '0';
    else { while (mag) { int d = (int)(mag % (uint64_t)base); digits[dn++] = (char)(d < 10 ? '0' + d : (upper ? 'A' : 'a') + (d - 10)); mag /= (uint64_t)base; } }
    for (int i = 0; i < dn / 2; i++) { char t = digits[i]; digits[i] = digits[dn - 1 - i]; digits[dn - 1 - i] = t; }
    int total = dn; if (total < min_digits) total = (int)min_digits;
    int step = 0;
    if (group == ',') step = 3;
    else if (group == '_') step = (base == 10 ? 3 : 4);
    char outb[384]; int on = 0;
    for (int i = 0; i < total; i++) {
        char c = (i < total - dn) ? '0' : digits[i - (total - dn)];
        outb[on++] = c;
        int remain = total - (i + 1);
        if (step > 0 && remain > 0 && (remain % step) == 0) outb[on++] = (group == ',' ? ',' : '_');
    }
    for (int i = 0; i < on; i++) t_sb_append_char(b, (uint8_t)outb[i]);
}

static TStr fmt_int_core(FmtSpec f, int neg, uint64_t mag) {
    if (f.zero && f.align == 0) { f.align = '='; f.fill = '0'; }
    if (f.align == 0) f.align = '>';
    if (f.type == 'c') {
        TSb* b = t_sb_new(t_arena_current());
        t_sb_append_char(b, (uint8_t)(mag & 0xFF));
        int64_t L = b->len;
        return fmt_pad(b, f.align, f.width, (f.fill >= 0 ? (char)f.fill : ' '), L);
    }
    int base = 10, upper = 0;
    if (f.type == 'b') base = 2;
    else if (f.type == 'o') base = 8;
    else if (f.type == 'x') base = 16;
    else if (f.type == 'X') { base = 16; upper = 1; }
    char signc = 0;
    if (neg) signc = '-';
    else if (f.sign == '+') signc = '+';
    else if (f.sign == ' ') signc = ' ';
    const char* altp = "";
    if (f.alt) {
        if (base == 2) altp = "0b";
        else if (base == 8) altp = "0o";
        else if (base == 16) altp = (upper ? "0X" : "0x");
    }
    int64_t mind = f.has_prec ? f.prec : 1;
    TSb* bdy = t_sb_new(t_arena_current());
    append_int_digits(bdy, mag, base, upper, mind, f.group);
    TStr body = t_sb_to_str(bdy);
    char pbuf[8]; int pn = 0;
    if (signc) pbuf[pn++] = signc;
    for (const char* p = altp; *p; p++) pbuf[pn++] = *p;
    TStr prefix = t_str_view((const uint8_t*)pbuf, pn);
    char fillc = (f.fill >= 0 ? (char)f.fill : ' ');
    if (f.align == '=') return fmt_pad_eq(prefix, body, f.width, fillc);
    TSb* full = t_sb_new(t_arena_current());
    t_sb_append_str(full, prefix);
    t_sb_append_str(full, body);
    int64_t L = full->len;
    return fmt_pad(full, f.align, f.width, fillc, L);
}

TStr t_format_int(TStr spec, int64_t v) {
    FmtSpec f = fmt_parse(spec);
    int neg = (v < 0);
    uint64_t mag = neg ? (uint64_t)(-(v + 1)) + 1ULL : (uint64_t)v;
    return fmt_int_core(f, neg, mag);
}

TStr t_format_uint(TStr spec, uint64_t v) {
    FmtSpec f = fmt_parse(spec);
    return fmt_int_core(f, 0, v);
}

// ── 任意位宽整数（>64）的十进制/二八十六进制格式化 ───────────────────────
// 值以「小端字节序」存放在 p 指向的 nbytes = ceil(nbits/8) 字节里（与宿主端的
// LLVM iN / C _BitInt(N) 内存布局一致；t 的目标平台均为小端）。运行时按 256
// 进制从低字节向高字节逐位做除法，生成十进制（或 2/8/16 进制）数字串。
#define T_BIG_MAXBYTES 8192   // 65535 位 → 8192 字节

// 字节 → 16 进制（imath 导入用；imath 无 mp_import，走 16 进制字符串解析）
static const char* T_HEXD = "0123456789ABCDEF";

// 原地二补码取负（用于有符号负数的绝对值）。
static void big_negate(uint8_t* m, int n) {
    for (int i = 0; i < n; i++) m[i] = (uint8_t)~m[i];
    int carry = 1;
    for (int i = 0; i < n; i++) {
        int v = (int)m[i] + carry;
        m[i] = (uint8_t)v;
        carry = v >> 8;
        if (!carry) break;
    }
}

// 与 fmt_int_core 同构，但 magnitude 是任意宽度的小端字节缓冲。
static TStr fmt_big_core(FmtSpec f, int neg, const uint8_t* magin, int nbytes) {
    if (f.zero && f.align == 0) { f.align = '='; f.fill = '0'; }
    if (f.align == 0) f.align = '>';
    if (f.type == 'c') {
        TSb* b = t_sb_new(t_arena_current());
        t_sb_append_char(b, (uint8_t)(magin[0]));
        int64_t L = b->len;
        return fmt_pad(b, f.align, f.width, (f.fill >= 0 ? (char)f.fill : ' '), L);
    }
    int base = 10, upper = 0;
    if (f.type == 'b') base = 2;
    else if (f.type == 'o') base = 8;
    else if (f.type == 'x') base = 16;
    else if (f.type == 'X') { base = 16; upper = 1; }
    char signc = 0;
    if (neg) signc = '-';
    else if (f.sign == '+') signc = '+';
    else if (f.sign == ' ') signc = ' ';
    const char* altp = "";
    if (f.alt) {
        if (base == 2) altp = "0b";
        else if (base == 8) altp = "0o";
        else if (base == 16) altp = (upper ? "0X" : "0x");
    }
    int64_t mind = f.has_prec ? f.prec : 1;
    // ★ 数字串由 imath（runtime/imath）生成：小端字节 → 大端 16 进制串 → mp_int → radix 串。
    //   取代原先手写的「256 进制反复除 base」——后者仅支持 base ≤ 16，且为逐字节 O(n²) 除法。
    char hex[T_BIG_MAXBYTES * 2 + 2];
    int hn = 0;
    int top = nbytes - 1; if (top >= T_BIG_MAXBYTES) top = T_BIG_MAXBYTES - 1;
    while (top > 0 && magin[top] == 0) top--;      // 去前导零字节（至少保留 1 字节）
    for (int i = top; i >= 0; i--) {
        uint8_t b = magin[i];
        hex[hn++] = T_HEXD[(b >> 4) & 0xF];
        hex[hn++] = T_HEXD[b & 0xF];
    }
    hex[hn] = 0;
    // ⚠ imath 的 mp_int 是 `mpz_t*`（指针 typedef），不是值类型：栈上是 mpz_t，再取地址。
    mpz_t bzs; mp_int bz = &bzs;
    if (mp_int_init(bz) != MP_OK) t_fatal("fmt_big: imath init failed");
    if (mp_int_read_string(bz, 16, hex) != MP_OK) t_fatal("fmt_big: imath read failed");
    int slen = (int)mp_int_string_len(bz, (mp_size)base);
    char dbuf_stack[512];
    char* digits = (slen + 2 <= (int)sizeof dbuf_stack)
        ? dbuf_stack : (char*)mi_malloc((size_t)slen + 2);
    if (mp_int_to_string(bz, (mp_size)base, digits, slen + 2) != MP_OK) {
        t_fatal("fmt_big: imath convert failed");
    }
    mp_int_clear(bz);
    int dn = 0; while (digits[dn]) dn++;
    if (base == 16 && !upper) {   // imath 输出大写 hex；'x' 需小写
        for (int i = 0; i < dn; i++) {
            if (digits[i] >= 'A' && digits[i] <= 'F') digits[i] = (char)(digits[i] - 'A' + 'a');
        }
    }
    int total = dn; if (total < mind) total = (int)mind;
    int step = 0;
    if (f.group == ',') step = 3;
    else if (f.group == '_') step = (base == 10 ? 3 : 4);
    TSb* bdy = t_sb_new(t_arena_current());
    int pad0 = total - dn;        // imath 输出已是高位在前，前导补零只补在最前面
    for (int i = 0; i < total; i++) {
        char c = (i < pad0) ? '0' : digits[i - pad0];
        t_sb_append_char(bdy, (uint8_t)c);
        int remain = total - (i + 1);
        if (step > 0 && remain > 0 && (remain % step) == 0) t_sb_append_char(bdy, (uint8_t)(f.group == ',' ? ',' : '_'));
    }
    if (digits != dbuf_stack) mi_free(digits);
    TStr body = t_sb_to_str(bdy);
    char pbuf[8]; int pn = 0;
    if (signc) pbuf[pn++] = signc;
    for (const char* p = altp; *p; p++) pbuf[pn++] = *p;
    TStr prefix = t_str_view((const uint8_t*)pbuf, pn);
    char fillc = (f.fill >= 0 ? (char)f.fill : ' ');
    if (f.align == '=') return fmt_pad_eq(prefix, body, f.width, fillc);
    TSb* full = t_sb_new(t_arena_current());
    t_sb_append_str(full, prefix);
    t_sb_append_str(full, body);
    int64_t L = full->len;
    return fmt_pad(full, f.align, f.width, fillc, L);
}

// 任意位宽整数（>64）格式化追加：p 指向值的小端字节，nbits 为位宽，is_signed 为符号。
void t_sb_append_fmt_big(TSb* b, TStr spec, const void* p, int64_t nbits, int is_signed) {
    FmtSpec f = fmt_parse(spec);
    int nbytes = (int)((nbits + 7) / 8);
    if (nbytes > T_BIG_MAXBYTES) nbytes = T_BIG_MAXBYTES;
    uint8_t buf[T_BIG_MAXBYTES];
    memcpy(buf, p, (size_t)nbytes);
    int neg = 0;
    if (is_signed) {
        int byteidx = nbytes - 1;
        int bits_in_top = ((int)nbits) % 8; if (bits_in_top == 0) bits_in_top = 8;
        uint8_t top = buf[byteidx];
        uint8_t mask = (uint8_t)(1u << (bits_in_top - 1));
        if (top & mask) { neg = 1; big_negate(buf, nbytes); }
    }
    TStr r = fmt_big_core(f, neg, buf, nbytes);
    t_sb_append_str(b, r);
}

// 浮点整数部分按 group 插入分隔符（小数点/e/E 前的整数段）。
static void append_float_grouped(TSb* b, const char* s, char group) {
    const char* dot = s;
    while (*dot && *dot != '.' && *dot != 'e' && *dot != 'E') dot++;
    int intlen = (int)(dot - s);
    for (int i = 0; i < intlen; i++) {
        t_sb_append_char(b, (uint8_t)s[i]);
        int remain = intlen - (i + 1);
        if (remain > 0 && (remain % 3) == 0) t_sb_append_char(b, (uint8_t)(group == ',' ? ',' : '_'));
    }
    if (*dot) t_sb_append_cstr(b, dot);
}

// ── Ryu 输出规范化 ───────────────────────────────────────────────
// Ryu 的特殊值字符串是 D/Java 风格（"Infinity" / "NaN" / "nan(snan)"），
// 统一成 C printf 风格（"inf" / "nan"），保证切换前后输出一致。
static void t_ryu_norm_special(char* s) {
    int neg = 0, i = 0;
    if (s[0] == '-') { neg = 1; i = 1; }
    const char* rep = 0;
    if (strncmp(s + i, "Infinity", 8) == 0) rep = "inf";
    else if (strncmp(s + i, "NaN", 3) == 0 || strncmp(s + i, "nan", 3) == 0) rep = "nan";
    else return;
    char tmp[64]; int k = 0;
    if (neg) tmp[k++] = '-';
    for (const char* p = rep; *p; p++) tmp[k++] = *p;
    tmp[k] = 0;
    memcpy(s, tmp, (size_t)k + 1);
}

// %g 语义渲染：P 位有效数字 + 指数阈值切换 + 去尾随零。
// 数字来源为 d2exp_buffered(v, P-1)——Ryu 对**真实值**一次正确舍入到 P 位有效数字，
// 而非「取最短串再截断」的二次舍入。
static void t_ryu_gfmt(double v, int prec, int alt, int upper, char* out) {
    int P = prec > 0 ? prec : 1;
    if (P > 400) {   // 超高精度：退回 libc（Ryu d2exp 输出随之变长，罕见路径）
        char sf[40]; int si = 0;
        sf[si++] = '%';
        sf[si++] = '.';
        si += snprintf(sf + si, sizeof(sf) - (size_t)si, "%d", P);
        sf[si++] = upper ? 'G' : 'g'; sf[si] = 0;
        // 调用方缓冲按 prec+64 分配（t_format_float），这里按同一公式取容量，
        // 避免写死 512 在高精度下截断。
        snprintf(out, (size_t)P + 64, sf, v);
        return;
    }
    char buf[640];
    int n = d2exp_buffered_n(v, (uint32_t)(P - 1), buf);
    buf[n] = 0;
    t_ryu_norm_special(buf);
    if (strstr(buf, "inf") || strstr(buf, "nan")) { memcpy(out, buf, strlen(buf) + 1); return; }
    // 解析 "[-]d[.ddd]e[+-]xx"
    int i = 0;
    char res[700]; int k = 0;
    if (buf[i] == '-') { res[k++] = '-'; i++; }
    char dig[600]; int dn = 0;
    while (buf[i] && buf[i] != 'e' && buf[i] != 'E') { if (buf[i] != '.') dig[dn++] = buf[i]; i++; }
    int exp = 0, esign = 1;
    if (buf[i] == 'e' || buf[i] == 'E') {
        i++;
        if (buf[i] == '-') { esign = -1; i++; } else if (buf[i] == '+') { i++; }
        while (buf[i] >= '0' && buf[i] <= '9') { exp = exp * 10 + (buf[i] - '0'); i++; }
    }
    exp *= esign;
    int keep = dn;                       // %g 去掉尾随零（'#' 时保留）
    if (!alt) { while (keep > 1 && dig[keep - 1] == '0') keep--; }
    if (exp < -4 || exp >= P) {          // 科学计数：d[.ddd]e±xx，指数至少 2 位
        res[k++] = dig[0];
        if (keep > 1) { res[k++] = '.'; for (int j = 1; j < keep; j++) res[k++] = dig[j]; }
        res[k++] = upper ? 'E' : 'e';
        int ae = exp < 0 ? -exp : exp;
        res[k++] = exp < 0 ? '-' : '+';
        if (ae >= 100) {
            res[k++] = (char)('0' + ae / 100);
            res[k++] = (char)('0' + (ae / 10) % 10);
            res[k++] = (char)('0' + ae % 10);
        } else {
            res[k++] = (char)('0' + ae / 10);
            res[k++] = (char)('0' + ae % 10);
        }
    } else if (exp >= 0) {               // 定点，有整数部分
        if (keep <= exp + 1) {
            for (int j = 0; j < keep; j++) res[k++] = dig[j];
            for (int j = 0; j < exp + 1 - keep; j++) res[k++] = '0';
        } else {
            for (int j = 0; j <= exp; j++) res[k++] = dig[j];
            res[k++] = '.';
            for (int j = exp + 1; j < keep; j++) res[k++] = dig[j];
        }
    } else {                             // 定点，纯小数
        res[k++] = '0'; res[k++] = '.';
        for (int j = 0; j < -exp - 1; j++) res[k++] = '0';
        for (int j = 0; j < keep; j++) res[k++] = dig[j];
    }
    res[k] = 0;
    memcpy(out, res, (size_t)k + 1);
}

TStr t_format_float(TStr spec, double v) {
    FmtSpec f = fmt_parse(spec);
    if (f.zero && f.align == 0) { f.align = '='; f.fill = '0'; }
    if (f.align == 0) f.align = '>';
    char tc = f.type;
    if (tc == 'd' || tc == 'b' || tc == 'o' || tc == 'x' || tc == 'X' || tc == 'c') {
        // 数值型：退化为整数格式化（浮点截断为整数）
        long long iv = (long long)v;
        return t_format_int(spec, (int64_t)iv);
    }
    int ispct = (tc == '%');
    double vv = ispct ? v * 100.0 : v;
    // ★ 浮点 → 字符串全部走 Ryu（runtime/ryu），不再经过 printf 浮点路径：
    //     e/E  → d2exp_buffered（C 风格 "d.ddde±xx"，与 %e 同格式）
    //     f/F  → d2fixed_buffered（定点，与 %f 同格式）
    //     其余 → t_ryu_gfmt：%g 语义（P 位有效数字 + 指数阈值切换 + 去尾随零），
    //            由 d2exp_buffered(v, P-1) 取得**正确舍入**的 P 位有效数字后自行渲染，
    //            不做「最短串再截断」的二次舍入。
    //   ⚠ 未采用 d2s（最短往返）：它输出 D/Java 风格、恒为科学计数法（0.0 → "0E0"），
    //     与 t 既有的 %g 语义不兼容；引入它会改变浮点默认打印精度，属语言语义变更。
    int prec = f.has_prec ? (int)f.prec : 6;
    if (prec < 0) { prec = 0; }
    // ⚠ Ryu 的 *_buffered_n 只写数字、**不补结尾 NUL**（只有 d2fixed_buffered /
    //   d2exp_buffered 这类便利封装才写 '\0'）。漏掉这一步 → 下游 t_str_from_c 按
    //   strlen 取长度会吃到上一次调用残留的字节（实测 format_demo 打出 "3.14]"、
    //   "50.00000e+03<garbage>%"）。故必须按返回值显式补 NUL。
    //   同时按 prec 估算容量：超大精度走堆，避免 512 字节栈缓冲溢出。
    size_t need = (size_t)prec + 64;
    char num_stack[512];
    char* num = (need <= sizeof(num_stack)) ? num_stack : (char*)mi_malloc(need);
    if (tc == 'e' || tc == 'E') {
        int n = d2exp_buffered_n(vv, (uint32_t)prec, num);
        num[n] = 0;
        t_ryu_norm_special(num);
        if (tc == 'E') { for (char* p = num; *p; p++) if (*p == 'e') *p = 'E'; }
    } else if (tc == 'f' || tc == 'F' || ispct) {
        int n = d2fixed_buffered_n(vv, (uint32_t)prec, num);
        num[n] = 0;
        t_ryu_norm_special(num);
    } else {
        t_ryu_gfmt(vv, prec, f.alt, (tc == 'G'), num);
    }
    // Ryu 只输出 '-'；'+' / ' ' 符号标志在此补上（与 printf 一致）
    if ((f.sign == '+' || f.sign == ' ') && num[0] != '-') {
        char tmp[520];
        tmp[0] = (char)f.sign;
        int k = 0; while (num[k]) { tmp[k + 1] = num[k]; k++; }
        tmp[k + 1] = 0;
        memcpy(num, tmp, (size_t)(k + 2));
    }
    char signc = 0; const char* bodyc = num;
    if (num[0] == '-' || num[0] == '+' || num[0] == ' ') { signc = num[0]; bodyc = num + 1; }
    TSb* bdy = t_sb_new(t_arena_current());
    if (f.group) append_float_grouped(bdy, bodyc, f.group);
    else t_sb_append_cstr(bdy, bodyc);
    if (num != num_stack) { mi_free(num); num = 0; bodyc = 0; }
    if (ispct) t_sb_append_char(bdy, (uint8_t)'%');
    TStr body = t_sb_to_str(bdy);
    char pbuf[2]; int pn = 0; if (signc) pbuf[pn++] = signc;
    TStr prefix = t_str_view((const uint8_t*)pbuf, pn);
    char fillc = (f.fill >= 0 ? (char)f.fill : ' ');
    if (f.align == '=') return fmt_pad_eq(prefix, body, f.width, fillc);
    TSb* full = t_sb_new(t_arena_current());
    t_sb_append_str(full, prefix);
    t_sb_append_str(full, body);
    int64_t L = full->len;
    return fmt_pad(full, f.align, f.width, fillc, L);
}

TStr t_format_str(TStr spec, TStr v) {
    FmtSpec f = fmt_parse(spec);
    if (f.zero && f.align == 0) { f.align = '='; f.fill = '0'; }
    if (f.align == 0) f.align = '<';
    int64_t len = v.len;
    if (f.has_prec && f.prec < len) len = f.prec;
    TSb* b = t_sb_new(t_arena_current());
    t_sb_append_str(b, t_str_view(v.ptr, len));
    int64_t L = b->len;
    return fmt_pad(b, f.align, f.width, (f.fill >= 0 ? (char)f.fill : ' '), L);
}

TStr t_format_bool(TStr spec, int v) {
    FmtSpec f = fmt_parse(spec);
    char tc = f.type;
    if (tc == 'd' || tc == 'b' || tc == 'o' || tc == 'x' || tc == 'X' ||
        tc == 'e' || tc == 'E' || tc == 'f' || tc == 'F' || tc == 'g' || tc == 'G' || tc == '%') {
        return t_format_int(spec, v ? 1 : 0);
    }
    if (f.zero && f.align == 0) { f.align = '='; f.fill = '0'; }
    if (f.align == 0) f.align = '>';
    const char* w = v ? "true" : "false";
    TSb* b = t_sb_new(t_arena_current());
    t_sb_append_cstr(b, w);
    int64_t L = b->len;
    return fmt_pad(b, f.align, f.width, (f.fill >= 0 ? (char)f.fill : ' '), L);
}

TStr t_format_char(TStr spec, uint8_t v) {
    FmtSpec f = fmt_parse(spec);
    if (f.zero && f.align == 0) { f.align = '='; f.fill = '0'; }
    if (f.align == 0) f.align = '<';
    TSb* b = t_sb_new(t_arena_current());
    t_sb_append_char(b, v);
    int64_t L = b->len;
    return fmt_pad(b, f.align, f.width, (f.fill >= 0 ? (char)f.fill : ' '), L);
}

// ── StringBuilder 直写变体 ──────────────────────────────────────────────
void t_sb_append_fmt_int(TSb* b, TStr spec, int64_t v)  { t_sb_append_str(b, t_format_int(spec, v)); }
void t_sb_append_fmt_uint(TSb* b, TStr spec, uint64_t v){ t_sb_append_str(b, t_format_uint(spec, v)); }
void t_sb_append_fmt_float(TSb* b, TStr spec, double v){ t_sb_append_str(b, t_format_float(spec, v)); }
void t_sb_append_fmt_str(TSb* b, TStr spec, TStr v)     { t_sb_append_str(b, t_format_str(spec, v)); }
void t_sb_append_fmt_bool(TSb* b, TStr spec, int v)     { t_sb_append_str(b, t_format_bool(spec, v)); }
void t_sb_append_fmt_char(TSb* b, TStr spec, uint8_t v) { t_sb_append_str(b, t_format_char(spec, v)); }

// ── 转换字段 !s / !r / !a / !j / !c / !p（M-fstr）────────────────────────
// 与 CPython 同构：**先按 mode 把值转成文本形态，再套 format spec**，
// 因此这些路径的 spec 一律按「字符串规则」解释（默认左对齐、`.N` 是截断）。
static const char T_FMT_HEXD[] = "0123456789abcdef";

static void fmt_esc_hex(TSb* b, uint8_t c) {
    t_sb_append_char(b, (uint8_t)'\\');
    t_sb_append_char(b, (uint8_t)'x');
    t_sb_append_char(b, (uint8_t)T_FMT_HEXD[(c >> 4) & 0xF]);
    t_sb_append_char(b, (uint8_t)T_FMT_HEXD[c & 0xF]);
}

static void fmt_esc_u16(TSb* b, uint8_t c) {
    t_sb_append_cstr(b, "\\u00");
    t_sb_append_char(b, (uint8_t)T_FMT_HEXD[(c >> 4) & 0xF]);
    t_sb_append_char(b, (uint8_t)T_FMT_HEXD[c & 0xF]);
}

static void fmt_esc_u_cp(TSb* b, uint32_t cp) {
    if (cp < 0x100) { fmt_esc_hex(b, (uint8_t)cp); return; }
    if (cp < 0x10000) {
        t_sb_append_cstr(b, "\\u");
        for (int s = 12; s >= 0; s -= 4) t_sb_append_char(b, (uint8_t)T_FMT_HEXD[(cp >> s) & 0xF]);
        return;
    }
    t_sb_append_cstr(b, "\\U");
    for (int s = 28; s >= 0; s -= 4) t_sb_append_char(b, (uint8_t)T_FMT_HEXD[(cp >> s) & 0xF]);
}

// UTF-8 解码：成功返回码点并把 *w 置为字节宽度；非法序列返回 -1（w=1）。
static int32_t fmt_utf8_cp(const uint8_t* p, int64_t n, int64_t i, int* w) {
    uint8_t c = p[i];
    *w = 1;
    if (c < 0x80) return c;
    int need = 0; uint32_t cp = 0;
    if ((c & 0xE0) == 0xC0) { need = 1; cp = c & 0x1F; }
    else if ((c & 0xF0) == 0xE0) { need = 2; cp = c & 0x0F; }
    else if ((c & 0xF8) == 0xF0) { need = 3; cp = c & 0x07; }
    else return -1;
    if (i + need >= n) return -1;
    for (int k = 1; k <= need; k++) {
        uint8_t cc = p[i + k];
        if ((cc & 0xC0) != 0x80) return -1;
        cp = (cp << 6) | (cc & 0x3F);
    }
    *w = need + 1;
    return (int32_t)cp;
}

// mode: 'r' repr / 'a' ascii / 'j' json / 'p' pbtxt / 'c' csv；其余原样返回。
// 字符串类转换统一加一层引号并按格式转义；标量（非字符串）由调用方直接走普通追加，不进本函数。
//   r  调试表示：\" \\ \n \t \r 转义，控制字符 \xHH，非 ASCII 保留 UTF-8
//   a  ascii：在 r 之上把非 ASCII 码点转义成 \xHH / \uXXXX / \UXXXXXXXX
//   j   json：\" \\ \n \t \r 转义，控制字符 \u00XX，非 ASCII 保留 UTF-8
//   p  pbtxt：同 j 的引号/转义风格（protobuf text 的 \" \\ \n \t \r，控制字符 \xHH），非 ASCII 保留 UTF-8
//   c   csv：仅当含 , " CR/LF 才加引号，内部 " 翻倍；否则原样返回
static TStr fmt_str_convert(TStr v, char mode) {
    if (mode != 'r' && mode != 'a' && mode != 'j' && mode != 'p' && mode != 'c') return v;
    // CSV：无特殊字符直接原样返回（裸单元格）
    if (mode == 'c') {
        int need_q = 0;
        for (int64_t k = 0; k < v.len; k++) {
            uint8_t c = v.ptr[k];
            if (c == ',' || c == '"' || c == '\n' || c == '\r') { need_q = 1; break; }
        }
        if (!need_q) return v;
    }
    TSb* b = t_sb_new(t_arena_current());
    t_sb_append_char(b, (uint8_t)'"');
    int64_t k = 0;
    while (k < v.len) {
        uint8_t c = v.ptr[k];
        if (c == '"') {
            if (mode == 'c') t_sb_append_cstr(b, "\"\"");   // CSV：双写
            else t_sb_append_cstr(b, "\\\"");
            k++; continue;
        }
        if (c == '\\') { t_sb_append_cstr(b, "\\\\"); k++; continue; }
        if (c == '\n') { t_sb_append_cstr(b, "\\n");  k++; continue; }
        if (c == '\t') { t_sb_append_cstr(b, "\\t");  k++; continue; }
        if (c == '\r') { t_sb_append_cstr(b, "\\r");  k++; continue; }
        if (c < 0x20 || c == 0x7F) {
            if (mode == 'j') fmt_esc_u16(b, c);          // JSON: \u00XX
            else fmt_esc_hex(b, c);                      // r/a/p: \xHH
            k++; continue;
        }
        if (c < 0x80) { t_sb_append_char(b, c); k++; continue; }
        if (mode == 'a') {
            int w = 1;
            int32_t cp = fmt_utf8_cp(v.ptr, v.len, k, &w);
            if (cp < 0) { fmt_esc_hex(b, c); k++; continue; }
            fmt_esc_u_cp(b, (uint32_t)cp);
            k += w;
        } else {
            t_sb_append_char(b, c); k++; continue;       // r/j/p/c：保留原样 UTF-8
        }
    }
    t_sb_append_char(b, (uint8_t)'"');
    return t_sb_to_str(b);
}

// 整数码点 → UTF-8 字符（越界给 U+FFFD，绝不产生非法序列）
static TStr fmt_cp_to_utf8(uint64_t cp) {
    TSb* b = t_sb_new(t_arena_current());
    if (cp < 0x80) {
        t_sb_append_char(b, (uint8_t)cp);
    } else if (cp < 0x800) {
        t_sb_append_char(b, (uint8_t)(0xC0 | (cp >> 6)));
        t_sb_append_char(b, (uint8_t)(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        t_sb_append_char(b, (uint8_t)(0xE0 | (cp >> 12)));
        t_sb_append_char(b, (uint8_t)(0x80 | ((cp >> 6) & 0x3F)));
        t_sb_append_char(b, (uint8_t)(0x80 | (cp & 0x3F)));
    } else if (cp <= 0x10FFFF) {
        t_sb_append_char(b, (uint8_t)(0xF0 | (cp >> 18)));
        t_sb_append_char(b, (uint8_t)(0x80 | ((cp >> 12) & 0x3F)));
        t_sb_append_char(b, (uint8_t)(0x80 | ((cp >> 6) & 0x3F)));
        t_sb_append_char(b, (uint8_t)(0x80 | (cp & 0x3F)));
    } else {
        t_sb_append_cstr(b, "\xEF\xBF\xBD");
    }
    return t_sb_to_str(b);
}

static TStr fmt_hex_prefixed(uint64_t mag, int neg) {
    TSb* b = t_sb_new(t_arena_current());
    if (neg) t_sb_append_char(b, (uint8_t)'-');
    t_sb_append_cstr(b, "0x");
    char d[24]; int dn = 0;
    if (mag == 0) d[dn++] = '0';
    else { while (mag) { d[dn++] = T_FMT_HEXD[mag & 0xF]; mag >>= 4; } }
    for (int k = dn - 1; k >= 0; k--) t_sb_append_char(b, (uint8_t)d[k]);
    return t_sb_to_str(b);
}

static char fmt_mode_of(TStr mode) { return mode.len > 0 ? (char)mode.ptr[0] : 's'; }

void t_sb_append_fmt_str_conv(TSb* b, TStr spec, TStr v, TStr mode) {
    t_sb_append_str(b, t_format_str(spec, fmt_str_convert(v, fmt_mode_of(mode))));
}

void t_sb_append_fmt_int_conv(TSb* b, TStr spec, int64_t v, TStr mode) {
    char m = fmt_mode_of(mode);
    if (m == 'c') {
        t_sb_append_str(b, t_format_str(spec, fmt_cp_to_utf8(v < 0 ? 0xFFFDULL : (uint64_t)v)));
        return;
    }
    if (m == 'p') {
        int neg = (v < 0);
        uint64_t mag = neg ? (uint64_t)(-(v + 1)) + 1ULL : (uint64_t)v;
        t_sb_append_str(b, t_format_str(spec, fmt_hex_prefixed(mag, neg)));
        return;
    }
    t_sb_append_str(b, t_format_int(spec, v));
}

void t_sb_append_fmt_uint_conv(TSb* b, TStr spec, uint64_t v, TStr mode) {
    char m = fmt_mode_of(mode);
    if (m == 'c') { t_sb_append_str(b, t_format_str(spec, fmt_cp_to_utf8(v))); return; }
    if (m == 'p') { t_sb_append_str(b, t_format_str(spec, fmt_hex_prefixed(v, 0))); return; }
    t_sb_append_str(b, t_format_uint(spec, v));
}

// ── 时间格式化（M56）───────────────────────────────────────────
// 时间值语义：i64 微秒 Unix epoch（见 docs/syntax/drafts/time_fmt.md D1）。
int64_t t_now(void) {
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (int64_t)ts.tv_sec * 1000000 + (int64_t)(ts.tv_nsec / 1000);
}

static void fmt_time_append_2d(TSb* b, int v) {
    if (v < 0) v = 0; if (v > 99) v = 99;
    t_sb_append_char(b, (uint8_t)('0' + v / 10));
    t_sb_append_char(b, (uint8_t)('0' + v % 10));
}
static void fmt_time_append_3d(TSb* b, int v) {
    if (v < 0) v = 0; if (v > 999) v = 999;
    t_sb_append_char(b, (uint8_t)('0' + v / 100));
    t_sb_append_char(b, (uint8_t)('0' + (v / 10) % 10));
    t_sb_append_char(b, (uint8_t)('0' + v % 10));
}
static void fmt_time_append_4d(TSb* b, int v) {
    if (v < 0) v = 0; if (v > 9999) v = 9999;
    t_sb_append_char(b, (uint8_t)('0' + v / 1000));
    t_sb_append_char(b, (uint8_t)('0' + (v / 100) % 10));
    t_sb_append_char(b, (uint8_t)('0' + (v / 10) % 10));
    t_sb_append_char(b, (uint8_t)('0' + v % 10));
}
static void fmt_time_append_6d(TSb* b, int v) {   // 微秒（6 位，strftime %f 语义）
    if (v < 0) v = 0; if (v > 999999) v = 999999;
    t_sb_append_char(b, (uint8_t)('0' + v / 100000));
    t_sb_append_char(b, (uint8_t)('0' + (v / 10000) % 10));
    t_sb_append_char(b, (uint8_t)('0' + (v / 1000) % 10));
    t_sb_append_char(b, (uint8_t)('0' + (v / 100) % 10));
    t_sb_append_char(b, (uint8_t)('0' + (v / 10) % 10));
    t_sb_append_char(b, (uint8_t)('0' + v % 10));
}

// 星期/月份英文名表（与 Python datetime.strftime 默认英语区一致，确定不受系统 locale 影响）
static const char* T_WDAY_ABBR[7] = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
static const char* T_WDAY_FULL[7] = {"Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"};
static const char* T_MON_ABBR[12] = {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
static const char* T_MON_FULL[12] = {"January","February","March","April","May","June","July","August","September","October","November","December"};

// ── 时间格式化核心（M57 抽出：UTC / 本地 / 固定偏移三种时区模式共用）──
// tz_kind: 0 = UTC, 1 = 本机本地时区, 2 = 固定偏移（tz_off 秒，东为正）
static void fmt_time_hms(TSb* b, const struct tm* tp) {
    fmt_time_append_2d(b, tp->tm_hour);
    t_sb_append_char(b, ':');
    fmt_time_append_2d(b, tp->tm_min);
    t_sb_append_char(b, ':');
    fmt_time_append_2d(b, tp->tm_sec);
}

// ±HHMM（colon != 0 时输出 ±HH:MM）
static void fmt_time_zoff(TSb* b, long tz_off, int colon) {
    char sign = tz_off < 0 ? '-' : '+';
    long aa = tz_off < 0 ? -tz_off : tz_off;
    t_sb_append_char(b, (uint8_t)sign);
    fmt_time_append_2d(b, (int)(aa / 3600));
    if (colon) t_sb_append_char(b, ':');
    fmt_time_append_2d(b, (int)((aa % 3600) / 60));
}

static TStr fmt_time_run(TStr spec, const struct tm* tpp, int us, long tz_off, int tz_kind) {
    struct tm tm_buf = *tpp;
    TSb* b = t_sb_new(t_arena_current());
    for (int64_t k = 0; k < spec.len; k++) {
        uint8_t c = spec.ptr[k];
        if (c != '%') { t_sb_append_char(b, c); continue; }
        if (k + 1 >= spec.len) { t_sb_append_char(b, '%'); break; }
        uint8_t x = spec.ptr[k + 1]; k++;
        switch (x) {
            case 'Y': fmt_time_append_4d(b, tm_buf.tm_year + 1900); break;
            case 'y': fmt_time_append_2d(b, (tm_buf.tm_year + 1900) % 100); break;
            case 'm': fmt_time_append_2d(b, tm_buf.tm_mon + 1); break;
            case 'd': fmt_time_append_2d(b, tm_buf.tm_mday); break;
            case 'H': fmt_time_append_2d(b, tm_buf.tm_hour); break;
            case 'M': fmt_time_append_2d(b, tm_buf.tm_min); break;
            case 'S': fmt_time_append_2d(b, tm_buf.tm_sec); break;
            case 'f': fmt_time_append_6d(b, (int)us); break;
            case 'I': { int hh = tm_buf.tm_hour % 12; if (hh == 0) hh = 12; fmt_time_append_2d(b, hh); break; }
            case 'p': t_sb_append_cstr(b, tm_buf.tm_hour < 12 ? "AM" : "PM"); break;
            case 'w': t_sb_append_char(b, (uint8_t)('0' + tm_buf.tm_wday)); break;
            case 'j': fmt_time_append_3d(b, tm_buf.tm_yday + 1); break;
            case 'U': fmt_time_append_2d(b, (tm_buf.tm_yday + 7 - tm_buf.tm_wday) / 7); break;
            case 'W': fmt_time_append_2d(b, (tm_buf.tm_yday + 7 - (tm_buf.tm_wday + 6) % 7) / 7); break;
            case 'a': t_sb_append_cstr(b, T_WDAY_ABBR[tm_buf.tm_wday]); break;
            case 'A': t_sb_append_cstr(b, T_WDAY_FULL[tm_buf.tm_wday]); break;
            case 'b': t_sb_append_cstr(b, T_MON_ABBR[tm_buf.tm_mon]); break;
            case 'B': t_sb_append_cstr(b, T_MON_FULL[tm_buf.tm_mon]); break;
            case 'z': fmt_time_zoff(b, tz_off, 0); break;
            case 'Z': {
                if (tz_kind == 1) {
                    char zbuf[64];
                    if (strftime(zbuf, sizeof(zbuf), "%Z", &tm_buf) > 0) t_sb_append_cstr(b, zbuf);
                } else if (tz_kind == 2 && tz_off != 0) {
                    // 与 Python datetime.timezone(...).tzname() 一致：UTC±HH:MM
                    t_sb_append_cstr(b, "UTC");
                    fmt_time_zoff(b, tz_off, 1);
                } else {
                    t_sb_append_cstr(b, "UTC");
                }
                break;
            }
            // ── locale 字段码（M57）：固定采用 C/POSIX 英语区表示，不随系统 locale 漂移 ──
            case 'x':                                   // %m/%d/%y
                fmt_time_append_2d(b, tm_buf.tm_mon + 1);
                t_sb_append_char(b, '/');
                fmt_time_append_2d(b, tm_buf.tm_mday);
                t_sb_append_char(b, '/');
                fmt_time_append_2d(b, (tm_buf.tm_year + 1900) % 100);
                break;
            case 'X': fmt_time_hms(b, &tm_buf); break;  // %H:%M:%S
            case 'c':                                   // %a %b %e %H:%M:%S %Y
                t_sb_append_cstr(b, T_WDAY_ABBR[tm_buf.tm_wday]);
                t_sb_append_char(b, ' ');
                t_sb_append_cstr(b, T_MON_ABBR[tm_buf.tm_mon]);
                t_sb_append_char(b, ' ');
                if (tm_buf.tm_mday < 10) t_sb_append_char(b, ' ');   // %e：空格填充日
                else t_sb_append_char(b, (uint8_t)('0' + tm_buf.tm_mday / 10));
                t_sb_append_char(b, (uint8_t)('0' + tm_buf.tm_mday % 10));
                t_sb_append_char(b, ' ');
                fmt_time_hms(b, &tm_buf);
                t_sb_append_char(b, ' ');
                fmt_time_append_4d(b, tm_buf.tm_year + 1900);
                break;
            case '%': t_sb_append_char(b, '%'); break;
            default:
                // 未知转换：原样保留 "%?"（reference §3.11 D2 运行期宽松兜底；
                // 字面量场景由编译器静态校验 T_TIME_BAD_SPEC 提前拦截）
                t_sb_append_char(b, '%');
                t_sb_append_char(b, x);
                break;
        }
    }
    return t_sb_to_str(b);
}

// spec 是否用到 %z / %Z（只有用到才值得付出算时区偏移的代价）
static int fmt_time_needs_tz(TStr spec) {
    for (int64_t k = 0; k < spec.len; k++) {
        if (spec.ptr[k] == '%' && k + 1 < spec.len) {
            uint8_t x = spec.ptr[k + 1];
            if (x == 'z' || x == 'Z') return 1;
        }
    }
    return 0;
}

TStr t_format_time(TStr spec, int64_t t_us, int use_local) {
    int64_t sec = t_us / 1000000;
    int64_t us = t_us % 1000000;
    if (us < 0) { us += 1000000; sec -= 1; }    // 防御负 epoch：向下取整到秒
    time_t t = (time_t)sec;
    struct tm* p = use_local ? localtime(&t) : gmtime(&t);
    if (p == NULL) {                            // 非法时间（溢出等）：确定性返回空串，不 panic
        TSb* eb = t_sb_new(t_arena_current());
        return t_sb_to_str(eb);
    }
    struct tm tm_buf = *p;
    long tz_off = 0;
    if (use_local && fmt_time_needs_tz(spec)) {
        struct tm lt = tm_buf;                  // 已是 localtime 结果
        struct tm gt = *gmtime(&t);
        gt.tm_isdst = lt.tm_isdst;              // 同一 DST 标志，避免夏令时差 1 小时
        tz_off = (long)(mktime(&lt) - mktime(&gt));
    }
    return fmt_time_run(spec, &tm_buf, (int)us, tz_off, use_local ? 1 : 0);
}

// M57：固定时区偏移。做法是把瞬时偏移进"墙上时间"后按 UTC 展开 ——
// 这样无需依赖平台 tzdata，任意偏移都可测、可复现。
TStr t_format_time_tz(TStr spec, int64_t t_us, int64_t tz_min) {
    int64_t sec = t_us / 1000000;
    int64_t us = t_us % 1000000;
    if (us < 0) { us += 1000000; sec -= 1; }
    sec += tz_min * 60;
    time_t t = (time_t)sec;
    struct tm* p = gmtime(&t);
    if (p == NULL) {
        TSb* eb = t_sb_new(t_arena_current());
        return t_sb_to_str(eb);
    }
    struct tm tm_buf = *p;
    return fmt_time_run(spec, &tm_buf, (int)us, (long)(tz_min * 60), 2);
}

// ── 时间解析（M57，strptime 子集）──────────────────────────────
// 民用历 → epoch 日数（Howard Hinnant days_from_civil）。自实现而非 timegm，
// 因为 timegm 非 C99 标准、各平台名字不一（_mkgmtime / timegm），且这里要求
// 跨平台逐位一致。m ∈ [1,12]，d ∈ [1,31]。
static int64_t t_days_from_civil(int64_t y, int m, int d) {
    y -= (m <= 2);
    int64_t era = (y >= 0 ? y : y - 399) / 400;
    int64_t yoe = y - era * 400;                          // [0, 399]
    int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;  // [0, 146096]
    return era * 146097 + doe - 719468;
}

typedef struct {
    int64_t y; int mon, mday, hour, min, sec, us;
    int hour12, pm;            // %I / %p：pm = 0 未见 / 1 AM / 2 PM
    int have_hour12;
    int yday, have_yday, have_mday;
    int tz_min, have_tz;
} TParts;

static int pt_lower(int c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }

static void pt_skip_ws(const uint8_t* in, int64_t n, int64_t* ip) {
    while (*ip < n && (in[*ip] == ' ' || in[*ip] == '\t' || in[*ip] == '\r' || in[*ip] == '\n')) (*ip)++;
}

// 读 1..maxd 位十进制数；不足 1 位返回 0（失败）
static int pt_num(const uint8_t* in, int64_t n, int64_t* ip, int maxd, int* out, int* ndig) {
    int v = 0, k = 0;
    while (*ip < n && k < maxd && in[*ip] >= '0' && in[*ip] <= '9') {
        v = v * 10 + (in[*ip] - '0');
        (*ip)++; k++;
    }
    if (k == 0) return 0;
    *out = v;
    if (ndig) *ndig = k;
    return 1;
}

// 在名称表里做大小写不敏感匹配，命中最长者
static int pt_name(const uint8_t* in, int64_t n, int64_t* ip, const char** tab, int cnt, int* idx) {
    int best = -1; int64_t bestlen = 0;
    for (int i = 0; i < cnt; i++) {
        int64_t L = (int64_t)strlen(tab[i]);
        if (*ip + L > n) continue;
        int ok = 1;
        for (int64_t k = 0; k < L; k++) {
            if (pt_lower(in[*ip + k]) != pt_lower((unsigned char)tab[i][k])) { ok = 0; break; }
        }
        if (ok && L > bestlen) { best = i; bestlen = L; }
    }
    if (best < 0) return 0;
    *ip += bestlen;
    *idx = best;
    return 1;
}

static int pt_scan(const uint8_t* sp, int64_t sl, const uint8_t* in, int64_t n, int64_t* ip, TParts* P);

// 把 locale 字段码展开成等价子模式后递归解析
static int pt_sub(const char* pat, const uint8_t* in, int64_t n, int64_t* ip, TParts* P) {
    return pt_scan((const uint8_t*)pat, (int64_t)strlen(pat), in, n, ip, P);
}

static int pt_scan(const uint8_t* sp, int64_t sl, const uint8_t* in, int64_t n, int64_t* ip, TParts* P) {
    for (int64_t k = 0; k < sl; k++) {
        uint8_t c = sp[k];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { pt_skip_ws(in, n, ip); continue; }
        if (c != '%') {
            if (*ip >= n || in[*ip] != c) return 0;
            (*ip)++;
            continue;
        }
        if (k + 1 >= sl) return 0;               // 以 '%' 结尾：非法模式
        uint8_t x = sp[k + 1]; k++;
        int v = 0, nd = 0, idx = 0;
        switch (x) {
            case 'Y': if (!pt_num(in, n, ip, 4, &v, &nd)) return 0; P->y = v; break;
            case 'y': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      P->y = (v >= 69) ? 1900 + v : 2000 + v; break;   // 与 Python 一致
            case 'm': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v < 1 || v > 12) return 0; P->mon = v; break;
            case 'd': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v < 1 || v > 31) return 0; P->mday = v; P->have_mday = 1; break;
            case 'e': pt_skip_ws(in, n, ip);
                      if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v < 1 || v > 31) return 0; P->mday = v; P->have_mday = 1; break;
            case 'H': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v > 23) return 0; P->hour = v; break;
            case 'I': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v < 1 || v > 12) return 0; P->hour12 = v; P->have_hour12 = 1; break;
            case 'M': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v > 59) return 0; P->min = v; break;
            case 'S': if (!pt_num(in, n, ip, 2, &v, &nd)) return 0;
                      if (v > 60) return 0; P->sec = (v == 60 ? 59 : v); break;  // 闰秒夹紧
            case 'j': if (!pt_num(in, n, ip, 3, &v, &nd)) return 0;
                      if (v < 1 || v > 366) return 0; P->yday = v; P->have_yday = 1; break;
            case 'f': {
                if (!pt_num(in, n, ip, 6, &v, &nd)) return 0;
                for (int q = nd; q < 6; q++) v *= 10;           // 右补零到微秒
                P->us = v; break;
            }
            case 'p': {
                static const char* AP[2] = { "AM", "PM" };
                if (!pt_name(in, n, ip, AP, 2, &idx)) return 0;
                P->pm = idx + 1; break;
            }
            case 'a': case 'A': {
                if (!pt_name(in, n, ip, T_WDAY_FULL, 7, &idx)
                    && !pt_name(in, n, ip, T_WDAY_ABBR, 7, &idx)) return 0;
                break;                                          // 星期只做校验消费，不参与定值
            }
            case 'b': case 'B': {
                if (!pt_name(in, n, ip, T_MON_FULL, 12, &idx)
                    && !pt_name(in, n, ip, T_MON_ABBR, 12, &idx)) return 0;
                P->mon = idx + 1; break;
            }
            case 'z': {
                if (*ip < n && (in[*ip] == 'Z' || in[*ip] == 'z')) { (*ip)++; P->tz_min = 0; P->have_tz = 1; break; }
                if (*ip >= n || (in[*ip] != '+' && in[*ip] != '-')) return 0;
                int sign = (in[*ip] == '-') ? -1 : 1;
                (*ip)++;
                int hh = 0, mm = 0;
                if (!pt_num(in, n, ip, 2, &hh, &nd) || nd != 2) return 0;
                if (*ip < n && in[*ip] == ':') (*ip)++;
                if (!pt_num(in, n, ip, 2, &mm, &nd) || nd != 2) return 0;
                P->tz_min = sign * (hh * 60 + mm); P->have_tz = 1; break;
            }
            case 'c': if (!pt_sub("%a %b %e %H:%M:%S %Y", in, n, ip, P)) return 0; break;
            case 'x': if (!pt_sub("%m/%d/%y", in, n, ip, P)) return 0; break;
            case 'X': if (!pt_sub("%H:%M:%S", in, n, ip, P)) return 0; break;
            case '%': if (*ip >= n || in[*ip] != '%') return 0; (*ip)++; break;
            default: return 0;                   // 解析不支持的字段码（%U %W %w %Z）
        }
    }
    return 1;
}

int64_t t_parse_time(TStr spec, TStr s, int use_local) {
    TParts P;
    P.y = 1900; P.mon = 1; P.mday = 1; P.hour = 0; P.min = 0; P.sec = 0; P.us = 0;
    P.hour12 = 0; P.pm = 0; P.have_hour12 = 0;
    P.yday = 0; P.have_yday = 0; P.have_mday = 0;
    P.tz_min = 0; P.have_tz = 0;

    int64_t ip = 0;
    if (!pt_scan(spec.ptr, spec.len, s.ptr, s.len, &ip, &P)) return T_TIME_INVALID;
    pt_skip_ws(s.ptr, s.len, &ip);
    if (ip != s.len) return T_TIME_INVALID;      // 输入未被完全消耗：判失败，不做静默截断

    if (P.have_hour12) {
        int h = P.hour12 % 12;
        if (P.pm == 2) h += 12;
        P.hour = h;
    }

    int64_t days;
    if (P.have_yday && !P.have_mday) {
        days = t_days_from_civil(P.y, 1, 1) + (P.yday - 1);
    } else {
        days = t_days_from_civil(P.y, P.mon, P.mday);
    }
    int64_t sec = days * 86400 + (int64_t)P.hour * 3600 + (int64_t)P.min * 60 + P.sec;

    if (P.have_tz) {
        sec -= (int64_t)P.tz_min * 60;           // 串内偏移优先于 use_local
    } else if (use_local) {
        struct tm lt;
        memset(&lt, 0, sizeof(lt));
        lt.tm_year = (int)(P.y - 1900);
        lt.tm_mon = P.mon - 1;
        lt.tm_mday = P.mday;
        lt.tm_hour = P.hour; lt.tm_min = P.min; lt.tm_sec = P.sec;
        lt.tm_isdst = -1;                        // 交给 libc 判夏令时
        time_t lv = mktime(&lt);
        if (lv == (time_t)-1) return T_TIME_INVALID;
        sec = (int64_t)lv;
    }
    return sec * 1000000 + P.us;
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

// 定长数组 → 切片零拷贝视图：直接把已有缓冲包装成 TSlice，不分配、不拷贝。
// 用于编译期/运行期的 [N]T → []T 转型（array→slice cast）。
TSlice t_slice_from_raw(void* ptr, int64_t len, int64_t elem_size) {
    TSlice s;
    s.ptr = ptr;
    s.len = len;
    s.cap = len;
    s.elem_size = elem_size;
    return s;
}

// 切片合并 `++`（§15.6）：分配足以容纳 a.len+b.len 个元素的新缓冲，按元素大小逐段拷贝，
// 返回新 TSlice（len=cap=总和）。与 t_slice_new 同构、arena 分配。
TSlice t_slice_concat(TSlice a, TSlice b) {
    if (g_arena == NULL) t_fatal("t_slice_concat: arena not initialized");
    int64_t total = a.len + b.len;
    int64_t esz = a.elem_size;
    TSlice r = t_slice_new(esz);
    if (total > 0) {
        r.ptr = t_arena_alloc(g_arena, (size_t)(total * esz));
        r.cap = total;
        if (a.len > 0) memcpy(r.ptr, a.ptr, (size_t)(a.len * esz));
        if (b.len > 0) memcpy((uint8_t*)r.ptr + a.len * esz, b.ptr, (size_t)(b.len * esz));
    }
    r.len = total;
    return r;
}

// 定长数组合并 `[N]T ++ [M]T ⇒ [N+M]T`（§15.6）。
// 以「字节数」而非元素个数传参：元素尺寸由调用方（C 后端 sizeof(T)*N、LLVM 后端
// GEP-null-1）精确给出，避免运行时反推元素布局（结构体元素尤其不可反推）。
void* t_array_concat(void* a, int64_t abytes, void* b, int64_t bbytes) {
    if (g_arena == NULL) t_fatal("t_array_concat: arena not initialized");
    int64_t total = abytes + bbytes;
    if (total <= 0) { return NULL; }
    void* out = t_arena_alloc(g_arena, (size_t)total);
    if (abytes > 0 && a != NULL) memcpy(out, a, (size_t)abytes);
    if (bbytes > 0 && b != NULL) memcpy((uint8_t*)out + abytes, b, (size_t)bbytes);
    return out;
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

// 子切片 `s[a..b]`：O(1) 视图，与源共享底层缓冲。
// cap 收成 len —— 对子切片 append 必定触发扩容拷贝，不会踩写源切片的后续元素。
TSlice t_slice_sub(TSlice s, int64_t start, int64_t end) {
    if (start < 0 || end < start || end > s.len)
        t_panic_bounds(start < 0 ? start : end, s.len, "t_slice_sub");
    TSlice r;
    r.ptr = (uint8_t*)s.ptr + start * s.elem_size;
    r.len = end - start;
    r.cap = r.len;
    r.elem_size = s.elem_size;
    return r;
}

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

// map[K]V ++ map[K]V ⇒ map[K]V：把 a 的全部条目、再 b 的条目（b 命中键覆盖 a）灌入 out。
// key/val 类型一致性由前端保证。out 须已按 a 的 arena / key_kind / val_size 建好。
void t_map_concat_into(TMap* a, TMap* b, TMap* out) {
    if (a == NULL || b == NULL || out == NULL) t_fatal("t_map_concat_into: null map operand");
    int64_t kk = a->key_kind;
    int64_t na = t_map_count(a);
    for (int64_t i = 0; i < na; i++) {
        if (kk == 0) { TStr k = t_map_key_str_at(a, i); void* v = t_map_val_at(a, i); t_map_put(out, &k, v); }
        else { int64_t k = t_map_key_int_at(a, i); void* v = t_map_val_at(a, i); t_map_put(out, &k, v); }
    }
    int64_t nb = t_map_count(b);
    for (int64_t i = 0; i < nb; i++) {
        if (kk == 0) { TStr k = t_map_key_str_at(b, i); void* v = t_map_val_at(b, i); t_map_put(out, &k, v); }
        else { int64_t k = t_map_key_int_at(b, i); void* v = t_map_val_at(b, i); t_map_put(out, &k, v); }
    }
}

// map[K]V ++ map[K]V ⇒ map[K]V：新建 map（沿用 a 的 arena / key_kind / val_size），灌入两侧条目。
TMap* t_map_concat(TMap* a, TMap* b) {
    if (a == NULL || b == NULL) t_fatal("t_map_concat: null map operand");
    TMap* r = t_map_new(a->a, a->key_kind, a->val_size);
    t_map_concat_into(a, b, r);
    return r;
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

// ── Sym：字符串驻留符号池（M40）────────────────────────────────
// 每个 tag 一个池：去重哈希表 + id→(off,len) 表 + 字节 bump 缓冲。
// entries 存 bytes 内的偏移而非指针，故 bytes realloc 移动后仍有效。
// 池内存独立 malloc/free，sym_release 时可真正回收（arena 无法按池回收）。
struct TSymPool {
    int32_t* htab;          // 去重哈希表：hash(str)&(cap-1) → id+1（0=空槽），线性探测
    int64_t  htab_cap;      // 2 的幂
    int64_t  htab_used;
    int64_t* ent_off;       // id → 字符串在 bytes 中的偏移
    int64_t* ent_len;       // id → 字符串长度
    int64_t  ent_count, ent_cap;
    uint8_t* bytes;         // 所有字符串字节（bump，realloc 增长）
    int64_t  bytes_len, bytes_cap;
    int64_t  bits;          // 16 / 32（id 上限校验）
};

typedef struct { TStr tag; struct TSymPool* pool; } TSymRegItem;
// 轻量全局注册表（Symbols）：按 tag 索引所有池；仅查找/释放用，不在 intern 热路径分配。
static struct { TSymRegItem* items; int64_t len, cap; } g_sym_reg = { NULL, 0, 0 };

static uint64_t sym_hash(const uint8_t* p, int64_t n) {
    uint64_t h = 1469598103934665603ULL;
    for (int64_t i = 0; i < n; i++) { h ^= p[i]; h *= 1099511628211ULL; }
    return h;
}

static struct TSymPool* sym_pool_new(int64_t bits) {
    // ⚠ 必须是 mi_*：sym_pool_free 用 mi_free 释放，混用 libc calloc 会堆损坏
    //   （实测 sym_demo 在 sym_release 后静默截断输出）。
    struct TSymPool* p = (struct TSymPool*)mi_calloc(1, sizeof(struct TSymPool));
    if (!p) t_fatal("sym: pool malloc failed");
    p->htab_cap = 16;
    p->htab = (int32_t*)mi_calloc((size_t)p->htab_cap, sizeof(int32_t));
    p->ent_cap = 8;
    p->ent_off = (int64_t*)mi_malloc(sizeof(int64_t) * (size_t)p->ent_cap);
    p->ent_len = (int64_t*)mi_malloc(sizeof(int64_t) * (size_t)p->ent_cap);
    p->bytes_cap = 256;
    p->bytes = (uint8_t*)mi_malloc((size_t)p->bytes_cap);
    p->bits = bits;
    if (!p->htab || !p->ent_off || !p->ent_len || !p->bytes) t_fatal("sym: pool buffers malloc failed");
    return p;
}

static void sym_pool_free(struct TSymPool* p) {
    if (!p) return;
    mi_free(p->htab); mi_free(p->ent_off); mi_free(p->ent_len); mi_free(p->bytes);
    mi_free(p);
}

// 按 tag 查池；create!=0 时不存在则新建并登记进注册表
static struct TSymPool* sym_pool_for(TStr tag, int64_t bits, int create) {
    for (int64_t i = 0; i < g_sym_reg.len; i++)
        if (t_str_eq(g_sym_reg.items[i].tag, tag)) return g_sym_reg.items[i].pool;
    if (!create) return NULL;
    if (g_sym_reg.len >= g_sym_reg.cap) {
        int64_t nc = g_sym_reg.cap < 4 ? 4 : g_sym_reg.cap * 2;
        TSymRegItem* ni = (TSymRegItem*)mi_realloc(g_sym_reg.items, sizeof(TSymRegItem) * (size_t)nc);
        if (!ni) t_fatal("sym: registry realloc failed");
        g_sym_reg.items = ni; g_sym_reg.cap = nc;
    }
    // 注册表持有 tag 的稳定副本（便于 release 时释放）
    uint8_t* tb = (uint8_t*)mi_malloc((size_t)(tag.len > 0 ? tag.len : 1));
    if (!tb) t_fatal("sym: tag malloc failed");
    if (tag.len > 0) memcpy(tb, tag.ptr, (size_t)tag.len);
    TStr tcopy; tcopy.ptr = tb; tcopy.len = tag.len;
    struct TSymPool* p = sym_pool_new(bits);
    g_sym_reg.items[g_sym_reg.len].tag = tcopy;
    g_sym_reg.items[g_sym_reg.len].pool = p;
    g_sym_reg.len++;
    return p;
}

static void sym_htab_rehash(struct TSymPool* p) {
    int64_t oldcap = p->htab_cap;
    int32_t* old = p->htab;
    p->htab_cap *= 2;
    p->htab = (int32_t*)mi_calloc((size_t)p->htab_cap, sizeof(int32_t));
    if (!p->htab) t_fatal("sym: htab rehash failed");
    for (int64_t i = 0; i < oldcap; i++) {
        int32_t slot = old[i];
        if (slot != 0) {
            int64_t id = slot - 1;
            uint64_t h = sym_hash(p->bytes + p->ent_off[id], p->ent_len[id]);
            int64_t j = (int64_t)(h & (uint64_t)(p->htab_cap - 1));
            while (p->htab[j] != 0) j = (j + 1) & (p->htab_cap - 1);
            p->htab[j] = slot;
        }
    }
    mi_free(old);
}

uint32_t t_sym_intern(TStr tag, TStr str, int64_t bits) {
    struct TSymPool* p = sym_pool_for(tag, bits, 1);
    uint64_t h = sym_hash(str.ptr, str.len);
    int64_t idx = (int64_t)(h & (uint64_t)(p->htab_cap - 1));
    while (p->htab[idx] != 0) {   // 去重命中检查
        int64_t id = p->htab[idx] - 1;
        if (p->ent_len[id] == str.len &&
            (str.len == 0 || memcmp(p->bytes + p->ent_off[id], str.ptr, (size_t)str.len) == 0))
            return (uint32_t)id;
        idx = (idx + 1) & (p->htab_cap - 1);
    }
    // 新字符串：写入 bytes（必要时 realloc；entries 存偏移，移动安全）
    if (p->bytes_len + str.len > p->bytes_cap) {
        int64_t nc = p->bytes_cap;
        while (p->bytes_len + str.len > nc) nc *= 2;
        uint8_t* nb = (uint8_t*)mi_realloc(p->bytes, (size_t)nc);
        if (!nb) t_fatal("sym: bytes realloc failed");
        p->bytes = nb; p->bytes_cap = nc;
    }
    int64_t off = p->bytes_len;
    if (str.len > 0) memcpy(p->bytes + off, str.ptr, (size_t)str.len);
    p->bytes_len += str.len;
    // 新 entry
    if (p->ent_count >= p->ent_cap) {
        int64_t nc = p->ent_cap * 2;
        int64_t* no = (int64_t*)mi_realloc(p->ent_off, sizeof(int64_t) * (size_t)nc);
        int64_t* nl = (int64_t*)mi_realloc(p->ent_len, sizeof(int64_t) * (size_t)nc);
        if (!no || !nl) t_fatal("sym: entries realloc failed");
        p->ent_off = no; p->ent_len = nl; p->ent_cap = nc;
    }
    int64_t id = p->ent_count;
    if (bits == 16 && id >= 65535) t_fatal("sym: Sym16 pool overflow (>65535 strings)");
    p->ent_off[id] = off;
    p->ent_len[id] = str.len;
    p->ent_count++;
    p->htab[idx] = (int32_t)(id + 1);
    p->htab_used++;
    if (p->htab_used * 10 >= p->htab_cap * 7) sym_htab_rehash(p);
    return (uint32_t)id;
}

TStr t_sym_str(TStr tag, uint32_t id) {
    struct TSymPool* p = sym_pool_for(tag, 32, 0);
    if (!p || (int64_t)id >= p->ent_count) { TStr e; e.ptr = (const uint8_t*)""; e.len = 0; return e; }
    TStr r; r.ptr = p->bytes + p->ent_off[id]; r.len = p->ent_len[id]; return r;
}

// Atom：名字表由编译器发射到生成代码（t_atom_table[] / t_atom_count），此处还原名字。
// id 为 1-based（索引 0 是占位空串）；越界返回空串。
//
// 自举逃生阀：本函数 extern 引用编译器发射的 t_atom_table/t_atom_count。若手头的
// 引导编译器早于「发射原子表」这段逻辑，链接会报 undefined symbol。此时用
//   clang -c -DT_ATOM_BOOTSTRAP_STUB ... runtime/t_runtime.c
// 编一版桩运行时打通一代，再去掉宏用新编译器重建即可。日常构建不要定义此宏。
TStr t_atom_str(int64_t id) {
#ifdef T_ATOM_BOOTSTRAP_STUB
    (void)id; { TStr e; e.ptr = (const uint8_t*)""; e.len = 0; return e; }
#else
    if (id <= 0 || id >= t_atom_count) { TStr e; e.ptr = (const uint8_t*)""; e.len = 0; return e; }
    return t_atom_table[id];
#endif
}

void t_sym_release(TStr tag) {
    for (int64_t i = 0; i < g_sym_reg.len; i++) {
        if (t_str_eq(g_sym_reg.items[i].tag, tag)) {
            sym_pool_free(g_sym_reg.items[i].pool);
            mi_free((void*)g_sym_reg.items[i].tag.ptr);
            for (int64_t j = i; j < g_sym_reg.len - 1; j++) g_sym_reg.items[j] = g_sym_reg.items[j + 1];
            g_sym_reg.len--;
            return;
        }
    }
}

void t_sym_release_all(void) {
    for (int64_t i = 0; i < g_sym_reg.len; i++) {
        sym_pool_free(g_sym_reg.items[i].pool);
        mi_free((void*)g_sym_reg.items[i].tag.ptr);
    }
    mi_free(g_sym_reg.items);
    g_sym_reg.items = NULL; g_sym_reg.len = 0; g_sym_reg.cap = 0;
}

// ── 文件 I/O 与进程 ───────────────────────────────────────────
TStr t_file_read_all(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "{\"error\":\"io\",\"op\":\"read\",\"path\":\"%s\"}\n", path); exit(1); }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    if (sz < 0) { fclose(f); t_fatal("file_read_all: ftell failed"); }
    fseek(f, 0, SEEK_SET);
    uint8_t* buf = (uint8_t*)mi_malloc((size_t)sz + 1);
    if (!buf) { fclose(f); t_fatal("file_read_all: malloc failed"); }
    size_t rd = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    if ((long)rd != sz) { mi_free(buf); t_fatal("file_read_all: read mismatch"); }
    buf[sz] = '\0'; // 便于当作 cstr 使用
    TStr r; r.ptr = buf; r.len = (int64_t)sz; return r; // 注意：此处用 malloc，由调用方持有至进程结束
}

// getenv(name) -> string：读取进程环境变量；未设置返回空串（不 panic）。
// ── REPL 交互输入（M-REPL）─────────────────────────────────────
// read_line()：从标准输入读取一行（去除结尾 \r\n），遇 EOF 返回空串并置 g_stdin_eof。
// 用于 tc 的 REPL 模式交互读取；行缓冲按需增长，最终副本存进 arena（进程退出时回收）。
TStr t_read_line(void) {
    size_t cap = 256;
    char* buf = (char*)mi_malloc(cap);
    if (!buf) t_fatal("read_line: malloc failed");
    int c = fgetc(stdin);
    if (c == EOF) {
        g_stdin_eof = 1;
        mi_free(buf);
        return t_str_from_c("");
    }
    ungetc(c, stdin);   // 把首字符放回，统一在循环里处理（含 CRLF）
    size_t alloc = cap;
    size_t len = 0;
    while (1) {
        if (len + 1 >= alloc) {
            alloc *= 2;
            char* nb = (char*)mi_realloc(buf, alloc);
            if (!nb) t_fatal("read_line: realloc failed");
            buf = nb;
        }
        c = fgetc(stdin);
        if (c == EOF || c == '\n') break;
        if (c == '\r') continue;   // 跳过 Windows 行尾 \r
        buf[len++] = (char)c;
    }
    buf[len] = '\0';
    uint8_t* p = (uint8_t*)t_arena_alloc(g_arena, len + 1);
    memcpy(p, buf, len + 1);
    mi_free(buf);
    TStr r; r.ptr = p; r.len = (int64_t)len; return r;
}

int t_stdin_eof(void) {
    return g_stdin_eof;
}

TStr t_getenv(const char* name) {
    const char* e = getenv(name);
    if (!e) { e = ""; }
    return t_str_from_c(e);
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

// ── 测试内建（@panic / @assert / @assert_eq）──
void t_panic(TStr msg) {
    fwrite("panic: ", 1, 7, stderr);
    if (msg.len > 0) fwrite(msg.ptr, 1, (size_t)msg.len, stderr);
    fputc('\n', stderr);
    fflush(stderr);
    exit(1);
}

void t_assert(int8_t cond, TStr msg) {
    if (!cond) { t_panic(msg); }
}

static void t_assert_fail(TStr msg, const char* detail) {
    fwrite("assertion failed: ", 1, 17, stderr);
    if (msg.len > 0) fwrite(msg.ptr, 1, (size_t)msg.len, stderr);
    if (detail != NULL) {
        fputc(' ', stderr);
        fwrite(detail, 1, strlen(detail), stderr);
    }
    fputc('\n', stderr);
    fflush(stderr);
    exit(1);
}

void t_assert_eq_i64(int64_t a, int64_t b, TStr msg) {
    if (a != b) {
        char d[64];
        snprintf(d, sizeof d, "(expected: %lld, got: %lld)", (long long)a, (long long)b);
        t_assert_fail(msg, d);
    }
}
void t_assert_eq_u64(uint64_t a, uint64_t b, TStr msg) {
    if (a != b) {
        char d[64];
        snprintf(d, sizeof d, "(expected: %llu, got: %llu)", (unsigned long long)a, (unsigned long long)b);
        t_assert_fail(msg, d);
    }
}
void t_assert_eq_f64(double a, double b, TStr msg) {
    if (a != b) {
        char d[64];
        snprintf(d, sizeof d, "(expected: %g, got: %g)", a, b);
        t_assert_fail(msg, d);
    }
}
void t_assert_eq_f32(float a, float b, TStr msg) {
    if (a != b) {
        char d[64];
        snprintf(d, sizeof d, "(expected: %g, got: %g)", (double)a, (double)b);
        t_assert_fail(msg, d);
    }
}
void t_assert_eq_b(int8_t a, int8_t b, TStr msg) {
    if (a != b) {
        char d[64];
        snprintf(d, sizeof d, "(expected: %s, got: %s)", a ? "true" : "false", b ? "true" : "false");
        t_assert_fail(msg, d);
    }
}
void t_assert_eq_s(TStr a, TStr b, TStr msg) {
    int eq = (a.len == b.len) && (a.len == 0 || memcmp(a.ptr, b.ptr, (size_t)a.len) == 0);
    if (!eq) {
        char d[160];
        snprintf(d, sizeof d, "(expected: \"%.*s\", got: \"%.*s\")",
            (int)a.len, (char*)a.ptr, (int)b.len, (char*)b.ptr);
        t_assert_fail(msg, d);
    }
}

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
int64_t     t_fi_tag(TFieldInfo* fi)         { return fi->tag; }

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

// ═══════════════════════════════════════════════════════════════
// Fid：文件描述符句柄 + 序列化操作符（M51）
// 句柄即 i64 下标。0/1/2 恒为 stdin/stdout/stderr。
// mode/kind/fmt 均为编译期降下来的小整数码，运行时零字符串比较。
// 格式在 t_fopen 时按 (kind, 后缀) 查注册表一次性解析并冻结进句柄记录。
// ═══════════════════════════════════════════════════════════════

#define T_FMT_TEXT     0
#define T_FMT_JSON     1
#define T_FMT_RAWBIN   2
#define T_FMT_PROTOBUF 3

#define T_FID_MAX 256
#define T_FMT_REG_MAX 64
#define T_FID_SUF_MAX 16

typedef struct TFidRec {
    FILE*   fp;
    int32_t fmt;     // T_FMT_*
    int32_t binary;  // 0=text 1=binary
    int32_t open;
    int32_t is_std;  // 标准流不可关闭
    char    err[128];// 最近一次错误描述（fid_error 查询用）
} TFidRec;

typedef struct TFmtReg {
    int32_t kind;                  // 0=text 1=binary
    char    suffix[T_FID_SUF_MAX]; // 不含点，全小写
    int32_t fmt;
} TFmtReg;

static TFidRec g_fids[T_FID_MAX];
static TFmtReg g_fmt_reg[T_FMT_REG_MAX];
static int32_t g_fmt_reg_count = 0;
static int32_t g_fid_inited = 0;
static char    g_fid_open_err[256]; // 最近一次 fopen 失败原因（fid == -1 时查）

static char fid_lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c; }

// 后注册覆盖先注册：同 (kind, suffix) 就地改写，否则追加。
static void fmt_reg_put(int32_t kind, const char* suffix, int32_t fmt) {
    char buf[T_FID_SUF_MAX];
    int  n = 0;
    if (suffix) {
        while (suffix[n] && n < T_FID_SUF_MAX - 1) { buf[n] = fid_lower(suffix[n]); n++; }
    }
    buf[n] = 0;
    for (int32_t i = 0; i < g_fmt_reg_count; i++) {
        if (g_fmt_reg[i].kind == kind && strcmp(g_fmt_reg[i].suffix, buf) == 0) {
            g_fmt_reg[i].fmt = fmt;
            return;
        }
    }
    if (g_fmt_reg_count >= T_FMT_REG_MAX) t_fatal("fmt_register: 注册表已满");
    g_fmt_reg[g_fmt_reg_count].kind = kind;
    memcpy(g_fmt_reg[g_fmt_reg_count].suffix, buf, (size_t)n + 1);
    g_fmt_reg[g_fmt_reg_count].fmt = fmt;
    g_fmt_reg_count++;
}

static void fid_init(void) {
    if (g_fid_inited) return;
    g_fid_inited = 1;
    for (int32_t i = 0; i < T_FID_MAX; i++) {
        g_fids[i].fp = NULL; g_fids[i].fmt = T_FMT_TEXT;
        g_fids[i].binary = 0; g_fids[i].open = 0; g_fids[i].is_std = 0; g_fids[i].err[0] = 0;
    }
    g_fids[0].fp = stdin;  g_fids[0].open = 1; g_fids[0].is_std = 1;
    g_fids[1].fp = stdout; g_fids[1].open = 1; g_fids[1].is_std = 1;
    g_fids[2].fp = stderr; g_fids[2].open = 1; g_fids[2].is_std = 1;
    // 内建后缀挂靠：文本 .json → json；二进制 .pb → protobuf
    fmt_reg_put(0, "json", T_FMT_JSON);
    fmt_reg_put(1, "pb",   T_FMT_PROTOBUF);
}

// 取路径最后一段的后缀（不含点，小写）。无后缀返回空串。
static void fid_suffix_of(const char* path, char* out) {
    int   dot = -1;
    int   i;
    out[0] = 0;
    if (!path) return;
    for (i = 0; path[i]; i++) {
        if (path[i] == '/' || path[i] == '\\') dot = -1;
        else if (path[i] == '.') dot = i;
    }
    if (dot < 0) return;
    int n = 0;
    for (i = dot + 1; path[i] && n < T_FID_SUF_MAX - 1; i++) out[n++] = fid_lower(path[i]);
    out[n] = 0;
}

static int32_t fid_resolve_fmt(int32_t kind, const char* suffix) {
    for (int32_t i = g_fmt_reg_count - 1; i >= 0; i--) {
        if (g_fmt_reg[i].kind == kind && strcmp(g_fmt_reg[i].suffix, suffix) == 0)
            return g_fmt_reg[i].fmt;
    }
    return (kind == 1) ? T_FMT_RAWBIN : T_FMT_TEXT;
}

int64_t t_fopen(const char* path, int32_t mode) {
    fid_init();
    const char* ms;
    int32_t binary = (mode >= 3) ? 1 : 0;
    switch (mode) {
        case 0: ms = "r";  break;
        case 1: ms = "w";  break;
        case 2: ms = "a";  break;
        case 3: ms = "rb"; break;
        case 4: ms = "wb"; break;
        case 5: ms = "ab"; break;
        default: t_fatal("fopen: 非法打开方式码"); return -1;
    }
    FILE* fp = fopen(path, ms);
    if (!fp) { snprintf(g_fid_open_err, sizeof(g_fid_open_err), "fopen '%s': %s", path ? path : "", strerror(errno)); return -1; }
    int32_t slot = -1;
    for (int32_t i = 3; i < T_FID_MAX; i++) { if (!g_fids[i].open) { slot = i; break; } }
    if (slot < 0) { snprintf(g_fid_open_err, sizeof(g_fid_open_err), "fopen '%s': 文件描述符表已满", path ? path : ""); fclose(fp); t_fatal("fopen: 文件描述符表已满"); return -1; }
    char suf[T_FID_SUF_MAX];
    fid_suffix_of(path, suf);
    g_fids[slot].fp     = fp;
    g_fids[slot].binary = binary;
    g_fids[slot].fmt    = fid_resolve_fmt(binary, suf);
    g_fids[slot].open   = 1;
    g_fids[slot].is_std = 0;
    return (int64_t)slot;
}

// 记录句柄最近一次错误原因（fid_error 查询用）。语义是「最近一次错误」：
// 成功路径**不清空**，故调用方可在若干次写之后统一探测。越界槽位静默忽略。
static void fid_set_err(int64_t f, const char* op, const char* why) {
    if (f < 0 || f >= T_FID_MAX) return;
    snprintf(g_fids[f].err, sizeof(g_fids[f].err), "%s: %s", op, why ? why : "未知错误");
}

// stdio 的写失败只置流错误标志，不逐调用返回；须显式 ferror 才能发现。
static void fid_check_write(int64_t f, TFidRec* r, const char* op) {
    if (!r || !r->fp) return;
    if (ferror(r->fp)) { fid_set_err(f, op, strerror(errno)); clearerr(r->fp); }
}

static TFidRec* fid_get(int64_t f) {
    fid_init();
    if (f < 0 || f >= T_FID_MAX) { t_fatal("fid: 非法文件描述符"); return NULL; }
    if (!g_fids[f].open)         { fid_set_err(f, "fid", "文件描述符已关闭或未打开");
                                   t_fatal("fid: 文件描述符已关闭或未打开"); return NULL; }
    return &g_fids[f];
}

void t_fclose(int64_t f) {
    TFidRec* r = fid_get(f);
    if (r->is_std) { fid_set_err(f, "fclose", "标准流不可关闭"); t_fatal("fclose: 标准流不可关闭"); }
    if (fclose(r->fp) != 0) fid_set_err(f, "fclose", strerror(errno));
    r->fp = NULL;
    r->open = 0;
}

void t_fflush(int64_t f) {
    TFidRec* r = fid_get(f);
    if (fflush(r->fp) != 0) fid_set_err(f, "fflush", strerror(errno));
    fid_check_write(f, r, "fflush");
}

int32_t t_fid_is_open(int64_t f) {
    fid_init();
    if (f < 0 || f >= T_FID_MAX) return 0;
    return g_fids[f].open ? 1 : 0;
}

// 查询句柄最近一次错误描述。f == -1 取自 fopen 失败原因；非法/未开句柄返回空串（不 panic，符合 D6/L-09）。
TStr t_fid_error(int64_t f) {
    if (f == -1) return t_str_from_c(g_fid_open_err);
    if (f < 0 || f >= T_FID_MAX) { TStr e; e.ptr = (const uint8_t*)""; e.len = 0; return e; }
    return t_str_from_c(g_fids[f].err);
}

// 是否已到结尾或出错（读路径探针，与 fid_is_open / fid_error 同族）。
// 无效/已关闭句柄或流错误一律返 1（不能再读），并写 fid_error；正常且未到尾返 0。
// 注意：单纯 EOF 不写 fid_error（EOF 是预期结束，应由 fid_eof 表达，见 §3.9.1 Option B）。
static TFidRec* fid_try(int64_t f);   // 前向声明（定义见下方 fseek 段）
// 语义是「还有没有下一个字节可读」，而**不是** C 的 feof —— feof 要等到一次读越界之后
// 才置位，恰好读完全部内容时它仍为假，`while (!fid_eof(f))` 会凭空多转一圈。
// 故这里做一字节前瞻（getc + ungetc）。纯 EOF 不写 fid_error（EOF 不是错误）。
int32_t t_fid_eof(int64_t f) {
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "fid_eof", "无效或已关闭的文件描述符"); return 1; }
    if (ferror(r->fp)) { fid_set_err(f, "fid_eof", strerror(errno)); return 1; }
    if (feof(r->fp)) return 1;
    int c = getc(r->fp);
    if (c == EOF) {
        if (ferror(r->fp)) { fid_set_err(f, "fid_eof", strerror(errno)); clearerr(r->fp); }
        return 1;
    }
    ungetc(c, r->fp);
    return 0;
}

// ── 定位 / 随机访问（fseek / ftell）───────────────────────────
// 与 fid_get 不同，这两个内建**不 panic**：无效/已关闭句柄写 err 后返回失败值
// （fseek→false，ftell→-1），由调用方用 fid_error 显式取因（L-02 / L-09）。
// 用 64 位定位原语，避免 Windows 上 long 只有 32 位导致 >2GB 文件截断。
#if defined(_WIN32)
  #define T_FSEEK_SET(fp, off) _fseeki64((fp), (off), SEEK_SET)
  #define T_FTELL(fp)          _ftelli64(fp)
#else
  #define T_FSEEK_SET(fp, off) fseeko((fp), (off_t)(off), SEEK_SET)
  #define T_FTELL(fp)          ((int64_t)ftello(fp))
#endif

static TFidRec* fid_try(int64_t f) {
    fid_init();
    if (f < 0 || f >= T_FID_MAX) return NULL;
    if (!g_fids[f].open)         return NULL;
    return &g_fids[f];
}

int32_t t_fseek(int64_t f, int64_t off) {
    TFidRec* r = fid_try(f);
    if (!r)      { fid_set_err(f, "fseek", "无效或已关闭的文件描述符"); return 0; }
    if (off < 0) { fid_set_err(f, "fseek", "偏移不能为负"); return 0; }
    if (T_FSEEK_SET(r->fp, off) != 0) { fid_set_err(f, "fseek", strerror(errno)); return 0; }
    clearerr(r->fp);   // 定位成功即清 EOF 标志，否则读到尾后再 seek 回去仍读不出
    return 1;
}

int64_t t_ftell(int64_t f) {
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "ftell", "无效或已关闭的文件描述符"); return -1; }
    int64_t p = (int64_t)T_FTELL(r->fp);
    if (p < 0) { fid_set_err(f, "ftell", strerror(errno)); return -1; }
    return p;
}

int64_t t_fid_format(int64_t f, int64_t a_text, int64_t a_json, int64_t a_raw, int64_t a_pb) {
    TFidRec* r = fid_get(f);
    switch (r->fmt) {
        case T_FMT_JSON:     return a_json;
        case T_FMT_RAWBIN:   return a_raw;
        case T_FMT_PROTOBUF: return a_pb;
        default:             return a_text;
    }
}

void t_fmt_register(int32_t kind, const char* suffix, int32_t fmt) {
    fid_init();
    fmt_reg_put(kind, suffix, fmt);
}

// ── 序列化：一律返回目标 fid，`f < a < b` 落成嵌套调用 ──────────
static void ser_raw(TFidRec* r, const void* p, size_t n) { fwrite(p, 1, n, r->fp); }

static void ser_pb_unsupported(void) { t_fatal("ser: protobuf 格式尚未实现（v1）"); }

// 序列化统一出口：探测写失败并落 err，再返回目标 fid（`f < a < b` 靠返回值串联）。
static int64_t ser_done(int64_t f, TFidRec* r) { fid_check_write(f, r, "serialize"); return f; }

int64_t t_ser_int(int64_t f, int64_t v, int32_t bits, int32_t sgn) {
    TFidRec* r = fid_get(f);
    if (r->fmt == T_FMT_PROTOBUF) ser_pb_unsupported();
    if (r->fmt == T_FMT_RAWBIN) {
        size_t n = (size_t)(bits / 8);
        if (n == 0 || n > 8) n = 8;
        uint64_t u = (uint64_t)v;
        uint8_t  b[8];
        for (size_t i = 0; i < n; i++) b[i] = (uint8_t)((u >> (8 * i)) & 0xFF); // little-endian
        ser_raw(r, b, n);
        return ser_done(f, r);
    }
    if (sgn) fprintf(r->fp, "%lld", (long long)v);
    else     fprintf(r->fp, "%llu", (unsigned long long)(uint64_t)v);
    return ser_done(f, r);
}

int64_t t_ser_f64(int64_t f, double v, int32_t bits) {
    TFidRec* r = fid_get(f);
    if (r->fmt == T_FMT_PROTOBUF) ser_pb_unsupported();
    if (r->fmt == T_FMT_RAWBIN) {
        if (bits == 32) { float g = (float)v; ser_raw(r, &g, 4); }
        else            { ser_raw(r, &v, 8); }
        return ser_done(f, r);
    }
    fprintf(r->fp, "%g", v);
    return ser_done(f, r);
}

int64_t t_ser_bool(int64_t f, int8_t v) {
    TFidRec* r = fid_get(f);
    if (r->fmt == T_FMT_PROTOBUF) ser_pb_unsupported();
    if (r->fmt == T_FMT_RAWBIN) { uint8_t b = v ? 1u : 0u; ser_raw(r, &b, 1); return ser_done(f, r); }
    fputs(v ? "true" : "false", r->fp);
    return ser_done(f, r);
}

// JSON 字符串转义：双引号、反斜杠与控制字符。
static void ser_json_str(TFidRec* r, const uint8_t* p, int64_t n) {
    fputc('"', r->fp);
    for (int64_t i = 0; i < n; i++) {
        uint8_t c = p[i];
        if (c == '"')       fputs("\\\"", r->fp);
        else if (c == '\\') fputs("\\\\", r->fp);
        else if (c == '\n') fputs("\\n", r->fp);
        else if (c == '\r') fputs("\\r", r->fp);
        else if (c == '\t') fputs("\\t", r->fp);
        else if (c < 0x20)  fprintf(r->fp, "\\u%04x", (unsigned)c);
        else                fputc((int)c, r->fp);
    }
    fputc('"', r->fp);
}

int64_t t_ser_atom(int64_t f, int64_t id) {
    TFidRec* r = fid_get(f);
    if (r->fmt == T_FMT_PROTOBUF) ser_pb_unsupported();
    if (r->fmt == T_FMT_RAWBIN) {
        uint64_t u = (uint64_t)id;
        uint8_t  b[8];
        for (size_t i = 0; i < 8; i++) b[i] = (uint8_t)((u >> (8 * i)) & 0xFF);
        ser_raw(r, b, 8);
        return ser_done(f, r);
    }
    TStr nm = t_atom_str(id);
    if (r->fmt == T_FMT_JSON) { ser_json_str(r, nm.ptr, nm.len); return ser_done(f, r); }
    if (nm.len > 0) fwrite(nm.ptr, 1, (size_t)nm.len, r->fp);
    return ser_done(f, r);
}

int64_t t_ser_str(int64_t f, TStr s) {
    TFidRec* r = fid_get(f);
    if (r->fmt == T_FMT_PROTOBUF) ser_pb_unsupported();
    if (r->fmt == T_FMT_RAWBIN) {
        uint64_t u = (uint64_t)s.len;
        uint8_t  b[8];
        for (size_t i = 0; i < 8; i++) b[i] = (uint8_t)((u >> (8 * i)) & 0xFF);
        ser_raw(r, b, 8);                                  // 8 字节 LE 长度前缀
        if (s.len > 0) ser_raw(r, s.ptr, (size_t)s.len);
        return ser_done(f, r);
    }
    if (r->fmt == T_FMT_JSON) { ser_json_str(r, s.ptr, s.len); return ser_done(f, r); }
    if (s.len > 0) fwrite(s.ptr, 1, (size_t)s.len, r->fp);
    return ser_done(f, r);
}

// ── 反序列化（读路径，M52 读路径，Option B：裸 T + fid_eof 探针）────────
// EOF/错误返回默认值（数值 0 / 空串），调用方用 fid_eof / fid_error 显式探测（L-02 显式）。
// 各格式与写路径镜像：:text 按空白切 token；:json 解析下一 JSON 值；:rawbin 按静态位宽读小端、
//   string 先读 u64 长度前缀；:protobuf 留 v2。

// 读 n 字节；短读/EOF 返 0（调用方用 fid_eof 探测）；I/O 错误写 err 后仍返 0。
static int64_t deser_read_raw(TFidRec* r, uint8_t* b, size_t n) {
    if (n == 0) return (int64_t)n;
    size_t got = fread(b, 1, n, r->fp);
    if (got != n) {
        if (ferror(r->fp)) fid_set_err((int64_t)(r - g_fids), "deserialize", strerror(errno));
        return 0;
    }
    return (int64_t)n;
}

// 跳过空白，读一个非空白 token 到 buf（不含结尾 \0），返回 token 长度；EOF 返 -1。
static int64_t deser_next_token(TFidRec* r, char* buf, int64_t cap) {
    int c = fgetc(r->fp);
    while (c != EOF && isspace(c)) c = fgetc(r->fp);
    if (c == EOF) return -1;
    int64_t n = 0;
    while (c != EOF && !isspace(c)) {
        if (n < cap - 1) buf[n++] = (char)c;
        c = fgetc(r->fp);
    }
    if (c != EOF) ungetc(c, r->fp);
    buf[n] = 0;
    return n;
}

// JSON 字符串：跳过前导空白与开引号，读到闭引号，处理 \" \\ \n \r \t \/ \uXXXX（简化）。
// 成功返回新分配缓冲（t_alloc）且 *out_len >= 0；格式错 *out_len = -1；非字符串值 *out_len = 0 且返 NULL。
static uint8_t* deser_json_str(TFidRec* r, int64_t* out_len) {
    int c = fgetc(r->fp);
    while (c != EOF && isspace(c)) c = fgetc(r->fp);
    if (c != '"') { if (c != EOF) ungetc(c, r->fp); *out_len = 0; return NULL; }
    int64_t cap = 4096, len = 0;
    uint8_t* buf = (uint8_t*)t_alloc((size_t)cap);
    while (1) {
        c = fgetc(r->fp);
        if (c == EOF) { *out_len = -1; return buf; }
        if (c == '"') break;
        if (c == '\\') {
            c = fgetc(r->fp);
            if (c == EOF) { *out_len = -1; return buf; }
            int outc;
            if (c == 'n') outc = '\n';
            else if (c == 't') outc = '\t';
            else if (c == 'r') outc = '\r';
            else if (c == '"') outc = '"';
            else if (c == '\\') outc = '\\';
            else if (c == '/') outc = '/';
            else if (c == 'u') {
                int v = 0;
                for (int k = 0; k < 4; k++) {
                    int h = fgetc(r->fp);
                    if (h == EOF) { *out_len = -1; return buf; }
                    v = v * 16 + (isdigit(h) ? h - '0' : tolower(h) - 'a' + 10);
                }
                outc = v & 0xFF;
            } else outc = c;
            c = outc;
        }
        if (len >= cap) { fid_set_err((int64_t)(r - g_fids), "deserialize", "JSON 字符串过长（>4096）"); break; }
        buf[len++] = (uint8_t)c;
    }
    *out_len = len;
    return buf;
}

int64_t t_deser_int(int64_t f, int32_t bits, int32_t sgn) {
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "deserialize", "无效或已关闭的文件描述符"); return 0; }
    if (r->fmt == T_FMT_PROTOBUF) { t_fatal("deser: protobuf 格式尚未实现（v1）"); return 0; }
    if (r->fmt == T_FMT_RAWBIN) {
        size_t n = (size_t)(bits / 8); if (n == 0 || n > 8) n = 8;
        uint8_t b[8] = {0};
        if (deser_read_raw(r, b, n) == 0) return 0;   // EOF/错误：默认 0，fid_eof 探测
        uint64_t u = 0;
        for (size_t i = 0; i < n; i++) u |= ((uint64_t)b[i]) << (8 * i);
        if (sgn) { int sh = 64 - bits; u = (uint64_t)((int64_t)(u << sh) >> sh); }
        return (int64_t)u;
    }
    char buf[64];
    if (deser_next_token(r, buf, sizeof buf) < 0) return 0;
    if (sgn) return (int64_t)strtoll(buf, NULL, 10);
    return (int64_t)strtoull(buf, NULL, 10);
}

double t_deser_f64(int64_t f, int32_t bits) {
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "deserialize", "无效或已关闭的文件描述符"); return 0.0; }
    if (r->fmt == T_FMT_PROTOBUF) { t_fatal("deser: protobuf 格式尚未实现（v1）"); return 0.0; }
    if (r->fmt == T_FMT_RAWBIN) {
        if (bits == 32) { float g; if (deser_read_raw(r, (uint8_t*)&g, 4) == 0) return 0.0; return (double)g; }
        double v; if (deser_read_raw(r, (uint8_t*)&v, 8) == 0) return 0.0; return v;
    }
    char buf[64];
    if (deser_next_token(r, buf, sizeof buf) < 0) return 0.0;
    return strtod(buf, NULL);
}

int8_t t_deser_bool(int64_t f) {
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "deserialize", "无效或已关闭的文件描述符"); return 0; }
    if (r->fmt == T_FMT_PROTOBUF) { t_fatal("deser: protobuf 格式尚未实现（v1）"); return 0; }
    if (r->fmt == T_FMT_RAWBIN) {
        uint8_t b; if (deser_read_raw(r, &b, 1) == 0) return 0; return b ? 1 : 0;
    }
    char buf[16];
    if (deser_next_token(r, buf, sizeof buf) < 0) return 0;
    if (strcmp(buf, "true") == 0 || strcmp(buf, "1") == 0) return 1;
    return 0;
}

int64_t t_deser_atom(int64_t f) {
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "deserialize", "无效或已关闭的文件描述符"); return 0; }
    if (r->fmt == T_FMT_PROTOBUF) { t_fatal("deser: protobuf 格式尚未实现（v1）"); return 0; }
    if (r->fmt == T_FMT_RAWBIN) {
        uint8_t b[8];
        if (deser_read_raw(r, b, 8) == 0) return 0;
        uint64_t u = 0; for (int i = 0; i < 8; i++) u |= ((uint64_t)b[i]) << (8 * i);
        return (int64_t)u;
    }
    char buf[64];
    if (deser_next_token(r, buf, sizeof buf) < 0) return 0;
#ifndef T_ATOM_BOOTSTRAP_STUB
    for (int64_t i = 1; i < t_atom_count; i++) {
        TStr nm = t_atom_str(i);
        if (nm.len == (int64_t)strlen(buf) && strncmp((const char*)nm.ptr, buf, (size_t)nm.len) == 0) return i;
    }
#endif
    fid_set_err(f, "deserialize", "未识别的 atom 名");
    return 0;
}

TStr t_deser_str(int64_t f) {
    TStr out; out.ptr = (const uint8_t*)""; out.len = 0;
    TFidRec* r = fid_try(f);
    if (!r) { fid_set_err(f, "deserialize", "无效或已关闭的文件描述符"); return out; }
    if (r->fmt == T_FMT_PROTOBUF) { t_fatal("deser: protobuf 格式尚未实现（v1）"); return out; }
    if (r->fmt == T_FMT_RAWBIN) {
        uint8_t b[8];
        if (deser_read_raw(r, b, 8) == 0) return out;   // EOF/错误：空串
        uint64_t u = 0; for (int i = 0; i < 8; i++) u |= ((uint64_t)b[i]) << (8 * i);
        int64_t n = (int64_t)u;
        if (n <= 0) return out;
        uint8_t* p = (uint8_t*)t_alloc((size_t)n);
        if (deser_read_raw(r, p, (size_t)n) == 0) { out.ptr = p; out.len = 0; return out; }  // 短读/EOF：空串
        out.ptr = p; out.len = n; return out;
    }
    if (r->fmt == T_FMT_JSON) {
        int64_t n = 0; uint8_t* p = deser_json_str(r, &n);
        if (n < 0) { fid_set_err(f, "deserialize", "JSON 字符串格式错误"); return out; }
        out.ptr = p; out.len = n; return out;
    }
    // :text：读下一 token（空白分隔；含空格的字符串无法 round-trip，属已知限制）
    char buf[4096];
    int64_t n = deser_next_token(r, buf, sizeof buf);
    if (n < 0) return out;
    uint8_t* p = (uint8_t*)t_alloc((size_t)n);
    for (int64_t i = 0; i < n; i++) p[i] = (uint8_t)buf[i];
    out.ptr = p; out.len = n; return out;
}

// ── 数学内建运行时包装实现（t_math_*）────────────────────────────
// ⚠ 弃用系统 libm：所有浮点数学经 vendored fdlibm（runtime/fdlibm）实现。
//   fdlibm 的公开符号（sin/cos/pow/…）在编译期被 -D 重命名为 tfd_*
//   （见 tools/build_runtime.mjs 的 FD_RENAME）：既避免与宿主 CRT 同名符号
//   争用，也防止宿主 <math.h> 把 sin/cos 等声明成 intrinsic 后绕开 fdlibm。
//   内部内核 __ieee754_* / __kernel_* 保持原名，本文件不直接引用。
// 故此处**不再** include <math.h>；isnan/signbit 等分类谓词用编译器内建，
// 它们不属于 libm（不产生任何库调用）。

// —— fdlibm 提供的 f64 公开符号（重命名后）——
extern double tfd_sin(double);
extern double tfd_cos(double);
extern double tfd_tan(double);
extern double tfd_asin(double);
extern double tfd_acos(double);
extern double tfd_atan(double);
extern double tfd_atan2(double, double);
extern double tfd_exp(double);
extern double tfd_log(double);
extern double tfd_log10(double);
extern double tfd_pow(double, double);
extern double tfd_sinh(double);
extern double tfd_cosh(double);
extern double tfd_tanh(double);
extern double tfd_sqrt(double);
extern double tfd_fmod(double, double);
extern double tfd_fabs(double);
extern double tfd_floor(double);
extern double tfd_ceil(double);
extern double tfd_expm1(double);
extern double tfd_log1p(double);
extern double tfd_hypot(double, double);
extern double tfd_cbrt(double);
extern double tfd_copysign(double, double);
extern double tfd_nextafter(double, double);
extern double tfd_remainder(double, double);

// —— fdlibm 未提供、在此补齐的 8 个符号（严格基于上面的 tfd_* 实现）——
static const double T_LN2 = 0.693147180559945309417232121458176568;

static double tfd_trunc(double x) {
    // floor / ceil 对 |x| ≥ 2^52 原样返回，对 NaN 透传 NaN，无需额外分支。
    return (x >= 0.0) ? tfd_floor(x) : tfd_ceil(x);
}
static double tfd_round(double x) {
    // 四舍五入、半数远离零（round() 语义）；大数 x±0.5 == x，结果即 x。
    return (x >= 0.0) ? tfd_floor(x + 0.5) : tfd_ceil(x - 0.5);
}
static double tfd_exp2(double x) { return tfd_pow(2.0, x); }
static double tfd_log2(double x) { return tfd_log(x) / T_LN2; }
static double tfd_fmin(double a, double b) {
    if (__builtin_isnan(a)) return b;
    if (__builtin_isnan(b)) return a;
    return (a < b) ? a : b;   // ±0 由比较决定，与 fmin 一致
}
static double tfd_fmax(double a, double b) {
    if (__builtin_isnan(a)) return b;
    if (__builtin_isnan(b)) return a;
    return (a > b) ? a : b;
}
static double tfd_fdim(double a, double b) {
    if (__builtin_isnan(a) || __builtin_isnan(b)) return a - b;   // NaN 传播
    if (a <= b) return 0.0;
    return a - b;
}
// 无硬件 FMA 时的正确舍入 fused multiply-add（Dekker two-product + two-sum 补偿）。
// ⚠ 不可用 __builtin_fma：无 FMA 指令时会退化成对 libm fma() 的调用（已弃用）。
static void tfdx_two_sum(double a, double b, double* s, double* e) {
    double x = a + b;
    double bb = x - a;
    *e = (a - (x - bb)) + (b - bb);
    *s = x;
}
static void tfdx_two_prod(double a, double b, double* p, double* e) {
    const double SPLIT = 134217729.0;   // 2^27 + 1
    double t = a * SPLIT; double ah = t - (t - a); double al = a - ah;
    t = b * SPLIT;        double bh = t - (t - b); double bl = b - bh;
    *p = a * b;
    *e = ((ah * bh - *p) + ah * bl + al * bh) + al * bl;
}
static double tfd_fma(double a, double b, double c) {
    if (!__builtin_isfinite(a) || !__builtin_isfinite(b) || !__builtin_isfinite(c)) {
        return a * b + c;               // Inf / NaN：交给硬件语义
    }
    double p, e, s, se;
    tfdx_two_prod(a, b, &p, &e);        // a*b = p + e（精确）
    if (!__builtin_isfinite(p)) return p + c;
    tfdx_two_sum(p, c, &s, &se);        // p + c = s + se（精确）
    if (!__builtin_isfinite(s)) return s;
    double corr = e + se;
    double r = s + corr;
    if (r == 0.0 && corr != 0.0) return corr;   // 完全抵消：保留补偿项的符号
    return r;
}

// —— t_math_* 包装：f64 直调 fdlibm；f32 变体以 double 计算后收敛回 float ——
// （f32 走 double 是双舍入，误差概率极低；fdlibm 本身不提供 float 版入口。）
double t_math_sin(double x) { return tfd_sin(x); }
float  t_math_sinf(float x) { return (float)tfd_sin((double)x); }
double t_math_cos(double x) { return tfd_cos(x); }
float  t_math_cosf(float x) { return (float)tfd_cos((double)x); }
double t_math_tan(double x) { return tfd_tan(x); }
float  t_math_tanf(float x) { return (float)tfd_tan((double)x); }
double t_math_atan(double x) { return tfd_atan(x); }
float  t_math_atanf(float x) { return (float)tfd_atan((double)x); }
double t_math_atan2(double a, double c) { return tfd_atan2(a, c); }
float  t_math_atan2f(float a, float c) { return (float)tfd_atan2((double)a, (double)c); }
double t_math_acos(double x) { return tfd_acos(x); }
float  t_math_acosf(float x) { return (float)tfd_acos((double)x); }
double t_math_asin(double x) { return tfd_asin(x); }
float  t_math_asinf(float x) { return (float)tfd_asin((double)x); }
double t_math_exp(double x) { return tfd_exp(x); }
float  t_math_expf(float x) { return (float)tfd_exp((double)x); }
double t_math_log(double x) { return tfd_log(x); }
float  t_math_logf(float x) { return (float)tfd_log((double)x); }
double t_math_log10(double x) { return tfd_log10(x); }
float  t_math_log10f(float x) { return (float)tfd_log10((double)x); }
double t_math_pow(double a, double c) { return tfd_pow(a, c); }
float  t_math_powf(float a, float c) { return (float)tfd_pow((double)a, (double)c); }
double t_math_sinh(double x) { return tfd_sinh(x); }
float  t_math_sinhf(float x) { return (float)tfd_sinh((double)x); }
double t_math_cosh(double x) { return tfd_cosh(x); }
float  t_math_coshf(float x) { return (float)tfd_cosh((double)x); }
double t_math_tanh(double x) { return tfd_tanh(x); }
float  t_math_tanhf(float x) { return (float)tfd_tanh((double)x); }
double t_math_sqrt(double x) { return tfd_sqrt(x); }
float  t_math_sqrtf(float x) { return (float)tfd_sqrt((double)x); }
double t_math_fmod(double a, double c) { return tfd_fmod(a, c); }
float  t_math_fmodf(float a, float c) { return (float)tfd_fmod((double)a, (double)c); }
double t_math_fabs(double x) { return tfd_fabs(x); }
float  t_math_fabsf(float x) { return (float)tfd_fabs((double)x); }
double t_math_floor(double x) { return tfd_floor(x); }
float  t_math_floorf(float x) { return (float)tfd_floor((double)x); }
double t_math_ceil(double x) { return tfd_ceil(x); }
float  t_math_ceilf(float x) { return (float)tfd_ceil((double)x); }
double t_math_trunc(double x) { return tfd_trunc(x); }
float  t_math_truncf(float x) { return (float)tfd_trunc((double)x); }
double t_math_round(double x) { return tfd_round(x); }
float  t_math_roundf(float x) { return (float)tfd_round((double)x); }
double t_math_exp2(double x) { return tfd_exp2(x); }
float  t_math_exp2f(float x) { return (float)tfd_exp2((double)x); }
double t_math_log2(double x) { return tfd_log2(x); }
float  t_math_log2f(float x) { return (float)tfd_log2((double)x); }
double t_math_log1p(double x) { return tfd_log1p(x); }
float  t_math_log1pf(float x) { return (float)tfd_log1p((double)x); }
double t_math_expm1(double x) { return tfd_expm1(x); }
float  t_math_expm1f(float x) { return (float)tfd_expm1((double)x); }
double t_math_hypot(double a, double c) { return tfd_hypot(a, c); }
float  t_math_hypotf(float a, float c) { return (float)tfd_hypot((double)a, (double)c); }
double t_math_cbrt(double x) { return tfd_cbrt(x); }
float  t_math_cbrtf(float x) { return (float)tfd_cbrt((double)x); }

// ── 扩展数学内建（推荐补充集）──
double t_math_copysign(double a, double b) { return tfd_copysign(a, b); }
float  t_math_copysignf(float a, float b) { return (float)tfd_copysign((double)a, (double)b); }
double t_math_nextafter(double a, double b) { return tfd_nextafter(a, b); }
float  t_math_nextafterf(float a, float b) { return (float)tfd_nextafter((double)a, (double)b); }
double t_math_remainder(double a, double b) { return tfd_remainder(a, b); }
float  t_math_remainderf(float a, float b) { return (float)tfd_remainder((double)a, (double)b); }
double t_math_fmin(double a, double b) { return tfd_fmin(a, b); }
float  t_math_fminf(float a, float b) { return (float)tfd_fmin((double)a, (double)b); }
double t_math_fmax(double a, double b) { return tfd_fmax(a, b); }
float  t_math_fmaxf(float a, float b) { return (float)tfd_fmax((double)a, (double)b); }
double t_math_fdim(double a, double b) { return tfd_fdim(a, b); }
float  t_math_fdimf(float a, float b) { return (float)tfd_fdim((double)a, (double)b); }
double t_math_fma(double a, double b, double c) { return tfd_fma(a, b, c); }
float  t_math_fmaf(float a, float b, float c) { return (float)tfd_fma((double)a, (double)b, (double)c); }
int32_t t_math_signbit(double x) { return __builtin_signbit(x); }
int32_t t_math_isnan(double x) { return __builtin_isnan(x); }
int32_t t_math_isinf(double x) { return __builtin_isinf(x); }
int32_t t_math_isfinite(double x) { return __builtin_isfinite(x); }
int32_t t_math_isnormal(double x) { return __builtin_isnormal(x); }

// ── 运行期 CPU 特性探测（@cpu_has 后端）─────────────────────────
// 返回 1 表示本机 CPU 支持该 ISA 扩展；用于「CPU 不支持向量宽度时」的运行期分派。
// 特性名对齐 x86 常见扩展：sse/sse2/sse3/ssse3/sse4.1/sse4.2/fma/avx/avx2/avx512f/
// avx512vl/avx512bw/avx512dq。
// 核心实现收 (ptr, len)：LLVM 后端直接按这个 C ABI 调（把 TStr 拆成两个标量传，
// 避免跨后端按值传聚合体的 ABI 分歧）；C 后端经下方 t_cpu_has(TStr) 包一层。
int t_cpu_has_n(const uint8_t* p, int64_t n) {
    char buf[32];
    if (p == 0) { n = 0; }
    if (n < 0) { n = 0; }
    if (n > 31) { n = 31; }
    for (int64_t i = 0; i < n; i++) { buf[i] = (char)p[i]; }
    buf[n] = 0;
    return t_cpu_has_cstr(buf);
}

int t_cpu_has(TStr feat) { return t_cpu_has_n(feat.ptr, feat.len); }

int t_cpu_has_cstr(const char* feat) {
#ifdef _WIN32
    int regs[4];
    if (strcmp(feat, "sse") == 0)     { __cpuid(regs, 1); return (regs[3] >> 25) & 1; }
    if (strcmp(feat, "sse2") == 0)    { __cpuid(regs, 1); return (regs[3] >> 26) & 1; }
    if (strcmp(feat, "sse3") == 0)    { __cpuid(regs, 1); return (regs[2] >> 0)  & 1; }
    if (strcmp(feat, "ssse3") == 0)   { __cpuid(regs, 1); return (regs[2] >> 9)  & 1; }
    if (strcmp(feat, "sse4.1") == 0)  { __cpuid(regs, 1); return (regs[2] >> 19) & 1; }
    if (strcmp(feat, "sse4.2") == 0)  { __cpuid(regs, 1); return (regs[2] >> 20) & 1; }
    if (strcmp(feat, "fma") == 0)     { __cpuid(regs, 1); return (regs[2] >> 12) & 1; }
    if (strcmp(feat, "avx") == 0) {
        __cpuid(regs, 1);
        // 需要 AVX 位 (ECX:28) 且 OSXSAVE (ECX:27)；现代 Windows 均保存 AVX 状态
        if (((regs[2] >> 28) & 1) == 0) { return 0; }
        if (((regs[2] >> 27) & 1) == 0) { return 0; }
        return 1;
    }
    if (strcmp(feat, "avx2") == 0)    { __cpuid(regs, 7); return (regs[1] >> 5)  & 1; }
    if (strcmp(feat, "avx512f") == 0) { __cpuid(regs, 7); return (regs[1] >> 16) & 1; }
    if (strcmp(feat, "avx512vl") == 0) { __cpuid(regs, 7); return (regs[1] >> 31) & 1; }
    if (strcmp(feat, "avx512bw") == 0) { __cpuid(regs, 7); return (regs[2] >> 30) & 1; }
    if (strcmp(feat, "avx512dq") == 0) { __cpuid(regs, 7); return (regs[2] >> 17) & 1; }
    return 0;
#else
    __builtin_cpu_init();
    if (strcmp(feat, "sse") == 0)     { return __builtin_cpu_supports("sse"); }
    if (strcmp(feat, "sse2") == 0)    { return __builtin_cpu_supports("sse2"); }
    if (strcmp(feat, "sse3") == 0)    { return __builtin_cpu_supports("sse3"); }
    if (strcmp(feat, "ssse3") == 0)   { return __builtin_cpu_supports("ssse3"); }
    if (strcmp(feat, "sse4.1") == 0)  { return __builtin_cpu_supports("sse4.1"); }
    if (strcmp(feat, "sse4.2") == 0)  { return __builtin_cpu_supports("sse4.2"); }
    if (strcmp(feat, "avx") == 0)     { return __builtin_cpu_supports("avx"); }
    if (strcmp(feat, "avx2") == 0)    { return __builtin_cpu_supports("avx2"); }
    if (strcmp(feat, "avx512f") == 0) { return __builtin_cpu_supports("avx512f"); }
    return 0;
#endif

}

// ── flag 位域运行时（KI-003）────────────────────────────────────
// 与前端 Perm_X_MASK / Perm_X_SHIFT 宏同一套约定：mask = (2^len - 1) << shift。
// flags / val 为字段语义展开后的整数（u16 经 i64 槽传递，低 16 位有效）。
// 内部按 mask 的最低置位偏移 shift 解包 / 打包，避免对 len 的额外参数依赖，
// 使单 bit 与多 bit 字段共用同一实现。
static int64_t t_flag_shift(int64_t mask) {
    uint64_t m = (uint64_t)mask;
    int shift = 0;
    while (m != 0 && (m & 1u) == 0) { m >>= 1; shift++; }
    return (int64_t)shift;
}

int64_t t_flag_set(int64_t flags, int64_t mask, int64_t val) {
    int64_t shift = t_flag_shift(mask);
    int64_t field = (val << shift) & mask;
    return (flags & ~mask) | field;
}

int64_t t_flag_get(int64_t flags, int64_t mask) {
    int64_t shift = t_flag_shift(mask);
    return (flags & mask) >> shift;
}

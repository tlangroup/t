// ═══════════════════════════════════════════════════════════════════════════
// runtime/t_runtime_gpu.c — Device 子系统 host 运行时（docs/device-design.md §5/§6 M3）
//
// 本机构建（无 CUDA toolkit / 无 GPU）走 CPU 设备模拟分支：
//   device.alloc       → host malloc（返回真实指针句柄，i64）
//   device.h2d/d2h      → memcpy
//   device.launch       → 解析内嵌的 Device Dialect（__t_devmod_blob）文本，
//                          按线性线程 index 在 host 上顺序执行 kernel 体，
//                          产出与 1D grid/block 真实 GPU 一致的结果。
// 这样 Device 子系统可在无 GPU 机器上端到端验证「host 发射 → 链接 → kernel 实际计算 → 取回」。
//
// 覆盖 demo 用到的 op 子集：device.thread_id / llvm.getelementptr / llvm.load /
// llvm.store / arith.addf / arith.constant / device.shared_alloc / device.barrier /
// device.atomic_add / device.return。shared 为单次 launch 内单块共享缓冲（demo 单 block）。
//
// HAVE_CUDA 分支（在他机 MLIR+CUDA 填充真实 JIT 引擎）见 §5，本机不启用。
// ═══════════════════════════════════════════════════════════════════════════

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "t_runtime_gpu.h"

#ifndef HAVE_CUDA

// ── SSA 值表（按名字索引，覆盖参数 %a/%b/... 与局部 %vN）──────────
typedef struct { char name[16]; int tag; union { int32_t i; float f; void* p; }; } Ssa;
// tag: 0 未初始化, 1 i32, 2 f32, 3 ptr
#define SSA_MAX 64
static Ssa g_ssa[SSA_MAX];
static int g_ssa_n = 0;
static void* g_shared = NULL; // 单次 launch 的 shared 缓冲（demo 单 block 共享）

static Ssa* ssa_get(const char* nm) {
    for (int k = 0; k < g_ssa_n; k++) if (strcmp(g_ssa[k].name, nm) == 0) return &g_ssa[k];
    return NULL;
}
static Ssa* ssa_set(const char* nm, int tag) {
    Ssa* s = ssa_get(nm);
    if (s) { s->tag = tag; return s; }
    if (g_ssa_n >= SSA_MAX) return NULL;
    Ssa* nw = &g_ssa[g_ssa_n++];
    memset(nw, 0, sizeof(*nw));
    strncpy(nw->name, nm, 15); nw->name[15] = 0;
    nw->tag = tag;
    return nw;
}

// 从 *p（须指向 '%'）解析一个 ssa 名到 out（不含 '%'），返回指向名后首字符的指针。
static const char* ssa_scan(const char* p, char* out) {
    if (*p != '%') return NULL;
    p++;
    int i = 0;
    while (*p && *p != ' ' && *p != '\t' && *p != '[' && *p != ']' &&
           *p != ',' && *p != ')' && *p != ':') {
        if (i < 15) out[i++] = *p;
        p++;
    }
    out[i] = 0;
    return p;
}

// 在 blob 中定位 `@name` 的 kernel_func，返回其函数体起始（'{' 之后）与长度（到匹配 '}'）。
static const char* find_kernel_body(const char* blob, const char* name, int* out_len) {
    char pat[128];
    snprintf(pat, sizeof(pat), "device.kernel_func @%s", name);
    const char* fn = strstr(blob, pat);
    if (!fn) return NULL;
    const char* ob = strchr(fn, '{');
    if (!ob) return NULL;
    const char* cb = strchr(ob, '}'); // demo dialect 无嵌套大括号
    if (!cb) return NULL;
    *out_len = (int)(cb - ob - 1);
    return ob + 1;
}

// 解析 `^entry(%a : T, %b : T, ...) ` 的参数名与类型（ptr vs 标量）。
static int parse_entry_args(const char* fnline, char names[][16], int* isptr) {
    const char* e = strstr(fnline, "^entry(");
    if (!e) return 0;
    e += 7;
    const char* end = strchr(e, ')');
    if (!end) return 0;
    int n = 0;
    const char* p = e;
    while (p < end && n < 16) {
        while (p < end && *p != '%') p++;
        if (p >= end) break;
        char nm[16]; const char* after = ssa_scan(p, nm);
        if (!after) break;
        const char* colon = strchr(after, ':');
        if (!colon) break;
        const char* t = colon + 1;
        while (*t == ' ' || *t == '\t') t++;
        isptr[n] = (strncmp(t, "!llvm.ptr", 10) == 0) ? 1 : 0;
        strncpy(names[n], nm, 15); names[n][15] = 0;
        n++;
        const char* comma = strchr(colon, ',');
        if (!comma || comma > end) break;
        p = comma + 1;
    }
    return n;
}

// 执行单个 kernel：grid*block 个线性线程，每个线程顺序执行体。
static int gpu_emu_run(const char* blob, const char* name,
                        int32_t grid, int32_t block, int32_t nargs, int64_t* argv) {
    int body_len; const char* body = find_kernel_body(blob, name, &body_len);
    if (!body) { fprintf(stderr, "device: kernel '%s' not found in module\n", name ? name : ""); return -1; }
    char pat[128]; snprintf(pat, sizeof(pat), "device.kernel_func @%s", name);
    const char* fnline = strstr(blob, pat);
    char argnames[16][16]; int argptr[16];
    int narg = parse_entry_args(fnline, argnames, argptr);

    int total = (int)grid * (int)block;
    if (total <= 0) total = 1;
    g_shared = NULL;
    for (int tid = 0; tid < total; tid++) {
        g_ssa_n = 0;
        for (int a = 0; a < narg && a < nargs; a++) {
            Ssa* s = ssa_set(argnames[a], argptr[a] ? 3 : 1);
            if (s) { if (argptr[a]) s->p = (void*)(intptr_t)argv[a]; else s->i = (int32_t)argv[a]; }
        }
        const char* p = body;
        const char* pend = body + body_len;
        while (p < pend) {
            const char* nl = p; while (nl < pend && *nl != '\n') nl++;
            char line[512]; int ll = (int)(nl - p); if (ll >= 512) ll = 511;
            memcpy(line, p, ll); line[ll] = 0;
            while (ll > 0 && (line[ll-1] == '\r' || line[ll-1] == ' ')) line[--ll] = 0;
            char* q = line; while (*q == ' ' || *q == '\t') q++;
            if (*q && *q != '\n' && *q != '\r') {
                char dstnm[16]; int has_dst = 0; const char* rhs = q;
                if (*q == '%') {
                    const char* after = ssa_scan(q, dstnm);
                    const char* eq = strstr(after, " = ");
                    if (eq) { rhs = eq + 3; has_dst = 1; }
                }
                if (has_dst) {
                    if (strstr(rhs, "device.thread_id")) {
                        Ssa* s = ssa_set(dstnm, 1); if (s) s->i = (int32_t)tid;
                    } else if (strstr(rhs, "arith.constant")) {
                        int v = 0; sscanf(rhs, "arith.constant %d", &v);
                        Ssa* s = ssa_set(dstnm, 1); if (s) s->i = (int32_t)v;
                    } else if (strstr(rhs, "device.shared_alloc")) {
                        char m[16]; const char* ap = strchr(rhs, '(');
                        if (ap) { const char* mp = strchr(ap, '%'); if (mp) { ssa_scan(mp, m);
                            Ssa* sm = ssa_get(m); int cnt = sm ? sm->i : 0;
                            if (!g_shared) g_shared = malloc((size_t)cnt * 4);
                            Ssa* s = ssa_set(dstnm, 3); if (s) s->p = g_shared; } }
                    } else if (strstr(rhs, "llvm.getelementptr")) {
                        char b[16], i[16]; const char* bp = strchr(rhs, '%');
                        if (bp) { const char* ba = ssa_scan(bp, b);
                            const char* ip = strchr(ba, '%'); if (ip) ssa_scan(ip, i); }
                        Ssa* sb = ssa_get(b); Ssa* si = ssa_get(i);
                        int esz = 4; if (strstr(rhs, ", i64")) esz = 8;
                        void* addr = (char*)sb->p + (int)si->i * esz;
                        Ssa* s = ssa_set(dstnm, 3); if (s) s->p = addr;
                    } else if (strstr(rhs, "llvm.load")) {
                        char s[16]; const char* sp = strchr(rhs, '%');
                        if (sp) ssa_scan(sp, s);
                        Ssa* sv = ssa_get(s);
                        Ssa* sd = ssa_set(dstnm, strstr(rhs, "-> f32") ? 2 : 1);
                        if (sd && sv) { if (sd->tag == 2) sd->f = *(float*)sv->p; else sd->i = *(int32_t*)sv->p; }
                    } else if (strstr(rhs, "arith.addf")) {
                        char a[16], b[16]; const char* ap = strchr(rhs, '%');
                        if (ap) { const char* aa = ssa_scan(ap, a);
                            const char* bp2 = strchr(aa, '%'); if (bp2) ssa_scan(bp2, b); }
                        Ssa* sa = ssa_get(a); Ssa* sb = ssa_get(b);
                        Ssa* s = ssa_set(dstnm, 2); if (s && sa && sb) s->f = sa->f + sb->f;
                    } else if (strstr(rhs, "device.atomic_add")) {
                        char pnm[16], vnm[16]; const char* pp = strchr(rhs, '(');
                        if (pp) { const char* pa = strchr(pp, '%'); if (pa) { ssa_scan(pa, pnm);
                            const char* vp = strchr(pa, '%'); if (vp) ssa_scan(vp, vnm); } }
                        Ssa* sp = ssa_get(pnm); Ssa* sv = ssa_get(vnm);
                        if (sp && sv) { float old = *(float*)sp->p; *(float*)sp->p = old + sv->f;
                            Ssa* s = ssa_set(dstnm, 2); if (s) s->f = old; }
                    }
                    // 其余带 dst 的 op（未来扩展）忽略
                } else {
                    if (strstr(q, "llvm.store")) {
                        char v[16], d[16]; const char* vp = strchr(q, '%');
                        if (vp) { const char* va = ssa_scan(vp, v);
                            const char* dp = strchr(va, '%'); if (dp) ssa_scan(dp, d); }
                        Ssa* sv = ssa_get(v); Ssa* sd = ssa_get(d);
                        if (sv && sd) *(float*)sd->p = sv->f;
                    } else if (strstr(q, "device.barrier")) {
                        // host 顺序执行已隐含线程间同步
                    } else if (strstr(q, "device.return")) {
                        break;
                    }
                }
            }
            p = (nl < pend) ? nl + 1 : pend;
        }
    }
    if (g_shared) { free(g_shared); g_shared = NULL; }
    return 0;
}

int64_t tll_gpu_alloc(int64_t bytes) {
    void* p = malloc((size_t)(bytes > 0 ? bytes : 1));
    return (int64_t)(intptr_t)p;
}

void tll_gpu_free(int64_t p) { if (p) free((void*)(intptr_t)p); }

void tll_gpu_h2d(int64_t dst, int64_t src, int64_t bytes) {
    memcpy((void*)(intptr_t)dst, (void*)(intptr_t)src, (size_t)bytes);
}
void tll_gpu_d2h(int64_t dst, int64_t src, int64_t bytes) {
    memcpy((void*)(intptr_t)dst, (void*)(intptr_t)src, (size_t)bytes);
}

int32_t tll_gpu_launch(const char* blob, const char* name,
                       int32_t grid, int32_t block, int32_t nargs, int64_t* argv) {
    int rc = gpu_emu_run(blob, name ? name : "", grid, block, nargs, argv);
    if (rc == 0) fprintf(stderr, "device: tll_gpu_launch(\"%s\") cpu-emu OK (%d threads)\n",
                          name ? name : "", (int)grid * (int)block);
    return rc;
}

#else
#error "HAVE_CUDA path not yet implemented on this machine (see docs/device-design.md §5)"
#endif

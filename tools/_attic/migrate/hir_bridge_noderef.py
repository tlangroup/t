#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
S4 工具箱第十一件：node_to_hir 桥「入参侧」切 u64 NodeRef（批次 20-K）

范围（刻意只做入参侧，返回值侧留作独立步）：
  · src/hir.tc  hir_of_node(n: i64)   → hir_of_node(n: u64)   + 函数体改走 base.nr_idx
  · src/hir.tc  hir_invalidate(n: i64)→ hir_invalidate(n: u64) + 函数体改走 base.nr_idx
  · src/sema.tc 15 处 hir_invalidate(X) / 4 处 hir_of_node(X) → (X as u64)

为什么**不做**返回值侧（hir_inst_node → u64）：
  sema 里 15+ 处是 `var d: i64 = hir.hir_inst_node(di);` 且返回值参与 `!= e` / `== fb`
  比较；改成 u64 会让 C 后端生成**无符号比较**，-1 哨兵语义随之改变。属独立 epic，不塞本批。

为什么入参侧是**零运行时变化**（动手前已证）：
  ① 迁移期 NodeRef == 裸索引，正索引逐位等价；
  ② ⚠ 负 id 不逐位等价：`nr_idx(((-1) as u64))` = 4294967295（低 32 位零扩展），
     不是 -1 ⇒ 原函数首行 `if (n < 0) return` 的哨兵语义必须靠**越界检查**兜住，
     这与既有 `node_*` 访问器范式完全一致（`id >= slice_len(...)` 返默认/-1）；
  ③ 节点 id 恒 < 2^31，`nr_idx` 的低 32 位截断无影响。

实现要点（沿用前两件工具的教训）：
  · op 表按**行号降序**施加（改大行号不影响小行号）；
  · **二进制读写 + 逐行保原终结符**（.gitattributes 对 sema.tc 是 text=auto，
    但工作区可能残留 CRLF，文本模式会整文件改行尾）；
  · 每行替换前**校验匹配**（不匹配即报错，不静默跳过）；
  · 幂等：已改过的行（含 `as u64`）会被识别并跳过。

用法： python tools/hir_bridge_noderef.py            # dry-run
       python tools/hir_bridge_noderef.py --apply
"""

import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── op 表：(文件, 行号, 旧串正则, 新串) ──────────────────────────────
# hir.tc：两个函数签名 + 函数体（用 range 整段替换更稳）
OPS = [
    # ── src/hir.tc ──
    ('src/hir.tc', 170, r'pub fn hir_invalidate\(n: i64\) void \{',
     'pub fn hir_invalidate(n: u64) void {'),
    ('src/hir.tc', 161, r'pub fn hir_of_node\(n: i64\) i64 \{',
     'pub fn hir_of_node(n: u64) i64 {'),
]

# hir.tc 函数体整段替换（按行号区间，闭区间）
RANGES = [
    ('src/hir.tc', 162, 164, [
        '    var id: i64 = base.nr_idx(n);   // 20-K：节点句柄按 NodeRef 解包；负 id 会落到越界分支，与旧 `n < 0` 等价\n',
        '    if (id < 0) { return -1; }\n',
        '    if (id >= slice_len(g_hir.node_to_hir) as i64) { return -1; }\n',
        '    return g_hir.node_to_hir[id];\n',
    ]),
    ('src/hir.tc', 171, 173, [
        '    var id: i64 = base.nr_idx(n);   // 20-K：同上\n',
        '    if (id < 0) { return; }\n',
        '    if (id >= slice_len(g_hir.node_to_hir) as i64) { return; }\n',
        '    g_hir.node_to_hir[id] = -1;\n',
    ]),
]

# sema.tc 调用点：(行号, 旧片段, 新片段)
SEMA_OPS = [
    (13255, 'hir.hir_of_node(pd)', 'hir.hir_of_node((pd as u64))'),
    (12704, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (12265, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (8502, 'hir.hir_invalidate(s)', 'hir.hir_invalidate((s as u64))'),
    (8132, 'hir.hir_invalidate(s)', 'hir.hir_invalidate((s as u64))'),
    (7851, 'hir.hir_of_node(s)', 'hir.hir_of_node((s as u64))'),
    (7427, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (6694, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (6673, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (5962, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (5772, 'hir.hir_invalidate(L)', 'hir.hir_invalidate((L as u64))'),
    (5359, 'hir.hir_of_node(e)', 'hir.hir_of_node((e as u64))'),
    (5329, 'hir.hir_of_node(e)', 'hir.hir_of_node((e as u64))'),
    (5053, 'hir.hir_invalidate(s)', 'hir.hir_invalidate((s as u64))'),
    (4996, 'hir.hir_invalidate(s)', 'hir.hir_invalidate((s as u64))'),
    (4954, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (4926, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (4863, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
    (4545, 'hir.hir_invalidate(e)', 'hir.hir_invalidate((e as u64))'),
]


def read_lines(path):
    """二进制读 + 按行切分，保留每行原终结符。"""
    with open(path, 'rb') as f:
        raw = f.read()
    lines = raw.split(b'\n')
    # 末元素无终结符（文件不以 \n 结尾时为空串）
    out = []
    for i, ln in enumerate(lines):
        if ln.endswith(b'\r'):
            out.append((ln[:-1].decode('utf-8'), '\r\n'))
        else:
            out.append((ln.decode('utf-8'), '\n' if i < len(lines) - 1 else ''))
    return out


def write_lines(path, lines):
    buf = io.BytesIO()
    for text, eol in lines:
        buf.write(text.encode('utf-8'))
        buf.write(eol.encode('utf-8'))
    data = buf.getvalue()
    with open(path, 'rb') as f:
        before = f.read()
    with open(path, 'wb') as f:
        f.write(data)
    # 写回自检：结构与终结符必须与预期一致
    with open(path, 'rb') as f:
        after = f.read()
    rebuilt = read_lines(path)
    assert len(rebuilt) == len(lines), '写回后行数不一致'
    for (t1, e1), (t2, e2) in zip(lines, rebuilt):
        assert t1 == t2 and e1 == e2, '写回后内容/终结符不一致'
    return len(before), len(after)


def main():
    apply = '--apply' in sys.argv
    files = {}

    def load(rel):
        if rel not in files:
            files[rel] = read_lines(os.path.join(ROOT, rel))
        return files[rel]

    plan = []

    # ⚠ 行号驱动的唯一正确顺序：**所有 op（含 RANGE）按起始行号降序施加**。
    #   首版把 RANGES 排在前面，而 162-164 由 3 行变 4 行 ⇒ 170/171 整体下移一位，
    #   导致 hir_invalidate 的签名与函数体改到错位（RANGE 会吃掉签名行）。
    #   ⇒ 大行号先改，小行号的行号才不受影响。
    jobs = []
    for rel, lo, hi, new in RANGES:
        jobs.append((lo, ('RANGE', rel, lo, hi, new)))
    for rel, ln, pat, rep in OPS:
        jobs.append((ln, ('SUB', rel, ln, pat, rep)))
    for ln, old, rep in SEMA_OPS:
        jobs.append((ln, ('SUB', 'src/sema.tc', ln, re.escape(old), rep)))
    jobs.sort(key=lambda x: x[0], reverse=True)

    for _, job in jobs:
        if job[0] == 'RANGE':
            _, rel, lo, hi, new = job
            lines = load(rel)
            old = [lines[i][0] for i in range(lo - 1, hi)]
            plan.append(('RANGE', rel, lo, hi, old, new))
            if apply:
                # 保留被替换区间最后一行的原终结符
                tail_eol = lines[hi - 1][1]
                repl = [(t.rstrip('\n'), '\n') for t in new]
                repl[-1] = (repl[-1][0], tail_eol)
                lines[lo - 1:hi] = repl
        else:
            _, rel, ln, pat, rep = job
            lines = load(rel)
            idx = ln - 1
            assert 0 <= idx < len(lines), '行号越界 %s:%d' % (rel, ln)
            text, eol = lines[idx]
            if text == rep:
                plan.append(('SKIP(已改)', rel, ln, text, rep))
                continue
            new_text, n = re.subn(pat, lambda m: rep, text)
            assert n == 1, '匹配失败（n=%d） %s:%d\n    %s' % (n, rel, ln, text)
            plan.append(('SUB', rel, ln, text, new_text))
            if apply:
                lines[idx] = (new_text, eol)

    # ── 输出 ──
    tag = 'APPLY' if apply else 'DRY-RUN'
    print('==== %s ==== (%d 项)' % (tag, len(plan)))
    for p in plan:
        if p[0] == 'RANGE':
            print('  RANGE %s:%d-%d' % (p[1], p[2], p[3]))
            for o in p[4]:
                print('    - ' + o)
            for n in p[5]:
                print('    + ' + n.rstrip('\n'))
        elif p[0] == 'SKIP(已改)':
            print('  SKIP  %s:%d (已是目标形态)' % (p[1], p[2]))
        else:
            print('  %s:%d' % (p[1], p[2]))
            print('    - ' + p[3])
            print('    + ' + p[4])

    if apply:
        for rel in files:
            b, a = write_lines(os.path.join(ROOT, rel), files[rel])
            print('  write %s  %d -> %d bytes' % (rel, b, a))
    else:
        print('\n（dry-run：加 --apply 落盘）')


if __name__ == '__main__':
    main()

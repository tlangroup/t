#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S4 §0.14.7 批次 20-E：把 `slice_len(<nodes>)` 换成 `node_count()`。

动机
────
S4 的终点是删掉 `pub var nodes: []Node;`（Node 结构体本身随之消失）。但全编译器有 25 处
`slice_len(nodes)` / `slice_len(base.nodes)` / `slice_len(base__nodes)` 在量节点池长度 ——
这些在 `nodes` 删除后全部失效。故**先**引入 `node_count()` 访问器把 25 处收敛掉，
再在下一批（20-F）改访问器实现并删 `nodes`。

⚠ 本批是**纯重命名**：`node_count()` 的函数体本批写成 `return slice_len(nodes) as i64;`，
  与替换前**逐字等价** ⇒ seed vs g1 必须逐字节 IDENTICAL（这是本批最强的正确性判据）。
  20-F 才把函数体改成 `slice_len(g_node_kind)`（那时 `nodes` 已不存在）。

⚠ `nodes` 的三种写法（同 drop_node_decl.py 的坑四）：`nodes` / `base.nodes` / `base__nodes`
  （后者是局部 `var base` 遮蔽 base 模块时的降级名）。

⚠ 行尾保真：`src/tir.tc` 等是 `-text`（CRLF），必须二进制读写 + 原样写回。

用法
────
    python tools/node_count_migrate.py            # dry-run：只列 PLAN
    python tools/node_count_migrate.py --apply    # 落盘
"""
import re
import sys
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FILES = ['base.tc', 'codegen_dev.tc', 'comptime_fold.tc', 'hir.tc', 'sema.tc', 'tir.tc']

NODES = r'(?:base(?:\.|__))?nodes'

# 两种形态都要吃：`slice_len(X)` 与 `slice_len(X) as i64`（后者去掉冗余 cast，
# 因为 node_count() 本就返回 i64）。
PAT_FULL = re.compile(r'slice_len\(\s*' + NODES + r'\s*\)\s+as\s+i64')
PAT_PLAIN = re.compile(r'slice_len\(\s*' + NODES + r'\s*\)')


def call_for(matched: str, in_base: bool):
    """按匹配到的写法产出对应的访问器调用名。"""
    if in_base:
        return 'node_count()'
    if matched.startswith('base__'):
        return 'base__node_count()'
    return 'base.node_count()'


def main():
    apply = '--apply' in sys.argv
    total = 0
    for fname in FILES:
        path = os.path.join(ROOT, 'src', fname)
        with open(path, 'rb') as f:
            raw = f.read()
        text = raw.decode('utf-8')
        crlf = b'\r\n' in raw
        nl = b'\r\n' if crlf else b'\n'
        lines = text.replace('\r\n', '\n').split('\n')
        in_base = (fname == 'base.tc')
        hits = []
        for i, ln in enumerate(lines):
            # 跳过整行注释（`//` 开头，缩进后）：注释里的形态只是说明，不改
            stripped = ln.lstrip()
            if stripped.startswith('//'):
                continue
            new = ln
            for pat in (PAT_FULL, PAT_PLAIN):
                def rep(m):
                    return call_for(m.group(0), in_base)
                new = pat.sub(rep, new)
            if new != ln:
                hits.append((i + 1, ln, new))
                lines[i] = new
        if hits:
            total += len(hits)
            print('── %s (%s, %d 处)' % (fname, 'CRLF' if crlf else 'LF', len(hits)))
            for no, old, new in hits:
                print('  %5d  - %s' % (no, old.strip()))
                print('         + %s' % new.strip())
        if apply and hits:
            out = nl.join(l.encode('utf-8') for l in lines)
            with open(path, 'wb') as f:
                f.write(out)
    print('\nPLAN: %d 处' % total)
    print('APPLIED' if apply else '(dry-run，未落盘；加 --apply 落盘)')


if __name__ == '__main__':
    main()

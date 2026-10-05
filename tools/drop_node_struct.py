#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S4 §0.14.7 批次 20-F：**删掉 `pub struct Node` 与 `pub var nodes: []Node;`**（S4 epic 的终点）。

前置（20-A…20-E 已完成）
──────────────────────
- 24 个载荷字段已全部外置为平行侧表；`Node` 只剩过渡字段 `id`。
- `.id` 真站点只剩 2 处：`node_new` 的写入点 + `codegen_dev::emit_dev_kernel` 的 `dn.id`。
- 29 处 `slice_len(*nodes)` 已收敛到 `node_count()`（20-E）。

本批的四组动作
──────────────
① `dev_safe_node` **改返索引**（越界返 **0**）—— 消掉最后 1 处 `.id` 读点。
   ⚠ 越界返 **0** 而不是 -1：`dn = dev_safe_node(d)` 的旧语义是「读零 Node 的字段」，
     零 Node 的 `id` 由 `var n: Node;` 零初始化为 **0** ⇒ 越界等价于按索引 0 读侧表。
     返 -1 会落到访问器的越界分支返默认值，二者在 node 0 该字段非默认值时**不相等**。
② 删 4 处**只声明不读**的 `Node` 局部量（`codegen_c` 的 `wn`、`sema` 的 `mvn`/`mvn2` ×3）。
③ 删 `pub struct Node`（132 行，含逐字段历史注释）+ `pub var nodes: []Node;`。
④ `node_count()` 函数体改读**锁步的 `g_node_kind`**（`nodes` 已不存在）。

⚠ 行尾保真：二进制读写；`src/tir.tc` 是 `-text`（CRLF），本批不碰它。

用法
────
    python tools/drop_node_struct.py            # dry-run
    python tools/drop_node_struct.py --apply    # 落盘
"""
import sys
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# ── op 形态 ────────────────────────────────────────────────────────────────
# ('range', start, end, new_lines)  —— 1-based 闭区间【原文件行号】整体替换
# ('del',   start, end)             —— 整段删除
# ('sub',   line, old, new)         —— 单行内子串替换（要求 old 在该行唯一出现）
# 所有行号以**运行前**的文件为基准，一次性施加（不做顺序位移）⇒ 无「先改后行号漂移」问题。

MARKER_STRUCT = [
    "// S4 批次 20-F（§0.14.7 收口）：`pub struct Node` 已删除 —— 24 个载荷字段在批次 1–19 全部外置为",
    "// 平行侧表（逐字段的默认值 / 哨兵论证见 docs/compiler/cst-design-v2.md §0.14.7 各批次小节，",
    "// 以及 git 历史里 20-F 之前的本文件版本），最后的过渡字段 `id` 随本批一并移除。",
    "// ⇒ **节点句柄从此就是裸索引**（`node_new` 的返回值），侧表访问面统一走 `node_xxx()` / `node_set_xxx()`。",
    "// ⚠ `nodes[]` 数组同时删除（其长度语义由 `node_count()` 承载，实现改读锁步的 `g_node_kind`）。",
]

DOC_NODE_COUNT = [
    "// S4 批次 20-E（§0.14.7 删 Node 收口）：节点池长度访问器。",
    "//   全仓 29 处 `slice_len(nodes)` / `slice_len(base.nodes)` / `slice_len(base__nodes)` 收敛于此。",
    "// S4 批次 20-F：`nodes[]` 已删除 ⇒ 函数体改读 **与之锁步的 `g_node_kind`**。",
    "//   ⚠ 锁步性：`node_new` 是**唯一**的节点创建入口，逐节点 `append(g_node_kind, kind)`，",
    "//   故 `slice_len(g_node_kind)` == 旧 `slice_len(nodes)`（20-F 前实测两者恒等）。",
]

FN_SAFE_NODE = [
    "// 越界安全的节点索引：emit-dev 路径下节点池可能未完整填充，任意索引越界访问都会崩；",
    "// 统一经此函数把索引夹回合法区间后再交给侧表访问器（越界读一律返该字段的默认值）。",
    "// S4 批次 20-F：返回类型由 `Node` 改为 **i64（节点索引）**。",
    "//   ⚠ 越界时返 **0**（不是 -1）：本函数唯一调用点的旧语义是「读零 Node 的字段」，而零 Node",
    "//     的 `id` 由 `var n: Node;` 零初始化为 **0** ⇒ 越界等价于按索引 0 读侧表。返 -1 会落到",
    "//     访问器的越界分支返默认值，二者在 node 0 的该字段非默认值时**不相等** ⇒ 必须返 0。",
    "//   ⚠ 随 `pub struct Node` 一并删除后，原逐字段「零节点初值 == 访问器越界返回值」的论证",
    "//     （批次 13–19 的 24 个字段）已无处依附，完整版本见",
    "//     docs/compiler/cst-design-v2.md §0.14.7 各批次小节与 git 历史。",
    "pub fn dev_safe_node(e: i64) i64 {",
    "    if (e >= 0 && e < base.node_count()) { return e; }",
    "    return 0;",
    "}",
]

OPS = {
    'src/base.tc': [
        ('range', 1730, 1861, MARKER_STRUCT),      # pub struct Node { … }
        ('del',   1873, 1873),                      # pub var nodes: []Node;
        ('range', 2939, 2945, DOC_NODE_COUNT),      # node_count 的注释（20-E 版 → 20-F 版）
        ('sub',   2947, 'return slice_len(nodes) as i64;',
                        'return slice_len(g_node_kind) as i64;'),
        ('del',   2952, 2952),                      # node_new 里的 var n: Node;
        ('del',   2977, 2978),                      # n.id = node_count(); + append(nodes, n);
    ],
    'src/codegen_dev.tc': [
        ('range', 33, 73, FN_SAFE_NODE),            # dev_safe_node 整体改写
        ('sub',   249, 'dev_safe_node 越界返默认 Node', 'dev_safe_node 越界返零节点索引 0'),
        ('del',   274, 274),                        # var dn: Node = dev_safe_node(d);
        ('sub',   313, 'base.node_lc((dn.id as u64))', 'base.node_lc((dev_safe_node(d) as u64))'),
    ],
    'src/codegen_c.tc': [
        ('sub', 2198, 'var wn: Node = base.nodes[base.node_nb((base.kids[c].val as u64))]; ', ''),
    ],
    'src/sema.tc': [
        ('sub', 6163, '{ var mvn: Node = base.nodes[mrows]; ', '{ '),
        ('sub', 6166, '{ var mvn2: Node = base.nodes[mcols]; ', '{ '),
        ('sub', 6210, '{ var mvn: Node = base.nodes[mlen]; ', '{ '),
    ],
}


def apply_file(path, ops, do_apply):
    with open(path, 'rb') as f:
        raw = f.read()
    nl = b'\r\n' if b'\r\n' in raw else b'\n'
    lines = raw.decode('utf-8').replace('\r\n', '\n').split('\n')
    touched = []
    # 先施加所有「整行替换/删除」。⚠⚠ 必须按**行号降序**：op 里的行号是**原文件**的，
    # 前面的删除会让后面的下标整体前移 —— 升序施加会把后面每个 op 都打偏（20-F 实测踩到）。
    # 降序则保证「被改动的区间始终在尚未处理的区间之下」，下标不会错位。
    new_lines = list(lines)
    for op in sorted([o for o in ops if o[0] in ('range', 'del')], key=lambda o: -o[1]):
        if op[0] == 'range':
            _, a, b, payload = op
            touched.append((a, b, 'RANGE'))
            new_lines[a - 1:b] = payload
        else:
            _, a, b = op
            touched.append((a, b, 'DEL'))
            new_lines[a - 1:b] = []
    # 行内替换必须按**行号降序**做不了（索引会乱），改为在原 lines 上定位后写回占位
    # ⇒ 简化：对 sub 类，直接用原文定位（行号以原文件为基准）
    for op in ops:
        if op[0] != 'sub':
            continue
        _, ln, old, new = op
        src = lines[ln - 1]
        if src.count(old) != 1:
            raise SystemExit('!! %s:%d 的 old 子串出现 %d 次（应为 1）：%r' % (path, ln, src.count(old), old))
        touched.append((ln, ln, 'SUB'))
        # 该行可能已被 range/del 影响？本批 sub 行号与 range/del 区间不重叠，直接替换
        idx = new_lines.index(src) if src in new_lines else None
        if idx is None:
            raise SystemExit('!! %s:%d 的行在施加 range/del 后找不到了：%r' % (path, ln, src))
        new_lines[idx] = src.replace(old, new)
    print('── %s（%s）%d 处' % (path, 'CRLF' if nl == b'\r\n' else 'LF', len(touched)))
    for a, b, kind in sorted(touched):
        preview = lines[a - 1].strip()[:72]
        print('   %-5s %d%s  | %s' % (kind, a, ('' if b == a else '..%d' % b), preview))
    if do_apply:
        out = nl.join(l.encode('utf-8') for l in new_lines)
        with open(path, 'wb') as f:
            f.write(out)
    return len(touched)


def main():
    do_apply = '--apply' in sys.argv
    total = 0
    for rel, ops in OPS.items():
        total += apply_file(os.path.join(ROOT, rel), ops, do_apply)
    print('\nPLAN: %d 处' % total)
    print('APPLIED' if do_apply else '(dry-run，未落盘；加 --apply 落盘)')


if __name__ == '__main__':
    main()

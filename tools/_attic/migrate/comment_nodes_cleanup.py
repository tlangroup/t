#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S4 §0.14.7 批次 20-G：把侧表注释里已失效的 `nodes[]` 表述改成「节点池 / 按 id 索引」。

动机
────
批次 20-F 删掉了 `pub struct Node` 与 `pub var nodes: []Node;`，**节点句柄从此就是裸索引**。
但侧表声明处的行尾注释仍大量写着「与 nodes 平行」「nodes[i] 的 …」——`nodes` 数组已不存在，
这些是**事实错误的当前形态描述**，会持续误导后续批次（尤其 ① `node_visit` 访问者化
② 删 re-export 垫片 ③ `node_to_hir` 桥 ④ S3 全局平行数组清理）。

本批的口径（⚠ 关键：**不是**全文替换 `nodes`）
──────────────────────────────────────────────
- **A 组（必改）**：侧表声明的行尾注释，描述的是**当前形态** ⇒ 改为「与节点池等长、按 id 索引」
  / 「节点 i 的 …」。行号白名单 = 全仓 `grep -n 'nodes[i]' src/base.tc` 命中的 31 行（全在注释里）。
- **B 组（必改）**：模块头 / 函数头注释里把 `base.nodes` 当作**当前**数据源描述的 9 处
  （`codegen_dev` / `comptime_fold` / `hir` / `base:1846,1927` / `codegen_c:1534`）。
- **C 组（保留不动）**：明写「原签名 / 旧代码 / 此前 / 取代 `nodes[id].x = …`」的**历史沿革注释**
  （`base.tc:1776→已标注完成`、`comptime_fold.tc:56`、`tir.tc:3478/3555`、`tir_to_ll.tc:3315/4174`、
  `codegen_c.tc:3447/4999`、`parse.tc:1139`…）。它们记录的是**迁移前的形态**，改写反而丢信息。

判据（纯注释改动 ⇒ 最强形态的「零行为变化」自证）
────────────────────────────────────────────────
1. `tc check src/tc.tc` 仍 **0 error / 530 warning**；
2. seed vs g1 自举产物 `.c`/`.h` **逐字节 IDENTICAL**；
3. IR 快照 **0 DIFF / 0 NEW / 0 GONE** ⇒ 无需 `--update` 重录基线；
4. 产物 `.c`/`.h` 的字节数与哈希 **等于 20-F 基线**（2 527 662 B / 130 831 B）⇒ 与改注释前逐字节相同。

⚠ 行尾保真：本批涉及的 6 个文件在 worktree 里**全是 CRLF**（git blob 是 LF，被 `text=auto eol=lf`
  归一化，故 `git diff` 看不出，但脚本必须原样写回，否则整文件重写）。二进制读写 + 逐行保终结符。

用法
────
    python tools/comment_nodes_cleanup.py            # dry-run：只列 PLAN（前后对照）
    python tools/comment_nodes_cleanup.py --apply    # 落盘（含写回自检）
"""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# ── A 组：base.tc 侧表声明行尾注释（白名单行号，逐行施加 3 条规则）──────────────
A_LINES = [
    1751, 1752, 1753, 1755, 1756, 1773, 1778, 1782, 1783, 1784,
    1790, 1791, 1800, 1801, 1810, 1811, 1812, 1813, 1814, 1815,
    1816, 1819, 1820, 1822, 1824, 1826, 1828, 1832, 1835, 1837,
    2194, 2737,
]

A_RULES = [
    ('与 nodes 平行的数组：', '与节点池等长、按 id 索引：'),
    ('与 nodes 平行：', '与节点池等长、按 id 索引：'),
    ('nodes[i]', '节点 i'),
]

# ── B 组：其它「把 nodes 当当前数据源」的描述性注释（显式 op：文件 / 行号 / 旧 / 新）──
B_OPS = [
    ('codegen_dev.tc', 11,
     '（base.nodes / lex.decl_list）',
     '（base 节点侧表 / lex.decl_list）'),
    ('codegen_dev.tc', 471,
     'emit-dev 路径下 base.nodes 可能未完整填充',
     'emit-dev 路径下 base 节点侧表可能未完整填充'),
    ('comptime_fold.tc', 14,
     '（吃 nodes 池 + meta_eval）',
     '（吃节点池 + meta_eval）'),
    ('hir.tc', 10,
     '（读 base.nodes / base.kids）',
     '（读 base 节点侧表 / base.kids）'),
    ('hir.tc', 132,
     'node_to_hir 与 base.nodes 等长',
     'node_to_hir 与节点池等长'),
    ('base.tc', 1776,
     '// 最终删 `pub struct Node` + `nodes[]`。首批',
     '// 20-F 已删 `pub struct Node` + `nodes[]`；首批'),
    ('base.tc', 1846,
     '数组（与 nodes[] 按 id 对齐）',
     '数组（按节点 id 对齐）'),
    ('base.tc', 1927,
     '（nodes + kids 池）',
     '（节点池 + kids 池）'),
    ('codegen_c.tc', 1534,
     '绝不可混用 nodes 节点下标',
     '绝不可混用节点池下标'),
    # ── 追加（第二批扫描补齐）：sema / tir / test 里把 nodes 当**当前形态**描述的表述 ──
    ('sema.tc', 2042,
     '回到 infer_expr 后 `nodes[e].bb == false` 依旧成立',
     '回到 infer_expr 后 `base.node_bb(e) == false` 依旧成立'),
    ('sema.tc', 5237,
     '⚠ 局部变量禁用 `nodes`（会与 `base.nodes` 跨模块裸名冲突触发 T-MOD-W561），改用 elem_nodes。',
     '⚠ 局部变量曾禁用 `nodes`（会与 `base.nodes` 跨模块裸名冲突触发 T-MOD-W561）⇒ 故名 `elem_nodes`；'
     '20-F 已删 `base.nodes`，该冲突不复存在，名字沿用不动。'),
    ('sema.tc', 5380,
     '首入一次性预扩到 base.nodes 长度 + 8M 余量',
     '首入一次性预扩到节点池长度（`base.node_count()`）+ 8M 余量'),
    ('sema.tc', 5859,
     '（base.nodes 长度 + 8M 余量覆盖脱糖新增',
     '（节点池长度 `base.node_count()` + 8M 余量覆盖脱糖新增'),
    ('sema.tc', 5861,
     '注意：用 `== 0` 门控而非每入重查 base.nodes——base.nodes 在推理中会随脱糖增长，',
     '注意：用 `== 0` 门控而非每入重查节点池长度——节点池在推理中会随脱糖增长，'),
    ('sema.tc', 6468,
     '无模式节点，base.nodes[-1] 会越界。',
     '无模式节点，按索引 -1 读侧表会越界。'),
    ('tir.tc', 14,
     '与 base.nodes 同构',
     '与 base 节点池（侧表群）同构'),
    ('tir.tc', 1079,
     '注意：此处 base.nodes[e].kind 为单层成员访问',
     '注意：此处 base.node_kind(e) 为单层调用'),
    ('tir.tc', 1578,
     '直接内联于 lower_unit：base.nodes/base.kids 在此以全局方式访问',
     '直接内联于 lower_unit：base 节点侧表 / base.kids 在此以全局方式访问'),
    ('tir.tc', 1666,
     '直接内联于 lower_unit：base.nodes/base.kids 以全局方式访问',
     '直接内联于 lower_unit：base 节点侧表 / base.kids 以全局方式访问'),
    ('test.tc', 18,
     '这样既无需重置 nodes/decl_list/g_test_seq 等一大票全局',
     '这样既无需重置节点侧表 / decl_list / g_test_seq 等一大票全局'),
]


def code_part(line: str) -> str:
    """取一行里 `//` 之前的代码部分（跳过字符串字面量内的 `//`）。

    自检用：本批是纯注释改动 ⇒ 每行的 code_part 必须**逐字节不变**。
    """
    in_str = False
    i = 0
    while i < len(line):
        c = line[i]
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == '/' and i + 1 < len(line) and line[i + 1] == '/':
            return line[:i]
        i += 1
    return line


def load(path):
    with open(path, 'rb') as f:
        raw = f.read()
    text = raw.decode('utf-8')
    nl = '\r\n' if '\r\n' in text else '\n'
    lines = text.replace('\r\n', '\n').split('\n')
    return lines, nl, raw


def save(path, lines, nl):
    out = nl.join(lines).encode('utf-8')
    with open(path, 'wb') as f:
        f.write(out)
    # 写回自检：字节数可预期 + 行数不变 + 终结符形态不变
    with open(path, 'rb') as f:
        back = f.read()
    assert back == out, '写回自检失败：字节不一致 %s' % path
    assert back.decode('utf-8').replace('\r\n', '\n').split('\n') == lines
    assert (('\r\n' in back.decode('utf-8')) == (nl == '\r\n')), '行尾形态被改写 %s' % path


def main():
    apply = '--apply' in sys.argv
    plan = {}          # fname -> list of (lineno, old, new)

    # A 组
    lines, nl, _ = load(os.path.join(ROOT, 'src', 'base.tc'))
    for no in A_LINES:
        old = lines[no - 1]
        new = old
        for a, b in A_RULES:
            new = new.replace(a, b)
        if new != old:
            plan.setdefault('base.tc', []).append((no, old, new))
        elif any(a in old for a, _ in A_RULES):
            # 规则命中不了却仍带旧表述 ⇒ 白名单/规则失配，必须人工看
            print('⚠ base.tc:%d 规则未命中却仍含旧表述：%s' % (no, old.strip()))
        # else：本行已是新形态（幂等重跑），静默跳过

    # B 组
    for fname, no, old, new in B_OPS:
        p = os.path.join(ROOT, 'src', fname)
        ls, _, _ = load(p)
        cur = ls[no - 1]
        if old not in cur:
            if new in cur:
                continue      # 已应用（幂等重跑），静默跳过
            print('✗ %s:%d 未找到预期原文：%r（当前行：%r）' % (fname, no, old, cur.strip()))
            sys.exit(1)
        if cur.count(old) != 1:
            print('✗ %s:%d 原文出现 %d 次，op 不唯一：%r' % (fname, no, cur.count(old), old))
            sys.exit(1)
        plan.setdefault(fname, []).append((no, cur, cur.replace(old, new)))

    total = 0
    for fname in sorted(plan):
        ops = sorted(plan[fname])
        total += len(ops)
        print('── %s（%d 处）' % (fname, len(ops)))
        for no, old, new in ops:
            print('  %5d  - %s' % (no, old.rstrip()))
            print('         + %s' % new.rstrip())
    print('\nPLAN: %d 处' % total)

    if not apply:
        print('(dry-run，未落盘；加 --apply 落盘)')
        return

    for fname in sorted(plan):
        path = os.path.join(ROOT, 'src', fname)
        ls, nl, _ = load(path)
        before = list(ls)
        for no, old, new in sorted(plan[fname]):
            assert ls[no - 1] == old, '并发漂移 %s:%d' % (fname, no)
            ls[no - 1] = new
        # 自检：行数不变 + 每行 code_part 逐字节不变
        assert len(ls) == len(before), '行数变化 %s' % fname
        for i, (b, a) in enumerate(zip(before, ls)):
            assert code_part(a) == code_part(b), '第 %d 行代码部分被改动 %s' % (i + 1, fname)
        save(path, ls, nl)
        print('APPLIED %s（%d 处，自检通过）' % (fname, len(plan[fname])))
    print('\nDONE: %d 处' % total)


if __name__ == '__main__':
    main()

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S4 §4.14.4 批次 20-J：S3 遗留的两个全局平行数组 → per-node bool 侧表。

对象（§0.14.5 第 4b 项 / §0.13.8 第 3 项，S3 因此记为 partial）
────────────────────────────────────────────────────────────
  · `g_local_decls`  （base.tc:2741；写 codegen_c.tc:3443；读 codegen_c.tc:2251）
      =「已唯一化重整（mangle 成 `name__<sid>`）的声明节点 id」集合
      → `g_node_mangled` + `node_mangled()` / `node_set_mangled()`
  · `g_conpat_binds` （base.tc:2800；写 codegen_c.tc:1500/1586/1640/1697；读 3441）
      =「conpat 载荷绑定（发射期现场合成的 var_decl）」集合，用于**禁止**对其重整
      → `g_node_conpat` + `node_conpat()` / `node_set_conpat()`
      （`node_conpat` 这个名字是 §4.10.3 预定的：「待 `node_conpat` 侧表化后清理」）

动机：二者是「**已登记 id 的集合**」（线性扫 `O(n)`），不是「节点 id → 值」的映射，
但语义上完全等价于「节点上的一个 bool 标记」⇒ 换成 per-node bool 侧表后 O(1)，
且与 S4 已迁的 19 个字段同一范式，顺带兑现 S3「删全局平行数组」的遗留要求。

⭐ 动手前必须先证的等价性（本批的验收核心，逐条已证）
────────────────────────────────────────────────────
① **越界写会被丢弃 = 行为差异吗？** —— 不会。
   侧表访问器 `node_set_xxx` 越界是静默 `return`（范式见 `node_set_bc`，base.tc:2344）。
   写入侧有三类 id：
     · `mk_var_decl` 的返回值 —— `mk_var_decl` 首行即 `node_new("var_decl")`，
       返回 `node_count()-1`，而 `node_new` 里侧表已 append 默认 0 ⇒ **恒在界内**；
     · 源码已有声明节点 id（`sid` / `vdcl`）—— 恒 `< node_count()`。
   ⇒ 不存在「写了却被丢弃」的情形。
② **原集合允许重复 append，bool 标记幂等** —— 查询语义等价。
   旧：成员关系靠「线性扫有没有相等元素」；重复 append 同一 id 不改变判定结果。
   新：`node_set_xxx(id, true)` 重复写同值，判定结果亦不变。⇒ 集合 ⟺ 标记，恒等价。
③ **有无「清空 / 重置」语义？** —— 无。
   grep 全仓「给 g_node_kind / g_local_decls / g_conpat_binds 赋空数组」的写法，结果为空
   ⇒ 两个旧数组与侧表都**从不重置**；侧表随 `node_new` 增长、默认 false（= 不在集合）。
④ **负 id / 越界读**：旧线性扫返回 false；新访问器 `id < 0 || id >= slice_len(...)` 返回
   false（`node_bc` 范式）⇒ 一致。

⚠ 三个不能踩的点
──────────────
· 访问器范式是 `sidetable_init(); var id = nr_idx(n); ...`（`node_bc`，base.tc:2338-2347），
  **读函数首行必须有 `sidetable_init();`**，setter 不需要。
· 新侧表必须在 `sidetable_init()` 里 **登记**（`sidetable_register("node_xxx", "S3")`）——
  它是侧表登记簿（供 IDE / 调试枚举），不是扩容逻辑。本批两张归 **"S3"**（收的是 S3 遗留）。
· `node_new` 里必须 append 默认值，否则侧表与节点池不等长 ⇒ 越界读全返 false（静默错）。

行尾保真：二进制读写 + 写回自检（S4 各批同款）。
脚本幂等：旧串不在但已是新形态 ⇒ 静默跳过；行号漂移只告警不中断。
⚠ op 施加顺序：全部 **按行号降序**（改大行号不影响小行号），避免插入/改行数打偏。

用法
────
    python tools/s3_globals_to_sidetable.py            # dry-run：列 PLAN
    python tools/s3_globals_to_sidetable.py --apply    # 落盘
"""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# ── op 三种：('sub', 行号, 旧串, 新串) / ('ins', 行号, 待插入文本) / ('range', 起, 止, 新行列表) ──
PLAN = {
    'base.tc': [
        # ① sidetable_init 登记簿：在 `node_sa` 那条之后追加两张新侧表
        ('ins', 1896,
         '    sidetable_register("node_mangled", "S3");   // 20-J：S3 遗留 g_local_decls 侧表化（已被唯一化重整的声明）\n'
         '    sidetable_register("node_conpat", "S3");    // 20-J：S3 遗留 g_conpat_binds 侧表化（conpat 载荷绑定，禁止重整）'),

        # ② g_local_decls 声明 → g_node_mangled 声明
        ('sub', 2741,
         'pub var g_local_decls:  []i64;     // 已唯一化重整的声明节点 id（mangle 结果记录）',
         'pub var g_node_mangled: []i64;     // 与节点池等长、按 id 索引：该声明已被唯一化重整（mangle 成 name__<sid>）  ← 20-J'),

        # ③ g_local_has 整块 → node_mangled / node_set_mangled（照 node_bc 范式，读函数带 sidetable_init）
        ('range', 2786, 2794, [
            '// 20-J：原 `g_local_has(dcl)`（线性扫 g_local_decls 集合）→ per-node bool 侧表。',
            '// 语义等价性见 tools/s3_globals_to_sidetable.py 文件头四证（集合 ⟺ 标记）。',
            'pub fn node_mangled(n: u64) bool {',
            '    sidetable_init();',
            '    var id = nr_idx(n);',
            '    if (id < 0 || id >= slice_len(g_node_mangled)) { return false; }',
            '    return g_node_mangled[id] != 0;',
            '}',
            'pub fn node_set_mangled(n: u64, v: bool) void {',
            '    var id = nr_idx(n);',
            '    if (id < 0 || id >= slice_len(g_node_mangled)) { return; }',
            '    if (v) { slice_set(g_node_mangled, id, 1); } else { slice_set(g_node_mangled, id, 0); }',
            '}',
        ]),

        # ④ g_conpat_binds 声明 → g_node_conpat 声明（上方那段「为什么禁止重整」的注释**保留不动**）
        ('sub', 2800,
         'pub var g_conpat_binds: []i64;',
         'pub var g_node_conpat:  []i64;     // 与节点池等长、按 id 索引：该节点是 conpat 载荷绑定（禁止唯一化重整）  ← 20-J'),

        # ⑤ g_conpat_bind_has 整块 → node_conpat / node_set_conpat
        ('range', 2801, 2809, [
            '// 20-J：原 `g_conpat_bind_has(d)`（线性扫 g_conpat_binds 集合）→ per-node bool 侧表。',
            'pub fn node_conpat(n: u64) bool {',
            '    sidetable_init();',
            '    var id = nr_idx(n);',
            '    if (id < 0 || id >= slice_len(g_node_conpat)) { return false; }',
            '    return g_node_conpat[id] != 0;',
            '}',
            'pub fn node_set_conpat(n: u64, v: bool) void {',
            '    var id = nr_idx(n);',
            '    if (id < 0 || id >= slice_len(g_node_conpat)) { return; }',
            '    if (v) { slice_set(g_node_conpat, id, 1); } else { slice_set(g_node_conpat, id, 0); }',
            '}',
        ]),

        # ⑥ node_new：两张新侧表 append 默认 0（与 node_bc 的「默认 false」同）
        ('ins', 2880,
         '    append(g_node_mangled, 0);                              // 20-J：mangled 默认 false（未重整；S3 遗留 g_local_decls 侧表化）\n'
         '    append(g_node_conpat, 0);                               // 20-J：conpat 默认 false（非绑定；S3 遗留 g_conpat_binds 侧表化）'),
    ],

    'codegen_c.tc': [
        # 写点：4 处 conpat 绑定登记（cp_vd / sl_vd / sp_vd / bp_vd 均为 mk_var_decl 返回的 i64）
        ('sub', 1500,
         'append(base.g_conpat_binds, cp_vd);',
         'base.node_set_conpat((cp_vd as u64), true);   // 20-J：S3 遗留全局数组 → per-node bool 侧表'),
        ('sub', 1586,
         'append(base.g_conpat_binds, sl_vd);',
         'base.node_set_conpat((sl_vd as u64), true);   // 20-J：同上'),
        ('sub', 1640,
         'append(base.g_conpat_binds, sp_vd);',
         'base.node_set_conpat((sp_vd as u64), true);   // 20-J：同上'),
        ('sub', 1697,
         'append(base.g_conpat_binds, bp_vd);',
         'base.node_set_conpat((bp_vd as u64), true);   // 20-J：同上'),

        # 读点 1：引用端判断是否也用重整名
        ('sub', 2251,
         'if (vdcl >= 0 && base.g_local_has(vdcl)) {',
         'if (vdcl >= 0 && base.node_mangled((vdcl as u64))) {'),

        # 读点 2 + 写点：声明端「非 conpat 绑定 且 本帧已见过同名」⇒ 重整并登记
        ('sub', 3441,
         'if (base.g_conpat_bind_has(sid) == false && base.g_seen_has(lkey)) {',
         'if (base.node_conpat((sid as u64)) == false && base.g_seen_has(lkey)) {'),
        ('sub', 3443,
         'append(base.g_local_decls, sid);',
         'base.node_set_mangled((sid as u64), true);   // 20-J：S3 遗留全局数组 → per-node bool 侧表'),

        # 注释里对旧数组名的引用
        ('sub', 1551,
         '// 声明（与 slice_pat / bitstr_pat 的 g_conpat_binds 机制同构）。纯绑定臂（无字面量字段）',
         '// 声明（与 slice_pat / bitstr_pat 的 node_conpat 侧表机制同构）。纯绑定臂（无字面量字段）'),
    ],
}


def load(path):
    with open(path, 'rb') as f:
        raw = f.read()
    text = raw.decode('utf-8')
    nl = '\r\n' if '\r\n' in text else '\n'
    return text.replace('\r\n', '\n').split('\n'), nl


def save(path, lines, nl):
    out = nl.join(lines).encode('utf-8')
    with open(path, 'wb') as f:
        f.write(out)
    with open(path, 'rb') as f:
        back = f.read()
    assert back == out, '写回自检失败 %s' % path
    assert (('\r\n' in back.decode('utf-8')) == (nl == '\r\n')), '行尾形态被改写 %s' % path


def main():
    apply = '--apply' in sys.argv

    # ── dry-run：逐条校验，幂等跳过，漂移告警 ──
    plan = {}
    for fname in sorted(PLAN):
        ls, _ = load(os.path.join(ROOT, 'src', fname))
        ops = []
        for op in PLAN[fname]:
            kind = op[0]
            if kind == 'sub':
                _, no, old, new = op
                cur = ls[no - 1] if no - 1 < len(ls) else ''
                if old not in cur:
                    if new in cur:
                        continue
                    print('⚠ %s:%d 行号已漂移（记录于编写时）：old=%r cur=%r'
                          % (fname, no, old[:40], cur.strip()[:60]))
                    continue
                ops.append(op)
            elif kind == 'ins':
                _, no, text = op
                first = text.split('\n')[0]
                if any(first == l.strip() or first.strip() == l.strip()
                       for l in ls[max(0, no - 3):no + 4]):
                    continue          # 幂等：已插入
                ops.append(op)
            else:  # range
                _, a, b, newlines = op
                seg = ls[a - 1:b]
                if seg == newlines:
                    continue          # 幂等：已是新形态
                ops.append(op)
        if ops:
            plan[fname] = ops

    total = 0
    for fname in sorted(plan):
        ops = plan[fname]
        total += len(ops)
        ls, _ = load(os.path.join(ROOT, 'src', fname))
        print('── %s（%d 处）' % (fname, len(ops)))
        for op in ops:
            if op[0] == 'sub':
                _, no, old, new = op
                print('  %5d  - %s' % (no, ls[no - 1].rstrip()))
                print('         + %s' % ls[no - 1].replace(old, new).rstrip())
            elif op[0] == 'ins':
                _, no, text = op
                print('  %5d+ 插入 %d 行：%s …' % (no, len(text.split('\n')),
                                                    text.split('\n')[0].strip()[:60]))
            else:
                _, a, b, newlines = op
                print('  %5d~%d 整段替换（%d 行 → %d 行）' % (a, b, b - a + 1, len(newlines)))
                for l in newlines[:2]:
                    print('         + %s' % l)
                if len(newlines) > 2:
                    print('         …（共 %d 行）' % len(newlines))
    print('\nPLAN: %d 处' % total)

    if not apply:
        print('(dry-run，未落盘；加 --apply 落盘)')
        return

    for fname in sorted(plan):
        path = os.path.join(ROOT, 'src', fname)
        ls, nl = load(path)
        # ⚠ 全部按行号**降序**施加：改大行号不会影响小行号，插入/改行数都不会打偏。
        for op in sorted(plan[fname], key=lambda o: -o[1]):
            if op[0] == 'sub':
                _, no, old, new = op
                assert old in ls[no - 1], 'sub 未命中 %s:%d' % (fname, no)
                ls[no - 1] = ls[no - 1].replace(old, new)
            elif op[0] == 'ins':
                _, no, text = op
                ls[no:no] = text.split('\n')     # 插到第 no 行（1-based）之后
            else:
                _, a, b, newlines = op
                ls[a - 1:b] = newlines
        save(path, ls, nl)
        print('APPLIED %s（%d 处）' % (fname, len(plan[fname])))
    print('\nDONE: %d 处' % total)


if __name__ == '__main__':
    main()

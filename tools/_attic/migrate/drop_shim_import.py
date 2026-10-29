#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S4 §4.14.4 批次 20-H：删 re-export 垫片（`pub @import("std.rc.cst" :: *)`）。

动机
────
S0 把 kind 注册表 / 关键字表迁进库模块 `std.rc.cst` 时，为了「引用点零改动」在
`src/base.tc:23` 与 `src/lex.tc:12` 各留了一个 **`pub @import("std.rc.cst" :: *)` 重导出垫片**。
§4.14.4 把「删 re-export 垫片」列为 S4 四项 deferred 之一，且它与「删 `base.Node`」一起是
**`@desugar` / `@pass` 插件化的硬前置**（否则 S8 的插件 API 会同时暴露两套入口）。

20-F 已删 `base.Node`；本批删垫片 ⇒ **硬前置全部兑现**。

真实站点（全仓去注释精确普查，正则排除 `g_vf_nodes` / `elem_nodes` / `cnodes` 等假阳性）
─────────────────────────────────────────────────────────────────────────────────
垫片只被 **3 处代码 + 2 处模块内裸名** 用到（远比预估小）：
  · `base.tc:2878`  `nk_of_kind(kind)`        ← 模块内裸名（`:: *` 提供）
  · `lex.tc:780`    `kw_lookup(text)`         ← 模块内裸名
  · `hir.tc:711`    `base.lower_policy_of(k) == base.LOWER_OPAQUE`
  · `tc.tc:103`     `lex.init_keywords();`
  · `tc.tc:104`     `base.init_node_kinds();`
⇒ 删掉 `pub` 后：base / lex 改**选择性导入**自己真正用到的符号；hir / tc.tc 各自
  `@import("std.rc.cst" :: …)` 直接引用，不再经 base / lex 转发。

⚠ 待实测的两个不确定点（跑完 `tc check` + IR 快照即可判定）
────────────────────────────────────────────────────────
1. **选择性导入 `:: sym` 是否会改变「哪些 cst 全局被发射」** —— 若发射面是**按模块**而非
   按导入选择器，则 IR 应 **0 DIFF**；若出现 GONE（`g_kw_text` / `g_kw_kind` / `g_kw_tier` /
   `node_kind_names` 等），说明发射面受选择器影响 ⇒ 退回「去 `pub` 但保留 `:: *`」的保守形态。
2. `pub @import` 是否会额外发射一层 **转发包装函数**（`base__init_node_kinds`）—— 若会，
   删垫片后该包装 GONE 属**预期内**（编译器内部别名，非用户可见 IR）。

行尾保真：涉及文件 worktree 全 CRLF（`src/tir.tc` 等 `-text` 文件是硬要求）⇒ 二进制读写 + 写回自检。
脚本幂等：旧串不在但已是新形态 ⇒ 静默跳过，可安全重跑 / 分轮补齐。

用法
────
    python tools/drop_shim_import.py            # dry-run：列 PLAN
    python tools/drop_shim_import.py --apply    # 落盘
"""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# ── 第一趟（已落盘）：去 `pub` + 收窄为选择性导入 + 调用点去 base./lex. 前缀 ──
PHASE1_SUBS = [
    ('base.tc', 21,
     '// 用 `pub @import(... :: *)` 通配**重导出**，使 `base.init_node_kinds()`（src/tc.tc:104）',
     '// 20-H：已删 re-export 垫片 —— 本模块只**选择性导入**自己用到的 `nk_of_kind`；'),
    ('base.tc', 22,
     '// 等既有引用继续解析到 cst 的真实定义（引用点零改动）。',
     '// 下游（`tc.tc` / `hir.tc`）改为各自 `@import("std.rc.cst" :: …)`，不再经 base 转发。'),
    ('base.tc', 23,
     'pub @import("std.rc.cst" :: *);',
     '@import("std.rc.cst" :: nk_of_kind);'),
    ('base.tc', 2989,
     '// 由文件头 `pub @import("std.rc.cst" :: *)` 重导出，引用点零改动。',
     '// 由文件头 `@import("std.rc.cst" :: nk_of_kind)` 选择性导入（20-H 起不再重导出）。'),
    ('lex.tc', 10,
     '// 用 `pub @import(... :: *)` 通配**重导出**，使本模块内部可直接裸名引用（引用点零改动），',
     '// 20-H：已删 re-export 垫片 —— 本模块只选择性导入自己用到的 `kw_lookup`；'),
    ('lex.tc', 11,
     '// 且下游 `lex.init_keywords()`（src/tc.tc:103）仍解析到 cst 的真实定义。',
     '// 下游 `tc.tc` 改为 `@import("std.rc.cst" :: init_keywords)` 直接引用。'),
    ('lex.tc', 12,
     'pub @import("std.rc.cst" :: *);',
     '@import("std.rc.cst" :: kw_lookup);'),
    ('lex.tc', 36,
     '// 关键字表 / kw_lookup / init_keywords 已于 S0 迁至库模块 std.rc.cst（见文件头 pub @import）。',
     '// 关键字表 / kw_lookup / init_keywords 已于 S0 迁至库模块 std.rc.cst（见文件头 @import）。'),
    ('hir.tc', 711,
     '} else if (base.lower_policy_of(k) == base.LOWER_OPAQUE) {',
     '} else if (lower_policy_of(k) == LOWER_OPAQUE) {'),
    ('tc.tc', 103,
     '    lex.init_keywords();',
     '    init_keywords();'),
    ('tc.tc', 104,
     '    base.init_node_kinds();',
     '    init_node_kinds();'),
]

PHASE1_INSERTS = [
    ('hir.tc', 19,
     '@import("std.rc.cst" :: lower_policy_of, LOWER_OPAQUE);   '
     '// 20-H：直连 cst（原经 base 的 pub @import 重导出）'),
    ('tc.tc', 24,
     '@import("std.rc.cst" :: init_keywords, init_node_kinds);   '
     '// 20-H：直连 cst（原经 lex / base 的 pub @import 重导出）'),
]

# ── 第二趟：裸名选择性导入 → 模块别名 `const cst = @import("std.rc.cst")` ──
# ⚠ 为什么改：第一趟后 `tc check` 0 error 但 warning 530 → **532**，多出的 4 条是
#   「跨模块访问必须使用模块限定名 cst__xxx，不能用裸名 xxx」（`nk_of_kind` /
#   `kw_lookup` / `init_keywords` / `init_node_kinds`）。改走 `cst.` 限定调用
#   既消掉这 4 条，也更贴合 §4.14.4「src 直接 @import("std.rc.cst")」的原意。
#   （同时「去 pub」本身撤掉了 2 条垫片告警，故预期最终 warning = 528。）
SUBS = [
    ('base.tc', 22,
     '// 下游（`tc.tc` / `hir.tc`）改为各自 `@import("std.rc.cst" :: …)`，不再经 base 转发。',
     '// 下游（`tc.tc` / `hir.tc`）改为各自 `@import("std.rc.cst")` 直连，不再经 base 转发。'),
    ('base.tc', 23,
     '@import("std.rc.cst" :: nk_of_kind);',
     'const cst = @import("std.rc.cst");'),
    ('base.tc', 2878,
     'var nref_tag: i64 = nk_of_kind(kind);',
     'var nref_tag: i64 = cst.nk_of_kind(kind);'),
    ('base.tc', 2989,
     '// 由文件头 `@import("std.rc.cst" :: nk_of_kind)` 选择性导入（20-H 起不再重导出）。',
     '// 由文件头 `const cst = @import("std.rc.cst")` 直连（20-H 起不再重导出）。'),
    ('lex.tc', 11,
     '// 下游 `tc.tc` 改为 `@import("std.rc.cst" :: init_keywords)` 直接引用。',
     '// 下游 `tc.tc` 改为 `@import("std.rc.cst")` 直连引用。形态同 base.tc（声明式 @import）。'),
    ('lex.tc', 12,
     '@import("std.rc.cst" :: kw_lookup);',
     'const cst = @import("std.rc.cst");'),
    ('lex.tc', 780,
     'var tname: string = kw_lookup(text);',
     'var tname: string = cst.kw_lookup(text);'),
    ('hir.tc', 20,
     '@import("std.rc.cst" :: lower_policy_of, LOWER_OPAQUE);',
     'const cst = @import("std.rc.cst");'),
    ('hir.tc', 712,
     '} else if (lower_policy_of(k) == LOWER_OPAQUE) {',
     '} else if (cst.lower_policy_of(k) == cst.LOWER_OPAQUE) {'),
    ('tc.tc', 25,
     '@import("std.rc.cst" :: init_keywords, init_node_kinds);',
     'const cst = @import("std.rc.cst");'),
    ('tc.tc', 104,
     '    init_keywords();',
     '    cst.init_keywords();'),
    ('tc.tc', 105,
     '    init_node_kinds();',
     '    cst.init_node_kinds();'),
]

INSERTS = []      # 第二趟无插入（第一趟的两条 import 行在本趟原地改写）

# ── 第三趟：模块别名从 `const cst = @import(...)` → 声明式 `@import(...)` ──
# ⚠ 为什么再改一趟：第二趟后 warning 530 → **532**，构成经旁路对照查明是
#   「+4 T-NAM-W402（CONST_UPPER：`const cst` 非 UPPER_SNAKE）／−2 T-MOD-W561」。
#   ——`const` 声明要走 `validate_const_name`（parse.tc:1132/2244），而全仓 30+ 个
#   `const base = @import("src.base")` 同样吃 W402（基线 62 条里绝大多数是它），
#   故「再 +4」不算新类别，但**有更干净的写法**：
#       lib/std/rc/cst.tc:23 的官方用法第二条 + conformance p42_std_import.tc 都在用
#       声明式 `@import("std.rc.cst");`（别名 = last_segment = `cst`，已是验证过的形态）。
#   它不产生 const 声明 ⇒ W402 回到基线 62；调用点 `cst.xxx()` 限定访问不变 ⇒ 不引入 W561。
#   结果：warning **528 = 530 − 2**（减掉的正是垫片自身那 2 条跨模块裸名告警）。
#   负向测试：把 `cst.nk_of_kind` 故意写错成 `cst.nk_of_kind_TYPO` ⇒ check 报 1 error，
#   证明声明式 @import 真的建立了 `cst.` 解析（不是被静默放过）。
PHASE3_SUBS = [
    ('base.tc', 23,
     'const cst = @import("std.rc.cst");',
     '@import("std.rc.cst");'),
    ('lex.tc', 12,
     'const cst = @import("std.rc.cst");',
     '@import("std.rc.cst");'),
    ('hir.tc', 20,
     'const cst = @import("std.rc.cst");   // 20-H：直连 cst（原经 base 的 pub @import 重导出）',
     '@import("std.rc.cst");   // 20-H：直连 cst（原经 base 的 pub @import 重导出）'),
    ('tc.tc', 25,
     'const cst = @import("std.rc.cst");   // 20-H：直连 cst（原经 lex / base 的 pub @import 重导出）',
     '@import("std.rc.cst");   // 20-H：直连 cst（原经 lex / base 的 pub @import 重导出）'),
]


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
    plan = {}

    for fname, no, old, new in SUBS + PHASE3_SUBS:
        ls, _ = load(os.path.join(ROOT, 'src', fname))
        cur = ls[no - 1]
        if old not in cur:
            if new in cur:
                continue          # 幂等：已应用
            # ⚠ 三趟的行号分别是**各趟当时**的行号（每趟插入/扩注释会让后续行下移），
            #   故整表重跑时 old/new 都可能对不上当前行 —— 这属于**记录漂移**，不是错误。
            #   只提示不中断，使脚本可作为「改动台账」复核而非只是一次性迁移器。
            print('⚠ %s:%d 行号已漂移（记录于该趟当时）：old=%r cur=%r' % (fname, no, old[:40], cur.strip()[:60]))
            continue
        if cur.count(old) != 1:
            print('✗ %s:%d 原文出现 %d 次' % (fname, no, cur.count(old)))
            sys.exit(1)
        plan.setdefault(fname, []).append(('sub', no, old, new))

    for fname, after, text in INSERTS:
        ls, _ = load(os.path.join(ROOT, 'src', fname))
        if any(text == ls[i] for i in range(max(0, after - 3), min(len(ls), after + 4))):
            continue              # 幂等：已插入
        plan.setdefault(fname, []).append(('ins', after, text, None))

    total = 0
    for fname in sorted(plan):
        ops = plan[fname]
        total += len(ops)
        ls, _ = load(os.path.join(ROOT, 'src', fname))
        print('── %s（%d 处）' % (fname, len(ops)))
        for op in ops:
            if op[0] == 'sub':
                _, no, old, new = op
                # ⚠ 打印**整行结果**而非 new 本身：old 可能不含行首缩进，
                #   只打 new 会看起来「缩进丢了」，实际 replace 只换子串、缩进保留。
                print('  %5d  - %s' % (no, ls[no - 1].rstrip()))
                print('         + %s' % ls[no - 1].replace(old, new).rstrip())
            else:
                _, after, text = op[0], op[1], op[2]
                print('  %5d+ 插入：%s' % (after, text))
    print('\nPLAN: %d 处' % total)

    if not apply:
        print('(dry-run，未落盘；加 --apply 落盘)')
        return

    for fname in sorted(plan):
        path = os.path.join(ROOT, 'src', fname)
        ls, nl = load(path)
        # ⚠ 顺序：op 表里的行号**全部以原文件为基准**，而插入会让其后的行整体下移
        #   ⇒ 必须 **先 sub（原行号仍有效）再 ins**；且 ins 之间按行号**降序**施加
        #   （同 20-F 坑六）。先 ins 后 sub 会让 sub 全部打偏（20-H 首跑实测踩到）。
        for op in plan[fname]:
            if op[0] != 'sub':
                continue
            _, no, old, new = op
            assert old in ls[no - 1], 'sub 未命中 %s:%d' % (fname, no)
            ls[no - 1] = ls[no - 1].replace(old, new)
        for op in sorted([o for o in plan[fname] if o[0] == 'ins'], key=lambda o: -o[1]):
            ls.insert(op[1], op[2])
        save(path, ls, nl)
        print('APPLIED %s（%d 处）' % (fname, len(plan[fname])))
    print('\nDONE: %d 处' % total)


if __name__ == '__main__':
    main()

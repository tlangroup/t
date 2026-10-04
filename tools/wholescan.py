#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
S4 SoA 跨索引「Node 整体拷贝」扫描器（批次 16 新增，第四个工具 - 见 cst-design-v2 §0.14.7）。

背景（第十六批 la 的血案）：
    `la` 外置为侧表后，形如 `base.nodes[e] = cn;`（cn 来自**另一个索引** call_id）的整体
    Node 结构体赋值**只搬 Node 里剩余的结构体字段，不再搬运已外置到 `g_node_*` 侧表的字段**。
    漏一处就静默丢数据 —— 本批表现为 6 个 ADT/match examples 双后端 IR DIFF：
    variant_lit 脱糖出的 call 节点实参列表存在 `call_id` 的 la 槽，而 `e` 的侧表仍是
    variant_lit 的默认 `-1` ⇒ 发射出 `List_from_One()` 而不是 `List_from_One(42)`。

用法：
    python tools/wholescan.py                  # 扫 src/*.tc，列出全部跨索引整体拷贝 + 已/未同步字段
    python tools/wholescan.py --only=na        # 只报告未同步包含指定字段的站点
    python tools/wholescan.py --all            # 连「同索引回写」也列出（默认跳过，因为无害）

判定口径：
  * `var V: Node = (base.)nodes[EXPR];` 记录 V ← EXPR
  * 危险站点 = `nodes[DEST] = V;` 或 `slice_set((base.)nodes, DEST, V)` 且 DEST != EXPR
  * 无害站点 = DEST == EXPR 的同索引回写（写回自己，侧表不受影响）
  * 对每个危险站点，检查其后 LOOKAHEAD 行内是否出现 `node_set_<field>((DEST ...))`，
    列出「已同步 / 未同步」两份清单。

⚠ 政策提醒（每批只对本批字段负责）：
    一份拷贝在 S4 之前本来搬运**全部**字段，故严格等价需要把**所有**已迁字段都同步。
    但历史批次的站点是在各自批次被悄然破坏的（因两节点取值恒等而不可观测），
    若一次性补齐会越过本批归因边界 ⇒ 采用「**本批迁入哪个字段，就在这些站点补哪个字段**」的
    增量纪律（本批补 la）；本脚本的「未同步」清单是**归因台账**，不是必须清零的门禁。
    S4 收口（删 Node）时统一以 `node_to_node` 辅助一次性对齐。
"""

import glob
import re
import sys

SOA_FIELDS = [
    "se", "has_sa", "has_sb", "has_sc", "be", "bf", "memspace", "bd", "bb", "bc",
    "nd", "ib", "sc", "sb", "nc", "ba", "lc", "ia", "lb", "nb", "la", "na",
    "kind",   # S4 第十八批（§0.14.7）
    "sa",     # S4 第十九批（§0.14.7）：Node 里最后一个真实载荷字段（string，默认 ""）
]
LOOKAHEAD = 6


def grab(s, i):
    """s[i] 必须是 '['，返回配对的方括号内文本（支持嵌套）。"""
    d = 0
    for j in range(i, len(s)):
        if s[j] == "[":
            d += 1
        elif s[j] == "]":
            d -= 1
            if d == 0:
                return s[i + 1:j]
    return None


def scan(path, lines):
    """返回 [(line_no, text, dest, src, kind)]"""
    hits = []
    decl = {}
    for i, ln in enumerate(lines):
        if re.match(r"\s*(pub )?fn ", ln):
            decl = {}
        for m in re.finditer(r"\bvar\s+(\w+)\s*:\s*(?:base\.)?Node\s*=\s*(?:base\.)?nodes\[", ln):
            inner = grab(ln, m.end() - 1)
            if inner is not None:
                decl[m.group(1)] = inner.strip()
        for m in re.finditer(r"\bvar\s+(\w+)\s*:\s*(?:base\.)?Node\s*=\s*([A-Za-z_]\w*)\s*;", ln):
            if m.group(2) in decl:
                decl[m.group(1)] = decl[m.group(2)]
        # nodes[DEST] = VAR;
        for m in re.finditer(r"(?:base\.)?nodes\[", ln):
            inner = grab(ln, m.end() - 1)
            if inner is None:
                continue
            tail = ln[m.end() + len(inner) + 1:]
            mm = re.match(r"\s*=\s*([A-Za-z_]\w*)\s*;", tail)
            if mm and mm.group(1) in decl:
                hits.append((i, ln, inner.strip(), decl[mm.group(1)], "WHOLE-COPY"))
        # slice_set((base.)nodes, DEST, VAR)
        for m in re.finditer(r"slice_set\(\s*(?:base\.)?nodes\s*,\s*", ln):
            rest = ln[m.end():]
            mm = re.match(r"([^,]+),\s*([A-Za-z_]\w*)\s*\)", rest)
            if mm and mm.group(2) in decl:
                hits.append((i, ln, mm.group(1).strip(), decl[mm.group(2)], "SLICESET"))
    return hits


def norm(x):
    return re.sub(r"\s+", "", x)


def main():
    argv = sys.argv[1:]
    only = None
    show_all = False
    for a in argv:
        if a.startswith("--only="):
            only = a.split("=", 1)[1]
        elif a == "--all":
            show_all = True
    need = set(SOA_FIELDS if only is None else [only])

    files = sorted(glob.glob("src/*.tc"))
    n_cross = n_same = 0
    findings = []
    for f in files:
        src = open(f, encoding="utf-8", errors="replace").read().replace("\r\n", "\n")
        lines = src.split("\n")
        for (i, ln, dest, srce, kind) in scan(f, lines):
            if norm(dest) == norm(srce):
                n_same += 1
                if show_all:
                    print(f"  [same-index 无害] {f}:{i+1}  {ln.strip()[:100]}")
                continue
            n_cross += 1
            window = "\n".join(lines[i + 1:i + 1 + LOOKAHEAD])
            done, miss = [], []
            for fl in SOA_FIELDS:
                pat = r"node_set_" + fl + r"\(\(\s*" + re.escape(norm(dest))
                if re.search(pat, norm(window)) or re.search(
                        r"node_set_" + fl + r"\(\(\s*" + re.escape(dest), window):
                    done.append(fl)
                else:
                    miss.append(fl)
            findings.append((f, i + 1, ln.strip(), dest, srce, kind, done, miss))

    print(f"跨索引 Node 整体拷贝站点：{n_cross} 处（同索引回写 {n_same} 处，无害）")
    for (f, no, txt, dest, srce, kind, done, miss) in findings:
        print(f"\n  ⚠ {f}:{no}  [{kind}]")
        print(f"      {txt[:110]}")
        print(f"      dest = [{dest}]   src 索引 = [{srce}]  ⇒ 结构体字段已搬，侧表字段需显式同步")
        print(f"      已同步: {','.join(done) if done else '(无)'}")
        print(f"      未同步: {','.join(m for m in miss if m in need) if need != set(SOA_FIELDS) else ','.join(miss)}")
    if n_cross == 0:
        print("  ✓ 无跨索引整体拷贝")
    return 0


if __name__ == "__main__":
    sys.exit(main())

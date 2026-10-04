#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
S4 §0.14.7 收口工具（批次 20-A）：消除「Node 局部声明 / 值拷贝」这一层冗余间接。

背景：24 个载荷字段全部外置为侧表后，`pub struct Node` 只剩 `id`（S5 过渡字段）。
      ⇒ `var n: Node = base.nodes[e];` 这类局部声明已无载荷可读，只剩下三种残留用途，
      本工具按三条规则分别处理；处理完即可删掉声明，为最终删 `pub var nodes: []Node;` 铺路。

三条规则（均由「作用域内标识符出现次数」驱动，绝不猜）：
  规则1（死声明）：声明之后变量**完全未再出现** ⇒ 删除声明行。
  规则2（成对回写）：变量唯一用途是配套回写 `slice_set(nodes, IDX, n);`
          （base.tc 的 ~200 个 mk_* 构造器即此形态）⇒ 声明行与回写行**成对删除**。
  规则3（id 反查）：变量仅以 `n.id` 形式被使用（`base.node_sb((n.id as u64))`）。
          ⚠ `n` 就是 `nodes[e]` ⇒ **`n.id` 恒等于索引表达式 `e`**（node_new 里
          `n.id = slice_len(nodes)` 即自身下标）⇒ 把 `n.id` 就地替换为索引表达式，
          再删除声明。这是纯粹的冗余间接消除，语义严格等价。
          ⚠⚠ **前置条件（否则禁用！用 `--safe-only` 关掉本规则）**：必须确保
          `nodes[i].id == i` 全局成立。而 sema 的 4 处**跨索引整体拷贝**
          （`base.nodes[e] = cn;`，见 `tools/wholescan.py`）会把**源节点的 id 搬到目标槽**
          ⇒ 目标槽的 `id` 变成源索引，**不变量被破坏**；且这 4 处还在搬运 span/td/trivia
          等**未同步**字段，本身也不能贸然删。⇒ R3 必须等该问题解决后再启用。

安全红线（本工具的全部意义）：
  ⚠ 删除一个局部声明时，若该名字**在作用域内仍被使用**，删除后 t 会把它解析到
    **外层同名变量** ⇒ **不报错、静默错值**（比报错更危险得多）。
    ⇒ 凡不满足上述三条规则的声明一律 **SKIP 并列出**，交人工处理。
  ⚠ 统计「是否仍被使用」时必须**剥离字符串字面量**：`sb_cat3("n", …)` 里的 `"n"`
    会被 `\bn\b` 命中，造成大量假阳性（实测一度把 1 处报成 86 处）。
  ⚠ 遇到**同名重声明**立即停止扫描：其后出现的是另一个变量，不计入本声明。

用法：
  python tools/drop_node_decl.py                  # dry-run（默认，扫全部 src/*.tc）
  python tools/drop_node_decl.py src/sema.tc      # 单文件 dry-run
  python tools/drop_node_decl.py --apply          # 落盘（保原行尾）
"""
import re, sys, glob

DECL_RE = re.compile(r'^\s*(var|let)\s+([A-Za-z_][A-Za-z_0-9]*)\s*:\s*(?:base\.)?Node\s*=')
FN_RE = re.compile(r'^\s*(?:pub\s+)?fn\s+')
IDX_RE = re.compile(r'(?:base\.)?nodes\s*\[(.*?)\]')


def strip_comment(line):
    """剥离 // 注释（字符串感知，保留字符串内容）"""
    out, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c == '"':
            out.append(c); i += 1
            while i < n:
                if line[i] == '\\':
                    out.append(line[i:i + 2]); i += 2; continue
                out.append(line[i])
                if line[i] == '"':
                    i += 1; break
                i += 1
            continue
        if c == '/' and i + 1 < n and line[i + 1] == '/':
            break
        out.append(c); i += 1
    return ''.join(out)


def strip_code(line):
    """剥离 // 注释**并清空字符串字面量内容**（用于标识符出现次数统计）"""
    out, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c == '"':
            i += 1
            while i < n:
                if line[i] == '\\':
                    i += 2; continue
                if line[i] == '"':
                    i += 1; break
                i += 1
            continue
        if c == '/' and i + 1 < n and line[i + 1] == '/':
            break
        out.append(c); i += 1
    return ''.join(out)


def read_lines(path):
    return open(path, 'rb').read().decode('utf-8').splitlines(keepends=True)


def write_lines(path, lines):
    open(path, 'wb').write(''.join(lines).encode('utf-8'))


def func_end(lines, start):
    """用花括号平衡定位函数体末行。

    ⚠⚠ 必须走 strip_code（**剥掉字符串字面量**）而非 strip_comment：字符串里的 `{` / `}`
      （如 `sb_cat3("{", ...)`）会让平衡算错 ⇒ 函数区间被判短 ⇒ 明明在用的变量被当成
      「未使用」误删 ⇒ tc check 报 8 个 T-SEM-E201（批次 20-A 实测踩到）。
    """
    depth, seen = 0, False
    for j in range(start, len(lines)):
        for ch in strip_code(lines[j]):
            if ch == '{':
                depth += 1; seen = True
            elif ch == '}':
                depth -= 1
        if seen and depth <= 0:
            return j
    return len(lines) - 1


def _is_slice_set(line, name, decl_idx):
    m = re.match(r'^\s*slice_set\s*\(\s*(?:base\.)?nodes\s*,\s*(.+?)\s*,\s*' + re.escape(name) + r'\s*\)\s*;', line)
    return bool(m) and m.group(1).strip() == decl_idx


def scan(path, apply=False, safe_only=False):
    lines = read_lines(path)
    code = [strip_code(l) for l in lines]
    drop, rewrite, keep = [], [], []
    for i, l in enumerate(code):
        m = DECL_RE.match(l)
        if not m:
            continue
        name = m.group(2)
        st = 0
        for j in range(i, -1, -1):
            if FN_RE.match(code[j]):
                st = j; break
        en = func_end(lines, st)
        pat = re.compile(r'\b' + re.escape(name) + r'\b')
        redecl = re.compile(r'^\s*(?:var|let)\s+' + re.escape(name) + r'\b')
        idpat = re.compile(r'\b' + re.escape(name) + r'\.id\b')
        use_lines = []
        reassigned = False
        for j in range(i + 1, en + 1):
            cj = code[j]
            if redecl.match(cj):
                break
            if re.match(r'^\s*' + re.escape(name) + r'\s*=', cj):
                reassigned = True
            if pat.search(cj):
                use_lines.append(j)
        m_idx = IDX_RE.search(l)
        decl_idx = m_idx.group(1).strip() if m_idx else None
        if not use_lines:
            drop.append((i, name, 'R1 死声明'))
        elif (not reassigned) and decl_idx and all(_is_slice_set(code[j], name, decl_idx) for j in use_lines):
            drop.append((i, name, 'R2 成对回写'))
            for j in use_lines:
                drop.append((j, name, 'R2 成对回写(slice_set)'))
        elif (not reassigned) and decl_idx and (not safe_only) and all(
                not pat.search(idpat.sub('', code[j])) for j in use_lines):
            # 规则3：所有出现都是 `name.id` ⇒ 就地替换为索引表达式后删声明
            for j in use_lines:
                rewrite.append((j, name, decl_idx))
            drop.append((i, name, 'R3 id 反查'))
        else:
            keep.append((i, name, len(use_lines)))
    if apply:
        for (j, name, idx) in rewrite:
            new = idpat_sub(lines[j], name, idx)
            lines[j] = new[0]
        idxs = set(i for i, _, _ in drop)
        lines = [l for i, l in enumerate(lines) if i not in idxs]
        write_lines(path, lines)
    return len(drop), len(rewrite), keep


def idpat_sub(line, name, idx):
    pat = re.compile(r'\b' + re.escape(name) + r'\.id\b')
    return [pat.sub(idx, line)]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    apply = '--apply' in sys.argv
    safe_only = '--safe-only' in sys.argv
    files = args if args else sorted(glob.glob('src/*.tc'))
    td = tr = 0
    all_keep = []
    for f in files:
        d, r, k = scan(f, apply, safe_only)
        td += d; tr += r
        for (i, name, used) in k:
            all_keep.append((f, i + 1, name, used))
    print("DROP(删除行): %d   REWRITE(n.id -> 索引): %d" % (td, tr))
    print("SKIP(需人工): %d" % len(all_keep))
    for (f, ln, name, used) in all_keep[:25]:
        print("   %s:%d  %s  (声明后仍出现 %d 次)" % (f, ln, name, used))
    if len(all_keep) > 25:
        print("   ... 其余 %d 处省略" % (len(all_keep) - 25))
    print("MODE: %s" % ('APPLY' if apply else 'DRY-RUN'))


if __name__ == '__main__':
    main()

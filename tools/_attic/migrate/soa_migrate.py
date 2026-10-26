#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
S4 SoA 通用字段外置迁移器（批次 13 从 mig13.py 泛化而来）。

用法：
    python tools/soa_migrate.py ia src/sema.tc              # dry run，输出计划 + 未映射清单
    python tools/soa_migrate.py ia src/sema.tc --apply      # 落盘

前置（调用方职责）：被迁字段的访问器必须已按下述约定命名
    getter = node_<field>()            setter = node_set_<field>()
且已一并加入 base.tc 的 sidetable_init 登记与 node_new 的锁步 append。
本脚本只负责把调用方站点改成访问器，不负责定义侧表。

策略（沿用批次 10/11/12）：
  * 先按函数体建立 Node 局部量 → 索引表达式 的映射
        var X: Node = base.nodes[IDX];   /  var X = nodes[IDX];
  * 读点 `X.ia`      → `<mod>node_ia((IDX as u64))`
  * 写点 `X.ia = V;` → `<mod>node_set_ia((IDX as u64), V);`
  * `<expr>.ia` 其中 expr 为 `base.nodes[IDX]` / `nodes[IDX]` 形式者直接改写
  * 模块限定符：base.tc 自身无限定；其余 `base.`；函数内出现 `var base` 遮蔽 → `base__`
  * 跳过：纯注释行、字符串字面量内的命中、tbl_Rec*（S2 per-kind record）

★★★ 行尾红线（批次 13 血的教训，见 topics/impl-rules.md）：
本仓库**逐文件**使用不同行尾（`mir/tmir/codegen_wasm/codegen_riscv` 为 CRLF，其余多为 LF）。
Python 文本模式读（`newline=None`）会把 `\r\n` 整体折叠成 `\n`，写回后整文件行尾被改写，
`git diff --stat` 会虚增到几千行、淹没真实改动。故本脚本**全程二进制读写 + 逐行记录原终结符**，
按原形态写回；收尾必须用 `git diff --stat` 与 `git diff -w --stat` 对照确认无漂移。
"""
import sys, os, io, re

if len(sys.argv) < 2:
    print('usage: python tools/soa_migrate.py <field> <file> [--apply]')
    sys.exit(1)
FIELD = sys.argv[1]
GET = 'node_' + FIELD
SET = 'node_set_' + FIELD


def outside_strings(s, pos):
    instr = False
    i = 0
    while i < pos:
        c = s[i]
        if not instr:
            if c == '"':
                instr = True
        else:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                instr = False
        i += 1
    return not instr


def find_all_outside(s, term, word_boundary=False):
    """返回 term 在字符串外、且不在 // 注释之后的所有位置。

    word_boundary=True 时额外要求 term 之后**不能紧跟标识符字符**（[A-Za-z0-9_]）。
    ⚠ 第十七批 `na` 的血案：不加这条，`d.name` / `d.names` 会被当成 `d.na` 命中
      （na 是 name 的前缀），若接收者恰好是已映射的 Node 局部量，就会被**改坏**成
      `node_na((idx as u64))me`。故自第十七批起默认开启（见下方调用点）。
    """
    res = []
    p = s.find(term)
    while p >= 0:
        if outside_strings(s, p):
            if word_boundary:
                nxt = p + len(term)
                if nxt < len(s) and (s[nxt].isalnum() or s[nxt] == "_"):
                    p = s.find(term, p + 1)
                    continue
            cpos = s.find('//')
            commented = False
            while cpos >= 0 and cpos < p:
                if outside_strings(s, cpos):
                    commented = True
                    break
                cpos = s.find('//', cpos + 1)
            if not commented:
                res.append(p)
        p = s.find(term, p + 1)
    return res


def func_bounds(lines):
    """返回 [(start, end)]，每个为 indent-0 顶层函数的行区间（0-based，含端点）。"""
    out = []
    i = 0
    n = len(lines)
    while i < n:
        if re.match(r'(pub\s+)?fn\s+\w+\s*\(', lines[i]):
            j = i
            # 找到签名结束的 `{`
            while j < n and '{' not in lines[j]:
                j += 1
            # 找收尾 `}`（indent 0）
            k = j
            while k < n and lines[k].rstrip() != '}':
                k += 1
            out.append((i, k))
            i = k + 1
        else:
            i += 1
    return out


NODE_LOCAL = re.compile(r'var\s+(\w+)\s*(?::\s*Node)?\s*=\s*(?:base__nodes|base\.nodes|nodes)\[([^\]]+)\]\s*;')


def read_lines(path):
    """二进制读入，返回 (lines, terms)：lines 为不含终结符的行内容，terms 为逐行原终结符。
    保证写回时行尾形态与源文件逐字节一致（CRLF / LF / 混用均可）。"""
    data = io.open(path, 'rb').read()
    txt = data.decode('utf-8', errors='replace')
    lines, terms = [], []
    start, n = 0, len(txt)
    while start < n:
        j = txt.find('\n', start)
        if j < 0:
            lines.append(txt[start:])
            terms.append('')
            break
        if j > start and txt[j - 1] == '\r':
            lines.append(txt[start:j - 1])
            terms.append('\r\n')
        else:
            lines.append(txt[start:j])
            terms.append('\n')
        start = j + 1
    return lines, terms


def eol_report(terms):
    crlf = sum(1 for t in terms if t == '\r\n')
    lf = sum(1 for t in terms if t == '\n')
    if crlf and not lf:
        return 'CRLF (%d 行)' % crlf
    if lf and not crlf:
        return 'LF (%d 行)' % lf
    return 'MIXED: CRLF %d / LF %d / 其他 %d' % (crlf, lf, len(terms) - crlf - lf)


def write_lines(path, lines, terms):
    out = ''.join(c + t for c, t in zip(lines, terms))
    io.open(path, 'wb').write(out.encode('utf-8'))
def first_semi(s):
    """返回首个**字符串外**的 `;` 下标，没有则 -1。"""
    i = 0
    instr = False
    while i < len(s):
        c = s[i]
        if not instr:
            if c == '"':
                instr = True
            elif c == ';':
                return i
        else:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                instr = False
        i += 1
    return -1


def balanced_content(s, open_pos):
    """s[open_pos] 必须是 '['，返回 (内层文本, 闭括号下标)；不配平返回 None。
    支持嵌套下标（如 `nodes[g_fc_d[i]]`），批次 14 因此多了 3 处自动站点。"""
    if open_pos >= len(s) or s[open_pos] != '[':
        return None
    depth = 0
    i = open_pos
    while i < len(s):
        if s[i] == '[':
            depth += 1
        elif s[i] == ']':
            depth -= 1
            if depth == 0:
                return (s[open_pos + 1:i], i)
        i += 1
    return None


NODE_PREFIXES = ('base__nodes[', 'base.nodes[', 'nodes[')   # 由长到短，供外部复用
# S4 第十八批（§0.14.7）：**返回 Node 的函数**也要当接收者——codegen_dev 的哨兵读取
# `var n: Node = dev_safe_node(tn);` / `dev_safe_node(s).kind` 走的不是下标而是函数调用。
# 全仓普查（§0.14.7「批次 18」）确认：返回 Node 的函数**只有** dev_safe_node 一个。
NODE_CALL_PREFIXES = ('base.dev_safe_node(', 'dev_safe_node(')


def balanced_tail(s, open_pos):
    """通用括号配对：open_pos 处是 '[' 或 '('，返回 (内层文本, 闭括号下标)。"""
    if open_pos >= len(s) or s[open_pos] not in '[(':
        return None
    oc, cc = s[open_pos], (']' if s[open_pos] == '[' else ')')
    depth = 0
    i = open_pos
    while i < len(s):
        if s[i] == oc:
            depth += 1
        elif s[i] == cc:
            depth -= 1
            if depth == 0:
                return (s[open_pos + 1:i], i)
        i += 1
    return None


def call_idx_at_end(pre):
    """pre 以 `...dev_safe_node(EXPR)` 结尾时返回 (起始下标, EXPR)，否则 None。"""
    for pat in NODE_CALL_PREFIXES:
        p = pre.rfind(pat)
        if p < 0:
            continue
        r = balanced_tail(pre, p + len(pat) - 1)
        if r is None:
            continue
        inner, close = r
        if close != len(pre) - 1:
            continue
        return (p, inner)
    return None


def idx_at_end(pre):
    """pre 以 `...nodes[EXPR]` 结尾时返回 (起始下标, EXPR)，否则 None。
    ⚠ 必须由**长到短**匹配前缀：否则 `base.nodes[d]` 会命中较短的 `nodes[`，
    把替换起点算到 `base.` 之后 ⇒ 产出 `base.base.node_lb(...)` 这种双限定（批次 14 实测）。"""
    for pat in NODE_PREFIXES:   # 已按「由长到短」排好，直接顺序匹配
        p = pre.rfind(pat)
        if p < 0:
            continue
        r = balanced_content(pre, p + len(pat) - 1)
        if r is None:
            continue
        inner, close = r
        if close != len(pre) - 1:
            continue
        return (p, inner)
    # S4 第十八批（§0.14.7）：回落去匹配「返回 Node 的函数」（dev_safe_node）
    return call_idx_at_end(pre)


DECL_BASE = re.compile(r'var\s+base\b')

# ⚠ 类型标注可能是 `Node` 也可能是 **`base.Node`**（批次 14 在 hir.tc 实测：该文件通篇
#   写作 `var n: base.Node = base.nodes[d];`，漏统一的只能手改 6 处）。
NODE_DECL_RE = re.compile(r'var\s+(\w+)\s*(?::\s*(?:base\.)?Node)?\s*=\s*(?:base__nodes|base\.nodes|nodes)\[')
# S4 第十八批（§0.14.7）：**返回 Node 的函数**（dev_safe_node，见 NODE_CALL_PREFIXES 处普查）
# 也是合法的 Node 局部量来源。若不认，codegen_dev 的全部站点都会掉进 UNMAPPED。
NODE_DECL_CALL_RE = re.compile(r'var\s+(\w+)\s*(?::\s*(?:base\.)?Node)?\s*=\s*(?:base\.\s*)?dev_safe_node\(')


def build_map(lines, start, end):
    """返回有序 [(lineno, col, name, idx_expr)]，解析时取「最近前置」声明。

    ⚠ 第十八批修订（同一行声明 + 同一行使用）：这里额外记下声明在行内的**起始列** `col`。
    旧版只记行号、`resolve` 要求 `ln < lineno`（严格小于），于是形如
        `if (mlen >= 0) { var mvn: Node = base.nodes[mlen]; if (mvn.kind == "int") ... }`
    的**同行**站点看不见自己的声明，回落到函数里**更早**的同名声明 ⇒ 把 `mvn.kind` 译成
    `node_kind((mrows as u64))`（前一个 `@tsplat` 分支的变量），产出未定义标识符。
    ⇒ 改为按 **(行, 列) 序**取最近前置：同行且声明在左侧者也算「可见」。
    """
    m = []
    for i in range(start, end + 1):
        s = lines[i]
        for mo in NODE_DECL_RE.finditer(s):
            open_pos = mo.end() - 1
            r = balanced_content(s, open_pos)
            if r is None:
                continue
            inner, close = r
            rest = s[close + 1:].lstrip()
            if rest.startswith(';') or rest.startswith('.'):
                m.append((i, mo.start(1), mo.group(1), inner))
        for mo in NODE_DECL_CALL_RE.finditer(s):
            r = balanced_tail(s, mo.end() - 1)
            if r is None:
                continue
            inner, close = r
            rest = s[close + 1:].lstrip()
            if rest.startswith(';') or rest.startswith('.'):
                m.append((i, mo.start(1), mo.group(1), inner))
    return m


def resolve(m, name, lineno, col=1 << 30):
    """按 (行, 列) 序取最近前置声明；`col` 缺省为行尾（等价旧行为的严格小于）。"""
    best = None
    for (ln, cl, nm, ex) in m:
        if nm != name:
            continue
        if (ln, cl) >= (lineno, col):
            continue
        if best is None or (ln, cl) > (best[0], best[1]):
            best = (ln, cl, nm, ex)
    return best[3] if best else None


def stale_inner(lines, field):
    """⭐ 第十七批新坑自检：索引表达式自身含被迁字段（`var ini: Node = base.nodes[n.na];`）。
    工具用**迁移前**的原文建立「接收者 → 索引表达式」映射，于是把 `ini.na` 译成
    `base.node_na((n.na as u64))` —— 外层译了，内层的 `n.na` 是**未迁移的字段读**，
    编译期表现为 T_UNKNOWN_FIELD。且二次扫描**发现不了**（该 `.na` 已落在访问器
    实参位，读/写点识别都不再命中，PLAN 恒为 0）。故必须显式自检。
    """
    # 只看「本批产出的访问器所在行」：避免把 S2 per-kind record 的 `r.na = tbl_RecX_na[i];`
    # （record 自己的 na 字段，与本批无关）当假阳性。
    pat = re.compile(r'\.' + re.escape(field) + r'\b')
    bad = []
    for i, s in enumerate(lines):
        if ('node_' + field + '(') not in s and ('node_set_' + field + '(') not in s:
            continue
        for m in pat.finditer(s):
            pre = s[:m.start()]
            # 紧邻前缀是 node_<field> / node_set_<field> / *_<field>（tbl_Rec 等）⇒ 不是字段访问
            if re.search(r'(?:^|[^A-Za-z0-9_])node_' + re.escape(field) + r'$', pre):
                continue
            if re.search(r'(?:^|[^A-Za-z0-9_])node_set_' + re.escape(field) + r'$', pre):
                continue
            if re.search(r'_' + re.escape(field) + r'$', pre):
                continue
            bad.append((i + 1, s.strip()))
            break
    return bad


def load_lines_filter(spec_path, path):
    """⭐ 第十八批新能力：**编译驱动模式**。

    `--lines=<json>` 里的 json 形如 {"C:\\...\\src\\sema.tc": [12, 34, ...]}，由
    `tc check` 的诊断输出提炼 —— 先把 `kind` 从 `Node` 里删掉，编译期 T_UNKNOWN_FIELD
    会精确点名**每一个真实 Node.kind 站点**（不受 `t.kind`/`tr2.kind`/`p1.kind` 之类
    同名 `.kind` 假阳性干扰）。本开关把迁移范围**收窄到这些行**，杜绝误伤非 Node 接收者。
    """
    import json as _json
    d = _json.load(io.open(spec_path, encoding='utf-8'))
    key = os.path.basename(path)
    for k, v in d.items():
        if os.path.basename(k) == key:
            return set(v)
    return set()


def main():
    path = sys.argv[2]
    apply = '--apply' in sys.argv
    lines_spec = None
    for a in sys.argv[3:]:
        if a.startswith('--lines='):
            lines_spec = a.split('=', 1)[1]
    allowed = load_lines_filter(lines_spec, path) if lines_spec else None
    own = os.path.basename(path) == 'base.tc'
    lines, terms = read_lines(path)
    if not apply:
        print('==== EOL %s : %s ====' % (path, eol_report(terms)))
        if allowed is not None:
            print('==== 编译驱动模式：只处理 %d 行（由 tc check 点名）====' % len(allowed))
    bounds = func_bounds(lines)
    changes = []      # (lineno, old, new)
    unmapped = []     # (lineno, text)

    def owner_of(lineno):
        for (s, e) in bounds:
            if s <= lineno <= e:
                return (s, e)
        return None

    for i, s in enumerate(lines):
        if FIELD not in s:
            continue
        if allowed is not None and (i + 1) not in allowed:
            continue
        pos_list = find_all_outside(s, '.' + FIELD, word_boundary=True)
        if not pos_list:
            continue
        if 'tbl_Rec' in s:
            continue
        fb = owner_of(i)
        if fb is None:
            unmapped.append((i + 1, s.strip(), 'no-func'))
            continue
        # 是否遮蔽 base
        shadow = False
        for k in range(fb[0], fb[1] + 1):
            if DECL_BASE.search(lines[k]) and 'base__' not in lines[k]:
                shadow = True
                break
        if own:
            qual = ''
        elif shadow:
            qual = 'base__'
        else:
            qual = 'base.'
        nmap = build_map(lines, fb[0], fb[1])
        nmap_names = set(x[1] for x in nmap)

        newline = s
        for p in sorted(pos_list, reverse=True):
            # 取接收者表达式：向前找标识符 / 下标链
            pre = newline[:p]
            mo = re.search(r'([A-Za-z_]\w*)\[\]$', pre)
            recv = None
            idx_expr = None
            # 情况 1：recv = nodes[EXPR] 形式（支持嵌套下标，如 base.nodes[g_fc_d[i]]）
            r = idx_at_end(pre)
            if r is not None:
                idx_expr = r[1]
                rep_from = r[0]
            else:
                m2 = re.search(r'([A-Za-z_]\w*)$', pre)
                if not m2:
                    unmapped.append((i + 1, s.strip(), 'norecv'))
                    continue
                name = m2.group(1)
                if name in ('nodes', 'base'):
                    unmapped.append((i + 1, s.strip(), 'recv=%s' % name))
                    continue
                # S4 第十八批：传**列**，让同行前置声明也参与「最近前置」竞争
                idx_expr = resolve(nmap, name, i, m2.start(1))
                if idx_expr is None:
                    if name not in nmap_names:
                        unmapped.append((i + 1, s.strip(), 'nomap:%s' % name))
                    else:
                        unmapped.append((i + 1, s.strip(), 'predecl:%s' % name))
                    continue
                rep_from = m2.start(1)
            # 读 or 写：`X.ia` 后紧跟 = 且不是 ==
            after = newline[p + len(FIELD) + 1:]
            is_write = False
            rhs = None
            if len(after) > 0 and after.lstrip().startswith('=') and not after.lstrip().startswith('=='):
                is_write = True
                rhs = after.lstrip()[1:].strip()
            if is_write:
                tail = after.lstrip()[1:]
                # ★★ 护栏（批次 14 实测踩坑）：**写点必须独占整条语句**才可自动改写。
                #   此前会把 `=` 之后的**全部剩余文本**当 rhs，于是：
                #     ① 单行 `if (c) { X.lb = f(...); }` ⇒ 吞掉结尾 `}`，产出括号不闭合；
                #     ② 同行多语句 `n.na = -1; n.lb = -1; n.sa = "";` ⇒ 吞掉后续整串语句。
                #   ⇒ 以下任一情形一律判 UNMAPPED 交手工：找不到 `;` / 首个 `;` 之前含
                #      `{` 或 `}` / 首个 `;` **之后**仍有非空非注释内容。
                sc = first_semi(tail)
                bad = None
                if sc < 0:
                    bad = 'no-semi'
                elif '{' in tail[:sc] or '}' in tail[:sc]:
                    bad = 'brace-inside'
                else:
                    rest = tail[sc + 1:]
                    ci = rest.find('//')
                    if ci >= 0 and outside_strings(rest, ci):
                        rest = rest[:ci]
                    if rest.strip():
                        bad = 'multi-stmt'
                if bad:
                    unmapped.append((i + 1, s.strip(), 'guard:%s' % bad))
                    continue
                # 行尾注释（字符串外的 //）要保留在改写之后
                rhs_body = rhs
                tailcmt = ''
                ci = 0
                instr = False
                while ci < len(rhs_body):
                    ch = rhs_body[ci]
                    if not instr:
                        if ch == '"':
                            instr = True
                        elif ch == '/' and ci + 1 < len(rhs_body) and rhs_body[ci + 1] == '/':
                            tailcmt = rhs_body[ci:]
                            rhs_body = rhs_body[:ci]
                            break
                    else:
                        if ch == '\\':
                            ci += 2
                            continue
                        if ch == '"':
                            instr = False
                    ci += 1
                rhs_body = rhs_body.strip()
                if rhs_body.endswith(';'):
                    rhs_body = rhs_body[:-1]
                new_tail = '%s%s((%s as u64), %s);' % (qual, SET, idx_expr, rhs_body)
                if tailcmt:
                    new_tail = new_tail + '   ' + tailcmt
                newline = newline[:rep_from] + new_tail
            else:
                newline = newline[:rep_from] + '%s%s((%s as u64))' % (qual, GET, idx_expr) + newline[p + len(FIELD) + 1:]
        if newline != s:
            changes.append((i + 1, s, newline))

    print('==== PLAN %s : %d changes ====' % (path, len(changes)))
    for ln, o, nw in changes:
        print('%5d - %s' % (ln, o.strip()))
        print('%5d + %s' % (ln, nw.strip()))
    print('==== UNMAPPED %s : %d ====' % (path, len(unmapped)))
    for ln, txt, why in unmapped:
        print('%5d | %s | %s' % (ln, why, txt))

    # ⭐ 内层未递归迁移自检：对「产出的新行」查残留字段访问
    out_preview = list(lines)
    for ln, o, nw in changes:
        out_preview[ln - 1] = nw
    bad = stale_inner(out_preview, FIELD)
    print('==== STALE-INNER %s : %d ====' % (path, len(bad)))
    for ln, txt in bad[:40]:
        print('%5d | %s' % (ln, txt[:110]))

    if apply and changes:
        out = list(lines)
        for ln, o, nw in changes:
            out[ln - 1] = nw
        write_lines(path, out, terms)
        # 写回自检：行尾形态必须与读入时完全一致
        _, terms2 = read_lines(path)
        same = (terms2 == terms)
        print('APPLIED %s (%d lines) | EOL %s | 行尾%s' % (
            path, len(changes), eol_report(terms2), '一致 ✓' if same else '漂移 ✗ 须回滚'))


main()

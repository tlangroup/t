#!/usr/bin/env python3
"""
gen_tint.py — 生成 t 模块的「接口文件」(.tint)

机制（§5.3 多进程 bootstrap，2026-10-24）：把模块源码里的**顶层函数/方法体**剥离为
前向声明 `;`，保留 struct/enum/variant/union/concept 定义、const/var/type 定义与 @import
行。导入方进程加载 .tint 而非 .tc，仅建「签名+类型」语义图，不再分析被依赖模块的实现 →
自举峰值有界。

用法：python3 tools/gen_tint.py <in.tc> <out.tint>

实现：字符级扫描，跳过字符串/注释，在 brace 深度 0 处、且处于「声明边界」（文件首 / 前一个
顶层声明以 `;` 或 `}` 结束）时识别顶层声明的起始关键字，记录声明种类（fn / def / other）。
当深度 0→1 的 `{` 属于 fn 声明时，将其匹配 `}` 之间的正文替换为 `;`。def 类
（struct/enum/...）的 `{...}` 原样保留；other 类（const/var/type/import）无函数体，整段保留。
"""
import sys
import re

# 顶层声明起始：可选修饰符 + 主关键字
MOD = r"(?:pub\s+|pub\s+kernel\s+|pub\s+comptime\s+|pub\s+extern\s+|kernel\s+|comptime\s+|extern\s+|override\s+|pub\s+override\s+)?"
FN_RE = re.compile(MOD + r"fn\b")
DEF_KW = ("struct", "enum", "variant", "union", "concept")


def strip_bodies(src: str) -> str:
    n = len(src)
    out = []
    last = 0
    depth = 0
    cur_kind = "other"
    # at_decl_start：是否处于「顶层声明首字符」——仅文件首 / 上一个顶层声明以 `;` 或 `}` 结束
    # 后的第一个有效字符为 True；识别一次后即置 False，直到下一个边界再置 True。
    at_decl_start = True

    i = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""

        # 注释 / 字符串：整段保留
        if c == '/' and nxt == '/':
            j = src.find('\n', i)
            j = n if j == -1 else j
            out.append(src[last:i]); out.append(src[i:j]); last = j; i = j
            continue
        if c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            j = n if j == -1 else j + 2
            out.append(src[last:i]); out.append(src[i:j]); last = j; i = j
            continue
        if c in '"\'`':
            q = c
            j = i + 1
            while j < n:
                if src[j] == '\\' and j + 1 < n:
                    j += 2
                    continue
                if src[j] == q:
                    j += 1
                    break
                j += 1
            out.append(src[last:i]); out.append(src[i:j]); last = j; i = j
            continue

        if c == '{':
            if depth == 0 and cur_kind == "fn":
                # fn 函数体开头：跳过字符串/注释后匹配到对应 '}' 并替换为 ';'
                # （内层扫描必须同样跳过串/注释，否则串内的 { } 会错配闭合括号）
                k = i + 1
                d = 1
                while k < n and d > 0:
                    cc = src[k]
                    cn = src[k + 1] if k + 1 < n else ""
                    if cc == '/' and cn == '/':
                        jj = src.find('\n', k)
                        k = n if jj == -1 else jj
                        continue
                    if cc == '/' and cn == '*':
                        jj = src.find('*/', k + 2)
                        k = n if jj == -1 else jj + 2
                        continue
                    if cc in '"\'`':
                        q = cc
                        k = k + 1
                        while k < n:
                            if src[k] == '\\' and k + 1 < n:
                                k += 2
                                continue
                            if src[k] == q:
                                k += 1
                                break
                            k += 1
                        continue
                    if cc == '{':
                        d += 1
                    elif cc == '}':
                        d -= 1
                        if d == 0:
                            break
                    k += 1
                close = k
                out.append(src[last:i])
                out.append(';')
                last = close + 1
                i = close + 1
                depth = 0
                cur_kind = "other"
                at_decl_start = True
                continue
            else:
                depth += 1
                i += 1
                continue

        if c == '}':
            if depth > 0:
                depth -= 1
                if depth == 0:
                    at_decl_start = True
            i += 1
            continue

        if c == ';' and depth == 0:
            at_decl_start = True
            i += 1
            continue

        if depth == 0 and c not in ' \t\r\n' and at_decl_start:
            # 顶层声明首字符：识别关键字种类（仅此一次）
            rest = src[i:i + 80]
            m = FN_RE.match(rest)
            if m:
                cur_kind = "fn"
            else:
                is_def = False
                for kw in DEF_KW:
                    if re.match(MOD + re.escape(kw) + r'\b', rest):
                        cur_kind = "def"
                        is_def = True
                        break
                if not is_def:
                    cur_kind = "other"
            at_decl_start = False
            i += 1
            continue

        i += 1

    out.append(src[last:])
    return "".join(out)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: gen_tint.py <in.tc> <out.tint>\n")
        sys.exit(2)
    inp, outp = sys.argv[1], sys.argv[2]
    with open(inp, "r", encoding="utf-8", newline="") as f:
        src = f.read()
    res = strip_bodies(src)
    with open(outp, "w", encoding="utf-8", newline="\n") as f:
        f.write(res)
    sys.stderr.write("gen_tint: %s -> %s (%d -> %d bytes)\n" %
                    (inp, outp, len(src), len(res)))


if __name__ == "__main__":
    main()

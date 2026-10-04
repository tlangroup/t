#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""普查：含 Node 值形参、且函数体内读/写指定字段的函数清单。

思路（批次 13 固化，批次 14 修订）：
  * 匹配 `.<field>` 形式（必须带前导点），否则会把 tir_lbl("while.h") 里的 `lb`
    子串当成字段访问，虚增 Node 值形参候选（批次 14 普查时实测误报 2 个函数）；
  * 二进制读入 + 逐行去终结符（行尾形态与本工具判定无关，保持一致习惯而已）。
用法：python tools/nvf.py <field>
"""
import sys, os, io, re

FIELD = sys.argv[1] if len(sys.argv) > 1 else ''
NEEDLE = '.' + FIELD

def main():
    files = sorted([f for f in os.listdir('src') if f.endswith('.tc') and 'bak' not in f])
    for f in files:
        lines = io.open(os.path.join('src', f), 'r', encoding='utf-8', errors='replace').read().split('\n')
        i = 0
        n = len(lines)
        while i < n:
            ln = lines[i]
            m = re.match(r'\s*(pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(', ln)
            if not m:
                i += 1
                continue
            # 收集参数直到匹配的右括号行
            start = i
            sig_lines = []
            depth = 0
            j = i
            while j < n:
                s = lines[j]
                depth += s.count('(') - s.count(')')
                sig_lines.append(s)
                if depth <= 0:
                    break
                j += 1
            sig = ' '.join(x.strip() for x in sig_lines)
            if re.search(r':\s*Node\b', sig):
                # 找函数体范围：下一个 top-level（遇到同缩进 `}`）
                k = j + 1
                body = []
                while k < n:
                    body.append(lines[k])
                    if lines[k].rstrip() == '}':
                        break
                    k += 1
                hits = [(k0 + 1, lines[k0]) for k0 in range(j + 1, min(k + 1, n))
                        if NEEDLE in lines[k0] and re.search(r'\.' + FIELD + r'\b', lines[k0])]
                if hits:
                    print('### %s:%d  %s' % (f, i + 1, m.group(2)))
                    print('    SIG: %s' % sig[:200])
                    for ln_no, txt in hits:
                        print('    %5d| %s' % (ln_no, txt.strip()))
            i = j + 1 if j >= i else i + 1

main()

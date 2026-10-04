#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""字符串感知地扫描 src/*.tc，定位含指定 term 的行并区分「真实代码」/「纯注释」。"""
import sys, os, io

def outside_strings(s, pos):
    """判断 s 中 pos 位置是否位于字符串字面量之外。"""
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

def classify(line, term):
    p = line.find(term)
    while p >= 0:
        if outside_strings(line, p):
            # 该次命中在字串外，再看前面是否有 //
            cpos = line.find('//')
            while cpos >= 0 and cpos < p:
                if outside_strings(line, cpos):
                    return 'comment'
                cpos = line.find('//', cpos + 1)
            return 'real'
        p = line.find(term, p + 1)
    return 'strlit'

def main():
    term = sys.argv[1]
    files = sorted([f for f in os.listdir('src') if f.endswith('.tc') and 'bak' not in f])
    comment, real, strl = [], [], []
    for f in files:
        lines = io.open(os.path.join('src', f), 'r', encoding='utf-8', errors='replace').read().split('\n')
        for i, ln in enumerate(lines, 1):
            if term not in ln:
                continue
            k = classify(ln, term)
            tag = '%s:%d' % (f, i)
            if k == 'comment':
                comment.append('%s: %s' % (tag, ln.strip()))
            elif k == 'real':
                real.append('%s: %s' % (tag, ln.strip()))
            else:
                strl.append('%s: %s' % (tag, ln.strip()))
    print('==== REAL : %d ====' % len(real))
    for x in real:
        print(x)
    print('==== COMMENT : %d ====' % len(comment))
    for x in comment:
        print(x)
    print('==== STRLIT-ONLY : %d ====' % len(strl))
    for x in strl:
        print(x)

main()

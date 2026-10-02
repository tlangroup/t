import re, sys

FILES = ["src/hir.tc", "src/sema.tc", "src/parse.tc", "src/tir.tc"]

# Copy-assign: X.ln = Y.ln  ->  base.node_set_span_id(X.id, base.node_span_id(Y.id))
COPY = [
    (r'(\w+)\.ln\s*=\s*(\w+)\.ln\b', r'base.node_set_span_id(\1.id, base.node_span_id(\2.id))'),
    (r'(\w+)\.cl\s*=\s*(\w+)\.cl\b', r'base.node_set_span_id(\1.id, base.node_span_id(\2.id))'),
    (r'(\w+)\.tv\s*=\s*(\w+)\.tv\b', r'base.node_set_span_id(\1.id, base.node_span_id(\2.id))'),
]
# base.nodes[IDX].ln / .cl  ->  node_span_id(IDX).line / .col
IDX = [
    (r'base\.nodes\[([^\]]+)\]\.ln\b', r'base.node_span_id(\1).line'),
    (r'base\.nodes\[([^\]]+)\]\.cl\b', r'base.node_span_id(\1).col'),
]
# Read: X.ln -> node_span_id(X.id).line ; X.cl -> .col
READ = [
    (r'(\w+)\.ln\b', r'base.node_span_id(\1.id).line'),
    (r'(\w+)\.cl\b', r'base.node_span_id(\1.id).col'),
]

def migrate_line(line):
    # special-case: str_len(n3.tv) used to compute end_col (sema 10827)
    if 'str_len(n3.tv)' in line:
        line = line.replace('str_len(n3.tv)',
                            '(base.node_span_id(n3.id).end_col - base.node_span_id(n3.id).col)')
    for pat, rep in IDX:
        line = re.sub(pat, rep, line)
    for pat, rep in COPY:
        line = re.sub(pat, rep, line)
    for pat, rep in READ:
        line = re.sub(pat, rep, line)
    return line

for f in FILES:
    with open(f, 'r', encoding='utf-8') as fh:
        lines = fh.readlines()
    out = [migrate_line(l) for l in lines]
    with open(f, 'w', encoding='utf-8') as fh:
        fh.writelines(out)
    print("migrated", f, "lines:", len(lines))

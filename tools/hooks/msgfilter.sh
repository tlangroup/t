#!/bin/sh
# 删除 Claude 系 Co-Authored-By 署名行（noreply@anthropic.com），并压缩尾部空行
grep -viE '^Co-Authored-By:.*noreply@anthropic\.com' | awk '{ a[NR] = $0 } END { n = NR; while (n > 0 && a[n] == "") n--; for (i = 1; i <= n; i++) print a[i] }'

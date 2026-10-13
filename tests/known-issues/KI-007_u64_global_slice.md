# KI-007 · `[]u64` 全局切片（侧表形态）跨模块 codegen 缺陷 —— ✅ **已证伪（refuted）**

> 本目录不被 conformance/difftest 自动扫描。本条**没有一个能失败的运行用例**，
> 因为原归因本身不成立。登记的目的是把 2026-10-13 的结论（"`[]u64` 侧表 codegen 缺陷"）
> 连同**三条证伪证据**一起固化，防止后来者再去 codegen 里挖这个不存在的缺陷。

实测环境：2026-10-14，基准 `out/dbg/tc.exe` = g4（HEAD `1693168`），Windows + clang。

## 1. 历史现象（2026-10-13）

节点侧表位打包（提交 `1693168`）首次把 12 个布尔标志侧表打包成**一个 `[]u64` 全局切片**
`g_node_flags`。该版 gate L2 跑出 **19/6**：

- `check src/tc.tc` 爆 **14211 条 `T-MOD-E558`**（模块私有可见性）；
- conformance `p_value_if_expr` 未穷尽。

对照旧编译器编译同份 src → 0 error ⇒ 判定为本次改动引入的行为回归。当时逐项排除了
局部 / 全局 / `pub` 全局 `[]u64` 的 `append` / `slice_set` / 索引 / `slice_len` /
位运算，乃至 5000 元素大索引——**玩具用例全部正确**，但真实自托管路径里「已置位」的
标志一律读成默认 ⇒ `bc`(pub) 恒 false ⇒ 全部声明被判私有 ⇒ 雪崩。

当时处置：把 `g_node_flags` 改回 `[]i64`（内存收益不变），缺陷被规避，交付未阻塞。
由此留下结论「编译器 `[]u64` 切片 codegen 缺陷」。

## 2. 证伪证据（2026-10-14）

按当时形态精确还原 u64 版 `src/base.tc`（`[]u64` 切片 + 12 个 `var F_*: u64` +
`append(...,7)` + 读访问器 `(g_flags[id] & F_X) != 0`）。

### 证据 ① 运行级：u64 版自托管链全绿

| # | 命令 | 历史期望 | 实测 |
|---|---|---|---|
| 1 | `out/dbg/tc.exe check src/tc.tc`（种子编译 u64 版源码） | — | **0 error** |
| 2 | `out/dbg/tc.exe build src/tc.tc --output out/dbg/g1u` | — | 成功，md5 `fc56a55f…` |
| 3 | `g1u.exe check src/tc.tc`（**历史失败点**） | 14211 条 E558 | **0 error，0 条 E558** |
| 4 | `g1u.exe build src/tc.tc --output out/dbg/g2u` | — | 成功，md5 `37b428df…` |
| 5 | `g2u.exe check src/tc.tc` | — | **0 error** |

玩具用例双后端（LLVM `tc run` / C `--emit-c` + clang `-O0`）逐字节一致：
`flags_a=7 bc_a=0 flags_b=15 bc_b=1`（期望值）。

### 证据 ② 原理级：LLVM IR 里 `u64` 与 `i64` 本就无差别

切片读写**不走**直接 GEP/load/store，全部经 runtime 函数（`out/dbg/KI-007_u64_global_slice.ll`）：

```
call ptr  @tll_slice_at (ptr @g_flags, i64 %idx)         ; 取元素地址
call i64  @tll_slice_len(ptr @g_flags)                   ; 长度
call void @tll_slice_set(ptr @g_flags, i64 %i, ptr %v)   ; 写入
call void @t_slice_append_sized(ptr @g_flags, ptr %src, i64 %n)
```

LLVM 整数类型**不区分有/无符号**——`u64` 与 `i64` 都落成 `i64`；差异只在 `udiv/sdiv`、
`lshr/ashr` 这类指令上体现，而位掩码访问器只用到 `and`/`or`/`xor`。两条路径生成
**完全相同**的 IR。

### 证据 ③ 产物级（决定性）：两版编译器的 IR 逐字节相同

用**同一种子** `tc.exe` 分别构建 i64 版 `g1i`（md5 `867397f0…`）与 u64 版 `g1u`
（md5 `fc56a55f…`），再让它们编译**同一份**输入：

| 被编译输入 | `g1u.exe emit-ll` | `g1i.exe emit-ll` | diff |
|---|---|---|---|
| `tests/known-issues/KI-007_u64_global_slice.tc` | `df4219d2…` | `df4219d2…` | **0 行** |
| `src/tc.tc`（真实自托管规模） | `8a010ea3…` | `8a010ea3…` | **0 行** |

编译器**自身**侧表是 `u64` 还是 `i64`，对它产出的 IR **一个字节都没有影响**。

## 3. 结论

**原归因不成立。**「把 u64 改成 i64 程序就通过了」是**把相关性误判为因果**：
`u64 → i64` 的回退同时带走了真正的病灶（打包时一起落地的访问器改写 / 常量类型 /
`append` 初值传播路径中的某处），元素类型本身是清白的。

三条证据互相独立且一致：运行级（自举两轮全绿）／原理级（IR 无 u64/i64 之分）／
产物级（逐字节相同）。

## 4. 处置

- **状态**：`refuted`。**不**排修复工时。
- **生产代码维持 `[]i64`**：无动机改回 u64（内存收益相同）。
- **若将来真出现「标志位读回恒为默认」类雪崩**：去查打包时的**伴随改动**（访问器改写 /
  常量类型 / append 初值传播），**不要**再去查元素类型或 codegen。

## 5. 一键复现脚本（若要自行复核）

```bash
# ① 备份并还原 u64 版侧表（切片声明 + 12 个 F_* 常量类型）
cp src/base.tc out/_ki007_base.tc.bak
python - <<'PY'
import io, re
p = 'src/base.tc'
s = io.open(p, encoding='utf-8', newline='').read()   # ⚠ base.tc 是 CRLF，必须 newline=''
s = s.replace('pub var g_node_flags: []i64;', 'pub var g_node_flags: []u64;')
s = re.sub(r'^(var F_\w+): i64 = (\d+);', lambda m: '%s: u64 = %s;' % (m.group(1), m.group(2)), s, flags=re.M)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
PY

# ② 运行级：自举两轮（判据：三处 check 全 0 error，第 3 步无 T-MOD-E558）
out/dbg/tc.exe build src/tc.tc --output out/dbg/g1u
out/dbg/g1u.exe check src/tc.tc        # ← 历史失败点
out/dbg/g1u.exe build src/tc.tc --output out/dbg/g2u
out/dbg/g2u.exe check src/tc.tc

# ③ 产物级（决定性）：i64 对照编译器编译同一输入，IR 应逐字节相同
cp out/_ki007_base.tc.bak src/base.tc                  # 先恢复成 i64
out/dbg/tc.exe build src/tc.tc --output out/dbg/g1i
out/dbg/g1u.exe emit-ll src/tc.tc --output out/_cmp/tcbyu
out/dbg/g1i.exe emit-ll src/tc.tc --output out/_cmp/tcbyi
diff out/_cmp/tcbyu.ll out/_cmp/tcbyi.ll && echo "IDENTICAL —— 元素类型对 codegen 零影响"

# ④ 恢复
cp out/_ki007_base.tc.bak src/base.tc && git status --short   # 应仅剩未跟踪的 KI-007 文件
```

⚠ **坑（本次踩过）**：

1. **`src/base.tc` 是 CRLF**：Python 改写必须 `newline=''` 读 + 原样写回；用
   `newline='\n'` 会让 `^…;$` 类正则失配，表现为「改了 0 处」却不报错。
2. **缺陷不在 `check` 步暴露**：用种子编译器 `check` u64 版源码是 **0 error**（假阴性），
   必须用 u64 版源码**构建出的 `g1u`** 再 `check` 才是历史失败点。
3. **对照实验要用同一种子**：拿 10-13 遗留的 `g1.exe` 跟今天的 `g1u.exe` 比是不成立的
   （种子编译器版本不同），必须现构建 `g1i` 对照。

## 6. 状态变更记录

- 2026-10-13：现象登记，归因「`[]u64` 切片 codegen 缺陷」，以改回 `[]i64` 规避。
- 2026-10-14（本次）：立为 KI-007，先判 `unreproducible`；随后补齐三条对照证据，
  确认**原归因不成立**，状态改 `refuted`。

# t 编译器内存占用问题报告（当前状态）

> 日期：2026-10-24
> 分支：`wb`（最新提交 `a20d0fa` docs: 内存控制规范 v0.2）
> 范围：编译器自身运行期内存（前端→sema→TIR→codegen 链路），不含生成代码的运行期内存。
> 数据来源：权威设计文档 `docs/compiler/memory-control-spec.md`（v0.2，2026-10-24）+ 本次对仓库实际状态的核查（git 日志、`out/mod/` 产物、`out/dbg/_phase.log`）。

---

## 0. 摘要（TL;DR）

| 维度 | 当前状态 |
| --- | --- |
| 自举 `check` 峰值 | **~2.5–2.66 GiB**（LLVM 后端降级 bug 修复后；接口文件下可降到 0.99 GiB） |
| 自举 `build` 峰值 | **~5.63 GiB**（codegen IR ~3GiB + check 2.66 GiB，尚未被有界化） |
| 灾难性 21GB 尖峰 | ✅ **已修复**（提交 `5a4c55d`，降 ~8.8×） |
| 真正的地板 | sema 语义图（291280 节点，~2.5 GiB 由 mi_heap 持有，**进程结束前不回收**） |
| 多进程自举（阶段 C） | 🔧 **实现中**：POC 端到端已验证；全量 `bootstrap_tc.mjs` 截至 16:37 尚未产出 `tc_pc.exe` |
| CI 风险 | mimalloc 间歇 OOM(error1455)，门禁单跑 check 须识别 OOM 并 SKIP，避免误报 |

**一句话**：21GB 的"假峰值"是后端降级 bug，已根除；剩下的 2.5GiB 是语义图常驻的真地板，正通过"分模块多进程自举"把 `build` 峰值压到 ~1GiB 量级。

---

## 1. 当前实测峰值基线

| 阶段 | 修复前峰值 | 修复后峰值 | 接口文件(.tint)下 | 备注 |
| --- | --- | --- | --- | --- |
| `tc check src/tc.tc` | **19.80 GiB** | **~2.5 GiB** | **0.99 GiB** | 修复前大头是后端降级 bug |
| `tc emit-ll src/tc.tc` | **22.75 GiB** | ~2.5 GiB | — | IR 54.7 MB |
| `tc build src/tc.tc` | — | **5.63 GiB** | 不受阶段 B 影响 | 真实自举峰值，须被有界化 |

> 注：任意小程序的 `check` 峰值恒为 **0.71 GiB**（固定基成本：std 库 + 类型系统 + 运行期），与程序大小无关 → 编译器自身语义图贡献约 2.5 GiB。

---

## 2. 内存问题根因（两层）

### 2.1 已修复：LLVM 后端全局数组降级堆拷（§3.5，提交 `5a4c55d`）

- **现象**：自举 `tc check` 峰值曾达 ~21GB，单看 sema 完全解释不了。
- **真根因（LLVM IR 层坐实）**：后端把「加载模块级 `var <大数组> = ...`」降级为「**每调用一次 `tll_alloc(整张) + memcpy 清零**」，而非对全局符号直接 GEP。读 `out/dbg/tc.ll:44121-44138` 确认 `is_xid_cont` 每调用 `tll_alloc(6448)`、`is_xid_start` 每调用 `tll_alloc(5528)`；二者被内联进 `lex__tokenize`，逐字符触发 → 仅 XID 一项累计 ~7.6GB，叠加其它分配推到 ~21GB。
- **C 后端无此缺陷**（按指针 GEP 索引，零分配），早期读 C 产物时漏判、误以为是 emit/sema 地板。
- **修复**：对全局数组取零拷贝切片视图 `var s: []T = arr`（array→slice lowering 补 `@slice_from_raw`，仅填切片槽 ptr/len，不搬数据）再索引。双后端一致、零分配。
- **验收**：MIHIST `sz=6448/5528` 出现 **0 次**；`conformance` 373/373；`gate L2` 24/24；峰值 **~2.5 GiB**（降 8.8×）。

### 2.2 当前真地板：语义图 mi_heap 常驻（§8.1）

修复后仍 ~2.5GiB，这才是合理的量级天花板。`MEMSTATS` + `T_MIHIST=1` 坐实拆解：

| 阶段 | arena_commit | mi_heap(mimalloc) | peak |
| --- | --- | --- | --- |
| after_parse | 61 MiB | 677 MiB | 677 MiB |
| after_sema | 891 MiB | 2854 MiB | 3221 MiB |

- **bump arena 语义图仅 ~892 MiB**（节点 SoA 壳 68MiB + 类型表 11MiB）——**并非地板主因**。
- **mi_heap 占 2.85GiB**：字符串内容恒在 mi_heap（运行期分配、进程结束前不回收、不可变）。
- **堆分配 Top2**（MIHIST）：`base__node_new` **489 MiB**（291280×1680B）、`cst__kw_lookup` **393 MiB**（190700×688B）；其余 ~1.9GiB 散落大量调用方。
- **字符串内容去重不是堆大头**：阶段 1「名去重」(`str_intern`) 已落地且**语义正确、零回归**，但 `str_intern` 对已分配串做内容去重**不释放副本** → 峰值中性（2.66 vs 2.61 GiB），推翻了"字符串去重即可压到几百 MB"的旧假设。

---

## 3. 诊断工具链（已就位，门控零开销）

| 工具 | 作用 |
| --- | --- |
| `T_MIHIST=1`（runtime/t_runtime.c） | 按调用方返回地址做 mi_malloc 字节/次数直方图 + `CaptureStackBackTrace`，直接定位「`sz=<整张字节>` 由谁调用」的堆尖峰 |
| `--memstats` / `T_MEMSTATS`（src/tc.tc + lex.tc/sema.tc 埋点 + `dbg_report_mem`） | 分阶段报告 mi 分配总量 |
| `tools/_mempeak2.py` | 读 `PrivateUsage`（ctypes+psapi，免 psutil）记录 check/emit 峰值 |
| `tools/mihist_resolve.py` | 解析 MIHIST 调用栈 |

**回归门禁（Rule E）**：改 `src` 后必跑 `check` 峰值 + `emit` 峰值 + `T_MIHIST=1` 直方图 + `gate L2`；峰值回归 >5% 或内存相关步骤 FAIL 即阻断。

---

## 4. 缓解路线与剩余工作（roadmap 状态）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 阶段 0 | arena 基础设施 + SIGSEGV 修复 + 字符串驻留（中性） | ✅ `4a29d03`+`b87e009` |
| 阶段 0.5 | LLVM 全局数组降级堆拷修复 + 诊断工具 | ✅ `5a4c55d`（21→2.5GiB） |
| 阶段 B | 接口文件 `.tint` 外链 | ✅ 已落地；`check` 峰值 **2.66→0.99 GiB（−63%）**，诊断逐字节一致 |
| 阶段 C | 逐模块分进程自举 + 链接 + per-module ginit 分裂 | 🔧 **实现中**：POC 端到端验证 ✅（`poclib.tlib` + 入口运行 `num=42 str=hello flag=1` 与单进程逐字节一致）；全量 `bootstrap_tc.mjs`（17 内部模块 + 4 外部库 → `tc_pc.exe`）**截至 16:37 尚未跑通**（仓库内无 `tc_pc.exe`，最新构建仅重建单进程 `tc_phc_new.exe`） |
| 阶段 D | 门禁 + 收尾 | ⬜ 依赖阶段 C |

**关键边界**：
- 阶段 B **只降 `check` 峰值**；`build` 因需被依赖模块完整实现以发射代码，接口文件无法替代 → `build` 峰值不受阶段 B 影响，必须由阶段 C 解决（每模块进程仅建本模块图 + 极小接口 + 本模块 codegen，峰值有界 ~0.99GiB 量级）。
- 阶段 C 当前阻断点已解除：per-module ginit 分裂（解除旧 §4.14.7 外部库 rc.cst 预编译根因）+ 内部模块 `.tlib` 链接 + `--mod-id` 模块身份。
- 已知前置坑（已规避）：函数值全局 ginit 的既有 codegen bug（编译器内部模块无此类全局，不影响自举）；独立编译入口缺模块值（已用 `g_modval_set` 补）；重建自身二进制须输出临时名再 `mv`（Windows 锁文件）。

**中长期杠杆（超出阶段 B/C）**：
- 类型表去重（`td`/`tis` 结构去重、引用走 id，§5.1 另一半）；
- 结构性分配削减（`node_new` 489MiB、`kw_lookup` 393MiB 两大堆大头）；
- 若仍不足：巨型模块 `sema.tc`/`tir.tc` 进一步拆分（数百 MB 的真正路径，估数周）。

---

## 5. 结论与建议

1. **短期（当前进行中）**：跑通 `bootstrap_tc.mjs` 全量，复测每子进程 `build` 峰值（目标 ~1GiB 有界）、自举不动点 `g2==g3==g4`、诊断逐字节一致、`gate L2`；完成后提交 `wb` 并进入阶段 D 门禁。
2. **真地板认知**：2.5GiB 大头是 mi_heap 中的语义图（节点结构 + 字符串内容），arena 语义图本身仅 ~892MiB；字符串内容去重**中性**，不要再把压峰希望寄于名去重。
3. **CI 纪律**：门禁单跑 check 间歇 mimalloc OOM(error1455)，判据脚本必须识别 OOM 并 SKIP，避免误报 FAIL。
4. **回归阻断**：任何 `src` 改动须过 Rule E 四步（check/emit 峰值 + MIHIST + gate L2），阈值 5%。

---

## 6. 复测命令

```bash
# 1) check 峰值（PrivateBytes）
python3 tools/_mempeak2.py out/dbg/tc.exe check src/tc.tc

# 2) emit 峰值
python3 tools/_mempeak2.py out/dbg/tc.exe emit-ll src/tc.tc --output out/dbg/_tc_final.ll

# 3) 堆尖峰按调用方直方图（抓 sz=<整张字节> 由谁分配）
T_MIHIST=1 out/dbg/tc.exe check src/tc.tc 2>out/dbg/mihist.log

# 4) 接口文件下降 check 峰值
T_TINT_DIR=out/mod out/dbg/tc.exe check src/tc.tc

# 5) 全链路正确性
node tools/gate.mjs L2
```

---

*权威细节（arena 体系、Zig 0.17 对照、Rule A–F 纪律、风险清单、验证计划）见 `docs/compiler/memory-control-spec.md`。本报告是其"当前状态"的提炼，非替代。*

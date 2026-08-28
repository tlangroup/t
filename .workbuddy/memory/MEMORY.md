# t 编译器 — 项目笔记

## 协作偏好
- 不中途停下：除非需用户拍板（选项无法决断/不可逆破坏数据），否则一路跑到底。

## 模块 DAG（9 模块，靠前不得引用靠后）
`base`→`lex`→`parse`→`sema`→`codegen_c`→`codegen_ll`→`test`→`repl`→`tc.tc`（driver+main，只做 CLI 派发）。清单 `tools/tc_sources.mjs`。⚠ 跨模块调用必须 import 被调方。

## 架构红线
1. tc 只管 lex/parse/sema；功能走可插拔 `.tlib`+`import`；不读环境变量（只中性 `getenv`+`--lib-dir`）。
2. agent：`state`=Component、`step`=System；`X agent {state; step}` 唯一写法。
3. t 无 `extern`/FFI/网络。

## 构建 & 门禁
- `out/dbg/`(`-O0 -gcodeview`)/`out/rls/`(`-O2`)。`node tools/gate.mjs L0|L1|L2` 串行。
- L0(~59s): diagdef→static→boot_std→boot1(g1)→snapshot→conform→unsup=0。L2(~170s) +boot23/examples/difftest/boot4 四代不动点/C 自举/difftc0/rls/tote。
- **IR 漂移归零**（改前端语法/解析后必做）：① `cp out/dbg/g4.exe out/dbg/tc.exe`（+rls）② `node tools/ir_snapshot.mjs --compiler out/dbg/g1.exe --update` ③ 复跑 gate。判不动点只比 emit-ll `.ll` md5。
- ⚠ **升级锁坑**：`cp out/dbg/g4.exe out/dbg/tc.exe` 偶发 `Device or resource busy` —— 上一轮 gate 的孙进程（clang/lld）或残留 `tc.exe` 仍持有文件锁。`tasklist | grep tc.exe` 找 PID，`taskkill /PID <n> /F` 后再 cp。
- 改诊断码只动 `tools/diag_defs.json` → `gen_diag.mjs`+`gen_diag_t.mjs`（GEN:diagnostics 区手改必被覆盖）。

## Git / 沙箱红线（致命坑，2026-08-29 实证）
- ⚠ **Bash 工具沙箱会损坏 `.git`**：默认沙箱对 `.git` 写操作（stash/commit/fetch/reset/repack）在 overlay 下 mishandle——删旧 pack 生效、新对象只落临时层 ⇒ 真实 `.git` 丢 pack、`refs/` 被清空。**每次默认沙箱跑 git 写命令都会复现损坏**。
- **铁律**：所有 git 写命令（stash/commit/fetch/reset/push）与自举构建（g4 种子 `build` / clang）**必须**加 `dangerouslyDisableSandbox: true`，在真实文件系统操作。否则会悄悄毁掉历史。
- **本机现状（2026-08-29）**：`df5cd06`（P5 闭包逃逸，6 项修复曾建其上并过 gate L2）**从未 push**，其对象库 `.pack` 已不可恢复；origin 拉回的是 `ce9418f`（浮点 CTFE 等**发散重写线**，且用比 df5cd06 编译器更旧语法方言，`g4` 种子无法解析其 `src/tc.tc` ⇒ 本环境无法构建/验证 ce9418f）。
- **恢复动作**：从工作树兜底 tarball 重建 `df5cd06+fixes` 为 **orphan 分支 `df5cd06-six-fixes`**（commit b511bd6），保留已验证源码；`main` 仍指向 `ce9418f`。该分支与 main **无共同祖先**，日后合并需 `git merge --allow-unrelated-histories`，且须在能构建 ce9418f 的环境验证后再合。
- 兜底备份：`/tmp/t_fixes_backup/`（5 源文件 df5cd06+修复版 + 2 example）、`/tmp/t_full_backup.tar.gz`（完整工作树快照，不含 out/ 与 .git）。
- **（2026-08-29 已 push）** `df5cd06-six-fixes` 分支已推至 `origin` 作远程备份（`git push -u origin df5cd06-six-fixes` 成功，PAT 经一次性 insteadOf 注入、未落盘）。远程提示 `dist/tc.js.exe` 83MB 超 50MB 建议值（仅警告）。

## 6 缺口扫描结论（2026-08-29，针对 ce9418f）
- ce9418f **已自带** #5 多载荷 variant、#6 `as` 转型、#8 C 后端 match 返回结构体（`struct_lit` 已在 codegen_c.tc:1921 / codegen_ll.tc:688,1437）、#10 浮点 CT（ce9418f 即 CTFE 线）。#9 的 6 处 `; UNSUPPORTED` 是防御性 fallthrough，两线都有，非缺口。
- **仅 #7 定长数组↔切片真缺**：但 ce9418f 的 `sema.tc:567-569` 已把 array→slice 包成 `cast` 节点（「让后端构造成 TSlice 零拷贝视图」），**缺的只是后端 lowering**——`codegen_c.tc` cast 分支(~1944)仍 `((T)expr)` 硬转、`codegen_ll.tc` cast-lowering(~1471)无 array→slice 分支、runtime 无 `t_slice_from_raw`/`tll_slice_from_raw`。port 时只改这 3 处+声明+example，参考 `df5cd06-six-fixes` 分支即可。

## 实现铁律（致命坑）
- `sb_catN` 实参必 ==N，最大 `sb_cat6`；`catn_check` 强制校验 arity（写错直接 gate 失败）。
- 新增内建须六处齐全：`builtin_ret`/`td_calls`/C emit/LLVM emit/`llph` declare/runtime（漏→静默 `; UNSUPPORTED call`）。
- `Node` 仅 `na/nb/nc/nd`+`la/lb/lc`（kids 链表头，须 `*_in_kids` 遍历）。
- ⚠ `Tok` 无字节偏移；需源码切片须解析期就地捕获。`diag_new` 的 `sev` 对未注册码须显式 `"warning"`。conformance 首行 `// EXPECT: pass`/`// EXPECT: error T_XXX`；`tc build` 成功时 stdout 只输出 warning（stdout 是机器可读通道）。
- 透传/匹配节点须查全 4 处 emit/etd；单态化缓存命中须改写调用点（`nodes[e].bb=true`）。
- ⚠ **空切片字面量 `[]` 的 LLVM 后端限制**：`[]` 只能作**局部变量初始化器**（`var x: []T = [];` codegen 正常）；作为**表达式**（赋值 RHS `g = [];` 或模块级初值器 `var g: []T = [];`）会被发射成 `ptr 0` → clang 拒绝（`load %TSlice, ptr 0` / UNSUPPORTED expr）。间接构造空切片 idiom：`var __e: []T = []; g = __e;`。
- **Stage 2 规范不动点已改道（重要）**：`docs/bootstrap.md §4.1` 的 C 后端三轮不动点 `tc0→tc1→tc2→tc3 / C_a≡C_b≡C_c` 在当前代码上**物理不可达**——种子 tc0（冻结于 v1.0-selfhost）解析不了当前 `import(src.x :: *)` 语法（gen0 直接 24 个 `T_PARSE_EXPECTED_TOKEN`），且其 C 后端对 `append(x, sb_to_str(...))` 生成 `&t_sb_to_str(...)` 取临时量地址 → MSVC `C2102`（README 第167行已据此把 `tools/bootstrap.mjs` 标为遗留/冻结）。**现行自举不动点由 `gate L2` 实证**：`boot4`（LLVM 四代 `g2==g3==g4` 比 `.ll` md5）+ `cself`（C 后端自举 + 跨后端等价）+ `difftc0`（tc0 外部对拍）全绿。补完 stage2 的缺口=①同步 docs（§4.1/M10-M11/README 数字过时）②把已验证状态提交并打新 tag（当前相对 v1.0-selfhost 有 400 文件改动全部未提交）③审计 conformance 对 spec 条款的 pos+neg 覆盖。（**①docs 同步 + ②提交+tag `v1.0-selfhost-llvm` + ③G3 覆盖率审计（诊断码 120/128，commit 4d71c8b）+ ④G4 信任根模型（接受 LLVM 自举不动点为信任根，docs/bootstrap.md §4.3 已文档化）均已完成。Stage 2 全闭环。**）

## REPL（裸 `tc` 进入，clean-subprocess）
- 每条输入重编 `decls+input`→`out/repl/repl_exe.exe` 再跑；跨行可变状态不持久。元命令 `:help/:quit/:reset/:dump/:load`。
- **修复（2026-08-10）**：解析错误原走 `eprint("parse error:..")`+`exit(1)` 进 stderr `build.err`，REPL 只回显 `build.log`(stdout) ⇒ 语法错完全静默（用户报 `(0..10) |> |v| print(f"{v}");` 无任何输出）。`print_json` 已从 sema.tc 下沉 base.tc（零 sema 依赖），新增 `parse_fatal`/`parse_fatal_at`（`T-PAR-E101` 通用/`T-PAR-E102` 已移除语法）→ stdout JSON，全部 36 处 eprint 已转 `parse_fatal`。验证：该输入现输出 T-PAR-E101 诊断（定位到 `..`）；`1+2`→`3`、`print("hi")`→`hi` 正常。
- **修复（2026-08-11）**：`sform` 无条件补 `;` ⇒ 块语句 `for/if/match/while {...}` 被包成 `...};` 而报 T-PAR-E101。改复用 `repl_term(tsrc)`（末字符非 `;`/`}` 才补 `;`），同时消除旧「输入带尾 ; 变 ;;」坑。验证：for/if/块语句及自带尾 `;` 均正常。
- ⚠ **语法红线（踩坑点）**：`t` 的 lambda 是 `fn(name: Type) Ret { body }`，**不是** `|v| ...`（后者会被词法切成 `|` `v` `|` 报 T-PAR-E101）。管道 `|>` 是「整体应用」非逐元素迭代；「遍历区间打印每个」用 `for (i in 1..10) { ... }`（`1..10` 半开到 9，含 10 用 `1..=10`）。

## 技术债
- ⚠ **P0 — #7 定长数组↔切片（ce9418f 现状）**：`sema.tc:567-569` 已把 array→slice 包成 `cast` 节点（「让后端构造成 TSlice 零拷贝视图」），**但后端 lowering 缺失** ⇒ 传 `[N]T` 给 `[]T` 形参仍是静默段错误。正解：runtime 加 `t_slice_from_raw`(+`tll_slice_from_raw` shim)、`codegen_c.tc` cast 分支(~1944)源=array 目标=slice→`t_slice_from_raw(...)`、`codegen_ll.tc` cast-lowering(~1471)同逻辑+`declare @tll_slice_from_raw`。参考 `df5cd06-six-fixes` 分支实现。管道层 `T-PIP-E863` 拦截仍保留，勿一刀切拒绝（误伤字面量初始化）。
  - **（2026-08-29 已 draft 进 main 工作树，未验证）**：改了 `runtime/t_runtime.c`(+`t_slice_from_raw`)/`t_runtime.h`/`t_shim_ll.c`(+shim)、`src/codegen_c.tc` cast 分支(1944)、`src/codegen_ll.tc` cast 分支(1471)+`declare`、新增 `examples/array_to_slice.tc`+`.expected.txt`。**本环境无法构建 ce9418f 验证**（g4 种子解析不了其旧语法），须用户在能构建 ce9418f 的机器上 `node tools/gate.mjs L2` 验绿后再 commit/push。LLVM 端切片按 `ptr %TSlice`（alloca+shim+返回指针，同 `args` 内置）约定。

## 文档治理（冲突防护）
- `docs/reference.md` = **t 语法唯一权威（single source of truth）**，机器可读（`ebnf` 块）驱动 `tools/gen_ebnf.mjs` 代码生成管线。它是**全局共享规格文件，非会话草稿**。
- ⚠ **多对话写 reference.md 会冲突**：WorkBuddy 普通文件无锁；Edit 需先 Read 当前快照，并发写者会 last-writer-wins 静默丢改动。规则：①reference.md 只增删语言规格（如 `cell` 关键字须先走 design.md 提案 + gate）；②会话级/跨对话知识走记忆层（`.workbuddy/memory/`），不写进 reference.md；③改规格须隔离操作（改前立即重 Read + 串行）；④多对话各需 reference 时各自落独立草稿，最后单一 owner 合并。

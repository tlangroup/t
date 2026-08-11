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

## 实现铁律（致命坑）
- `sb_catN` 实参必 ==N，最大 `sb_cat6`；`catn_check` 强制校验 arity（写错直接 gate 失败）。
- 新增内建须六处齐全：`builtin_ret`/`td_calls`/C emit/LLVM emit/`llph` declare/runtime（漏→静默 `; UNSUPPORTED call`）。
- `Node` 仅 `na/nb/nc/nd`+`la/lb/lc`（kids 链表头，须 `*_in_kids` 遍历）。
- ⚠ `Tok` 无字节偏移；需源码切片须解析期就地捕获。`diag_new` 的 `sev` 对未注册码须显式 `"warning"`。conformance 首行 `// EXPECT: pass`/`// EXPECT: error T_XXX`；`tc build` 成功时 stdout 只输出 warning（stdout 是机器可读通道）。
- 透传/匹配节点须查全 4 处 emit/etd；单态化缓存命中须改写调用点（`nodes[e].bb=true`）。
- ⚠ **空切片字面量 `[]` 的 LLVM 后端限制**：`[]` 只能作**局部变量初始化器**（`var x: []T = [];` codegen 正常）；作为**表达式**（赋值 RHS `g = [];` 或模块级初值器 `var g: []T = [];`）会被发射成 `ptr 0` → clang 拒绝（`load %TSlice, ptr 0` / UNSUPPORTED expr）。间接构造空切片 idiom：`var __e: []T = []; g = __e;`。
- **Stage 2 规范不动点已改道（重要）**：`docs/bootstrap.md §4.1` 的 C 后端三轮不动点 `tc0→tc1→tc2→tc3 / C_a≡C_b≡C_c` 在当前代码上**物理不可达**——种子 tc0（冻结于 v1.0-selfhost）解析不了当前 `import(src.x :: *)` 语法（gen0 直接 24 个 `T_PARSE_EXPECTED_TOKEN`），且其 C 后端对 `append(x, sb_to_str(...))` 生成 `&t_sb_to_str(...)` 取临时量地址 → MSVC `C2102`（README 第167行已据此把 `tools/bootstrap.mjs` 标为遗留/冻结）。**现行自举不动点由 `gate L2` 实证**：`boot4`（LLVM 四代 `g2==g3==g4` 比 `.ll` md5）+ `cself`（C 后端自举 + 跨后端等价）+ `difftc0`（tc0 外部对拍）全绿。补完 stage2 的缺口=①同步 docs（§4.1/M10-M11/README 数字过时）②把已验证状态提交并打新 tag（当前相对 v1.0-selfhost 有 400 文件改动全部未提交）③审计 conformance 对 spec 条款的 pos+neg 覆盖。

## REPL（裸 `tc` 进入，clean-subprocess）
- 每条输入重编 `decls+input`→`out/repl/repl_exe.exe` 再跑；跨行可变状态不持久。元命令 `:help/:quit/:reset/:dump/:load`。
- **修复（2026-08-10）**：解析错误原走 `eprint("parse error:..")`+`exit(1)` 进 stderr `build.err`，REPL 只回显 `build.log`(stdout) ⇒ 语法错完全静默（用户报 `(0..10) |> |v| print(f"{v}");` 无任何输出）。`print_json` 已从 sema.tc 下沉 base.tc（零 sema 依赖），新增 `parse_fatal`/`parse_fatal_at`（`T-PAR-E101` 通用/`T-PAR-E102` 已移除语法）→ stdout JSON，全部 36 处 eprint 已转 `parse_fatal`。验证：该输入现输出 T-PAR-E101 诊断（定位到 `..`）；`1+2`→`3`、`print("hi")`→`hi` 正常。
- **修复（2026-08-11）**：`sform` 无条件补 `;` ⇒ 块语句 `for/if/match/while {...}` 被包成 `...};` 而报 T-PAR-E101。改复用 `repl_term(tsrc)`（末字符非 `;`/`}` 才补 `;`），同时消除旧「输入带尾 ; 变 ;;」坑。验证：for/if/块语句及自带尾 `;` 均正常。
- ⚠ **语法红线（踩坑点）**：`t` 的 lambda 是 `fn(name: Type) Ret { body }`，**不是** `|v| ...`（后者会被词法切成 `|` `v` `|` 报 T-PAR-E101）。管道 `|>` 是「整体应用」非逐元素迭代；「遍历区间打印每个」用 `for (i in 1..10) { ... }`（`1..10` 半开到 9，含 10 用 `1..=10`）。

## 技术债
- ⚠ **P0 未根治**：`[N]T`→`[]T` 无转换 lowering，Array↔Slice `can_cast` 无条件放行 ⇒ 传定长数组给 `[]T` 形参静默读垃圾长度段错误。正解 Array→Slice 插 `t_slice_from_raw`；当前仅管道层拦截（`T-PIP-E863`）。勿一刀切拒绝（误伤字面量初始化）。

# 语法规则草稿：日期/时间格式化（`now` / `format_time`）

> **状态**：**已采纳（ADOPTED）** —— 已并入 `docs/reference.md` §3.11（2026-08-03，用户指令「规则采纳 L-15」）。本草稿依 L-15 工作流（草稿 → 法律验证 → 采纳 → 并入 → 失效）进入**失效态**，内容以 `reference.md` §3.11 为权威准绳；本文件仅作历史留痕，不再维护。
> **依据**：L-15 语法规则法 第5条起草工作流（草稿 → 法律验证 → 采纳 → 并入 → 失效）。
> **作用对象**：① 时钟内建 `now()`；② 时间格式化内建 `format_time` / `format_time_local`；③ 时间值语义 = **i64 微秒 epoch**（复用既有 `i64` 标量，不新增类型）。
> **记号**：符合 `docs/reference.md` §1 Notation。
> **关联**：M54 §3.10 已实现数值/字符串格式化（Python 迷你语言 `{:>10}` 风格）；本稿为**时间域**的格式化，采用 **strftime / Python `datetime.strftime` 的 `%` 风格子集**——两套 spec 语法按领域分化（见 §0）。

---

## 0. 与 M54 §3.10 的关系（spec 语法分化说明）

`t` 已有两个 spec 语法家族，按领域分化，并非不一致：

| 领域 | 内建 | spec 风格 | 示例 |
|---|---|---|---|
| 数值 / 字符串 | `format_int` 等（M54 §3.10） | Python 格式规范迷你语言（`{:>10.2f}`） | `format_int(">10", 42)` |
| 日期 / 时间 | `format_time`（本稿） | strftime / `datetime.strftime` 的 `%` 风格 | `format_time("%Y-%m-%d", t)` |

理由：日期格式化的业界事实标准是 `%` 风格（C `strftime`、Python `datetime.strftime`、Go `time.Format` 的等价物均如此）；数值格式化是 Python `format()` 的冒号风格。两者受众、历史包袱不同，**刻意不强行统一**，避免任一领域为了迁就另一套而变得别扭。文档（§3.10 与本文）显式写明此分化，防止日后被误判为 bug。

---

## 1. EBNF

```ebnf
// —— 时钟内建 ——
// 无新语法 / 无新关键字，作为普通内建函数接入（仿 M54 的 format_int）。
// now() 不接受参数，返回当前时刻的微秒 epoch。
now fn() -> i64

// —— 时间格式化内建 ——
// spec：% 风格格式规范字符串（见 §2 D2 字段码表）。
// t：i64 微秒 epoch（见 §2 D1）。
format_time      fn(spec: string, t: i64) -> string   // 按 UTC 展开（gmtime）
format_time_local fn(spec: string, t: i64) -> string   // 按本地时区展开（localtime）
```

- **不新增任何词法记号、不新增关键字、不新增类型**。`now` / `format_time` / `format_time_local` 作为内建函数名接入（与 `format_int` 完全一致）。
- 时间值复用既有 `i64` 标量，无需新标量管线（scalar_pred / bits / ctype / parse / emit 全部复用）。这是选「i64 epoch 标量」而非「struct」的核心收益。
- 与 M55 `format(tmpl, ...)` 模板天然可组合：`format("到期 {0}", format_time("%Y-%m-%d", now()))` —— 外层 M55 模板脱糖、内层 `format_time` 普通内建调用，零额外工作。

---

## 2. Where（编译期约束）

### D1 —— 时间值语义 = i64 微秒 Unix epoch（L-02 显式、L-04 唯一语义）

- 时间值统一为 **i64 微秒**精度的 Unix epoch（从 1970-01-01T00:00:00Z 起的微秒数）。
  - 正数 = 1970 之后；负数 = 1970 之前（允许，gmtime/localtime 须正确处理，runtime 用 `time_t`/`int64_t` 承载，避免 2038 年 `time_t` 32 位溢出）。
- `now()` 返回当前时刻的微秒 epoch。
- 选微秒而非秒的理由：高精度时间戳 / 性能分析 / 分布式追踪常用微秒；秒精度场景由用户自行 `t / 1000000`。runtime 内部将微秒拆为「秒（`t/1000000`）+ 微秒余数（`t%1000000`）」喂给 `gmtime`/`localtime`，余数用于 `%f` 字段（6 位微秒）。
- 无隐式时区字段：epoch 本身是 UTC 绝对时刻；时区只在「格式化输出」时引入（见 D3）。

### D2 —— spec 文法与字段码（strftime / `datetime.strftime` 子集）

```ebnf
TimeSpec: ( literal_char | "%" conversion )*
conversion:
    "Y" | "y" | "m" | "d" | "H" | "M" | "S" | "f" | "I"
  | "b" | "B" | "a" | "A" | "p"
  | "j" | "U" | "W" | "z" | "Z" | "%"
```

| 字段码 | 含义 | 示例输出 | 备注 |
|---|---|---|---|
| `%Y` | 4 位年 | `2026` | |
| `%y` | 2 位年 | `26` | |
| `%m` | 2 位月 `01`–`12` | `08` | |
| `%d` | 2 位日 `01`–`31` | `03` | |
| `%H` | 24 小时制时 `00`–`23` | `20` | |
| `%M` | 分 `00`–`59` | `51` | |
| `%S` | 秒 `00`–`59` | `30` | |
| `%I` | 12 小时制时 `01`–`12` | `08` | 配合 `%p` |
| `%f` | 微秒 `000000`–`999999` | `123000` | 取 `t%1000000` |
| `%b` | 短月名 | `Aug` | 英文缩写，固定 ASCII |
| `%B` | 全月名 | `August` | |
| `%a` | 短星期 | `Mon` | |
| `%A` | 全星期 | `Monday` | |
| `%p` | AM/PM | `PM` | 依 12 小时制 |
| `%j` | 年积日 `001`–`366` | `215` | |
| `%U` | 周数（周日为一周起点） | `30` | |
| `%W` | 周数（周一为一周起点） | `30` | |
| `%z` | 时区偏移 | `+0000`（UTC）/ `-0800`（本地） | UTC 下恒 `+0000` |
| `%Z` | 时区名 | `UTC`（UTC）/ `CST`（本地） | 字符串名，平台相关 |
| `%%` | 字面 `%` | `%` | |

- **最小集（已实现 ✅）**：`%Y %y %m %d %H %M %S %f %%`。
- **扩展集（已实现 ✅，M56 字段码扩展）**：`%a %A %b %B %p %I %j %w %U %W %z %Z`。
  - `%w`：星期数 `0`(周日)–`6`(周六)；`%U`/`%W` 为周数（`%U` 周日起、`%W` 周一起）。
  - `%z`/`%Z`：时区偏移/名（UTC 下恒 `+0000`/`UTC`；本地下由 `localtime`↔`gmtime` 差算偏移，`%Z` 借 `strftime("%Z")` 取平台名）。
- **literal_char**：任何非 `%` 字符原样输出。
- **未知 `%X` 的处理（已裁定 ✅）**：**两层策略**——当 spec 为字符串**字面量**时，编译期扫描字段码，未知则报 **`T_TIME_BAD_SPEC`**（与 M54 待裁定的 `T_FMT_BAD_SPEC` 思路一致，把错误前移到编译期，捕捉 `%Q` 这类笔误）；当 spec 非常量时，运行期引擎对未知 `%X` **原样保留字符**（宽松兜底，因非常量无法编译期判定）。首版即实现两层策略。

### D3 —— 时区（L-02 显式）

- `format_time(spec, t)`：**始终按 UTC 展开**（`gmtime`）。确定性、可测、无平台差异，是默认推荐。
- `format_time_local(spec, t)`：按**运行时所在时区**展开（`localtime`）。贴近用户直觉，但测试需固定 `TZ` 环境变量才确定；其值依赖部署环境。
- 不在首版提供「参数指定时区」（`format_time_tz(spec, t, tz)`）—— 时区名跨平台不一致、且 `t` 无变参无法优雅传 tz。如未来需要，单独里程碑引入（可借 `atom` 传 `:utc`/`:local`/`:+0800`）。
- `%z` / `%Z` 在 `format_time`（UTC）下恒为 `+0000` / `UTC`；在 `format_time_local` 下取平台本地值。

### D4 —— 实参类型与返回值（L-04 唯一语义）

- `now()`：无实参，返回 `i64`（微秒 epoch）。
- `format_time(spec, t)` / `format_time_local(spec, t)`：
  - `spec` 必须为 `string`，否则编译期 `T_TYPE_MISMATCH`（走内建通用类型检查）。
  - `t` 必须为 `i64`（微秒 epoch），否则 `T_TYPE_MISMATCH`。
  - 返回 `string`，在当前 arena 分配。
- 不隐式类型转换（`t` 传入 `u64` / `f64` 不自动转，违者 `T_TYPE_MISMATCH`）—— 与 M54 §3.10.2 的 L-02 立场一致。

---

## 3. 实现约定

### 3.1 runtime 引擎（`t_runtime.c` / `t_shim_ll.c`）

- **`t_now() -> int64_t`**：
  - POSIX：`clock_gettime(CLOCK_REALTIME, &ts)` / `timespec_get(&ts, TIME_UTC)` → `ts.tv_sec * 1000000 + ts.tv_nsec / 1000`。
  - Windows：`_time64(NULL) * 1000000 + 微秒部分`（`_timespec64` / `GetSystemTime` 取微秒）。须避免 32 位 `long`/`time_t` 截断（参考 M53 的 `_fseeki64` 教训）。
  - 返回 `int64_t`。
- **`t_format_time(spec: TStr, t_us: int64_t, out: TStr*, use_local: bool) -> void`**：
  - 拆 `sec = t_us / 1000000`，`us = t_us % 1000000`。
  - `use_local ? localtime(&sec) : gmtime(&sec)` → `struct tm`（注意 `gmtime`/`localtime` 返回静态缓冲，须立即拷出，避免被下一次调用覆盖）。
  - 逐字符扫描 `spec`：遇 `%` 取其后的 conversion，按 §2 D2 表展开写入 `out`（经由 `StringBuilder` 或动态缓冲，最终回填 `TStr`）。`%f` 用 `us` 补 6 位微秒。
  - 双后端一致：C 后端直调 `t_format_time`；LLVM 后端经 `t_shim_ll.c` 的 `tll_format_time` 指针桥（聚合 `TStr` 按 `TStr*` 传入、返回用末位 out 指针，仿 M54 §3.10.4 的 `tll_format_*` 桥）。
- 单点实现、双后端共享同一 runtime 函数 ⇒ **逐字节一致**（同 M54 论证）。

### 3.2 编译器接线（`src/tc.tc`，五处齐全）

新增内建须走与 `fid_error` / `format_int` 完全相同的**五处注册 + 检查器实参规则**（M52/M54 铁律）：

| 内建 | ① `builtin_ret` | ② `td_calls` | ③ C 发射 | ④ LLVM 发射 | ⑤ `llph` declare |
|---|---|---|---|---|---|
| `now` | `i64` (scalar) | `now -> i64` | `t_now()` | `@tll_now()` | 加 |
| `format_time` | `string` | `format_time -> string` | `t_format_time(spec, t, &out, false)` | `@tll_format_time(...)` | 加 |
| `format_time_local` | `string` | `format_time_local -> string` | `t_format_time(spec, t, &out, true)` | `@tll_format_time(...)` | 加 |

- 检查器实参规则：`format_time` / `format_time_local` 须校验 `spec:string` + `t:i64`（非字面量场景也走通用 `T_TYPE_MISMATCH`）；`now` 无实参。
- **缺少任一注册点 ⇒ 发射 `; UNSUPPORTED call X`**，调用被静默丢弃（M53 根因）。gate 的 `UNSUPPORTED 计数 0` 断言是唯一自动防线，必须保持。
- `now` 无需 spec 解析逻辑；`format_time` 的 spec 若为字面量且启用 D2 编译期校验，则在 check 阶段扫描字段码（参考 M55 `desugar_format_call` 对模板的静态校验手法）。

### 3.3 与既有门禁

- conformance：`pXX_time_ok`（pass，覆盖 `now` 调用、各字段码基本输出）。
- run_examples：`examples/time_fmt_demo.tc` + `examples/time_fmt_demo.expected.txt`（双后端实跑比对，覆盖 `format_time` / `format_time_local` 多字段码）。
- 对拍：用 Python `datetime` 验证一致性（仿 M54 的 CPython 对拍）：固定一个已知 epoch（如 `2026-08-03T20:51:30.123000Z` 的微秒值 `1754249490123000`），断言 `format_time("%Y-%m-%d %H:%M:%S", t)` 与 `datetime(2026,8,3,20,51,30,123000, tzinfo=timezone.utc).strftime(...)` 逐字节一致。
- gate：L0（自举 g1→IR 双后端比对 + conformance + UNSUPPORTED 计数 0）+ L2（四代不动点 + cself + rls）。新增/改动 runtime 函数 ⇒ **必须跑 rls 通道**（MEMORY 铁律：动 runtime → 必跑 rls）。

---

## 4. 验收用例（命名草案）

- conformance（pass）：
  - `p30_time_now_ok.tc`：`var t: i64 = now();`（语法/类型通过，值不比对）。
  - `p31_time_fmt_ok.tc`：`format_time("%Y-%m-%d", 1754249490123000)` 等字段码类型检查通过。
  - `p32_time_local_ok.tc`：`format_time_local` 类型通过。
- conformance（fail，新诊断码）：
  - `f50_time_spec_type.tc`：`format_time(123, t)` → `T_TYPE_MISMATCH`（spec 非 string）。
  - `f51_time_arg_type.tc`：`format_time("%Y", "2026")` → `T_TYPE_MISMATCH`（t 非 i64）。
  - `f52_time_bad_spec.tc`：`format_time("%Q", t)` → `T_TIME_BAD_SPEC`（spec 为字面量，编译期校验拦截）。
- run_examples：
  - `examples/time_fmt_demo.tc` + `.expected.txt`：固定 epoch 值（微秒），断言 UTC 与本地输出（本地用例在固定 `TZ` 下断言，或仅断言 UTC 字段以保确定性）。

---

## 5. 法律验证（L-15 子层）

| 法律 | 条目 | 状态 | 说明 |
|---|---|---|---|
| L-04 | 唯一语义 | ⏳ | 时间值恒为 i64 微秒 epoch；`format_time` 恒 UTC、`format_time_local` 恒本地，语义不重叠 |
| L-02 | 全行为显式 | ⏳ | 单位（微秒）、时区（UTC/本地分内建）、字段码表、未知 `%X` 处理均显式 |
| L-03 | 静态优先 | ⏳ | spec 字面量可编译期校验字段码（若启用 D2 静态校验） |
| L-09 | 零 UB | ⏳ | `gmtime`/`localtime` 返回值立即拷出；epoch 负/溢出走 `int64_t` 承载 |

> ⏳ = 待本稿采纳时回填计数。

---

## 6. 采纳状态 / 未来扩展

- **采纳节奏**：本稿经 L-15 起草工作流验证后，并入 `docs/reference.md`（建议 §3.10.5+ 或独立 §3.11），并入后本草稿标记失效。
- **未来扩展（独立里程碑，不在本稿范围）**：
  - 参数指定时区 `format_time_tz`（需先解决 tz 传参，借 `atom`）。
  - 反向解析 `parse_time(spec, s) -> i64`（字符串→epoch），与 `format_time` 对称，属独立能力。
  - 编译期静态校验非法 spec（D2 推荐口径），与 M54 的 `T_FMT_BAD_SPEC` 同期推进。

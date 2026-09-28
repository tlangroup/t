# KI-006 · LLVM 后端 f32（窄元素）堆数组元素运行时索引 store 不落盘

> 本目录不被 conformance/difftest 自动扫描，仅作为已知缺陷的复现/修复回归记录。
> 与 KI-005 关联：KI-005 的 device 示例端到端对拍失败，根因之一即本 bug（host 侧
> `[256]f32` 定长数组元素赋值在 LLVM 后端不落盘）；本 KI 为独立的 LLVM 后端数组
> store bug，现已修复。

实测环境：2026-09-28，`out/dbg/tc_new6.exe`（含本修复），Windows，clang 链接。

## 现象（修复前）

```t
fn main() i32 @main {
    var ha: [256]f32;
    var k: i64 = 0;
    while (k < 4) {
        ha[k] = (k + 1) as f32;   // 运行期内索引写 f32 元素
        k = k + 1;
    }
    print(int_to_str(ha[0] as i64));  // 读回恒 0（实际应为 1）
}
```

- 常量索引（`ha[0]=0.0; ha[1]=1.0; ...`）正常；
- 运行期内索引写 + 循环外读（`ha[idx]=7.0; print(ha[2])`）正常；
- 运行期内索引写 + 循环内读（`ha[k]=x; print(ha[k])`）正常；
- **唯独「运行期内索引写 + 之后（或跨迭代）再读同一元素」失效**，读回为 mimalloc
  残留模式 `0x200`（≈float `1.43e-42`），仿佛写没发生。
- `[256]i64` 定长数组的同款循环**正常**（`b0=0 b1=1 b2=2 b3=3`），凸显与元素宽度相关。

## 根因（最终定位，修正版）

`tir_to_ll_emit` 第 2 遍开头有**函数入口预扫描**（序言），把每个局部 `$dst` 临时槽的
`alloca` 集中在函数入口发射（避免 lazy 分配把 alloca 落进分支导致另一分支引用
undefined）。预扫描按 `tir_st_to_str(pins.st)` 给每个临时槽定类型。

`TIR_OP_GEP_IDX`（数组元素取址）的 `inst.st` 是**元素类型**（如 `f32`），于是该 GEP 结果
临时槽（例 `%main.t7`）在序言被按 `float`（4 字节）分配：
```
%main.t7 = alloca float
```
但 GEP 的结果是一个**元素指针**（`ptr<float>`，8 字节），随后 `store ptr %p, ptr %t7`
把 8 字节指针写进 4 字节槽 → **写穿 4 字节，踩坏相邻栈槽**（循环变量 `k` / 值），
循环计数/数据被破坏，后续读回的元素值错乱、表现为「写不落盘」。

铁证（emit-ll，`_arrinh`）：
```
%main.t7 = alloca float          ; 序言按元素类型 f32 分配（4 字节，错误）
...
store ptr %main.llt12, ptr %main.t7   ; 8 字节指针写进 4 字节槽 → 溢出
```
`[256]i64` 侥幸正确：`ptr<i64>` 经 `st_to_ll` → `alloca i64`（8 字节）恰好容纳 8 字节指针，
故 i64 元素数组从未触发此溢出；`f32`（4B）是最后一个缺口。

## 修复（最终版）

**不**加宽 `f32` 值槽（见下「错误首修」），而是在**序言预扫描**对 `GEP_IDX` 结果槽强制按
指针宽度分配：

```t
// tir_to_ll.tc · tir_to_ll_emit 第 2 遍预扫描
while (pscan < pscann) {
    var pins: TIRInst = f.body[pscan];
    if (pins.is_comment == false && str_len(pins.dst.name) >= 1 && pins.dst.name[0] == 36) {
        var pst: string = tir.tir_st_to_str(pins.st);
        if (pins.op == TIR_OP_GEP_IDX) { pst = base.sb_cat3("ptr<", pst, ">"); }  // ← KI-006：承载指针，按 ptr<elem>(8B)
        if (str_len(pst) > 0 && pst != "void") { ll_ensure_slot(pins.dst.name, pst); }
    }
    pscan = pscan + 1;
}
```

结果 GEP 结果槽按 `ptr<float>`（→`alloca ptr`，8 字节）分配，`store ptr` 写满 8 字节不溢出；
元素值仍经该指针 `store float` 写进数组元素（4 字节），读路径 `load float` 正确。
`ll_ensure_slot` 保持原整数加宽逻辑（`i1/i8/u8/i16/u16/i32/u32 → i64`），**不**触碰 `f32`。

### ⚠ 错误首修（已回退，留作教训）

首修曾把 `ll_ensure_slot` 的加宽条件加上 `|| ast == "f32"`（f32 槽→i64）。这确实让 GEP
结果槽变成 8 字节、数组写入恢复，但**同时把真正的 f32 值槽也变成 i64**：`var single: f32`
的 `alloca`/`load` 全变 `i64`，传给期望 `float` 的内建（如 `__fmt_2`）时值错乱 →
`examples/literal_demo.tc` 的 `single=1.5` 被打印成 `single=0`。**教训：加宽槽宽只能针对
「确实承载指针/宽值」的槽（GEP 结果），不能一刀切加宽元素值槽类型。**

## 关联改动（本 bug 的周边整治，前序会话已落、本 KI 复核）

- `src/tir_to_ll.tc` `TIR_OP_STORE` 的 else 分支加 `ll_coerce_scalar` 标量类型换算
  （`store double` 进 `float` 槽需 `fptrunc`，等）；
- `src/llname.tc` `ll_is_scalar_st` / `ll_is_float` 增补 `float`/`double` 识别；
- `src/base.tc` `ll_bits` 增补 `float`→32、`double`→64。
这些治的是「写路径类型换算」，本 KI 的**序言 GEP_IDX 指针槽宽**治的是「槽宽」根因——
二者互补，缺一不可（缺换算会类型错编，缺加宽会写穿）。

## 验证（已达成）

1. **诊断集（6/6）**——均用 `tc_new6.exe` 构建运行：
   | 程序 | 内容 | 期望 | 结果 |
   |---|---|---|---|
   | `_arrrt` | 常量索引写 + 循环读 | `r=0 r=1 r=2 r=3` | ✓ |
   | `_t1` | 运行期内索引写 + 循环外读 | `7` | ✓ |
   | `_t2` | 运行期内索引读 + 循环外写 | `7` | ✓ |
   | `_arrinh` | 循环内写后即读 | `1:1 2:2 3:3 4:4` | ✓ |
   | `_arrdiag` | 运行时循环写 `ha[k]=k` + 读 | `b0=0 b1=1 b2=2 b3=3` | ✓ |
   | `_arri64` | i64 数组回归 | `b0=0 b1=1 b2=2 b3=3` | ✓ |
2. **回归反向验证**：`examples/literal_demo.tc` 双后端（LLVM + C）输出与
   `literal_demo.expected.txt` 逐字节一致，`single=1.5`（确认 f32 值槽未被误加宽）。
3. **自举不动点**：`tc_new6 emit-ll src/tc.tc` 与
   `tc_new7(=tc_new6 build src) emit-ll src/tc.tc` 的 `.ll` **逐字节相同**
   （md5 `f881993c…`）；gate L2 的 `g2==g3==g4` 不动点随之成立（序言 GEP 修正为
   确定性改动，不破坏自托管）。
4. **KI-005 device 示例（LLVM 后端）**：
   - `examples/_cpuemu_check.tc` → `vec_add rc=0 hc[0..3]=2,3,4,5`、
     `reduce_atomic rc=0 ho[0..3]=0,1,2,3`（端到端 h2d/d2h 全链路打通）；
   - `examples/vecadd_device_full.tc` → `device.launch(vec_add) -> rc=0`、
     `hc[0..3]=2,3,4,5`。
   二者 C 后端：`vec_add` 段已正确（host 定长数组 store 修复同样惠及 C 后端），
   但 `_cpuemu_check` 在 `reduce_atomic` 第二 launch 后 **segfault**（C 后端独立 device
   运行时问题，非本 bug），故仍留 `SMOKE_SKIP`（见 run_examples.mjs 注释），待 C 后端
   device 运行时单独修。
5. **IR 基线**：改动了 LLVM 发射器（GEP 结果槽宽度），已重录 `tests/ir_baseline.json`
   （`node tools/ir_snapshot.mjs --compiler out/dbg/tc_new6.exe --update`，117 targets × ll/c/dev），
   随后 gate L2 全绿（23 passed, 0 failed）。

## 验收准则（gate L2 全绿 + 上述诊断 + literal_demo + device 示例 LLVM 端到端）

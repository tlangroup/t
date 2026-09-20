#!/usr/bin/env python3
"""M1 三轨对拍：tir(LLVM) / tmir-wasm / tmir-riscv 对 S1 标量子集。

判据（docs/compiler/pipeline-implementation-route.md §10.3 M1）：
    「对 S1 example 子集，wasm/riscv 与 LLVM 后端运行输出对拍一致」

- LLVM 轨：tc build（默认 --backend tir）产出 exe，运行取进程退出码（t 的 main 返回值）。
- WASM 轨：tc emit-ll --backend tmir-wasm 产出 .wat，wasmtime 实例化后调用导出 main。
- RV    轨：tc emit-ll --backend tmir-riscv 产出 .s，clang -target riscv64-linux-gnu -c 汇编校验。

用法：
    python tools/m1_difftest.py [--tc out/dbg/tc.exe] [--opt 0|1] [--dir tests/m1]
退出码：0 全绿；1 有对拍不一致或任一轨失败。
"""
import argparse
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, cwd=ROOT):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    return p.returncode, p.stdout, p.stderr


def wasm_run(wat_path):
    """返回 (ok, value_or_error)。"""
    try:
        import wasmtime
    except Exception as ex:
        return False, 'wasmtime 不可用: %s' % ex
    try:
        eng = wasmtime.Engine()
        mod = wasmtime.Module(eng, open(wat_path, encoding='utf-8').read())
        store = wasmtime.Store(eng)
        inst = wasmtime.Instance(store, mod, [])
        ex = inst.exports(store)
        if 'main' not in ex:
            return False, 'no exported main (exports=%s)' % sorted(ex.keys())
        return True, ex['main'](store)
    except Exception as ex:
        return False, str(ex).replace('\n', ' ')[:300]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tc', default=os.path.join('out', 'dbg', 'tc.exe'))
    ap.add_argument('--opt', default='0')
    ap.add_argument('--dir', default=os.path.join('tests', 'm1'))
    ap.add_argument('--outdir', default=os.path.join('out', 'm1'))
    args = ap.parse_args()

    outdir = os.path.join(ROOT, args.outdir)
    os.makedirs(outdir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(ROOT, args.dir, '*.tc')))
    if not files:
        print('no tests in', args.dir)
        return 1

    fails = 0
    print('%-22s %10s %10s %8s  %s' % ('test', 'llvm', 'wasm', 'riscv', 'verdict'))
    print('-' * 78)
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        rel = os.path.relpath(f, ROOT).replace('\\', '/')

        # ── LLVM 轨 ──
        ll_exe = os.path.join(outdir, name + '_ll.exe')
        rc, so, se = run([args.tc, 'build', rel, '--output',
                          os.path.join(args.outdir, name + '_ll'),
                          '--opt', args.opt])
        if rc != 0:
            print('%-22s %10s %10s %8s  LLVM-BUILD-FAIL' % (name, '-', '-', '-'))
            print('   ', (se or so).strip()[:300])
            fails += 1
            continue
        p = subprocess.run([ll_exe], cwd=ROOT, capture_output=True)
        v_ll = p.returncode

        # ── WASM 轨 ──
        wat = os.path.join(outdir, name + '_w.wat')
        rc, so, se = run([args.tc, 'emit-ll', rel, '--output',
                          os.path.join(args.outdir, name + '_w'),
                          '--backend', 'tmir-wasm', '--opt', args.opt])
        if rc != 0 or not os.path.exists(wat):
            print('%-22s %10s %10s %8s  WASM-EMIT-FAIL' % (name, v_ll, '-', '-'))
            print('   ', (se or so).strip()[:300])
            fails += 1
            continue
        ok_w, v_w = wasm_run(wat)

        # ── RISC-V 轨 ──
        sfile = os.path.join(outdir, name + '_rv.s')
        rc, so, se = run([args.tc, 'emit-ll', rel, '--output',
                          os.path.join(args.outdir, name + '_rv'),
                          '--backend', 'tmir-riscv', '--opt', args.opt])
        if rc != 0 or not os.path.exists(sfile):
            v_rv = 'EMIT-FAIL'
            fails += 1
        else:
            rc2, so2, se2 = run(['clang', '-target', 'riscv64-linux-gnu', '-c',
                                 os.path.join(args.outdir, name + '_rv.s'),
                                 '-o', os.path.join(outdir, name + '_rv.o')])
            v_rv = 'OK' if rc2 == 0 else 'ASM-FAIL'
            if rc2 != 0:
                fails += 1
                print('   [riscv]', se2.strip()[:200])

        if not ok_w:
            print('%-22s %10s %10s %8s  WASM-RUN-FAIL' % (name, v_ll, '-', v_rv))
            print('   ', v_w[:300])
            fails += 1
            continue
        if v_ll != v_w:
            print('%-22s %10s %10s %8s  MISMATCH' % (name, v_ll, v_w, v_rv))
            fails += 1
            continue
        print('%-22s %10s %10s %8s  ok' % (name, v_ll, v_w, v_rv))

    print('-' * 78)
    print('FAILS:', fails)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())

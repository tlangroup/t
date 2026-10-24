#!/usr/bin/env python3
"""
mempeak.py —— 测量 t 编译器单次运行的峰值内存。

为什么需要它：t 的 arena 在 Windows 上用 VirtualAlloc(MEM_RESERVE) 预留 64GB 虚拟地址空间
（纯地址空间，无物理成本），再按 64KB 粒度按需 MEM_COMMIT。因此：

  - 任务管理器/WorkingSet(rss) 只显示**当前驻留物理页**，不等于真实水位；
  - 而 psutil 的 vms == Windows "Private Bytes" == 已提交私有内存，
    正好等于 arena->committed，是我们要盯的真实峰值指标。

用法：
  python tools/mempeak.py [--exe <compiler>] -- <tc 参数...>
例：
  python tools/mempeak.py -- check src/tc.tc --json
  python tools/mempeak.py -- emit-ll src/tc.tc --output out/dbg/memtest
"""
import subprocess
import sys
import time

import psutil

ROOT = r"C:\seesaw\codebuddy\t"
DEFAULT_EXE = ROOT + r"\out\dbg\tc.exe"


def measure(exe, args, label):
    p = subprocess.Popen(
        [exe] + args,
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    proc = psutil.Process(p.pid)
    peak_rss = 0
    peak_vms = 0
    while p.poll() is None:
        try:
            mi = proc.memory_info()
            if mi.rss > peak_rss:
                peak_rss = mi.rss
            if mi.vms > peak_vms:
                peak_vms = mi.vms
        except psutil.Error:
            break
        time.sleep(0.08)
    code = p.wait()
    gib = 1024 ** 3
    print(
        f"{label:<10} exit={code}  peak_rss(工作集)={peak_rss / gib:6.2f} GiB"
        f"  peak_vms(已提交/PrivateBytes)={peak_vms / gib:6.2f} GiB"
    )
    return peak_vms


def main():
    argv = sys.argv[1:]
    exe = DEFAULT_EXE
    if argv and argv[0] == "--exe":
        exe = argv[1]
        argv = argv[2:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    if not argv:
        print(__doc__)
        sys.exit(2)
    measure(exe, argv, argv[0])


if __name__ == "__main__":
    main()

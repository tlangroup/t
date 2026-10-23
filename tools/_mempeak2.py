#!/usr/bin/env python3
"""Peak Private Bytes measurement (psutil-free: ctypes + psapi).

PrivateUsage == arena->committed, i.e. the real memory watermark we care about.
"""
import ctypes
import subprocess
import sys
import time
from ctypes import wintypes


class PMC_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


psapi = ctypes.WinDLL("psapi", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC_EX), wintypes.DWORD]
psapi.GetProcessMemoryInfo.restype = wintypes.BOOL


def peak(exe, args, label):
    p = subprocess.Popen([exe] + args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    h = k32.OpenProcess(0x1000, False, p.pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    pk = 0
    peak_ws = 0
    while p.poll() is None:
        c = PMC_EX()
        c.cb = ctypes.sizeof(PMC_EX)
        if psapi.GetProcessMemoryInfo(h, ctypes.byref(c), c.cb):
            if c.PrivateUsage > pk:
                pk = c.PrivateUsage
            if c.WorkingSetSize > peak_ws:
                peak_ws = c.WorkingSetSize
        time.sleep(0.05)
    code = p.wait()
    k32.CloseHandle(h)
    g = 1024 ** 3
    print(
        f"{label:<12} exit={code}  peak_private={pk / g:6.2f} GiB  peak_workingset={peak_ws / g:6.2f} GiB"
    )
    return pk


if __name__ == "__main__":
    exe = sys.argv[1]
    rest = sys.argv[2:]
    peak(exe, rest, rest[0] if rest else "?")

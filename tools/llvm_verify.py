#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""真 LLVM IR verifier —— 通过 LLVM-C.dll 的 LLVMVerifyModule 校验发射出的 .ll。

为什么需要它
------------
release 版 LLVM 不跑 verifier：`opt` / `llvm-as` 在本环境也没有。于是
「发射出非法 IR」这件事在 -O0 下静默通过，到 -O2 才被优化器按 UB 处理成
行为错乱 —— 这就是「-O0 对、-O2 错」整类问题的根源（7eecbae 属此类）。

实测 clang 本身会跑 verifier（能抓 ret 类型不符、Cannot allocate unsized type），
**但抓不到 call 实参类型不符**（`call i8 @f(i64 42)` 静默通过）。而那恰是本仓库
真实踩到过的一类（cb99734 修的 30 处）。本工具直接调 LLVM-C 的 LLVMVerifyModule，
覆盖比 clang 更全。

零构建：不需要 LLVM 头文件，用 ctypes 直接 dlopen LLVM-C.dll。

用法
----
    python tools/llvm_verify.py <file.ll>          # 有错 exit 1，打印 verifier 输出
    python tools/llvm_verify.py --quiet <file.ll>  # 只退出码，不打印
    LLVM_C_DLL=<path> python tools/llvm_verify.py <file.ll>

退出码：0 = 模块合法；1 = 模块非法；2 = 无法运行（找不到 LLVM-C.dll 等）。
"""

import ctypes
import os
import sys
from ctypes import c_char_p, c_int, c_void_p, POINTER, byref

# LLVMVerifierFailureAction
LLVMAbortProcessAction = 0
LLVMPrintMessageAction = 1
LLVMReturnStatusAction = 2


def _candidate_dll_paths():
    env = os.environ.get("LLVM_C_DLL")
    if env:
        yield env
    # 与 clang 同目录（Windows 官方安装布局）
    for base in (
        r"C:\Program Files\LLVM\bin",
        r"C:\Program Files (x86)\LLVM\bin",
    ):
        yield os.path.join(base, "LLVM-C.dll")
    yield "LLVM-C.dll"


def _load():
    tried = []
    for p in _candidate_dll_paths():
        tried.append(p)
        try:
            return ctypes.WinDLL(p), p
        except OSError:
            continue
    return None, tried


def main(argv):
    quiet = False
    files = []
    for a in argv[1:]:
        if a in ("-q", "--quiet"):
            quiet = True
        else:
            files.append(a)
    if not files:
        sys.stderr.write("usage: llvm_verify.py [--quiet] <file.ll>\n")
        return 2

    lib, info = _load()
    if lib is None:
        sys.stderr.write("llvm_verify: SKIP (无法加载 LLVM-C.dll，试过: %s)\n" % info)
        # 找不到就不假装通过：由调用方决定是否容忍（门禁默认容忍，但会显式标注 SKIP）
        return 2

    lib.LLVMCreateMemoryBufferWithContentsOfFile.argtypes = [
        c_char_p, POINTER(c_void_p), POINTER(c_char_p)]
    lib.LLVMCreateMemoryBufferWithContentsOfFile.restype = c_int

    lib.LLVMParseIRInContext.argtypes = [
        c_void_p, c_void_p, POINTER(c_void_p), POINTER(c_char_p)]
    lib.LLVMParseIRInContext.restype = c_int

    lib.LLVMVerifyModule.argtypes = [c_void_p, c_int, POINTER(c_char_p)]
    lib.LLVMVerifyModule.restype = c_int

    lib.LLVMContextCreate.argtypes = []
    lib.LLVMContextCreate.restype = c_void_p
    lib.LLVMGetGlobalContext.argtypes = []
    lib.LLVMGetGlobalContext.restype = c_void_p
    lib.LLVMDisposeMessage.argtypes = [c_char_p]

    ctx = lib.LLVMContextCreate()

    worst = 0
    for path in files:
        if not os.path.exists(path):
            sys.stderr.write("llvm_verify: 文件不存在 %s\n" % path)
            worst = max(worst, 1)
            continue

        buf = c_void_p()
        msg = c_char_p()
        rc = lib.LLVMCreateMemoryBufferWithContentsOfFile(
            path.encode("utf-8"), byref(buf), byref(msg))
        if rc != 0:
            detail = msg.value.decode("utf-8", "replace") if msg.value else "unknown"
            sys.stderr.write("llvm_verify: 读文件失败 %s: %s\n" % (path, detail))
            worst = max(worst, 1)
            continue

        mod = c_void_p()
        pmsg = c_char_p()
        rc = lib.LLVMParseIRInContext(ctx, buf, byref(mod), byref(pmsg))
        if rc != 0:
            detail = pmsg.value.decode("utf-8", "replace") if pmsg.value else "parse error"
            sys.stdout.write(
                "llvm_verify: %s: IR 解析失败:\n%s\n" % (path, detail))
            worst = max(worst, 1)
            continue

        vmsg = c_char_p()
        broken = lib.LLVMVerifyModule(mod, LLVMReturnStatusAction, byref(vmsg))
        detail = vmsg.value.decode("utf-8", "replace") if vmsg.value else ""
        if broken != 0 or (detail.strip() != ""):
            if not quiet:
                n = len([l for l in detail.splitlines()
                         if l.strip() and not l.startswith(";")])
                sys.stdout.write(
                    "llvm_verify: %s 非法 IR（%d 条）:\n%s\n" % (path, n or "?", detail))
            worst = max(worst, 1)
        else:
            if not quiet:
                sys.stdout.write("llvm_verify: %s OK\n" % path)

    return worst


if __name__ == "__main__":
    sys.exit(main(sys.argv))

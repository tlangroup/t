#!/bin/bash
# End-to-end vertical slice: T `device` dialect  ->  NVPTX PTX.
# Stage 1 runs OUR tool (t-device-opt, built via clang-cl/MSVC).
# Stages 2-5 use the upstream portable-mlir-toolchain in C:/tools/mlir/bin
# plus the system LLVM clang (which has the nvptx64 backend; llc in the
# bundle does NOT).
set -euo pipefail
MLIR_BIN="${MLIR_BIN:-C:/tools/mlir/bin}"
CLANG="${CLANG:-C:/Program Files/LLVM/bin/clang.exe}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

echo "[1/5] device dialect -> func.func + arith + llvm"
build/t-device-opt.exe test/vec_add.mlir --device-to-nvvm -o v1.mlir

echo "[2/5] func->llvm + arith->llvm (upstream mlir-opt)"
"$MLIR_BIN/mlir-opt.exe" --convert-func-to-llvm --convert-arith-to-llvm v1.mlir -o v2.mlir

echo "[3/5] rename unregistered kernel marker tdevice.kernel -> nvvm.kernel"
# func.func rejects the registered nvvm.kernel (NVVM restricts it to llvm.func),
# so we mark with an unregistered attr through conversion, then rename here.
sed 's/tdevice\.kernel/nvvm.kernel/g' v2.mlir > v3.mlir

echo "[4/5] MLIR LLVM dialect -> LLVM IR"
"$MLIR_BIN/mlir-translate.exe" --mlir-to-llvmir v3.mlir -o vec_add.ll

echo "[5/5] LLVM IR -> PTX (nvptx64, system clang)"
"$CLANG" -target nvptx64-nvidia-cuda -S vec_add.ll -o vec_add.ptx

echo "DONE -> vec_add.ptx"
rm -f v1.mlir v2.mlir v3.mlir

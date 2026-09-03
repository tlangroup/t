cmake_minimum_required(VERSION 3.20)
project(t-device LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Point at the setup-mlir install if CMake cannot auto-find it:
#   cmake -B build -DMLIR_DIR=C:/tools/mlir/lib/cmake/mlir \
#                  -DLLVM_DIR=C:/tools/mlir/lib/cmake/llvm
find_package(LLVM REQUIRED CONFIG)
find_package(MLIR REQUIRED CONFIG)

message(STATUS "Using MLIR from ${MLIR_DIR}")
message(STATUS "Using LLVM from ${LLVM_DIR}")

list(APPEND CMAKE_MODULE_PATH "${MLIR_DIR}")
include(AddLLVM)
include(TableGen)
include(AddMLIR)
include(HandleLLVMOptions)

include_directories(${LLVM_INCLUDE_DIRS})
include_directories(${MLIR_INCLUDE_DIRS})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)
include_directories(${CMAKE_CURRENT_BINARY_DIR}/include)

set(LLVM_LINK_COMPONENTS Core)

# ---- TableGen: dialect / ops / types ----
set(LLVM_TARGET_DEFINITIONS include/t-device/Dialect.td)
mlir_tablegen(include/t-device/Dialect.h.inc -gen-op-decls)
mlir_tablegen(include/t-device/Dialect.cpp.inc -gen-op-defs)
# The dialect CLASS (DeviceDialect) is generated separately. -gen-dialect-* needs
# -dialect=<name> where <name> is the dialect's `name` string (here "device"),
# NOT the ODS def name (Device_Dialect).
mlir_tablegen(include/t-device/DialectDialect.h.inc -gen-dialect-decls -dialect=device)
mlir_tablegen(include/t-device/DialectDialect.cpp.inc -gen-dialect-defs -dialect=device)
add_custom_target(DeviceDialectIncGen DEPENDS
  ${CMAKE_CURRENT_BINARY_DIR}/include/t-device/Dialect.h.inc
  ${CMAKE_CURRENT_BINARY_DIR}/include/t-device/Dialect.cpp.inc
  ${CMAKE_CURRENT_BINARY_DIR}/include/t-device/DialectDialect.h.inc
  ${CMAKE_CURRENT_BINARY_DIR}/include/t-device/DialectDialect.cpp.inc)

# ---- TableGen: pass registration ----
set(LLVM_TARGET_DEFINITIONS include/t-device/Passes.td)
mlir_tablegen(include/t-device/Passes.h.inc -gen-pass-decls)
add_custom_target(DevicePassIncGen DEPENDS
  ${CMAKE_CURRENT_BINARY_DIR}/include/t-device/Passes.h.inc)

# ---- Dialect library ----
add_mlir_dialect_library(MIRTDevice
  lib/Dialect.cpp
  DEPENDS
    DeviceDialectIncGen
  LINK_COMPONENTS
    Core
  LINK_LIBS
    MLIRIR
    MLIRFuncDialect
    MLIRNVVMDialect
    MLIRArithDialect
    MLIRSCFDialect
    MLIRControlFlowDialect
    MLIRLLVMDialect
)

# ---- Lowering pass library ----
add_mlir_library(MIRTDeviceTransforms
  lib/DeviceToNVVM.cpp
  DEPENDS
    DeviceDialectIncGen
    DevicePassIncGen
  LINK_LIBS
    MIRTDevice
    MLIRIR
    MLIRFuncDialect
    MLIRNVVMDialect
    MLIRArithDialect
    MLIRSCFDialect
    MLIRControlFlowDialect
    MLIRLLVMDialect
    MLIRTransformUtils
)

# ---- Driver tool ----
# NOTE: add_mlir_tool (== add_llvm_executable) does NOT accept a LINK_LIBS
# keyword, so libraries are attached via target_link_libraries below.
add_mlir_tool(t-device-opt
  tools/t-device-opt.cpp
  tools/runtime_shim.cpp
  DEPENDS
    DeviceDialectIncGen
    DevicePassIncGen
)

target_link_libraries(t-device-opt PRIVATE
  MIRTDevice
  MIRTDeviceTransforms
  MLIRIR
  MLIRFuncDialect
  MLIRNVVMDialect
  MLIRArithDialect
  MLIRSCFDialect
  MLIRControlFlowDialect
  MLIRLLVMDialect
  MLIRParser
  MLIRPass
  MLIRTransforms
  MLIRSupport
  MLIRMlirOptMain
  MLIRBuiltinToLLVMIRTranslation
  MLIRTransformUtils
)

# clang-cl + lld-link (driven directly by CMake's vs_link_exe) does NOT auto-link the
# MSVC/WinSDK default runtime import libs, so we list them explicitly. These match the
# Release /MD build of the prebuilt portable-mlir-toolchain (LLVM 22.1.8).
# clang-cl + lld-link driven by CMake's vs_link_exe does NOT search the LIB env for bare
# library names, and ninja cannot track dependency paths that contain spaces. So we point
# lld-link at the runtime lib dirs via /LIBPATH: (quoted) and list the bare import-lib names.
# These are the Release /MD import libs of MSVC 14.37.32822 + WinSDK 10.0.22621.0, matching
# the prebuilt portable-mlir-toolchain (LLVM 22.1.8).
target_link_options(t-device-opt PRIVATE
  /LIBPATH:C:/PROGRA~1/MICROS~1/2022/COMMUN~1/VC/Tools/MSVC/1437~1.328/lib/x64
  /LIBPATH:C:/PROGRA~2/WI3CF2~1/10/Lib/100226~1.0/ucrt/x64
  /LIBPATH:C:/PROGRA~2/WI3CF2~1/10/Lib/100226~1.0/um/x64
)
target_link_libraries(t-device-opt PRIVATE
  msvcrt     # /MD CRT import lib
  msvcprt    # C++ STL import lib (/MD; provides __std_* out-of-line helpers, etc.)
  ucrt       # Universal CRT (provides _Thrd_sleep_for, etc.)
  oldnames   # POSIX-name forwarding
  kernel32   # Win32 API (Sleep, used by _Thrd_sleep_for shim)
)

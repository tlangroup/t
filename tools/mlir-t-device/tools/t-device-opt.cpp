#include "t-device/Dialect.h"
#include "t-device/Passes.h"

#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/Dialect/SCF/IR/SCF.h"
#include "mlir/IR/DialectRegistry.h"
#include "mlir/Support/LogicalResult.h"
#include "mlir/Tools/mlir-opt/MLIROptMain.h"

using namespace mlir;

int main(int argc, char **argv) {
  DialectRegistry registry;
  registry.insert<tdevice::DeviceDialect>();
  registry.insert<func::FuncDialect>();
  registry.insert<LLVM::LLVMDialect>();
  registry.insert<NVVM::NVVMDialect>();
  registry.insert<arith::ArithDialect>();
  registry.insert<scf::SCFDialect>();

  tdevice::registerDevicePasses();

  // Modern MLIR 22 API: (argc, argv, toolName, registry). asMainReturnCode maps
  // LogicalResult -> process exit code.
  return mlir::asMainReturnCode(
      mlir::MlirOptMain(argc, argv, "t-device-opt", registry));
}

#ifndef T_DEVICE_PASSES_TD
#define T_DEVICE_PASSES_TD

include "mlir/Pass/PassBase.td"

def DeviceToNVVM : Pass<"device-to-nvvm", "::mlir::ModuleOp"> {
  let summary = "Lower device.* ops to NVVM / LLVM";
  let description = [{
    Converts device.func / device.kernel_func to func.func (kernel variant gets
    the nvvm.kernel attribute), device.return to func.return, and the GPU-specific
    ops (thread_id / block_id / block_dim / grid_dim / barrier / atomic_add) to
    LLVM inline-asm / llvm.atomic_rmw so the module lowers cleanly to PTX via the
    LLVM NVPTX backend.
  }];
  let dependentDialects = [
    "::mlir::LLVM::LLVMDialect",
    "::mlir::NVVM::NVVMDialect",
    "::mlir::func::FuncDialect"
  ];
}

#endif // T_DEVICE_PASSES_TD

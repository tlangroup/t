#ifndef T_DEVICE_DIALECT_TD
#define T_DEVICE_DIALECT_TD

include "mlir/IR/DialectBase.td"
include "mlir/IR/OpBase.td"
include "mlir/IR/AttrTypeBase.td"
include "mlir/IR/BuiltinTypes.td"
include "mlir/IR/BuiltinAttributes.td"
include "mlir/IR/SymbolInterfaces.td"
include "mlir/Dialect/LLVMIR/LLVMOpBase.td"

def Device_Dialect : Dialect {
  let name = "device";
  let cppNamespace = "tdevice";
  let summary = "Target-independent device dialect for the T language";
  let description = [{
    Minimal target-independent dialect for T's Device subsystem. Lowered to
    NVVM / LLVM by the device-to-nvvm pass, then to PTX by the LLVM NVPTX
    backend. See docs/device-design.md §3.
  }];
}

// NOTE: the typed !device.ptr<memspace, T> TypeDef (design §3.1) is DEFERRED.
// The vertical slice lowers straight to !llvm.ptr<as> (see test/vec_add.mlir),
// so no DevicePtr type is generated here yet. Re-add a TypeDef + its
// -gen-typedef-* tablegen steps + addTypes<> once the addrspace mapping is wired.

class Device_Op<string mnemonic, list<Trait> traits = []> :
  Op<Device_Dialect, mnemonic, traits>;

// device.func / device.kernel_func -- device-callable / grid entry container
def DeviceFuncOp : Device_Op<"func", [IsolatedFromAbove, Symbol]> {
  let arguments = (ins SymbolNameAttr:$sym_name,
                      TypeAttrOf<FunctionType>:$function_type);
  let regions = (region SizedRegion<1>:$body);
  let assemblyFormat = "$sym_name `:` $function_type attr-dict-with-keyword $body";
}

def DeviceKernelFuncOp : Device_Op<"kernel_func", [IsolatedFromAbove, Symbol]> {
  let arguments = (ins SymbolNameAttr:$sym_name,
                      TypeAttrOf<FunctionType>:$function_type);
  let regions = (region SizedRegion<1>:$body);
  let assemblyFormat = "$sym_name `:` $function_type attr-dict-with-keyword $body";
}

def DeviceReturnOp : Device_Op<"return", [Terminator]> {
}

// Index intrinsics -> nvvm.read.ptx.sreg.* (lowered to llvm.inline_asm).
// dim: 0 = x, 1 = y, 2 = z (I32 to avoid the portable-package StringAttr gap).
def ThreadIdOp : Device_Op<"thread_id", [Pure]> {
  let arguments = (ins I32Attr:$dim);
  let results = (outs I32:$result);
}
def BlockIdOp : Device_Op<"block_id", [Pure]> {
  let arguments = (ins I32Attr:$dim);
  let results = (outs I32:$result);
}
def BlockDimOp : Device_Op<"block_dim", [Pure]> {
  let arguments = (ins I32Attr:$dim);
  let results = (outs I32:$result);
}
def GridDimOp : Device_Op<"grid_dim", [Pure]> {
  let arguments = (ins I32Attr:$dim);
  let results = (outs I32:$result);
}

def BarrierOp : Device_Op<"barrier", []> {
}

def AtomicAddOp : Device_Op<"atomic_add", []> {
  let arguments = (ins LLVM_AnyPointer:$ptr, AnyType:$value);
  let results = (outs AnyType:$result);
}

// 共享内存分配（docs/device-design.md §3.2）：在地址空间 3（shared）分配 `count` 个
// `elem` 元素的缓冲区，结果 !llvm.ptr<3>。lowering 降为 llvm.alloca（addrspace 3），
// 由 NVVM/PTX 后端落到 .shared。本 op 补上设计 §3.2 的 `device.shared_alloc`。
def DeviceSharedAllocOp : Device_Op<"shared_alloc", []> {
  let arguments = (ins I32:$count, TypeAttr:$elem);
  let results = (outs LLVM_AnyPointer:$result);
}

#endif // T_DEVICE_DIALECT_TD

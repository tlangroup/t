#include "t-device/Dialect.h"
#define GET_OP_CLASSES
#include "t-device/Dialect.cpp.inc"
#undef GET_OP_CLASSES

#include "t-device/DialectDialect.cpp.inc"

using namespace mlir;
using namespace tdevice;

void DeviceDialect::initialize() {
  addOperations<
    DeviceFuncOp, DeviceKernelFuncOp, DeviceReturnOp,
    ThreadIdOp, BlockIdOp, BlockDimOp, GridDimOp,
    BarrierOp, AtomicAddOp, DeviceSharedAllocOp
  >();
}

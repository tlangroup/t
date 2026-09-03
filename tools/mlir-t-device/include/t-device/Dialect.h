#ifndef T_DEVICE_DIALECT_H
#define T_DEVICE_DIALECT_H

#include "mlir/IR/Dialect.h"
#include "mlir/IR/OpDefinition.h"
#include "mlir/IR/BuiltinTypes.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "t-device/DialectDialect.h.inc"
#define GET_OP_CLASSES
#include "t-device/Dialect.h.inc"
#undef GET_OP_CLASSES


#endif // T_DEVICE_DIALECT_H

#include "t-device/Dialect.h"
#include "t-device/Passes.h"

#include "mlir/Dialect/Func/IR/FuncOps.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/IRMapping.h"
#include "mlir/IR/PatternMatch.h"
#include "mlir/Pass/Pass.h"
#include "mlir/Transforms/GreedyPatternRewriteDriver.h"
#include "llvm/ADT/StringExtras.h"

// Pull in the generated DeviceToNVVM pass class (impl::DeviceToNVVMBase) and
// the global createDeviceToNVVM() / registerDeviceToNVVM() definitions.
#define GEN_PASS_DEF_DEVICETONVVM
#include "t-device/Passes.h.inc"
#undef GEN_PASS_DEF_DEVICETONVVM

// Also emit registerDeviceToNVVM() so registerDevicePasses() can call it.
#define GEN_PASS_REGISTRATION
#include "t-device/Passes.h.inc"
#undef GEN_PASS_REGISTRATION

namespace {

using namespace mlir;
using namespace tdevice;

// device.func / device.kernel_func -> func.func
template <typename DeviceFuncTy>
class FuncConversion : public OpRewritePattern<DeviceFuncTy> {
public:
  using OpRewritePattern<DeviceFuncTy>::OpRewritePattern;
  LogicalResult matchAndRewrite(DeviceFuncTy op,
                                PatternRewriter &rewriter) const final {
    bool isKernel =
        std::is_same<DeviceFuncTy, DeviceKernelFuncOp>::value;
    auto func = rewriter.create<func::FuncOp>(op.getLoc(), op.getSymName(),
                                              op.getFunctionType());
    func.getBody().takeBody(op.getBody());
    // Mark kernels with an UNREGISTERED attribute on func.func (func.func
    // rejects the registered `nvvm.kernel`, which NVVM restricts to llvm.func).
    // The func.func->llvm.func conversion in the pipeline copies it through;
    // a later sed renames tdevice.kernel -> nvvm.kernel before translation.
    if (isKernel)
      func->setAttr("tdevice.kernel", rewriter.getUnitAttr());
    rewriter.eraseOp(op);
    return success();
  }
};

class ReturnConversion : public OpRewritePattern<DeviceReturnOp> {
public:
  using OpRewritePattern::OpRewritePattern;
  LogicalResult matchAndRewrite(DeviceReturnOp op,
                                PatternRewriter &rewriter) const final {
    rewriter.replaceOpWithNewOp<func::ReturnOp>(op);
    return success();
  }
};

// thread/block/grid index -> llvm.inline_asm reading the PTX special register.
// dim: 0=x, 1=y, 2=z. sreg: tid / ctaid / ntid / nctaid.
template <typename OpTy>
class IndexToAsm : public OpRewritePattern<OpTy> {
public:
  IndexToAsm(MLIRContext *ctx, llvm::StringRef sreg)
      : OpRewritePattern<OpTy>(ctx), sreg(sreg) {}
  LogicalResult matchAndRewrite(OpTy op,
                                PatternRewriter &rewriter) const final {
    int dimIdx = op.getDim();
    llvm::StringRef dimStr = dimIdx == 0 ? "x" : (dimIdx == 1 ? "y" : "z");
    std::string asmStr =
        "mov.u32 $0, %" + sreg.str() + "." + dimStr.str() + ";";
    auto i32 = rewriter.getI32Type();
    auto asmOp = rewriter.create<LLVM::InlineAsmOp>(
        op.getLoc(), /*res=*/i32, ValueRange{},
        /*asm_string=*/asmStr, /*constraints=*/"=r",
        /*hasSideEffects=*/true, /*isAlignStack=*/false,
        /*tailCallKind=*/LLVM::TailCallKind::None,
        /*asmDialect=*/LLVM::AsmDialectAttr::get(op.getContext(),
                                                LLVM::AsmDialect::AD_ATT),
        /*operandAttrs=*/ArrayAttr());
    rewriter.replaceOp(op, asmOp.getResults());
    return success();
  }

private:
  llvm::StringRef sreg;
};

class BarrierConversion : public OpRewritePattern<BarrierOp> {
public:
  using OpRewritePattern::OpRewritePattern;
  LogicalResult matchAndRewrite(BarrierOp op,
                                PatternRewriter &rewriter) const final {
    rewriter.create<LLVM::InlineAsmOp>(
        op.getLoc(), /*res=*/Type(), ValueRange{},
        /*asm_string=*/"bar.sync 0;", /*constraints=*/"",
        /*hasSideEffects=*/true, /*isAlignStack=*/false,
        /*tailCallKind=*/LLVM::TailCallKind::None,
        /*asmDialect=*/LLVM::AsmDialectAttr::get(op.getContext(),
                                                LLVM::AsmDialect::AD_ATT),
        /*operandAttrs=*/ArrayAttr());
    rewriter.eraseOp(op);
    return success();
  }
};

class AtomicAddConversion : public OpRewritePattern<AtomicAddOp> {
public:
  using OpRewritePattern::OpRewritePattern;
  LogicalResult matchAndRewrite(AtomicAddOp op,
                                PatternRewriter &rewriter) const final {
    auto rmw = rewriter.create<LLVM::AtomicRMWOp>(
        op.getLoc(), LLVM::AtomicBinOp::add,
        op.getPtr(), op.getValue(), LLVM::AtomicOrdering::monotonic);
    rewriter.replaceOp(op, rmw.getResult());
    return success();
  }
};

// device.shared_alloc -> llvm.alloca（结果 !llvm.ptr<3>，shared 地址空间）。
// NVVM/PTX 后端把 addrspace 3 的 alloca 落到 .shared。
class SharedAllocConversion : public OpRewritePattern<DeviceSharedAllocOp> {
public:
  using OpRewritePattern::OpRewritePattern;
  LogicalResult matchAndRewrite(DeviceSharedAllocOp op,
                                PatternRewriter &rewriter) const final {
    auto elemTy = op.getElem();
    auto ptrTy = LLVM::LLVMPointerType::get(elemTy.getContext(), /*addrspace=*/3);
    auto alloca = rewriter.create<LLVM::AllocaOp>(
        op.getLoc(), ptrTy, op.getCount(), /*alignment=*/0);
    rewriter.replaceOp(op, alloca.getResult());
    return success();
  }
};

class DeviceToNVVM : public ::impl::DeviceToNVVMBase<DeviceToNVVM> {
public:
  void runOnOperation() final {
    MLIRContext *ctx = &getContext();
    RewritePatternSet patterns(ctx);
    patterns.add<FuncConversion<DeviceFuncOp>,
                  FuncConversion<DeviceKernelFuncOp>,
                  ReturnConversion,
                  BarrierConversion,
                  AtomicAddConversion,
                  SharedAllocConversion>(ctx);
    patterns.add<IndexToAsm<ThreadIdOp>>(ctx, "tid");
    patterns.add<IndexToAsm<BlockIdOp>>(ctx, "ctaid");
    patterns.add<IndexToAsm<BlockDimOp>>(ctx, "ntid");
    patterns.add<IndexToAsm<GridDimOp>>(ctx, "nctaid");
    // func conversion moves device bodies into func.func; the inner device
    // ops are then lowered in subsequent greedy iterations (fixpoint).
    if (failed(applyPatternsGreedily(getOperation(), std::move(patterns))))
      signalPassFailure();
  }
};

} // namespace

namespace tdevice {
void registerDevicePasses() {
  registerDeviceToNVVM();
}
} // namespace tdevice

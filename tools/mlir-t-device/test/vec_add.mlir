// vec_add kernel in the T `device` dialect (pretty syntax, lowered by --device-to-nvvm).
// Pointers use !llvm.ptr<1> (global address space). The kernel body is straight-line
// (no bounds guard / grid-stride loop) so this slice only needs device/func/llvm/arith.
device.kernel_func @vec_add : (!llvm.ptr<1>, !llvm.ptr<1>, !llvm.ptr<1>, i32) -> () {
^entry(%a: !llvm.ptr<1>, %b: !llvm.ptr<1>, %c: !llvm.ptr<1>, %n: i32):
  %i   = "device.thread_id"() {dim = 0 : i32} : () -> i32
  %bd  = "device.block_dim"()  {dim = 0 : i32} : () -> i32
  %bid = "device.block_id"()  {dim = 0 : i32} : () -> i32
  %gid = arith.muli %bid, %bd : i32
  %idx = arith.addi %gid, %i  : i32
  %ai  = llvm.getelementptr %a[%idx] : (!llvm.ptr<1>, i32) -> !llvm.ptr<1>, f32
  %av  = llvm.load %ai : !llvm.ptr<1> -> f32
  %bi  = llvm.getelementptr %b[%idx] : (!llvm.ptr<1>, i32) -> !llvm.ptr<1>, f32
  %bv  = llvm.load %bi : !llvm.ptr<1> -> f32
  %sum = arith.addf %av, %bv : f32
  %ci  = llvm.getelementptr %c[%idx] : (!llvm.ptr<1>, i32) -> !llvm.ptr<1>, f32
  llvm.store %sum, %ci : f32, !llvm.ptr<1>
  "device.barrier"() : () -> ()
  "device.return"() : () -> ()
}

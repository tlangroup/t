/**
 * t Language - C Code Emitter
 *
 * Transpiles t language AST to C source code.
 * This is a pragmatic code generation strategy for a new language —
 * leverage existing C toolchains (gcc, clang, msvc) for final compilation.
 *
 * Handles:
 * - Struct/Enum/Flag/Union → C struct/enum/typedef
 * - Functions → C functions
 * - Annotations → C #pragma / __attribute__ where applicable
 * - Flag bitfield operations → C bit manipulation macros
 * - @derive → generates C function implementations
 */
import { CompilationUnit } from "../ast/nodes.js";
import { FlagResolver } from "../flag/bitfield.js";
export declare class CEmitter {
    private flagResolver;
    private deriveProcessor;
    private resolvedFlags;
    private headerLines;
    private sourceLines;
    constructor(flagResolver: FlagResolver);
    emit(unit: CompilationUnit): {
        header: string;
        source: string;
    };
    private emitDecl;
    private emitStructDecl;
    private emitEnumDecl;
    private emitFlagDecl;
    private emitFlagSetDecl;
    private emitUnionDecl;
    private emitFuncDecl;
    private emitGlobalVar;
    private emitGlobalConst;
    private emitStmt;
    private emitExpr;
    private emitType;
    private scalarToC;
    private emitAttributes;
    private emitFlagMacros;
}
//# sourceMappingURL=emitter.d.ts.map
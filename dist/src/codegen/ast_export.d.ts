/**
 * t Language - AST JSON Export
 *
 * Implements spec 8.3: AST 标准化导出
 *
 * The compiler exports source as JSON-format AST, enabling AI to:
 * - Batch analyze source code
 * - Batch refactor
 * - Generate template code
 *
 * Also includes serialization of type_info, annotations, and flag layouts.
 */
import { CompilationUnit } from "../ast/nodes.js";
import { TypeInfoProvider } from "../comptime/type_info.js";
import { FlagResolver } from "../flag/bitfield.js";
export declare class AstJsonExporter {
    private typeInfoProvider;
    private flagResolver;
    private deriveProcessor;
    constructor(flagResolver: FlagResolver, typeInfoProvider?: TypeInfoProvider | null);
    /**
     * Export a compilation unit as JSON (spec 8.3).
     */
    export(unit: CompilationUnit): string;
    private serializeDecl;
    private serializeAnnotation;
    private serializeAnnotationArg;
    private serializeType;
    private serializeStmt;
    private serializeExpr;
    private serializeFlagLayout;
}
//# sourceMappingURL=ast_export.d.ts.map
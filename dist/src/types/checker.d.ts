/**
 * t Language - Type Checker
 *
 * Performs semantic analysis on the AST:
 * - Builds symbol table from declarations
 * - Resolves and validates types
 * - Checks expression types
 * - Enforces no implicit conversion (spec 2.1, principle 2)
 * - Validates return path coverage (spec 1.3: all branches must return)
 * - Checks flag/bitfield operations (spec 6.4)
 */
import { CompilationUnit, DeclNode } from "../ast/nodes.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
import { TypeInfo } from "./types.js";
interface SymbolEntry {
    name: string;
    kind: "type" | "var" | "func" | "const";
    typeInfo: TypeInfo;
    decl: DeclNode;
}
export declare class SymbolTable {
    private parent;
    private symbols;
    constructor(parent?: SymbolTable | null);
    define(name: string, kind: SymbolEntry["kind"], typeInfo: TypeInfo, decl: DeclNode): boolean;
    defineLocal(name: string, typeInfo: TypeInfo): boolean;
    lookup(name: string): SymbolEntry | null;
    child(): SymbolTable;
}
export declare class TypeChecker {
    private bag;
    private globalScope;
    private currentScope;
    private currentReturnType;
    constructor(bag: DiagnosticBag);
    check(unit: CompilationUnit): void;
    private registerDecl;
    private resolveType;
    private checkDecl;
    private checkFuncDecl;
    private checkStructDecl;
    private checkEnumDecl;
    private checkFlagDecl;
    private checkStmt;
    private inferExprType;
    private lookupBuiltinReturnType;
    private allPathsReturn;
    private stmtReturns;
    private errorTypeMismatch;
}
export {};
//# sourceMappingURL=checker.d.ts.map
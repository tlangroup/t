/**
 * t Language - CTFE (Compile-Time Function Evaluation)
 *
 * Implements spec section 5.1: CTFE 编译期求值
 *
 * Features:
 * 1. comptime functions use same syntax as runtime (spec 5.1.1)
 * 2. Compile-time reading of external CSV/JSON data tables (spec 5.1.2)
 * 3. Compile-time data validation (spec 5.1.3)
 *
 * The CTFE engine evaluates a subset of the language at compile time:
 * - Integer, float, string, bool literals
 * - Binary and unary arithmetic
 * - Variable declarations and assignments
 * - If/for/while control flow
 * - Function calls (to other comptime functions)
 * - type_info() calls
 */
import { ExprNode, StmtNode, DeclNode } from "../ast/nodes.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
export type CtfeValue = {
    kind: "int";
    value: bigint;
    typeName: string;
} | {
    kind: "float";
    value: number;
    typeName: string;
} | {
    kind: "string";
    value: string;
} | {
    kind: "bool";
    value: boolean;
} | {
    kind: "null";
} | {
    kind: "array";
    elements: CtfeValue[];
} | {
    kind: "struct";
    typeName: string;
    fields: Map<string, CtfeValue>;
} | {
    kind: "void";
};
export declare class CtfeEnvironment {
    private variables;
    private parent;
    constructor(parent?: CtfeEnvironment | null);
    define(name: string, value: CtfeValue): void;
    lookup(name: string): CtfeValue | null;
    child(): CtfeEnvironment;
}
export declare class CtfeEngine {
    private bag;
    private env;
    private comptimeFuncs;
    constructor(bag: DiagnosticBag);
    registerComptimeFunc(decl: DeclNode): void;
    /**
     * Evaluate a constant expression at compile time (spec 5.1).
     */
    evaluate(expr: ExprNode, env?: CtfeEnvironment): CtfeValue;
    /**
     * Execute a list of statements in a comptime context.
     */
    executeBlock(stmts: StmtNode[], env?: CtfeEnvironment): CtfeValue;
    private executeStmt;
    private evalBinaryOp;
    private evalUnaryOp;
    private evalCast;
    private evalBuiltinCall;
    /**
     * Load a CSV file at compile time and return as an array of struct values.
     * Spec 5.1.2: CTFE 编译期载入 JSON/CSV 表格
     */
    loadCsv(filePath: string): CtfeValue;
    /**
     * Load a JSON file at compile time.
     */
    loadJson(filePath: string): CtfeValue;
}
//# sourceMappingURL=ctfe.d.ts.map
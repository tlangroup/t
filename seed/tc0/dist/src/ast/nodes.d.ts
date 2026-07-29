/**
 * t Language - AST Node Definitions
 *
 * Complete AST node types covering all language constructs:
 * - Declarations (struct, enum, flag, union, func, var, const, import)
 * - Statements (if, for, while, switch, return, break, continue, defer, expr, decl)
 * - Expressions (literals, identifiers, binary, unary, call, member, index, etc.)
 * - Types (scalar, array, slice, map, custom, variant)
 * - Annotations (@derive, @test, @cfg, etc.)
 * - Flag/bitfield declarations
 *
 * Spec reference: sections 1-8
 */
import { Token } from "../lexer/token.js";
export interface AstNode {
    kind: string;
    token?: Token;
    span?: {
        file: string;
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
    };
}
export interface AnnotationNode extends AstNode {
    kind: "Annotation";
    name: string;
    args: AnnotationArg[];
}
export type AnnotationArg = {
    kind: "StringArg";
    value: string;
} | {
    kind: "IdentArg";
    value: string;
} | {
    kind: "NumberArg";
    value: string;
} | {
    kind: "ListArg";
    values: AnnotationArg[];
};
export interface TypeNode extends AstNode {
    kind: "Type";
    inner: TypeKind;
}
export type TypeKind = {
    kind: "ScalarType";
    name: string;
} | {
    kind: "ArrayType";
    elem: TypeNode;
    length: ExprNode;
} | {
    kind: "SliceType";
    elem: TypeNode;
} | {
    kind: "MapType";
    key: TypeNode;
    value: TypeNode;
} | {
    kind: "NamedType";
    name: string;
} | {
    kind: "VariantType";
} | {
    kind: "FlagType";
    underlying: string;
} | {
    kind: "FlagSetType";
} | {
    kind: "PointerType";
    elem: TypeNode;
} | {
    kind: "OptionalType";
    elem: TypeNode;
};
export type MemoryLayout = "aos" | "soa" | "default";
export interface ExprNode extends AstNode {
    kind: "Expr";
    exprKind: ExprKind;
}
export type ExprKind = {
    kind: "IntegerLit";
    value: string;
    radix: number;
} | {
    kind: "FloatLit";
    value: string;
} | {
    kind: "StringLit";
    value: string;
} | {
    kind: "BoolLit";
    value: boolean;
} | {
    kind: "NullLit";
} | {
    kind: "IdentExpr";
    name: string;
} | {
    kind: "BinaryExpr";
    op: string;
    left: ExprNode;
    right: ExprNode;
} | {
    kind: "UnaryExpr";
    op: string;
    operand: ExprNode;
} | {
    kind: "AssignExpr";
    op: string;
    target: ExprNode;
    value: ExprNode;
} | {
    kind: "CallExpr";
    callee: ExprNode;
    args: ExprNode[];
} | {
    kind: "MemberExpr";
    object: ExprNode;
    member: string;
} | {
    kind: "IndexExpr";
    object: ExprNode;
    index: ExprNode;
} | {
    kind: "ArrayLit";
    elements: ExprNode[];
} | {
    kind: "MapLit";
    entries: {
        key: ExprNode;
        value: ExprNode;
    }[];
} | {
    kind: "StructLit";
    typeName: string;
    fields: {
        name: string;
        value: ExprNode;
    }[];
} | {
    kind: "CastExpr";
    expr: ExprNode;
    targetType: TypeNode;
} | {
    kind: "RangeExpr";
    start: ExprNode;
    end: ExprNode;
} | {
    kind: "ComptimeExpr";
    expr: ExprNode;
} | {
    kind: "TypeInfoExpr";
    targetType: TypeNode;
} | {
    kind: "ParenExpr";
    inner: ExprNode;
} | {
    kind: "FlagSetExpr";
    flagExpr: ExprNode;
    fieldName: string;
    value: ExprNode;
};
export interface StmtNode extends AstNode {
    kind: "Stmt";
    stmtKind: StmtKind;
}
export type StmtKind = {
    kind: "ExprStmt";
    expr: ExprNode;
} | {
    kind: "VarDecl";
    name: string;
    typeNode: TypeNode | null;
    init: ExprNode | null;
    isConst: boolean;
} | {
    kind: "IfStmt";
    condition: ExprNode;
    thenBlock: StmtNode[];
    elseBlock: StmtNode[] | null;
} | {
    kind: "ForStmt";
    init: StmtNode | null;
    condition: ExprNode | null;
    update: ExprNode | null;
    body: StmtNode[];
} | {
    kind: "ForEachStmt";
    varName: string;
    iterable: ExprNode;
    body: StmtNode[];
} | {
    kind: "WhileStmt";
    condition: ExprNode;
    body: StmtNode[];
} | {
    kind: "SwitchStmt";
    expr: ExprNode;
    cases: SwitchCase[];
    defaultBlock: StmtNode[] | null;
} | {
    kind: "ReturnStmt";
    value: ExprNode | null;
} | {
    kind: "BreakStmt";
} | {
    kind: "ContinueStmt";
} | {
    kind: "DeferStmt";
    body: StmtNode[];
} | {
    kind: "BlockStmt";
    body: StmtNode[];
} | {
    kind: "ComptimeStmt";
    body: StmtNode[];
} | {
    kind: "AssignmentStmt";
    target: ExprNode;
    op: string;
    value: ExprNode;
};
export interface SwitchCase {
    pattern: ExprNode;
    body: StmtNode[];
}
export interface DeclNode extends AstNode {
    kind: "Decl";
    declKind: DeclKind;
    annotations: AnnotationNode[];
}
export type DeclKind = StructDecl | EnumDecl | FlagDecl | FlagSetDecl | UnionDecl | FuncDecl | VarDecl | ConstDecl | ImportDecl | TypeAliasDecl;
export interface StructDecl {
    kind: "StructDecl";
    name: string;
    fields: StructField[];
    memoryLayout: MemoryLayout;
    isBitpack: boolean;
    bitpackType: string | null;
}
export interface StructField {
    name: string;
    typeNode: TypeNode;
    bitWidth: number | null;
    annotations: AnnotationNode[];
}
export interface EnumDecl {
    kind: "EnumDecl";
    name: string;
    underlyingType: string;
    variants: EnumVariant[];
}
export interface EnumVariant {
    name: string;
    value: ExprNode | null;
    annotations: AnnotationNode[];
}
export interface FlagDecl {
    kind: "FlagDecl";
    name: string;
    underlyingType: string;
    slots: FlagSlot[];
}
export interface FlagSlot {
    name: string;
    bitWidth: number;
    offset: number | null;
    annotations: AnnotationNode[];
}
export interface FlagSetDecl {
    kind: "FlagSetDecl";
    name: string;
    slots: FlagSlot[];
}
export interface UnionDecl {
    kind: "UnionDecl";
    name: string;
    underlyingType: string | null;
    members: UnionMember[];
}
export interface UnionMember {
    name: string;
    typeNode: TypeNode;
    annotations: AnnotationNode[];
}
export interface FuncDecl {
    kind: "FuncDecl";
    name: string;
    params: FuncParam[];
    returnType: TypeNode;
    body: StmtNode[] | null;
    isExtern: boolean;
    isComptime: boolean;
}
export interface FuncParam {
    name: string;
    typeNode: TypeNode;
    annotations: AnnotationNode[];
}
export interface VarDecl {
    kind: "GlobalVarDecl";
    name: string;
    typeNode: TypeNode;
    init: ExprNode | null;
    isComptime: boolean;
}
export interface ConstDecl {
    kind: "GlobalConstDecl";
    name: string;
    typeNode: TypeNode | null;
    init: ExprNode;
    isComptime: boolean;
}
export interface ImportDecl {
    kind: "ImportDecl";
    path: string;
    alias: string | null;
}
export interface TypeAliasDecl {
    kind: "TypeAliasDecl";
    name: string;
    aliasedType: TypeNode;
}
export interface CompilationUnit {
    file: string;
    moduleName: string;
    declarations: DeclNode[];
}
export interface AstVisitor<T> {
    visitAnnotation(node: AnnotationNode): T;
    visitType(node: TypeNode): T;
    visitExpr(node: ExprNode): T;
    visitStmt(node: StmtNode): T;
    visitDecl(node: DeclNode): T;
}
export declare function walkDecl(decl: DeclNode, fn: (node: AstNode) => void): void;
export declare function walkStmt(stmt: StmtNode, fn: (node: AstNode) => void): void;
export declare function walkExpr(expr: ExprNode, fn: (node: AstNode) => void): void;
//# sourceMappingURL=nodes.d.ts.map
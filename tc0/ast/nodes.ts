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

// ─── Base AST Node ───────────────────────────────────────────────

export interface AstNode {
    kind: string;
    token?: Token;
    span?: { file: string; startLine: number; startCol: number; endLine: number; endCol: number };
}

// ─── Annotations (spec section 4) ────────────────────────────────

export interface AnnotationNode extends AstNode {
    kind: "Annotation";
    name: string;                    // e.g. "derive", "test", "doc"
    args: AnnotationArg[];           // arguments
}

export type AnnotationArg =
    | { kind: "StringArg"; value: string }
    | { kind: "IdentArg"; value: string }
    | { kind: "NumberArg"; value: string }
    | { kind: "ListArg"; values: AnnotationArg[] };  // e.g. (Clone, BinarySerde) for @derive

// ─── Types (spec section 2) ──────────────────────────────────────

export interface TypeNode extends AstNode {
    kind: "Type";
    inner: TypeKind;
}

export type TypeKind =
    | { kind: "ScalarType"; name: string }                       // u8, i32, f64, bool, string, void
    | { kind: "ArrayType"; elem: TypeNode; length: ExprNode }    // [N]T
    | { kind: "SliceType"; elem: TypeNode }                      // []T
    | { kind: "MapType"; key: TypeNode; value: TypeNode }        // map[K]V
    | { kind: "NamedType"; name: string }                        // custom struct/enum/flag name
    | { kind: "VariantType" }                                    // Variant
    | { kind: "FlagType"; underlying: string }                   // flag[u32] - underlying int type
    | { kind: "FlagSetType" }                                    // flag_set
    | { kind: "PointerType"; elem: TypeNode }                    // *T (for unsafe FFI)
    | { kind: "OptionalType"; elem: TypeNode };                  // ?T

// ─── Memory Layout Directives (spec 3.1) ─────────────────────────

export type MemoryLayout = "aos" | "soa" | "default";

// ─── Expressions ─────────────────────────────────────────────────

export interface ExprNode extends AstNode {
    kind: "Expr";
    exprKind: ExprKind;
}

export type ExprKind =
    | { kind: "IntegerLit"; value: string; radix: number }
    | { kind: "FloatLit"; value: string }
    | { kind: "StringLit"; value: string }
    | { kind: "BoolLit"; value: boolean }
    | { kind: "NullLit" }
    | { kind: "IdentExpr"; name: string }
    | { kind: "BinaryExpr"; op: string; left: ExprNode; right: ExprNode }
    | { kind: "UnaryExpr"; op: string; operand: ExprNode }
    | { kind: "AssignExpr"; op: string; target: ExprNode; value: ExprNode }
    | { kind: "CallExpr"; callee: ExprNode; args: ExprNode[] }
    | { kind: "MemberExpr"; object: ExprNode; member: string }
    | { kind: "IndexExpr"; object: ExprNode; index: ExprNode }
    | { kind: "ArrayLit"; elements: ExprNode[] }
    | { kind: "MapLit"; entries: { key: ExprNode; value: ExprNode }[] }
    | { kind: "StructLit"; typeName: string; fields: { name: string; value: ExprNode }[] }
    | { kind: "CastExpr"; expr: ExprNode; targetType: TypeNode }
    | { kind: "RangeExpr"; start: ExprNode; end: ExprNode }
    | { kind: "ComptimeExpr"; expr: ExprNode }    // comptime { ... } or comptime expr
    | { kind: "TypeInfoExpr"; targetType: TypeNode }  // type_info(T)
    | { kind: "ParenExpr"; inner: ExprNode }
    | { kind: "FlagSetExpr"; flagExpr: ExprNode; fieldName: string; value: ExprNode };  // flag_set(inst, field, val)

// ─── Statements ──────────────────────────────────────────────────

export interface StmtNode extends AstNode {
    kind: "Stmt";
    stmtKind: StmtKind;
}

export type StmtKind =
    | { kind: "ExprStmt"; expr: ExprNode }
    | { kind: "VarDecl"; name: string; typeNode: TypeNode | null; init: ExprNode | null; isConst: boolean }
    | { kind: "IfStmt"; condition: ExprNode; thenBlock: StmtNode[]; elseBlock: StmtNode[] | null }
    | { kind: "ForStmt"; init: StmtNode | null; condition: ExprNode | null; update: ExprNode | null; body: StmtNode[] }
    | { kind: "ForEachStmt"; varName: string; iterable: ExprNode; body: StmtNode[] }
    | { kind: "WhileStmt"; condition: ExprNode; body: StmtNode[] }
    | { kind: "SwitchStmt"; expr: ExprNode; cases: SwitchCase[]; defaultBlock: StmtNode[] | null }
    | { kind: "ReturnStmt"; value: ExprNode | null }
    | { kind: "BreakStmt" }
    | { kind: "ContinueStmt" }
    | { kind: "DeferStmt"; body: StmtNode[] }
    | { kind: "BlockStmt"; body: StmtNode[] }
    | { kind: "ComptimeStmt"; body: StmtNode[] }
    | { kind: "AssignmentStmt"; target: ExprNode; op: string; value: ExprNode };

export interface SwitchCase {
    pattern: ExprNode;
    body: StmtNode[];
}

// ─── Declarations ────────────────────────────────────────────────

export interface DeclNode extends AstNode {
    kind: "Decl";
    declKind: DeclKind;
    annotations: AnnotationNode[];
}

export type DeclKind =
    | StructDecl
    | EnumDecl
    | FlagDecl
    | FlagSetDecl
    | UnionDecl
    | FuncDecl
    | VarDecl
    | ConstDecl
    | ImportDecl
    | TypeAliasDecl;

// ── Struct (spec 3.1) ──

export interface StructDecl {
    kind: "StructDecl";
    name: string;
    fields: StructField[];
    memoryLayout: MemoryLayout;
    isBitpack: boolean;
    bitpackType: string | null;      // @bitpack(u16) -> "u16"
}

export interface StructField {
    name: string;
    typeNode: TypeNode;
    bitWidth: number | null;         // for @bitpack structs: field : 4
    annotations: AnnotationNode[];
}

// ── Enum (spec 3.2) ──

export interface EnumDecl {
    kind: "EnumDecl";
    name: string;
    underlyingType: string;          // u8, u16, u32, i32, etc.
    variants: EnumVariant[];
}

export interface EnumVariant {
    name: string;
    value: ExprNode | null;          // explicit value or auto-increment
    annotations: AnnotationNode[];
}

// ── Flag / flag[T] (spec 6) ──

export interface FlagDecl {
    kind: "FlagDecl";
    name: string;
    underlyingType: string;          // u8, u16, u32, u64
    slots: FlagSlot[];
}

export interface FlagSlot {
    name: string;
    bitWidth: number;                // 1 for bool, 2+ for value bitfield
    offset: number | null;           // explicit @offset(N) or null for auto
    annotations: AnnotationNode[];
}

// ── Flag Set / flag_set (spec 6.5) ──

export interface FlagSetDecl {
    kind: "FlagSetDecl";
    name: string;
    slots: FlagSlot[];               // same structure as FlagDecl
}

// ── Union (spec 3.3) ──

export interface UnionDecl {
    kind: "UnionDecl";
    name: string;
    underlyingType: string | null;   // optional explicit storage type
    members: UnionMember[];
}

export interface UnionMember {
    name: string;
    typeNode: TypeNode;
    annotations: AnnotationNode[];
}

// ── Function (spec 1.3) ──

export interface FuncDecl {
    kind: "FuncDecl";
    name: string;
    params: FuncParam[];
    returnType: TypeNode;
    body: StmtNode[] | null;         // null = extern declaration
    isExtern: boolean;
    isComptime: boolean;
}

export interface FuncParam {
    name: string;
    typeNode: TypeNode;
    annotations: AnnotationNode[];
}

// ── Global Var / Const (spec 1.1) ──

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

// ── Import ──

export interface ImportDecl {
    kind: "ImportDecl";
    path: string;
    alias: string | null;
}

// ── Type Alias ──

export interface TypeAliasDecl {
    kind: "TypeAliasDecl";
    name: string;
    aliasedType: TypeNode;
}

// ─── Compilation Unit (a single .tc file) ────────────────────────

export interface CompilationUnit {
    file: string;
    moduleName: string;
    declarations: DeclNode[];
}

// ─── AST Visitor Pattern ─────────────────────────────────────────

export interface AstVisitor<T> {
    visitAnnotation(node: AnnotationNode): T;
    visitType(node: TypeNode): T;
    visitExpr(node: ExprNode): T;
    visitStmt(node: StmtNode): T;
    visitDecl(node: DeclNode): T;
}

export function walkDecl(decl: DeclNode, fn: (node: AstNode) => void): void {
    fn(decl);
    const dk = decl.declKind;
    switch (dk.kind) {
        case "StructDecl":
            dk.fields.forEach((f) => {
                fn(f.typeNode);
                f.annotations.forEach((a) => fn(a));
            });
            break;
        case "EnumDecl":
            dk.variants.forEach((v) => {
                if (v.value) fn(v.value);
                v.annotations.forEach((a) => fn(a));
            });
            break;
        case "FlagDecl":
        case "FlagSetDecl":
            dk.slots.forEach((s) => s.annotations.forEach((a) => fn(a)));
            break;
        case "UnionDecl":
            dk.members.forEach((m) => {
                fn(m.typeNode);
                m.annotations.forEach((a) => fn(a));
            });
            break;
        case "FuncDecl":
            dk.params.forEach((p) => {
                fn(p.typeNode);
                p.annotations.forEach((a) => fn(a));
            });
            fn(dk.returnType);
            if (dk.body) dk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "GlobalVarDecl":
            fn(dk.typeNode);
            if (dk.init) fn(dk.init);
            break;
        case "GlobalConstDecl":
            if (dk.typeNode) fn(dk.typeNode);
            fn(dk.init);
            break;
        case "TypeAliasDecl":
            fn(dk.aliasedType);
            break;
    }
    decl.annotations.forEach((a) => fn(a));
}

export function walkStmt(stmt: StmtNode, fn: (node: AstNode) => void): void {
    fn(stmt);
    const sk = stmt.stmtKind;
    switch (sk.kind) {
        case "ExprStmt":
            fn(sk.expr);
            break;
        case "VarDecl":
            if (sk.typeNode) fn(sk.typeNode);
            if (sk.init) fn(sk.init);
            break;
        case "IfStmt":
            fn(sk.condition);
            sk.thenBlock.forEach((s) => walkStmt(s, fn));
            if (sk.elseBlock) sk.elseBlock.forEach((s) => walkStmt(s, fn));
            break;
        case "ForStmt":
            if (sk.init) walkStmt(sk.init, fn);
            if (sk.condition) fn(sk.condition);
            if (sk.update) fn(sk.update);
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "ForEachStmt":
            fn(sk.iterable);
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "WhileStmt":
            fn(sk.condition);
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "SwitchStmt":
            fn(sk.expr);
            sk.cases.forEach((c) => {
                fn(c.pattern);
                c.body.forEach((s) => walkStmt(s, fn));
            });
            if (sk.defaultBlock) sk.defaultBlock.forEach((s) => walkStmt(s, fn));
            break;
        case "ReturnStmt":
            if (sk.value) fn(sk.value);
            break;
        case "DeferStmt":
        case "BlockStmt":
        case "ComptimeStmt":
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "AssignmentStmt":
            fn(sk.target);
            fn(sk.value);
            break;
    }
}

export function walkExpr(expr: ExprNode, fn: (node: AstNode) => void): void {
    fn(expr);
    const ek = expr.exprKind;
    switch (ek.kind) {
        case "BinaryExpr":
            walkExpr(ek.left, fn);
            walkExpr(ek.right, fn);
            break;
        case "UnaryExpr":
            walkExpr(ek.operand, fn);
            break;
        case "AssignExpr":
            walkExpr(ek.target, fn);
            walkExpr(ek.value, fn);
            break;
        case "CallExpr":
            walkExpr(ek.callee, fn);
            ek.args.forEach((a) => walkExpr(a, fn));
            break;
        case "MemberExpr":
            walkExpr(ek.object, fn);
            break;
        case "IndexExpr":
            walkExpr(ek.object, fn);
            walkExpr(ek.index, fn);
            break;
        case "ArrayLit":
            ek.elements.forEach((e) => walkExpr(e, fn));
            break;
        case "MapLit":
            ek.entries.forEach((e) => { walkExpr(e.key, fn); walkExpr(e.value, fn); });
            break;
        case "StructLit":
            ek.fields.forEach((f) => walkExpr(f.value, fn));
            break;
        case "CastExpr":
            walkExpr(ek.expr, fn);
            fn(ek.targetType);
            break;
        case "RangeExpr":
            walkExpr(ek.start, fn);
            walkExpr(ek.end, fn);
            break;
        case "ParenExpr":
            walkExpr(ek.inner, fn);
            break;
        case "FlagSetExpr":
            walkExpr(ek.flagExpr, fn);
            walkExpr(ek.value, fn);
            break;
    }
}

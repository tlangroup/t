/**
 * t Language - Pure-Syntax Parse Export (bootstrap difftest baseline)
 *
 * Emits the *syntactic* AST as compact JSON — no type info, no derive
 * results, no flag layout resolution. This is the byte-exact comparison
 * target for the selfhost parser (M6). Everything here must be
 * reproducible from tokens alone.
 *
 * Output shape (compact JSON, no whitespace):
 *   {"format":"t-parse-json","decls":[ ...decl... ]}
 */

import {
    CompilationUnit, DeclNode, ExprNode, StmtNode, TypeNode,
    AnnotationNode, AnnotationArg,
} from "../ast/nodes.js";

export class ParseJsonExporter {
    export(unit: CompilationUnit): string {
        const json = {
            format: "t-parse-json",
            decls: unit.declarations.map((d) => this.decl(d)),
        };
        return JSON.stringify(json);
    }

    private decl(decl: DeclNode): any {
        const dk = decl.declKind as any;
        const base = {
            kind: dk.kind,
            name: dk.name ?? null,
            annotations: decl.annotations.map((a) => this.annotation(a)),
        };
        switch (dk.kind) {
            case "StructDecl":
                return {
                    ...base,
                    memoryLayout: dk.memoryLayout,
                    isBitpack: dk.isBitpack,
                    bitpackType: dk.bitpackType,
                    fields: dk.fields.map((f: any) => ({
                        name: f.name,
                        type: f.typeNode ? this.type(f.typeNode) : null,
                        bitWidth: f.bitWidth,
                        annotations: f.annotations.map((a: AnnotationNode) => this.annotation(a)),
                    })),
                };
            case "EnumDecl":
                return {
                    ...base,
                    underlyingType: dk.underlyingType,
                    variants: dk.variants.map((v: any) => ({
                        name: v.name,
                        value: v.value ? this.expr(v.value) : null,
                        annotations: v.annotations.map((a: AnnotationNode) => this.annotation(a)),
                    })),
                };
            case "FlagDecl":
                return {
                    ...base,
                    underlyingType: dk.underlyingType,
                    slots: dk.slots.map((s: any) => this.slot(s)),
                };
            case "FlagSetDecl":
                return { ...base, slots: dk.slots.map((s: any) => this.slot(s)) };
            case "UnionDecl":
                return {
                    ...base,
                    members: dk.members.map((m: any) => ({
                        name: m.name,
                        type: this.type(m.typeNode),
                        annotations: m.annotations.map((a: AnnotationNode) => this.annotation(a)),
                    })),
                };
            case "FuncDecl":
                return {
                    ...base,
                    params: dk.params.map((p: any) => ({
                        name: p.name,
                        type: this.type(p.typeNode),
                        annotations: p.annotations.map((a: AnnotationNode) => this.annotation(a)),
                    })),
                    returnType: this.type(dk.returnType),
                    isExtern: dk.isExtern,
                    isComptime: dk.isComptime,
                    body: dk.body ? dk.body.map((s: StmtNode) => this.stmt(s)) : null,
                };
            case "GlobalVarDecl":
                return {
                    ...base,
                    type: this.type(dk.typeNode),
                    init: dk.init ? this.expr(dk.init) : null,
                    isComptime: dk.isComptime,
                };
            case "GlobalConstDecl":
                return {
                    ...base,
                    type: dk.typeNode ? this.type(dk.typeNode) : null,
                    init: this.expr(dk.init),
                    isComptime: dk.isComptime,
                };
            case "ImportDecl":
                return { ...base, path: dk.path, alias: dk.alias };
            case "TypeAliasDecl":
                return { ...base, aliasedType: this.type(dk.aliasedType) };
        }
    }

    private slot(s: any): any {
        return {
            name: s.name,
            bitWidth: s.bitWidth,
            offset: s.offset,
            annotations: s.annotations.map((a: AnnotationNode) => this.annotation(a)),
        };
    }

    private annotation(ann: AnnotationNode): any {
        return { name: ann.name, args: ann.args.map((a) => this.annotationArg(a)) };
    }

    private annotationArg(arg: AnnotationArg): any {
        switch (arg.kind) {
            case "StringArg": return { kind: "string", value: arg.value };
            case "IdentArg": return { kind: "ident", value: arg.value };
            case "NumberArg": return { kind: "number", value: arg.value };
            case "ListArg": return { kind: "list", values: arg.values.map((v) => this.annotationArg(v)) };
        }
    }

    private type(type: TypeNode): any {
        const inner = type.inner as any;
        switch (inner.kind) {
            case "ScalarType": return { kind: "scalar", name: inner.name };
            case "ArrayType": return { kind: "array", elem: this.type(inner.elem), length: this.expr(inner.length) };
            case "SliceType": return { kind: "slice", elem: this.type(inner.elem) };
            case "MapType": return { kind: "map", key: this.type(inner.key), value: this.type(inner.value) };
            case "NamedType": return { kind: "named", name: inner.name };
            case "VariantType": return { kind: "variant" };
            case "FlagType": return { kind: "flag", underlying: inner.underlying };
            case "FlagSetType": return { kind: "flag_set" };
            case "PointerType": return { kind: "pointer", elem: this.type(inner.elem) };
            case "OptionalType": return { kind: "optional", elem: this.type(inner.elem) };
        }
    }

    private stmt(stmt: StmtNode): any {
        const sk = stmt.stmtKind as any;
        switch (sk.kind) {
            case "ExprStmt": return { kind: "expr", expr: this.expr(sk.expr) };
            case "VarDecl": return {
                kind: "var_decl", name: sk.name, isConst: sk.isConst,
                type: sk.typeNode ? this.type(sk.typeNode) : null,
                init: sk.init ? this.expr(sk.init) : null,
            };
            case "IfStmt": return {
                kind: "if", condition: this.expr(sk.condition),
                then: sk.thenBlock.map((s: StmtNode) => this.stmt(s)),
                else: sk.elseBlock ? sk.elseBlock.map((s: StmtNode) => this.stmt(s)) : null,
            };
            case "ForStmt": return {
                kind: "for",
                init: sk.init ? this.stmt(sk.init) : null,
                condition: sk.condition ? this.expr(sk.condition) : null,
                update: sk.update ? this.expr(sk.update) : null,
                body: sk.body.map((s: StmtNode) => this.stmt(s)),
            };
            case "ForEachStmt": return {
                kind: "for_each", varName: sk.varName,
                iterable: this.expr(sk.iterable),
                body: sk.body.map((s: StmtNode) => this.stmt(s)),
            };
            case "WhileStmt": return {
                kind: "while", condition: this.expr(sk.condition),
                body: sk.body.map((s: StmtNode) => this.stmt(s)),
            };
            case "SwitchStmt": return {
                kind: "switch", expr: this.expr(sk.expr),
                cases: sk.cases.map((c: any) => ({
                    pattern: this.expr(c.pattern),
                    body: c.body.map((s: StmtNode) => this.stmt(s)),
                })),
                default: sk.defaultBlock ? sk.defaultBlock.map((s: StmtNode) => this.stmt(s)) : null,
            };
            case "ReturnStmt": return { kind: "return", value: sk.value ? this.expr(sk.value) : null };
            case "BreakStmt": return { kind: "break" };
            case "ContinueStmt": return { kind: "continue" };
            case "DeferStmt": return { kind: "defer", body: sk.body.map((s: StmtNode) => this.stmt(s)) };
            case "BlockStmt": return { kind: "block", body: sk.body.map((s: StmtNode) => this.stmt(s)) };
            case "ComptimeStmt": return { kind: "comptime_block", body: sk.body.map((s: StmtNode) => this.stmt(s)) };
            case "AssignmentStmt": return {
                kind: "assignment", target: this.expr(sk.target),
                op: sk.op, value: this.expr(sk.value),
            };
        }
    }

    private expr(expr: ExprNode): any {
        const ek = expr.exprKind as any;
        switch (ek.kind) {
            case "IntegerLit": return { kind: "int", value: ek.value, radix: ek.radix };
            case "FloatLit": return { kind: "float", value: ek.value };
            case "StringLit": return { kind: "string", value: ek.value };
            case "BoolLit": return { kind: "bool", value: ek.value };
            case "NullLit": return { kind: "null" };
            case "IdentExpr": return { kind: "ident", name: ek.name };
            case "BinaryExpr": return { kind: "binary", op: ek.op, left: this.expr(ek.left), right: this.expr(ek.right) };
            case "UnaryExpr": return { kind: "unary", op: ek.op, operand: this.expr(ek.operand) };
            case "AssignExpr": return { kind: "assign", op: ek.op, target: this.expr(ek.target), value: this.expr(ek.value) };
            case "CallExpr": return { kind: "call", callee: this.expr(ek.callee), args: ek.args.map((a: ExprNode) => this.expr(a)) };
            case "MemberExpr": return { kind: "member", object: this.expr(ek.object), member: ek.member };
            case "IndexExpr": return { kind: "index", object: this.expr(ek.object), index: this.expr(ek.index) };
            case "ArrayLit": return { kind: "array_lit", elements: ek.elements.map((e: ExprNode) => this.expr(e)) };
            case "MapLit": return {
                kind: "map_lit",
                entries: ek.entries.map((e: any) => ({ key: this.expr(e.key), value: this.expr(e.value) })),
            };
            case "StructLit": return {
                kind: "struct_lit", typeName: ek.typeName,
                fields: ek.fields.map((f: any) => ({ name: f.name, value: this.expr(f.value) })),
            };
            case "CastExpr": return { kind: "cast", expr: this.expr(ek.expr), targetType: this.type(ek.targetType) };
            case "RangeExpr": return { kind: "range", start: this.expr(ek.start), end: this.expr(ek.end) };
            case "ParenExpr": return { kind: "paren", inner: this.expr(ek.inner) };
            case "ComptimeExpr": return { kind: "comptime", expr: this.expr(ek.expr) };
            case "TypeInfoExpr": return { kind: "type_info", targetType: this.type(ek.targetType) };
            case "FlagSetExpr": return {
                kind: "flag_set_call", flagExpr: this.expr(ek.flagExpr),
                fieldName: ek.fieldName, value: this.expr(ek.value),
            };
        }
    }
}

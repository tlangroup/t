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

import {
    CompilationUnit, DeclNode, ExprNode, StmtNode, TypeNode,
    AnnotationNode, AnnotationArg,
    walkDecl, walkExpr, walkStmt,
} from "../ast/nodes.js";
import { TypeInfoProvider } from "../comptime/type_info.js";
import { DeriveProcessor } from "../annotations/derive.js";
import { FlagResolver, ResolvedFlagDecl } from "../flag/bitfield.js";
import { AnnotationRegistry } from "../annotations/registry.js";

// ─── AST JSON Serializer ─────────────────────────────────────────

export class AstJsonExporter {
    private typeInfoProvider: TypeInfoProvider | null;
    private flagResolver: FlagResolver;
    private deriveProcessor: DeriveProcessor;

    constructor(
        flagResolver: FlagResolver,
        typeInfoProvider: TypeInfoProvider | null = null,
    ) {
        this.flagResolver = flagResolver;
        this.typeInfoProvider = typeInfoProvider;
        this.deriveProcessor = new DeriveProcessor();
    }

    /**
     * Export a compilation unit as JSON (spec 8.3).
     */
    export(unit: CompilationUnit): string {
        const json = {
            format: "t-ast-json",
            version: "0.1.0",
            file: unit.file,
            module: unit.moduleName,
            declarations: unit.declarations.map((d) => this.serializeDecl(d)),
            typeInfo: this.typeInfoProvider
                ? unit.declarations
                    .filter((d) => {
                        const dk = d.declKind;
                        return dk.kind === "StructDecl" || dk.kind === "EnumDecl" ||
                               dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl" ||
                               dk.kind === "UnionDecl";
                    })
                    .map((d) => this.typeInfoProvider!.getTypeInfo((d.declKind as any).name))
                    .filter((info) => info !== null)
                : [],
        };
        return JSON.stringify(json, null, 2);
    }

    private serializeDecl(decl: DeclNode): any {
        const dk = decl.declKind;
        const base = {
            kind: dk.kind,
            name: (dk as any).name ?? null,
            annotations: decl.annotations.map((a) => this.serializeAnnotation(a)),
        };

        switch (dk.kind) {
            case "StructDecl":
                return {
                    ...base,
                    memoryLayout: dk.memoryLayout,
                    isBitpack: dk.isBitpack,
                    bitpackType: dk.bitpackType,
                    fields: dk.fields.map((f) => ({
                        name: f.name,
                        type: f.typeNode ? this.serializeType(f.typeNode) : null,
                        bitWidth: f.bitWidth,
                        annotations: f.annotations.map((a) => this.serializeAnnotation(a)),
                    })),
                    deriveResults: this.deriveProcessor.process(decl, null).methods,
                };
            case "EnumDecl":
                return {
                    ...base,
                    underlyingType: dk.underlyingType,
                    variants: dk.variants.map((v) => ({
                        name: v.name,
                        value: v.value ? this.serializeExpr(v.value) : null,
                        annotations: v.annotations.map((a) => this.serializeAnnotation(a)),
                    })),
                };
            case "FlagDecl":
                return {
                    ...base,
                    underlyingType: dk.underlyingType,
                    slots: dk.slots.map((s) => ({
                        name: s.name,
                        bitWidth: s.bitWidth,
                        offset: s.offset,
                        annotations: s.annotations.map((a) => this.serializeAnnotation(a)),
                    })),
                    resolvedLayout: this.serializeFlagLayout(decl),
                };
            case "FlagSetDecl":
                return {
                    ...base,
                    slots: dk.slots.map((s) => ({
                        name: s.name,
                        bitWidth: s.bitWidth,
                        offset: s.offset,
                        annotations: s.annotations.map((a) => this.serializeAnnotation(a)),
                    })),
                    resolvedLayout: this.serializeFlagLayout(decl),
                };
            case "UnionDecl":
                return {
                    ...base,
                    members: dk.members.map((m) => ({
                        name: m.name,
                        type: this.serializeType(m.typeNode),
                        annotations: m.annotations.map((a) => this.serializeAnnotation(a)),
                    })),
                };
            case "FuncDecl":
                return {
                    ...base,
                    params: dk.params.map((p) => ({
                        name: p.name,
                        type: this.serializeType(p.typeNode),
                        annotations: p.annotations.map((a) => this.serializeAnnotation(a)),
                    })),
                    returnType: this.serializeType(dk.returnType),
                    isExtern: dk.isExtern,
                    isComptime: dk.isComptime,
                    body: dk.body ? dk.body.map((s) => this.serializeStmt(s)) : null,
                };
            case "GlobalVarDecl":
                return {
                    ...base,
                    type: this.serializeType(dk.typeNode),
                    init: dk.init ? this.serializeExpr(dk.init) : null,
                    isComptime: dk.isComptime,
                };
            case "GlobalConstDecl":
                return {
                    ...base,
                    type: dk.typeNode ? this.serializeType(dk.typeNode) : null,
                    init: this.serializeExpr(dk.init),
                    isComptime: dk.isComptime,
                };
            case "ImportDecl":
                return { ...base, path: dk.path, alias: dk.alias };
            case "TypeAliasDecl":
                return { ...base, aliasedType: this.serializeType(dk.aliasedType) };
        }
    }

    private serializeAnnotation(ann: AnnotationNode): any {
        return {
            name: ann.name,
            args: ann.args.map((a) => this.serializeAnnotationArg(a)),
        };
    }

    private serializeAnnotationArg(arg: AnnotationArg): any {
        switch (arg.kind) {
            case "StringArg": return { kind: "string", value: arg.value };
            case "IdentArg": return { kind: "ident", value: arg.value };
            case "NumberArg": return { kind: "number", value: arg.value };
            case "ListArg": return { kind: "list", values: arg.values.map((v) => this.serializeAnnotationArg(v)) };
        }
    }

    private serializeType(type: TypeNode): any {
        const inner = type.inner;
        switch (inner.kind) {
            case "ScalarType": return { kind: "scalar", name: inner.name };
            case "ArrayType": return { kind: "array", elem: this.serializeType(inner.elem), length: this.serializeExpr(inner.length) };
            case "SliceType": return { kind: "slice", elem: this.serializeType(inner.elem) };
            case "MapType": return { kind: "map", key: this.serializeType(inner.key), value: this.serializeType(inner.value) };
            case "NamedType": return { kind: "named", name: inner.name };
            case "VariantType": return { kind: "variant" };
            case "FlagType": return { kind: "flag", underlying: inner.underlying };
            case "FlagSetType": return { kind: "flag_set" };
            case "PointerType": return { kind: "pointer", elem: this.serializeType(inner.elem) };
            case "OptionalType": return { kind: "optional", elem: this.serializeType(inner.elem) };
        }
    }

    private serializeStmt(stmt: StmtNode): any {
        const sk = stmt.stmtKind;
        switch (sk.kind) {
            case "ExprStmt": return { kind: "expr", expr: this.serializeExpr(sk.expr) };
            case "VarDecl": return {
                kind: "var_decl", name: sk.name, isConst: sk.isConst,
                type: sk.typeNode ? this.serializeType(sk.typeNode) : null,
                init: sk.init ? this.serializeExpr(sk.init) : null,
            };
            case "IfStmt": return {
                kind: "if", condition: this.serializeExpr(sk.condition),
                then: sk.thenBlock.map((s) => this.serializeStmt(s)),
                else: sk.elseBlock ? sk.elseBlock.map((s) => this.serializeStmt(s)) : null,
            };
            case "ForStmt": return {
                kind: "for",
                init: sk.init ? this.serializeStmt(sk.init) : null,
                condition: sk.condition ? this.serializeExpr(sk.condition) : null,
                update: sk.update ? this.serializeExpr(sk.update) : null,
                body: sk.body.map((s) => this.serializeStmt(s)),
            };
            case "ForEachStmt": return {
                kind: "for_each", varName: sk.varName,
                iterable: this.serializeExpr(sk.iterable),
                body: sk.body.map((s) => this.serializeStmt(s)),
            };
            case "WhileStmt": return {
                kind: "while", condition: this.serializeExpr(sk.condition),
                body: sk.body.map((s) => this.serializeStmt(s)),
            };
            case "SwitchStmt": return {
                kind: "switch", expr: this.serializeExpr(sk.expr),
                cases: sk.cases.map((c) => ({
                    pattern: this.serializeExpr(c.pattern),
                    body: c.body.map((s) => this.serializeStmt(s)),
                })),
                default: sk.defaultBlock ? sk.defaultBlock.map((s) => this.serializeStmt(s)) : null,
            };
            case "ReturnStmt": return { kind: "return", value: sk.value ? this.serializeExpr(sk.value) : null };
            case "BreakStmt": return { kind: "break" };
            case "ContinueStmt": return { kind: "continue" };
            case "DeferStmt": return { kind: "defer", body: sk.body.map((s) => this.serializeStmt(s)) };
            case "BlockStmt": return { kind: "block", body: sk.body.map((s) => this.serializeStmt(s)) };
            case "ComptimeStmt": return { kind: "comptime_block", body: sk.body.map((s) => this.serializeStmt(s)) };
            case "AssignmentStmt": return {
                kind: "assignment", target: this.serializeExpr(sk.target),
                op: sk.op, value: this.serializeExpr(sk.value),
            };
        }
    }

    private serializeExpr(expr: ExprNode): any {
        const ek = expr.exprKind;
        switch (ek.kind) {
            case "IntegerLit": return { kind: "int", value: ek.value, radix: ek.radix };
            case "FloatLit": return { kind: "float", value: ek.value };
            case "StringLit": return { kind: "string", value: ek.value };
            case "BoolLit": return { kind: "bool", value: ek.value };
            case "NullLit": return { kind: "null" };
            case "IdentExpr": return { kind: "ident", name: ek.name };
            case "BinaryExpr": return {
                kind: "binary", op: ek.op,
                left: this.serializeExpr(ek.left), right: this.serializeExpr(ek.right),
            };
            case "UnaryExpr": return { kind: "unary", op: ek.op, operand: this.serializeExpr(ek.operand) };
            case "AssignExpr": return {
                kind: "assign", op: ek.op,
                target: this.serializeExpr(ek.target), value: this.serializeExpr(ek.value),
            };
            case "CallExpr": return {
                kind: "call", callee: this.serializeExpr(ek.callee),
                args: ek.args.map((a) => this.serializeExpr(a)),
            };
            case "MemberExpr": return {
                kind: "member", object: this.serializeExpr(ek.object), member: ek.member,
            };
            case "IndexExpr": return {
                kind: "index", object: this.serializeExpr(ek.object), index: this.serializeExpr(ek.index),
            };
            case "ArrayLit": return { kind: "array_lit", elements: ek.elements.map((e) => this.serializeExpr(e)) };
            case "MapLit": return {
                kind: "map_lit",
                entries: ek.entries.map((e) => ({ key: this.serializeExpr(e.key), value: this.serializeExpr(e.value) })),
            };
            case "StructLit": return {
                kind: "struct_lit", typeName: ek.typeName,
                fields: ek.fields.map((f) => ({ name: f.name, value: this.serializeExpr(f.value) })),
            };
            case "CastExpr": return {
                kind: "cast", expr: this.serializeExpr(ek.expr), targetType: this.serializeType(ek.targetType),
            };
            case "RangeExpr": return {
                kind: "range", start: this.serializeExpr(ek.start), end: this.serializeExpr(ek.end),
            };
            case "ParenExpr": return { kind: "paren", inner: this.serializeExpr(ek.inner) };
            case "ComptimeExpr": return { kind: "comptime", expr: this.serializeExpr(ek.expr) };
            case "TypeInfoExpr": return { kind: "type_info", targetType: this.serializeType(ek.targetType) };
            case "FlagSetExpr": return {
                kind: "flag_set_call",
                flagExpr: this.serializeExpr(ek.flagExpr),
                fieldName: ek.fieldName,
                value: this.serializeExpr(ek.value),
            };
        }
    }

    private serializeFlagLayout(decl: DeclNode): any {
        const resolved = this.flagResolver.resolve(decl);
        if (!resolved) return null;
        return {
            name: resolved.name,
            underlyingType: resolved.underlyingType,
            totalBits: resolved.totalBits,
            isFlagSet: resolved.isFlagSet,
            slots: resolved.slots.map((s) => ({
                name: s.name,
                startBit: s.startBit,
                bitLength: s.bitLength,
                endBit: s.endBit,
                minValue: s.minValue,
                maxValue: s.maxValue,
                isSingleBit: s.isSingleBit,
                annotations: s.annotations,
            })),
        };
    }
}

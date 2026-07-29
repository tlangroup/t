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
import { DeriveProcessor } from "../annotations/derive.js";
export class CEmitter {
    flagResolver;
    deriveProcessor;
    resolvedFlags = new Map();
    headerLines = [];
    sourceLines = [];
    constructor(flagResolver) {
        this.flagResolver = flagResolver;
        this.deriveProcessor = new DeriveProcessor();
    }
    emit(unit) {
        this.headerLines = [];
        this.sourceLines = [];
        // Header guard
        const guardName = `TC_${unit.moduleName.toUpperCase()}_H`;
        this.headerLines.push(`#ifndef ${guardName}`);
        this.headerLines.push(`#define ${guardName}`);
        this.headerLines.push("");
        this.headerLines.push("#include <stdint.h>");
        this.headerLines.push("#include <stdbool.h>");
        this.headerLines.push("#include <stddef.h>");
        this.headerLines.push("");
        // Source includes
        this.sourceLines.push(`#include "${unit.moduleName}.h"`);
        this.sourceLines.push("#include <stdio.h>");
        this.sourceLines.push("#include <stdlib.h>");
        this.sourceLines.push("#include <string.h>");
        this.sourceLines.push("");
        // First pass: resolve flags, register types
        for (const decl of unit.declarations) {
            const dk = decl.declKind;
            if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
                const resolved = this.flagResolver.resolve(decl);
                if (resolved)
                    this.resolvedFlags.set(dk.name, resolved);
            }
        }
        // Second pass: emit declarations
        for (const decl of unit.declarations) {
            this.emitDecl(decl);
        }
        // Emit flag operation macros
        this.emitFlagMacros();
        this.headerLines.push("");
        this.headerLines.push(`#endif // ${guardName}`);
        return {
            header: this.headerLines.join("\n"),
            source: this.sourceLines.join("\n"),
        };
    }
    emitDecl(decl) {
        const dk = decl.declKind;
        switch (dk.kind) {
            case "StructDecl":
                this.emitStructDecl(dk, decl);
                break;
            case "EnumDecl":
                this.emitEnumDecl(dk);
                break;
            case "FlagDecl":
                this.emitFlagDecl(dk);
                break;
            case "FlagSetDecl":
                this.emitFlagSetDecl(dk);
                break;
            case "UnionDecl":
                this.emitUnionDecl(dk);
                break;
            case "FuncDecl":
                this.emitFuncDecl(dk, decl);
                break;
            case "GlobalVarDecl":
                this.emitGlobalVar(dk);
                break;
            case "GlobalConstDecl":
                this.emitGlobalConst(dk);
                break;
            case "ImportDecl":
                this.headerLines.push(`#include "${dk.path}"`);
                break;
            case "TypeAliasDecl":
                this.headerLines.push(`typedef ${this.emitType(dk.aliasedType)} ${dk.name};`);
                break;
        }
    }
    // ── Struct ───────────────────────────────────────────────────
    emitStructDecl(dk, decl) {
        const attrs = this.emitAttributes(decl.annotations);
        if (dk.isBitpack && dk.bitpackType) {
            // Bitpack struct → C bitfield
            this.headerLines.push(`// @bitpack(${dk.bitpackType}) struct`);
            if (attrs)
                this.headerLines.push(attrs);
            this.headerLines.push(`typedef struct ${dk.name} {`);
            for (const field of dk.fields) {
                this.headerLines.push(`    ${this.scalarToC(dk.bitpackType)} ${field.name} : ${field.bitWidth};`);
            }
            this.headerLines.push(`} ${dk.name};`);
        }
        else {
            const layoutAttr = dk.memoryLayout === "soa" ? " // #soa layout" : "";
            if (attrs)
                this.headerLines.push(attrs);
            this.headerLines.push(`typedef struct ${dk.name} {${layoutAttr}`);
            for (const field of dk.fields) {
                if (field.bitWidth === null) {
                    const fieldAttrs = this.emitAttributes(field.annotations);
                    if (fieldAttrs)
                        this.headerLines.push(`    ${fieldAttrs}`);
                    this.headerLines.push(`    ${this.emitType(field.typeNode)} ${field.name};`);
                }
            }
            this.headerLines.push(`} ${dk.name};`);
        }
        // Emit derived methods
        const deriveResult = this.deriveProcessor.process(decl, null);
        for (const method of deriveResult.methods) {
            this.sourceLines.push(method.generatedCode);
            this.sourceLines.push("");
        }
    }
    // ── Enum ─────────────────────────────────────────────────────
    emitEnumDecl(dk) {
        this.headerLines.push(`typedef ${this.scalarToC(dk.underlyingType)} ${dk.name};`);
        this.headerLines.push("");
        let autoValue = 0;
        for (const variant of dk.variants) {
            if (variant.value) {
                const val = this.emitExpr(variant.value);
                this.headerLines.push(`#define ${dk.name}_${variant.name} ${val}`);
                if (variant.value.exprKind.kind === "IntegerLit") {
                    autoValue = parseInt(variant.value.exprKind.value, variant.value.exprKind.radix) + 1;
                }
            }
            else {
                this.headerLines.push(`#define ${dk.name}_${variant.name} ${autoValue}`);
                autoValue++;
            }
        }
    }
    // ── Flag ─────────────────────────────────────────────────────
    emitFlagDecl(dk) {
        this.headerLines.push(`// flag[${dk.underlyingType}] ${dk.name}`);
        this.headerLines.push(`typedef ${this.scalarToC(dk.underlyingType)} ${dk.name};`);
        this.headerLines.push("");
        const resolved = this.resolvedFlags.get(dk.name);
        if (resolved) {
            for (const slot of resolved.slots) {
                if (slot.isSingleBit) {
                    this.headerLines.push(`#define ${dk.name}_${slot.name} (1u << ${slot.startBit})`);
                }
                else {
                    this.headerLines.push(`// ${slot.name}: bits ${slot.startBit}-${slot.endBit - 1} (${slot.bitLength} bits, max=${slot.maxValue})`);
                    this.headerLines.push(`#define ${dk.name}_${slot.name}_SHIFT ${slot.startBit}`);
                    this.headerLines.push(`#define ${dk.name}_${slot.name}_MASK (((1u << ${slot.bitLength}) - 1) << ${slot.startBit})`);
                }
            }
        }
    }
    // ── Flag Set ─────────────────────────────────────────────────
    emitFlagSetDecl(dk) {
        this.headerLines.push(`// flag_set ${dk.name} (dynamic length bitfield)`);
        this.headerLines.push(`typedef struct ${dk.name} {`);
        this.headerLines.push(`    uint8_t* data;`);
        this.headerLines.push(`    size_t bit_count;`);
        this.headerLines.push(`    size_t byte_count;`);
        this.headerLines.push(`} ${dk.name};`);
        this.headerLines.push("");
        const resolved = this.resolvedFlags.get(dk.name);
        if (resolved) {
            for (const slot of resolved.slots) {
                this.headerLines.push(`// ${slot.name}: bits ${slot.startBit}-${slot.endBit - 1} (${slot.bitLength} bits)`);
                this.headerLines.push(`#define ${dk.name}_${slot.name}_SHIFT ${slot.startBit}`);
                this.headerLines.push(`#define ${dk.name}_${slot.name}_MASK (((1u << ${slot.bitLength}) - 1) << ${slot.startBit})`);
            }
        }
    }
    // ── Union ────────────────────────────────────────────────────
    emitUnionDecl(dk) {
        this.headerLines.push(`typedef union ${dk.name} {`);
        for (const member of dk.members) {
            this.headerLines.push(`    ${this.emitType(member.typeNode)} ${member.name};`);
        }
        this.headerLines.push(`} ${dk.name};`);
    }
    // ── Function ─────────────────────────────────────────────────
    emitFuncDecl(dk, decl) {
        const attrs = this.emitAttributes(decl.annotations);
        const params = dk.params.map((p) => `${this.emitType(p.typeNode)} ${p.name}`);
        const paramStr = params.length > 0 ? params.join(", ") : "void";
        const retType = this.emitType(dk.returnType);
        if (dk.isExtern) {
            if (attrs)
                this.headerLines.push(attrs);
            this.headerLines.push(`${retType} ${dk.name}(${paramStr});`);
        }
        else {
            // Declaration in header
            if (attrs)
                this.headerLines.push(attrs);
            this.headerLines.push(`${retType} ${dk.name}(${paramStr});`);
            // Definition in source
            this.sourceLines.push(`${retType} ${dk.name}(${paramStr}) {`);
            if (dk.body) {
                for (const stmt of dk.body) {
                    this.emitStmt(stmt, this.sourceLines, 1);
                }
            }
            this.sourceLines.push(`}`);
            this.sourceLines.push("");
        }
    }
    // ── Global var / const ───────────────────────────────────────
    emitGlobalVar(dk) {
        this.headerLines.push(`extern ${this.emitType(dk.typeNode)} ${dk.name};`);
        const init = dk.init ? ` = ${this.emitExpr(dk.init)}` : "";
        this.sourceLines.push(`${this.emitType(dk.typeNode)} ${dk.name}${init};`);
    }
    emitGlobalConst(dk) {
        const type = dk.typeNode ? this.emitType(dk.typeNode) : "const int";
        this.headerLines.push(`#define ${dk.name} (${this.emitExpr(dk.init)})`);
    }
    // ── Statements ───────────────────────────────────────────────
    emitStmt(stmt, lines, indent) {
        const pad = "    ".repeat(indent);
        const sk = stmt.stmtKind;
        switch (sk.kind) {
            case "ExprStmt":
                lines.push(`${pad}${this.emitExpr(sk.expr)};`);
                break;
            case "VarDecl": {
                const type = sk.typeNode ? this.emitType(sk.typeNode) : "auto";
                const init = sk.init ? ` = ${this.emitExpr(sk.init)}` : "";
                lines.push(`${pad}${type} ${sk.name}${init};`);
                break;
            }
            case "IfStmt":
                lines.push(`${pad}if (${this.emitExpr(sk.condition)}) {`);
                for (const s of sk.thenBlock)
                    this.emitStmt(s, lines, indent + 1);
                if (sk.elseBlock) {
                    lines.push(`${pad}} else {`);
                    for (const s of sk.elseBlock)
                        this.emitStmt(s, lines, indent + 1);
                }
                lines.push(`${pad}}`);
                break;
            case "WhileStmt":
                lines.push(`${pad}while (${this.emitExpr(sk.condition)}) {`);
                for (const s of sk.body)
                    this.emitStmt(s, lines, indent + 1);
                lines.push(`${pad}}`);
                break;
            case "ForStmt":
                lines.push(`${pad}for (`);
                if (sk.init) {
                    if (sk.init.stmtKind.kind === "VarDecl") {
                        const vd = sk.init.stmtKind;
                        const type = vd.typeNode ? this.emitType(vd.typeNode) : "int";
                        const init = vd.init ? ` = ${this.emitExpr(vd.init)}` : "";
                        lines[lines.length - 1] += `${type} ${vd.name}${init}`;
                    }
                    else if (sk.init.stmtKind.kind === "ExprStmt") {
                        lines[lines.length - 1] += this.emitExpr(sk.init.stmtKind.expr);
                    }
                }
                lines[lines.length - 1] += `; ${sk.condition ? this.emitExpr(sk.condition) : ""}; ${sk.update ? this.emitExpr(sk.update) : ""}) {`;
                for (const s of sk.body)
                    this.emitStmt(s, lines, indent + 1);
                lines.push(`${pad}}`);
                break;
            case "ReturnStmt":
                lines.push(`${pad}return${sk.value ? " " + this.emitExpr(sk.value) : ""};`);
                break;
            case "BreakStmt":
                lines.push(`${pad}break;`);
                break;
            case "ContinueStmt":
                lines.push(`${pad}continue;`);
                break;
            case "AssignmentStmt":
                lines.push(`${pad}${this.emitExpr(sk.target)} ${sk.op} ${this.emitExpr(sk.value)};`);
                break;
            case "BlockStmt":
                lines.push(`${pad}{`);
                for (const s of sk.body)
                    this.emitStmt(s, lines, indent + 1);
                lines.push(`${pad}}`);
                break;
            case "SwitchStmt":
                lines.push(`${pad}switch (${this.emitExpr(sk.expr)}) {`);
                for (const c of sk.cases) {
                    lines.push(`${pad}case ${this.emitExpr(c.pattern)}:`);
                    for (const s of c.body)
                        this.emitStmt(s, lines, indent + 2);
                    lines.push(`${pad}    break;`);
                }
                if (sk.defaultBlock) {
                    lines.push(`${pad}default:`);
                    for (const s of sk.defaultBlock)
                        this.emitStmt(s, lines, indent + 2);
                    lines.push(`${pad}    break;`);
                }
                lines.push(`${pad}}`);
                break;
        }
    }
    // ── Expressions ──────────────────────────────────────────────
    emitExpr(expr) {
        const ek = expr.exprKind;
        switch (ek.kind) {
            case "IntegerLit": {
                if (ek.radix === 16)
                    return ek.value;
                if (ek.radix === 2)
                    return `0b${ek.value.replace(/^0b/i, "")}`;
                return ek.value;
            }
            case "FloatLit": return ek.value;
            case "StringLit": return `"${ek.value}"`;
            case "BoolLit": return ek.value ? "true" : "false";
            case "NullLit": return "NULL";
            case "IdentExpr": return ek.name;
            case "BinaryExpr": return `(${this.emitExpr(ek.left)} ${ek.op} ${this.emitExpr(ek.right)})`;
            case "UnaryExpr": return `(${ek.op}${this.emitExpr(ek.operand)})`;
            case "AssignExpr": return `(${this.emitExpr(ek.target)} ${ek.op} ${this.emitExpr(ek.value)})`;
            case "CallExpr": {
                const args = ek.args.map((a) => this.emitExpr(a)).join(", ");
                return `${this.emitExpr(ek.callee)}(${args})`;
            }
            case "MemberExpr": return `${this.emitExpr(ek.object)}.${ek.member}`;
            case "IndexExpr": return `${this.emitExpr(ek.object)}[${this.emitExpr(ek.index)}]`;
            case "ArrayLit": {
                const elems = ek.elements.map((e) => this.emitExpr(e)).join(", ");
                return `{${elems}}`;
            }
            case "StructLit": {
                const fields = ek.fields.map((f) => `.${f.name} = ${this.emitExpr(f.value)}`).join(", ");
                return `(${ek.typeName}){${fields}}`;
            }
            case "CastExpr": return `((${this.emitType(ek.targetType)})${this.emitExpr(ek.expr)})`;
            case "ParenExpr": return `(${this.emitExpr(ek.inner)})`;
            default: return "/* unsupported expr */";
        }
    }
    // ── Types ────────────────────────────────────────────────────
    emitType(type) {
        const inner = type.inner;
        switch (inner.kind) {
            case "ScalarType": {
                const map = {
                    "u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t", "u64": "uint64_t",
                    "i8": "int8_t", "i16": "int16_t", "i32": "int32_t", "i64": "int64_t",
                    "f16": "_Float16", "f32": "float", "f64": "double",
                    "bool": "bool", "void": "void",
                    "string": "const char*",
                    "StringBuilder": "char*",
                };
                return map[inner.name] ?? inner.name;
            }
            case "NamedType": return inner.name;
            case "ArrayType": return `${this.emitType(inner.elem)}*`; // simplified
            case "SliceType": return `${this.emitType(inner.elem)}*`; // simplified
            case "MapType": return "void*"; // maps need runtime support
            case "PointerType": return `${this.emitType(inner.elem)}*`;
            case "OptionalType": return `${this.emitType(inner.elem)}`; // simplified
            case "FlagType": return inner.underlying;
            case "FlagSetType": return "void*";
            case "VariantType": return "void*";
        }
    }
    // ── Scalar type mapping helper ───────────────────────────────
    scalarToC(name) {
        const map = {
            "u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t", "u64": "uint64_t",
            "i8": "int8_t", "i16": "int16_t", "i32": "int32_t", "i64": "int64_t",
            "f16": "_Float16", "f32": "float", "f64": "double",
            "bool": "bool", "void": "void",
        };
        return map[name] ?? name;
    }
    // ── Attributes ───────────────────────────────────────────────
    emitAttributes(annotations) {
        const attrs = [];
        for (const ann of annotations) {
            switch (ann.name) {
                case "inline":
                    attrs.push("__attribute__((always_inline))");
                    break;
                case "no_inline":
                    attrs.push("__attribute__((noinline))");
                    break;
                case "deprecated":
                    if (ann.args.length > 0 && ann.args[0].kind === "StringArg") {
                        attrs.push(`__attribute__((deprecated("${ann.args[0].value}")))`);
                    }
                    else {
                        attrs.push("__attribute__((deprecated))");
                    }
                    break;
                case "must_use":
                    attrs.push("__attribute__((warn_unused_result))");
                    break;
                case "export_symbol":
                    if (ann.args.length > 0 && ann.args[0].kind === "StringArg") {
                        attrs.push(`__attribute__((visibility("default")))`);
                    }
                    break;
            }
        }
        return attrs.length > 0 ? attrs.join(" ") : "";
    }
    // ── Flag operation macros ────────────────────────────────────
    emitFlagMacros() {
        this.headerLines.push("");
        this.headerLines.push("// ── Flag operations (spec 6.4) ──");
        this.headerLines.push("// 1-bit: use | & ^ operators, check with (mask & FLAG) != 0");
        this.headerLines.push("// multi-bit: use flag_set_val/flag_get_val macros");
        this.headerLines.push("");
        this.headerLines.push("#define flag_set_val(flags, shift, mask, val) do { (flags) = ((flags) & ~(mask)) | (((val) << (shift)) & (mask)); } while(0)");
        this.headerLines.push("#define flag_get_val(flags, shift, mask) (((flags) & (mask)) >> (shift))");
        this.headerLines.push("");
    }
}
//# sourceMappingURL=emitter.js.map
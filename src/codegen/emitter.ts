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

import {
    CompilationUnit, DeclNode, StmtNode, ExprNode, TypeNode,
} from "../ast/nodes.js";
import { DeriveProcessor } from "../annotations/derive.js";
import {
    FlagResolver, ResolvedFlagDecl,
} from "../flag/bitfield.js";
import { AnnotationRegistry, AnnotationCategory } from "../annotations/registry.js";
import { getBitWidth, isIntType } from "../types/types.js";

interface TypeDesc {
    cat: "string" | "slice" | "map" | "named" | "scalar" | "unknown" | "void";
    elem?: TypeDesc;
    key?: TypeDesc;
    value?: TypeDesc;
    name?: string;
}

export class CEmitter {
    private flagResolver: FlagResolver;
    private deriveProcessor: DeriveProcessor;
    private resolvedFlags: Map<string, ResolvedFlagDecl> = new Map();
    private headerLines: string[] = [];
    private sourceLines: string[] = [];
    // Static type descriptors, used to emit runtime-backed type operations
    // (string -> TStr, []T -> TSlice, map -> TMap*) without full inference.
    private typeMap: Map<string, TypeDesc> = new Map();
    // Per-function scopes: params + locals, so same-named vars in different
    // functions don't clobber each other (critical for large units).
    private fnScopes: Map<string, Map<string, TypeDesc>> = new Map();
    private currentScope: Map<string, TypeDesc> | null = null;
    private structFields: Map<string, Map<string, TypeDesc>> = new Map();
    // Name of the @main function (if present), used to emit C main()
    private mainFuncName: string | null = null;

    constructor(flagResolver: FlagResolver) {
        this.flagResolver = flagResolver;
        this.deriveProcessor = new DeriveProcessor();
    }

    emit(unit: CompilationUnit): { header: string; source: string } {
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
        this.headerLines.push("#include \"t_runtime.h\"");
        this.headerLines.push("");

        // Source includes
        this.sourceLines.push(`#include "${unit.moduleName}.h"`);
        this.sourceLines.push("#include <stdio.h>");
        this.sourceLines.push("#include <stdlib.h>");
        this.sourceLines.push("#include <string.h>");
        this.sourceLines.push("#include \"t_runtime.h\"");
        this.sourceLines.push("");

        // Build static type map (names -> descriptors) for runtime-backed types
        this.typeMap = new Map();
        this.fnScopes = new Map();
        this.currentScope = null;
        this.buildTypeMap(unit);

        // First pass: resolve flags, register types
        for (const decl of unit.declarations) {
            const dk = decl.declKind;
            if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
                const resolved = this.flagResolver.resolve(decl);
                if (resolved) this.resolvedFlags.set(dk.name, resolved);
            }
        }

        // Second pass: emit declarations
        for (const decl of unit.declarations) {
            this.emitDecl(decl);
        }

        // Emit C main() that bootstraps the runtime and calls the @main function
        if (this.mainFuncName) {
            this.sourceLines.push("");
            this.sourceLines.push("int main(int argc, char** argv) {");
            this.sourceLines.push("    t_runtime_init(argc, argv);");
            this.sourceLines.push("    t_runtime_set_arena(t_arena_new());");
            this.sourceLines.push(`    int32_t _exit_code = ${this.mainFuncName}();`);
            this.sourceLines.push("    t_runtime_done();");
            this.sourceLines.push("    return (int)_exit_code;");
            this.sourceLines.push("}");
            this.sourceLines.push("");
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

    private emitDecl(decl: DeclNode): void {
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

    private emitStructDecl(dk: any, decl: DeclNode): void {
        const attrs = this.emitAttributes(decl.annotations);

        if (dk.isBitpack && dk.bitpackType) {
            // Bitpack struct → C bitfield
            this.headerLines.push(`// @bitpack(${dk.bitpackType}) struct`);
            if (attrs) this.headerLines.push(attrs);
            this.headerLines.push(`typedef struct ${dk.name} {`);
            for (const field of dk.fields) {
                this.headerLines.push(`    ${this.scalarToC(dk.bitpackType)} ${field.name} : ${field.bitWidth};`);
            }
            this.headerLines.push(`} ${dk.name};`);
        } else {
            const layoutAttr = dk.memoryLayout === "soa" ? " // #soa layout" : "";
            if (attrs) this.headerLines.push(attrs);
            this.headerLines.push(`typedef struct ${dk.name} {${layoutAttr}`);
            for (const field of dk.fields) {
                if (field.bitWidth === null) {
                    const fieldAttrs = this.emitAttributes(field.annotations);
                    if (fieldAttrs) this.headerLines.push(`    ${fieldAttrs}`);
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

    private emitEnumDecl(dk: any): void {
        this.headerLines.push(`typedef ${this.scalarToC(dk.underlyingType)} ${dk.name};`);
        this.headerLines.push("");
        let autoValue = 0;
        for (const variant of dk.variants) {
            if (variant.value) {
                const val = this.emitExpr(variant.value);
                this.headerLines.push(`#define ${dk.name}_${variant.name} ${val}`);
                if (variant.value.exprKind.kind === "IntegerLit") {
                    autoValue = parseInt((variant.value.exprKind as any).value, (variant.value.exprKind as any).radix) + 1;
                }
            } else {
                this.headerLines.push(`#define ${dk.name}_${variant.name} ${autoValue}`);
                autoValue++;
            }
        }
    }

    // ── Flag ─────────────────────────────────────────────────────

    private emitFlagDecl(dk: any): void {
        this.headerLines.push(`// flag[${dk.underlyingType}] ${dk.name}`);
        this.headerLines.push(`typedef ${this.scalarToC(dk.underlyingType)} ${dk.name};`);
        this.headerLines.push("");

        const resolved = this.resolvedFlags.get(dk.name);
        if (resolved) {
            for (const slot of resolved.slots) {
                if (slot.isSingleBit) {
                    this.headerLines.push(`#define ${dk.name}_${slot.name} (1u << ${slot.startBit})`);
                } else {
                    this.headerLines.push(`// ${slot.name}: bits ${slot.startBit}-${slot.endBit - 1} (${slot.bitLength} bits, max=${slot.maxValue})`);
                    this.headerLines.push(`#define ${dk.name}_${slot.name}_SHIFT ${slot.startBit}`);
                    this.headerLines.push(`#define ${dk.name}_${slot.name}_MASK (((1u << ${slot.bitLength}) - 1) << ${slot.startBit})`);
                }
            }
        }
    }

    // ── Flag Set ─────────────────────────────────────────────────

    private emitFlagSetDecl(dk: any): void {
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

    private emitUnionDecl(dk: any): void {
        this.headerLines.push(`typedef union ${dk.name} {`);
        for (const member of dk.members) {
            this.headerLines.push(`    ${this.emitType(member.typeNode)} ${member.name};`);
        }
        this.headerLines.push(`} ${dk.name};`);
    }

    // ── Function ─────────────────────────────────────────────────

    private emitFuncDecl(dk: any, decl: DeclNode): void {
        // Mangle the @main function name to avoid colliding with C main()
        let emitName = dk.name;
        if (decl.annotations.some((a: any) => a.name === "main")) {
            emitName = `t_entry_${dk.name}`;
            this.mainFuncName = emitName;
        }
        const attrs = this.emitAttributes(decl.annotations);
        const params = dk.params.map((p: any) => `${this.emitType(p.typeNode)} ${p.name}`);
        const paramStr = params.length > 0 ? params.join(", ") : "void";
        const retType = this.emitType(dk.returnType);

        if (dk.isExtern) {
            if (attrs) this.headerLines.push(attrs);
            this.headerLines.push(`${retType} ${emitName}(${paramStr});`);
        } else {
            // Declaration in header
            if (attrs) this.headerLines.push(attrs);
            this.headerLines.push(`${retType} ${emitName}(${paramStr});`);

            // Definition in source (activate this function's type scope)
            this.currentScope = this.fnScopes.get(dk.name) ?? null;
            this.sourceLines.push(`${retType} ${emitName}(${paramStr}) {`);
            if (dk.body) {
                for (const stmt of dk.body) {
                    this.emitStmt(stmt, this.sourceLines, 1);
                }
            }
            this.sourceLines.push(`}`);
            this.currentScope = null;
            this.sourceLines.push("");
        }
    }

    // ── Global var / const ───────────────────────────────────────

    private emitGlobalVar(dk: any): void {
        this.headerLines.push(`extern ${this.emitType(dk.typeNode)} ${dk.name};`);
        const init = dk.init ? ` = ${this.emitExpr(dk.init)}` : "";
        this.sourceLines.push(`${this.emitType(dk.typeNode)} ${dk.name}${init};`);
    }

    private emitGlobalConst(dk: any): void {
        const type = dk.typeNode ? this.emitType(dk.typeNode) : "const int";
        this.headerLines.push(`#define ${dk.name} (${this.emitExpr(dk.init)})`);
    }

    // ── Statements ───────────────────────────────────────────────

    private emitStmt(stmt: StmtNode, lines: string[], indent: number): void {
        const pad = "    ".repeat(indent);
        const sk = stmt.stmtKind;

        switch (sk.kind) {
            case "ExprStmt":
                lines.push(`${pad}${this.emitExpr(sk.expr)};`);
                break;
            case "VarDecl": {
                if (sk.typeNode) {
                    const td = this.resolveTypeDesc(sk.typeNode);
                    if (td.cat === "slice" && !sk.init) {
                        lines.push(`${pad}TSlice ${sk.name} = t_slice_new(sizeof(${this.descToC(td.elem!)}));`);
                        break;
                    }
                    if (td.cat === "string" && !sk.init) {
                        lines.push(`${pad}TStr ${sk.name} = {0};`);
                        break;
                    }
                    // 命名 struct 局部变量无初始化 → 零初始化（保证节点池确定性）
                    if (td.cat === "named" && !sk.init) {
                        const cty = this.descToC(td);
                        lines.push(cty.endsWith("*")
                            ? `${pad}${cty} ${sk.name} = NULL;`
                            : `${pad}${cty} ${sk.name} = {0};`);
                        break;
                    }
                }
                const type = sk.typeNode ? this.emitType(sk.typeNode) : "auto";
                const init = sk.init ? ` = ${this.emitExpr(sk.init)}` : "";
                lines.push(`${pad}${type} ${sk.name}${init};`);
                break;
            }
            case "ForEachStmt": {
                const iterDesc = this.exprTypeDesc((sk as any).iterable);
                const elemC = iterDesc.cat === "slice" && iterDesc.elem ? this.descToC(iterDesc.elem) : "void*";
                const iterExpr = this.emitExpr((sk as any).iterable);
                lines.push(`${pad}for (int64_t _fe_i = 0; _fe_i < t_slice_len(${iterExpr}); _fe_i = _fe_i + 1) {`);
                lines.push(`${pad}    ${elemC} ${(sk as any).varName} = *((${elemC}*)t_slice_at(${iterExpr}, _fe_i));`);
                for (const s of (sk as any).body) this.emitStmt(s, lines, indent + 2);
                lines.push(`${pad}}`);
                break;
            }
            case "IfStmt":
                lines.push(`${pad}if (${this.emitExpr(sk.condition)}) {`);
                for (const s of sk.thenBlock) this.emitStmt(s, lines, indent + 1);
                if (sk.elseBlock) {
                    lines.push(`${pad}} else {`);
                    for (const s of sk.elseBlock) this.emitStmt(s, lines, indent + 1);
                }
                lines.push(`${pad}}`);
                break;
            case "WhileStmt":
                lines.push(`${pad}while (${this.emitExpr(sk.condition)}) {`);
                for (const s of sk.body) this.emitStmt(s, lines, indent + 1);
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
                    } else if (sk.init.stmtKind.kind === "ExprStmt") {
                        lines[lines.length - 1] += this.emitExpr((sk.init.stmtKind as any).expr);
                    }
                }
                lines[lines.length - 1] += `; ${sk.condition ? this.emitExpr(sk.condition) : ""}; ${sk.update ? this.emitExpr(sk.update) : ""}) {`;
                for (const s of sk.body) this.emitStmt(s, lines, indent + 1);
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
                for (const s of sk.body) this.emitStmt(s, lines, indent + 1);
                lines.push(`${pad}}`);
                break;
            case "SwitchStmt":
                lines.push(`${pad}switch (${this.emitExpr(sk.expr)}) {`);
                for (const c of sk.cases) {
                    lines.push(`${pad}case ${this.emitExpr(c.pattern)}:`);
                    for (const s of c.body) this.emitStmt(s, lines, indent + 2);
                    lines.push(`${pad}    break;`);
                }
                if (sk.defaultBlock) {
                    lines.push(`${pad}default:`);
                    for (const s of sk.defaultBlock) this.emitStmt(s, lines, indent + 2);
                    lines.push(`${pad}    break;`);
                }
                lines.push(`${pad}}`);
                break;
        }
    }

    // ── Expressions ──────────────────────────────────────────────

    private emitExpr(expr: ExprNode): string {
        const ek = expr.exprKind;
        switch (ek.kind) {
            case "IntegerLit": {
                if (ek.radix === 16) return ek.value;
                if (ek.radix === 2) return `0b${ek.value.replace(/^0b/i, "")}`;
                return ek.value;
            }
            case "FloatLit": return ek.value;
            case "StringLit": return `TSTR_LIT("${CEmitter.escapeCString(ek.value)}")`;
            case "BoolLit": return ek.value ? "true" : "false";
            case "NullLit": return "NULL";
            case "IdentExpr": return ek.name;
            case "BinaryExpr": {
                const lt = this.exprTypeDesc(ek.left);
                const rt = this.exprTypeDesc(ek.right);
                if ((ek.op === "==" || ek.op === "!=") && (lt.cat === "string" || rt.cat === "string")) {
                    const cmp = `t_str_eq(${this.emitExpr(ek.left)}, ${this.emitExpr(ek.right)})`;
                    return ek.op === "==" ? cmp : `(!${cmp})`;
                }
                return `(${this.emitExpr(ek.left)} ${ek.op} ${this.emitExpr(ek.right)})`;
            }
            case "UnaryExpr": return `(${ek.op}${this.emitExpr(ek.operand)})`;
            case "AssignExpr": return `(${this.emitExpr(ek.target)} ${ek.op} ${this.emitExpr(ek.value)})`;
            case "CallExpr": {
                if (ek.callee.exprKind.kind === "IdentExpr") {
                    const n = (ek.callee.exprKind as any).name;
                    const a = ek.args.map((x) => this.emitExpr(x));
                    switch (n) {
                        case "str_len": return `t_str_len(${a[0]})`;
                        case "str_at": return `t_str_byte_at(${a[0]}, ${a[1]})`;
                        case "slice_len": return `t_slice_len(${a[0]})`;
                        case "append": {
                            // append_sized 允许零初始化的全局切片首次 append 时自动定型
                            return `t_slice_append_sized(&${a[0]}, &${a[1]}, (int64_t)sizeof(${a[1]}))`;
                        }
                        case "slice_set": return `t_slice_set(${a[0]}, ${a[1]}, &${a[2]})`;
                        case "file_read_all": return `t_file_read_all(t_cstr(${a[0]}))`;
                        case "path_resolve": return `t_path_resolve(t_cstr(${a[0]}))`;
                        case "file_write_all": return `t_file_write_all(t_cstr(${a[0]}), ${a[1]})`;
                        case "args": return `t_args()`;
                        case "exit": return `t_exit(${a[0]})`;
                        case "print": return `t_print(${a[0]})`;
                        case "eprint": return `t_eprint(${a[0]})`;
                        case "str_slice": return `t_str_slice(${a[0]}, ${a[1]}, ${a[2]})`;
                        case "sb_new": return `t_sb_new(t_arena_current())`;
                        case "sb_append_str": return `t_sb_append_str(${a[0]}, ${a[1]})`;
                        case "sb_append_char": return `t_sb_append_char(${a[0]}, ${a[1]})`;
                        case "sb_append_u64": return `t_sb_append_u64(${a[0]}, ${a[1]})`;
                        case "sb_append_i64": return `t_sb_append_i64(${a[0]}, ${a[1]})`;
                        case "sb_to_str": return `t_sb_to_str(${a[0]})`;
                        case "sb_clear": return `t_sb_clear(${a[0]})`;
                    }
                }
                const args = ek.args.map((a) => this.emitExpr(a)).join(", ");
                return `${this.emitExpr(ek.callee)}(${args})`;
            }
            case "MemberExpr": return `${this.emitExpr(ek.object)}.${ek.member}`;
            case "IndexExpr": {
                const od = this.exprTypeDesc(ek.object);
                const obj = this.emitExpr(ek.object);
                const idx = this.emitExpr(ek.index);
                if (od.cat === "string") return `t_str_byte_at(${obj}, ${idx})`;
                // 外层括号保证后接 .member 时优先级正确：(*(T*)p).f
                if (od.cat === "slice") return `(*(${this.descToC(od.elem!)}*)t_slice_at(${obj}, ${idx}))`;
                return `(${obj}[${idx}])`;
            }
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

    // ── Static type descriptors (for runtime-backed codegen) ─────

    /** Walk the unit and record variable/param/function-return type descriptors. */
    private buildTypeMap(unit: CompilationUnit): void {
        for (const decl of unit.declarations) {
            const dk = decl.declKind as any;
            switch (dk.kind) {
                case "StructDecl": {
                    // Record field type descriptors so MemberExpr can be typed
                    const fields = new Map<string, TypeDesc>();
                    for (const f of dk.fields ?? []) {
                        if (f.typeNode) fields.set(f.name, this.resolveTypeDesc(f.typeNode));
                    }
                    this.structFields.set(dk.name, fields);
                    break;
                }
                case "GlobalVarDecl":
                case "GlobalConstDecl":
                    if (dk.typeNode) this.typeMap.set(dk.name, this.resolveTypeDesc(dk.typeNode));
                    break;
                case "FuncDecl": {
                    // Return type registered under "name()" to avoid clashing with vars
                    if (dk.returnType) this.typeMap.set(`${dk.name}()`, this.resolveTypeDesc(dk.returnType));
                    // Params + locals go into a per-function scope
                    const scope = new Map<string, TypeDesc>();
                    this.fnScopes.set(dk.name, scope);
                    for (const p of dk.params ?? []) {
                        if (p.typeNode) scope.set(p.name, this.resolveTypeDesc(p.typeNode));
                    }
                    if (dk.body) {
                        this.currentScope = scope;
                        this.collectLocalTypes(dk.body);
                        this.currentScope = null;
                    }
                    break;
                }
            }
        }
    }

    /** Recursively collect VarDecl types inside statement bodies. */
    private collectLocalTypes(stmts: StmtNode[]): void {
        for (const stmt of stmts) {
            const sk = stmt.stmtKind as any;
            switch (sk.kind) {
                case "VarDecl":
                    if (sk.typeNode) (this.currentScope ?? this.typeMap).set(sk.name, this.resolveTypeDesc(sk.typeNode));
                    break;
                case "IfStmt":
                    this.collectLocalTypes(sk.thenBlock ?? []);
                    if (sk.elseBlock) this.collectLocalTypes(sk.elseBlock);
                    break;
                case "WhileStmt":
                case "BlockStmt":
                    this.collectLocalTypes(sk.body ?? []);
                    break;
                case "ForStmt":
                    if (sk.init) this.collectLocalTypes([sk.init]);
                    this.collectLocalTypes(sk.body ?? []);
                    break;
                case "ForEachStmt": {
                    // Element var type = elem type of the iterable (if known)
                    const it = this.exprTypeDesc(sk.iterable);
                    if (it.cat === "slice" && it.elem) (this.currentScope ?? this.typeMap).set(sk.varName, it.elem);
                    this.collectLocalTypes(sk.body ?? []);
                    break;
                }
                case "SwitchStmt":
                    for (const c of sk.cases ?? []) this.collectLocalTypes(c.body ?? []);
                    if (sk.defaultBlock) this.collectLocalTypes(sk.defaultBlock);
                    break;
            }
        }
    }

    /** TypeNode → TypeDesc. */
    private resolveTypeDesc(type: TypeNode | null | undefined): TypeDesc {
        if (!type) return { cat: "unknown" };
        const inner = type.inner as any;
        switch (inner.kind) {
            case "ScalarType":
                if (inner.name === "string") return { cat: "string" };
                if (inner.name === "void") return { cat: "void" };
                if (inner.name === "StringBuilder") return { cat: "named", name: "TSb*" };
                return { cat: "scalar", name: inner.name };
            case "SliceType":
                return { cat: "slice", elem: this.resolveTypeDesc(inner.elem) };
            case "MapType":
                return {
                    cat: "map",
                    key: this.resolveTypeDesc(inner.keyType ?? inner.key),
                    value: this.resolveTypeDesc(inner.valueType ?? inner.value),
                };
            case "NamedType":
                return { cat: "named", name: inner.name };
            default:
                return { cat: "unknown" };
        }
    }

    /** TypeDesc → C type string. */
    private descToC(desc: TypeDesc): string {
        switch (desc.cat) {
            case "string": return "TStr";
            case "slice": return "TSlice";
            case "map": return "TMap*";
            case "scalar": return this.scalarToC(desc.name ?? "i64");
            case "named": return desc.name ?? "void*";
            case "void": return "void";
            default: return "void*";
        }
    }

    /** Best-effort static type of an expression (no full inference). */
    private exprTypeDesc(expr: ExprNode): TypeDesc {
        const ek = expr.exprKind as any;
        switch (ek.kind) {
            case "StringLit": return { cat: "string" };
            case "IntegerLit": return { cat: "scalar", name: "i64" };
            case "FloatLit": return { cat: "scalar", name: "f64" };
            case "BoolLit": return { cat: "scalar", name: "bool" };
            case "IdentExpr":
                return this.currentScope?.get(ek.name) ?? this.typeMap.get(ek.name) ?? { cat: "unknown" };
            case "ParenExpr": return this.exprTypeDesc(ek.inner);
            case "CastExpr": return this.resolveTypeDesc(ek.targetType);
            case "IndexExpr": {
                const od = this.exprTypeDesc(ek.object);
                if (od.cat === "string") return { cat: "scalar", name: "u8" };
                if (od.cat === "slice") return od.elem ?? { cat: "unknown" };
                if (od.cat === "map") return od.value ?? { cat: "unknown" };
                return { cat: "unknown" };
            }
            case "CallExpr": {
                if (ek.callee.exprKind.kind === "IdentExpr") {
                    const n = (ek.callee.exprKind as any).name;
                    switch (n) {
                        case "file_read_all": return { cat: "string" };
                        case "path_resolve": return { cat: "string" };
                        case "str_len": case "slice_len": return { cat: "scalar", name: "u64" };
                        case "str_at": return { cat: "scalar", name: "u8" };
                        case "args": return { cat: "slice", elem: { cat: "string" } };
                        case "file_write_all": return { cat: "scalar", name: "bool" };
                        case "str_slice": case "sb_to_str": return { cat: "string" };
                        case "sb_new": return { cat: "named", name: "TSb*" };
                    }
                    return this.typeMap.get(`${n}()`) ?? { cat: "unknown" };
                }
                return { cat: "unknown" };
            }
            case "BinaryExpr": {
                // Comparison/logical → bool; arithmetic keeps left operand type
                if (["==", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(ek.op)) {
                    return { cat: "scalar", name: "bool" };
                }
                return this.exprTypeDesc(ek.left);
            }
            case "MemberExpr": {
                const od = this.exprTypeDesc(ek.object);
                if (od.cat === "named" && od.name) {
                    const fields = this.structFields.get(od.name);
                    if (fields) return fields.get(ek.member) ?? { cat: "unknown" };
                }
                return { cat: "unknown" };
            }
            default: return { cat: "unknown" };
        }
    }

    // ── Types ────────────────────────────────────────────────────

    private emitType(type: TypeNode): string {
        const inner = type.inner;
        switch (inner.kind) {
            case "ScalarType": {
                const map: Record<string, string> = {
                    "u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t", "u64": "uint64_t",
                    "i8": "int8_t", "i16": "int16_t", "i32": "int32_t", "i64": "int64_t",
                    "f16": "_Float16", "f32": "float", "f64": "double",
                    "bool": "bool", "void": "void",
                    "string": "TStr",
                    "StringBuilder": "TSb*",
                };
                return map[inner.name] ?? inner.name;
            }
            case "NamedType": return inner.name;
            case "ArrayType": return `${this.emitType(inner.elem)}*`; // simplified
            case "SliceType": return "TSlice";
            case "MapType": return "TMap*";
            case "PointerType": return `${this.emitType(inner.elem)}*`;
            case "OptionalType": return `${this.emitType(inner.elem)}`; // simplified
            case "FlagType": return inner.underlying;
            case "FlagSetType": return "void*";
            case "VariantType": return "void*";
        }
    }

    /** Escape a raw string value (may contain real \n, \t, quotes…) into a C string literal body. */
    private static escapeCString(value: string): string {
        let out = "";
        for (const ch of value) {
            switch (ch) {
                case "\\": out += "\\\\"; break;
                case '"': out += '\\"'; break;
                case "\n": out += "\\n"; break;
                case "\r": out += "\\r"; break;
                case "\t": out += "\\t"; break;
                case "\0": out += "\\0"; break;
                default:
                    out += ch;
            }
        }
        return out;
    }

    // ── Scalar type mapping helper ───────────────────────────────

    private scalarToC(name: string): string {
        const map: Record<string, string> = {
            "u8": "uint8_t", "u16": "uint16_t", "u32": "uint32_t", "u64": "uint64_t",
            "i8": "int8_t", "i16": "int16_t", "i32": "int32_t", "i64": "int64_t",
            "f16": "_Float16", "f32": "float", "f64": "double",
            "bool": "bool", "void": "void",
        };
        return map[name] ?? name;
    }

    // ── Attributes ───────────────────────────────────────────────

    private emitAttributes(annotations: any[]): string {
        const attrs: string[] = [];
        for (const ann of annotations) {
            switch (ann.name) {
                case "inline": attrs.push("__attribute__((always_inline))"); break;
                case "no_inline": attrs.push("__attribute__((noinline))"); break;
                case "deprecated":
                    if (ann.args.length > 0 && ann.args[0].kind === "StringArg") {
                        attrs.push(`__attribute__((deprecated("${ann.args[0].value}")))`);
                    } else {
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

    private emitFlagMacros(): void {
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

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
import { ErrorCode, makeSpan, } from "../diagnostics/diagnostic.js";
import { typesEqual, typeToString, canExplicitCast, isScalarType, isIntType, getBitWidth, } from "./types.js";
export class SymbolTable {
    parent;
    symbols = new Map();
    constructor(parent = null) {
        this.parent = parent;
    }
    define(name, kind, typeInfo, decl) {
        if (this.symbols.has(name))
            return false;
        this.symbols.set(name, { name, kind, typeInfo, decl });
        return true;
    }
    defineLocal(name, typeInfo) {
        if (this.symbols.has(name))
            return false;
        this.symbols.set(name, { name, kind: "var", typeInfo, decl: null });
        return true;
    }
    lookup(name) {
        if (this.symbols.has(name))
            return this.symbols.get(name);
        if (this.parent)
            return this.parent.lookup(name);
        return null;
    }
    child() {
        return new SymbolTable(this);
    }
}
// ─── Type Checker ────────────────────────────────────────────────
export class TypeChecker {
    bag;
    globalScope;
    currentScope;
    currentReturnType = { kind: "Void" };
    constructor(bag) {
        this.bag = bag;
        this.globalScope = new SymbolTable();
        this.currentScope = this.globalScope;
    }
    check(unit) {
        // First pass: register all type declarations
        for (const decl of unit.declarations) {
            this.registerDecl(decl);
        }
        // Second pass: check bodies
        for (const decl of unit.declarations) {
            this.checkDecl(decl);
        }
    }
    // ─── Declaration registration ────────────────────────────────
    registerDecl(decl) {
        const dk = decl.declKind;
        switch (dk.kind) {
            case "StructDecl":
                this.globalScope.define(dk.name, "type", { kind: "Struct", name: dk.name }, decl);
                break;
            case "EnumDecl":
                this.globalScope.define(dk.name, "type", { kind: "Enum", name: dk.name, underlying: dk.underlyingType }, decl);
                break;
            case "FlagDecl":
                this.globalScope.define(dk.name, "type", { kind: "Flag", name: dk.name, underlying: dk.underlyingType }, decl);
                break;
            case "FlagSetDecl":
                this.globalScope.define(dk.name, "type", { kind: "FlagSet", name: dk.name }, decl);
                break;
            case "UnionDecl":
                this.globalScope.define(dk.name, "type", { kind: "Union", name: dk.name }, decl);
                break;
            case "FuncDecl":
                this.globalScope.define(dk.name, "func", { kind: "Func", name: dk.name }, decl);
                break;
            case "GlobalVarDecl":
                this.globalScope.define(dk.name, "var", this.resolveType(dk.typeNode), decl);
                break;
            case "GlobalConstDecl":
                this.globalScope.define(dk.name, "const", dk.typeNode ? this.resolveType(dk.typeNode) : { kind: "Unknown" }, decl);
                break;
            case "TypeAliasDecl":
                this.globalScope.define(dk.name, "type", this.resolveType(dk.aliasedType), decl);
                break;
            case "ImportDecl":
                break;
        }
    }
    // ─── Type resolution ─────────────────────────────────────────
    resolveType(typeNode) {
        const inner = typeNode.inner;
        switch (inner.kind) {
            case "ScalarType":
                if (isScalarType(inner.name)) {
                    return { kind: "Scalar", name: inner.name, bitWidth: getBitWidth(inner.name) };
                }
                if (inner.name === "void")
                    return { kind: "Void" };
                if (inner.name === "string")
                    return { kind: "String" };
                if (inner.name === "StringBuilder")
                    return { kind: "StringBuilder" };
                return { kind: "Named", name: inner.name };
            case "ArrayType": {
                const elem = this.resolveType(inner.elem);
                // Try to evaluate length as constant
                let length = 0;
                if (inner.length.exprKind.kind === "IntegerLit") {
                    length = parseInt(inner.length.exprKind.value, inner.length.exprKind.radix);
                }
                return { kind: "Array", elem, length };
            }
            case "SliceType":
                return { kind: "Slice", elem: this.resolveType(inner.elem) };
            case "MapType":
                return { kind: "Map", key: this.resolveType(inner.key), value: this.resolveType(inner.value) };
            case "NamedType": {
                const sym = this.globalScope.lookup(inner.name);
                if (sym)
                    return sym.typeInfo;
                return { kind: "Named", name: inner.name };
            }
            case "VariantType":
                return { kind: "Variant" };
            case "FlagType":
                return { kind: "Flag", name: "<anonymous>", underlying: inner.underlying };
            case "FlagSetType":
                return { kind: "FlagSet", name: "<anonymous>" };
            case "PointerType":
                return { kind: "Pointer", elem: this.resolveType(inner.elem) };
            case "OptionalType":
                return { kind: "Optional", elem: this.resolveType(inner.elem) };
        }
    }
    // ─── Declaration checking ────────────────────────────────────
    checkDecl(decl) {
        const dk = decl.declKind;
        switch (dk.kind) {
            case "FuncDecl":
                this.checkFuncDecl(dk);
                break;
            case "StructDecl":
                this.checkStructDecl(dk);
                break;
            case "EnumDecl":
                this.checkEnumDecl(dk);
                break;
            case "FlagDecl":
            case "FlagSetDecl":
                this.checkFlagDecl(dk);
                break;
            case "GlobalVarDecl":
                if (dk.init) {
                    const initType = this.inferExprType(dk.init);
                    const varType = this.resolveType(dk.typeNode);
                    if (initType.kind !== "Unknown" && !typesEqual(initType, varType)) {
                        if (!canExplicitCast(initType, varType)) {
                            this.errorTypeMismatch(dk.init, varType, initType);
                        }
                    }
                }
                break;
            case "GlobalConstDecl":
                if (dk.init) {
                    const initType = this.inferExprType(dk.init);
                    if (dk.typeNode) {
                        const constType = this.resolveType(dk.typeNode);
                        if (initType.kind !== "Unknown" && !typesEqual(initType, constType)) {
                            if (!canExplicitCast(initType, constType)) {
                                this.errorTypeMismatch(dk.init, constType, initType);
                            }
                        }
                    }
                }
                break;
        }
    }
    checkFuncDecl(dk) {
        if (!dk.body)
            return; // extern function
        const funcScope = this.globalScope.child();
        const prevScope = this.currentScope;
        this.currentScope = funcScope;
        // Register parameters
        for (const param of dk.params) {
            const paramType = this.resolveType(param.typeNode);
            funcScope.defineLocal(param.name, paramType);
        }
        // Set return type for checking
        const prevReturnType = this.currentReturnType;
        this.currentReturnType = this.resolveType(dk.returnType);
        // Check body
        for (const stmt of dk.body) {
            this.checkStmt(stmt);
        }
        // Check return path coverage (spec 1.3: all branches must return)
        if (this.currentReturnType.kind !== "Void") {
            if (!this.allPathsReturn(dk.body)) {
                const tok = dk.body[dk.body.length - 1]?.token ?? decl_token(dk);
                this.bag.error(ErrorCode.T_PARSE_INVALID_EXPR, `function '${dk.name}' is missing return on some code paths (all branches must explicitly return)`, makeSpan(tok?.file ?? "", tok?.line ?? 1, tok?.col ?? 1, tok?.line ?? 1, (tok?.col ?? 1) + 10));
            }
        }
        this.currentReturnType = prevReturnType;
        this.currentScope = prevScope;
    }
    checkStructDecl(dk) {
        for (const field of dk.fields) {
            if (field.bitWidth === null) {
                this.resolveType(field.typeNode);
            }
        }
    }
    checkEnumDecl(dk) {
        // Validate underlying type is an integer
        if (!isIntType(dk.underlyingType)) {
            this.bag.error(ErrorCode.T_TYPE_MISMATCH, `enum '${dk.name}' underlying type must be an integer type, got '${dk.underlyingType}'`, makeSpan("", 1, 1, 1, 10), { validValues: ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64"] });
        }
        // Check explicit values are integers
        let lastValue = -1;
        for (const variant of dk.variants) {
            if (variant.value) {
                const vt = this.inferExprType(variant.value);
                if (vt.kind === "Scalar" && !isIntType(vt.name)) {
                    this.bag.error(ErrorCode.T_TYPE_MISMATCH, `enum variant value must be integer, got ${typeToString(vt)}`, makeSpan("", 1, 1, 1, 5));
                }
            }
        }
    }
    checkFlagDecl(dk) {
        // Validate underlying type for FlagDecl (not FlagSetDecl)
        if (dk.kind === "FlagDecl" && !isIntType(dk.underlyingType)) {
            this.bag.error(ErrorCode.T_TYPE_MISMATCH, `flag '${dk.name}' underlying type must be an integer type, got '${dk.underlyingType}'`, makeSpan("", 1, 1, 1, 10), { validValues: ["u8", "u16", "u32", "u64"] });
        }
        // Validate bit widths and offsets
        let autoOffset = 0;
        const usedBits = [];
        for (const slot of dk.slots) {
            const startBit = slot.offset !== null ? slot.offset : autoOffset;
            const endBit = startBit + slot.bitWidth;
            // Check for overlapping bits
            for (const used of usedBits) {
                if (startBit < used.end && endBit > used.start) {
                    this.bag.error(ErrorCode.T_FLAG_OFFSET_CONFLICT, `flag slot '${slot.name}' (bits ${startBit}-${endBit - 1}) overlaps with '${used.name}' (bits ${used.start}-${used.end - 1})`, makeSpan("", 1, 1, 1, 10));
                }
            }
            usedBits.push({ name: slot.name, start: startBit, end: endBit });
            // Check total bits don't exceed underlying type width
            if (dk.kind === "FlagDecl") {
                const typeWidth = getBitWidth(dk.underlyingType);
                if (typeWidth && endBit > typeWidth) {
                    this.bag.error(ErrorCode.T_FLAG_OVERFLOW, `flag '${dk.name}' slot '${slot.name}' exceeds ${dk.underlyingType} (${typeWidth} bits): uses bits ${startBit}-${endBit - 1}`, makeSpan("", 1, 1, 1, 10), { validValues: [`0-${typeWidth - 1} bits`] });
                }
            }
            autoOffset = endBit;
        }
    }
    // ─── Statement checking ──────────────────────────────────────
    checkStmt(stmt) {
        const sk = stmt.stmtKind;
        switch (sk.kind) {
            case "VarDecl": {
                const varType = sk.typeNode ? this.resolveType(sk.typeNode) : null;
                if (sk.init) {
                    const initType = this.inferExprType(sk.init);
                    if (varType && initType.kind !== "Unknown" && !typesEqual(initType, varType)) {
                        // Allow integer literal initialization for flag/enum types (semantically integers)
                        const isIntToFlagOrEnum = (varType.kind === "Flag" || varType.kind === "Enum") &&
                            initType.kind === "Scalar" && isIntType(initType.name);
                        if (!isIntToFlagOrEnum && !canExplicitCast(initType, varType)) {
                            this.errorTypeMismatch(sk.init, varType, initType);
                        }
                    }
                    if (!varType) {
                        // Type inference from init
                        this.currentScope.defineLocal(sk.name, initType);
                        return;
                    }
                }
                if (varType) {
                    this.currentScope.defineLocal(sk.name, varType);
                }
                break;
            }
            case "IfStmt": {
                const condType = this.inferExprType(sk.condition);
                // Enforce explicit boolean comparison (spec 1.2.5: no implicit bool)
                if (condType.kind === "Scalar" && condType.name !== "bool") {
                    this.bag.error(ErrorCode.T_STMT_IMPLICIT_BOOL, `if condition must be bool or explicit comparison, got ${typeToString(condType)}`, makeSpan("", 1, 1, 1, 5), { fixSuggestions: [{ description: "add explicit comparison", range: makeSpan("", 1, 1, 1, 1), replacement: "(expr != 0)" }] });
                }
                const thenScope = this.currentScope.child();
                const prevScope = this.currentScope;
                this.currentScope = thenScope;
                for (const s of sk.thenBlock)
                    this.checkStmt(s);
                if (sk.elseBlock) {
                    const elseScope = prevScope.child();
                    this.currentScope = elseScope;
                    for (const s of sk.elseBlock)
                        this.checkStmt(s);
                }
                this.currentScope = prevScope;
                break;
            }
            case "ForStmt":
            case "WhileStmt": {
                const skAny = sk;
                if (skAny.condition) {
                    const condType = this.inferExprType(skAny.condition);
                    if (condType.kind === "Scalar" && condType.name !== "bool") {
                        this.bag.error(ErrorCode.T_STMT_IMPLICIT_BOOL, `loop condition must be bool, got ${typeToString(condType)}`, makeSpan("", 1, 1, 1, 5));
                    }
                }
                const loopScope = this.currentScope.child();
                const prev = this.currentScope;
                this.currentScope = loopScope;
                if (skAny.init)
                    this.checkStmt(skAny.init);
                for (const s of skAny.body)
                    this.checkStmt(s);
                this.currentScope = prev;
                break;
            }
            case "ForEachStmt": {
                const iterType = this.inferExprType(sk.iterable);
                const loopScope = this.currentScope.child();
                const prev = this.currentScope;
                this.currentScope = loopScope;
                // Infer element type from iterable
                let elemType = { kind: "Unknown" };
                if (iterType.kind === "Slice" || iterType.kind === "Array") {
                    elemType = iterType.elem;
                }
                loopScope.defineLocal(sk.varName, elemType);
                for (const s of sk.body)
                    this.checkStmt(s);
                this.currentScope = prev;
                break;
            }
            case "ReturnStmt":
                if (sk.value) {
                    const vt = this.inferExprType(sk.value);
                    if (vt.kind !== "Unknown" && !typesEqual(vt, this.currentReturnType)) {
                        if (!canExplicitCast(vt, this.currentReturnType)) {
                            this.errorTypeMismatch(sk.value, this.currentReturnType, vt);
                        }
                    }
                }
                break;
            case "AssignmentStmt": {
                const targetType = this.inferExprType(sk.target);
                const valType = this.inferExprType(sk.value);
                if (targetType.kind !== "Unknown" && valType.kind !== "Unknown" && !typesEqual(targetType, valType)) {
                    if (!canExplicitCast(valType, targetType)) {
                        this.errorTypeMismatch(sk.value, targetType, valType);
                    }
                }
                break;
            }
            case "ExprStmt":
                this.inferExprType(sk.expr);
                break;
            case "BlockStmt":
            case "DeferStmt":
            case "ComptimeStmt": {
                const blockScope = this.currentScope.child();
                const prev = this.currentScope;
                this.currentScope = blockScope;
                for (const s of sk.body)
                    this.checkStmt(s);
                this.currentScope = prev;
                break;
            }
            case "SwitchStmt":
                this.inferExprType(sk.expr);
                for (const c of sk.cases) {
                    this.inferExprType(c.pattern);
                    for (const s of c.body)
                        this.checkStmt(s);
                }
                if (sk.defaultBlock) {
                    for (const s of sk.defaultBlock)
                        this.checkStmt(s);
                }
                break;
        }
    }
    // ─── Expression type inference ───────────────────────────────
    inferExprType(expr) {
        const ek = expr.exprKind;
        switch (ek.kind) {
            case "IntegerLit": {
                // Try to fit into smallest unsigned type, but flag ambiguous int
                const val = BigInt(ek.value);
                if (val >= 0n) {
                    if (val <= 255n)
                        return { kind: "Scalar", name: "u8", bitWidth: 8 };
                    if (val <= 65535n)
                        return { kind: "Scalar", name: "u16", bitWidth: 16 };
                    if (val <= 4294967295n)
                        return { kind: "Scalar", name: "u32", bitWidth: 32 };
                    return { kind: "Scalar", name: "u64", bitWidth: 64 };
                }
                return { kind: "Scalar", name: "i64", bitWidth: 64 };
            }
            case "FloatLit":
                return { kind: "Scalar", name: "f64", bitWidth: 64 };
            case "StringLit":
                return { kind: "String" };
            case "BoolLit":
                return { kind: "Scalar", name: "bool", bitWidth: 1 };
            case "NullLit":
                return { kind: "Unknown" };
            case "IdentExpr": {
                const sym = this.currentScope.lookup(ek.name);
                if (sym)
                    return sym.typeInfo;
                // Check for built-in constants
                if (ek.name === "true" || ek.name === "false") {
                    return { kind: "Scalar", name: "bool", bitWidth: 1 };
                }
                return { kind: "Unknown" };
            }
            case "BinaryExpr": {
                const leftType = this.inferExprType(ek.left);
                const rightType = this.inferExprType(ek.right);
                // Comparison operators return bool
                if (["==", "!=", "<", ">", "<=", ">="].includes(ek.op)) {
                    return { kind: "Scalar", name: "bool", bitWidth: 1 };
                }
                // Logical operators return bool
                if (["&&", "||"].includes(ek.op)) {
                    return { kind: "Scalar", name: "bool", bitWidth: 1 };
                }
                // Arithmetic and bitwise: result type is the common type
                // Per spec: no implicit conversion, so both must be same type.
                // Exception: untyped integer literals adapt to the other operand's type.
                if (leftType.kind === "Scalar" && rightType.kind === "Scalar") {
                    if (typesEqual(leftType, rightType))
                        return leftType;
                    const leftIsLit = ek.left.exprKind.kind === "IntegerLit";
                    const rightIsLit = ek.right.exprKind.kind === "IntegerLit";
                    if (leftIsLit && !rightIsLit)
                        return rightType;
                    if (rightIsLit && !leftIsLit)
                        return leftType;
                    if (leftIsLit && rightIsLit)
                        return leftType;
                    // Flag implicit conversion
                    this.bag.error(ErrorCode.T_TYPE_IMPLICIT_CAST, `binary operator '${ek.op}' requires same types, got ${typeToString(leftType)} and ${typeToString(rightType)}`, makeSpan("", 1, 1, 1, 5), { notes: ["use explicit cast: `expr as Type`"] });
                }
                return leftType.kind !== "Unknown" ? leftType : rightType;
            }
            case "UnaryExpr": {
                const operandType = this.inferExprType(ek.operand);
                if (ek.op === "!")
                    return { kind: "Scalar", name: "bool", bitWidth: 1 };
                return operandType;
            }
            case "AssignExpr":
                this.inferExprType(ek.value);
                return this.inferExprType(ek.target);
            case "CallExpr": {
                // Look up function
                if (ek.callee.exprKind.kind === "IdentExpr") {
                    const funcName = ek.callee.exprKind.name;
                    const sym = this.globalScope.lookup(funcName);
                    if (sym && sym.typeInfo.kind === "Func") {
                        const funcDecl = sym.decl.declKind;
                        if (funcDecl.kind === "FuncDecl") {
                            return this.resolveType(funcDecl.returnType);
                        }
                    }
                    // Built-in functions
                    return this.lookupBuiltinReturnType(funcName);
                }
                return { kind: "Unknown" };
            }
            case "MemberExpr": {
                const objType = this.inferExprType(ek.object);
                if (objType.kind === "Struct" || objType.kind === "Named") {
                    const sym = this.globalScope.lookup(objType.name);
                    if (sym && sym.decl.declKind.kind === "StructDecl") {
                        const field = sym.decl.declKind.fields.find((f) => f.name === ek.member);
                        if (field)
                            return this.resolveType(field.typeNode);
                    }
                }
                if (objType.kind === "Enum") {
                    return objType; // enum variant access returns the enum type
                }
                return { kind: "Unknown" };
            }
            case "IndexExpr": {
                const objType = this.inferExprType(ek.object);
                if (objType.kind === "Array" || objType.kind === "Slice")
                    return objType.elem;
                if (objType.kind === "Map")
                    return objType.value;
                return { kind: "Unknown" };
            }
            case "ArrayLit":
                if (ek.elements.length > 0) {
                    const elemType = this.inferExprType(ek.elements[0]);
                    return { kind: "Array", elem: elemType, length: ek.elements.length };
                }
                return { kind: "Array", elem: { kind: "Unknown" }, length: 0 };
            case "MapLit":
                if (ek.entries.length > 0) {
                    const keyType = this.inferExprType(ek.entries[0].key);
                    const valType = this.inferExprType(ek.entries[0].value);
                    return { kind: "Map", key: keyType, value: valType };
                }
                return { kind: "Map", key: { kind: "Unknown" }, value: { kind: "Unknown" } };
            case "StructLit":
                return { kind: "Struct", name: ek.typeName };
            case "CastExpr":
                return this.resolveType(ek.targetType);
            case "RangeExpr":
                return { kind: "Unknown" };
            case "ParenExpr":
                return this.inferExprType(ek.inner);
            case "ComptimeExpr":
                return this.inferExprType(ek.expr);
            case "TypeInfoExpr":
                return { kind: "Unknown" }; // type_info returns a comptime structure
            case "FlagSetExpr":
                return { kind: "Unknown" };
        }
    }
    lookupBuiltinReturnType(name) {
        const builtins = {
            "assert_eq": { kind: "Void" },
            "assert_true": { kind: "Void" },
            "assert_false": { kind: "Void" },
            "assert_panic": { kind: "Void" },
            "flag_set": { kind: "Void" },
            "flag_get": { kind: "Scalar", name: "u32", bitWidth: 32 },
            "print": { kind: "Void" },
            "println": { kind: "Void" },
            "to_string": { kind: "String" },
            "from_string": { kind: "Unknown" },
        };
        return builtins[name] ?? { kind: "Unknown" };
    }
    // ─── Return path analysis ────────────────────────────────────
    allPathsReturn(stmts) {
        if (stmts.length === 0)
            return false;
        const last = stmts[stmts.length - 1];
        return this.stmtReturns(last);
    }
    stmtReturns(stmt) {
        const sk = stmt.stmtKind;
        switch (sk.kind) {
            case "ReturnStmt":
                return true;
            case "IfStmt":
                if (sk.elseBlock) {
                    return this.allPathsReturn(sk.thenBlock) && this.allPathsReturn(sk.elseBlock);
                }
                return false;
            case "BlockStmt":
                return this.allPathsReturn(sk.body);
            default:
                return false;
        }
    }
    // ─── Error helpers ───────────────────────────────────────────
    errorTypeMismatch(expr, expected, actual) {
        const tok = expr.token;
        this.bag.error(ErrorCode.T_TYPE_MISMATCH, `type mismatch: expected ${typeToString(expected)} but got ${typeToString(actual)}`, makeSpan(tok?.file ?? "", tok?.line ?? 1, tok?.col ?? 1, tok?.line ?? 1, (tok?.col ?? 1) + 5), {
            notes: [`expected: ${typeToString(expected)}`, `found:    ${typeToString(actual)}`],
        });
    }
}
function decl_token(dk) {
    return dk.token;
}
//# sourceMappingURL=checker.js.map
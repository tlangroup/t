/**
 * t Language - type_info(T) Compile-Time Type Introspection
 *
 * Implements spec section 5.2: type_info(T) 编译期类型自省（核心底座）
 *
 * Returns complete structured information about any type:
 * - Field names, types, memory offsets, bit widths, value ranges
 * - All mounted annotations and meta tags
 *
 * All @derive auto-methods, test collection, serialization code,
 * editor metadata export are based on AST generation — zero string
 * template concatenation (spec principle 3).
 */
import { getBitWidth, TYPE_RANGES } from "../types/types.js";
import { FlagResolver } from "../flag/bitfield.js";
// ─── Type Info Provider ──────────────────────────────────────────
export class TypeInfoProvider {
    flagResolver;
    typeDecls = new Map();
    resolvedFlags = new Map();
    constructor(flagResolver) {
        this.flagResolver = flagResolver;
    }
    registerDecl(name, decl) {
        this.typeDecls.set(name, decl);
        const dk = decl.declKind;
        if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
            const resolved = this.flagResolver.resolve(decl);
            if (resolved)
                this.resolvedFlags.set(name, resolved);
        }
    }
    /**
     * Get complete type info for a named type (spec 5.2).
     */
    getTypeInfo(typeName) {
        const decl = this.typeDecls.get(typeName);
        if (!decl) {
            // Could be a scalar type
            if (getBitWidth(typeName) !== null) {
                return this.getScalarTypeInfo(typeName);
            }
            return null;
        }
        const dk = decl.declKind;
        switch (dk.kind) {
            case "StructDecl":
                return this.getStructTypeInfo(dk, decl);
            case "EnumDecl":
                return this.getEnumTypeInfo(dk, decl);
            case "FlagDecl":
                return this.getFlagTypeInfo(typeName, decl);
            case "FlagSetDecl":
                return this.getFlagSetTypeInfo(typeName, decl);
            case "UnionDecl":
                return this.getUnionTypeInfo(dk, decl);
            default:
                return null;
        }
    }
    // ── Scalar type info ─────────────────────────────────────────
    getScalarTypeInfo(name) {
        const width = getBitWidth(name) ?? 0;
        const sizeBytes = Math.ceil(width / 8);
        const range = TYPE_RANGES[name];
        return {
            typeName: name,
            kind: "scalar",
            sizeBytes,
            alignBytes: sizeBytes,
            fields: [],
            enumVariants: [],
            unionMembers: [],
            flagSlots: [],
            annotations: [],
            memoryLayout: "scalar",
        };
    }
    // ── Struct type info ─────────────────────────────────────────
    getStructTypeInfo(dk, decl) {
        const fields = [];
        let offset = 0;
        for (const field of dk.fields) {
            if (field.bitWidth !== null) {
                // @bitpack field
                fields.push({
                    name: field.name,
                    typeName: dk.bitpackType ?? "void",
                    byteOffset: null,
                    bitOffset: offset,
                    bitWidth: field.bitWidth,
                    minValue: "0",
                    maxValue: ((1 << field.bitWidth) - 1).toString(),
                    annotations: this.extractAnnotations(field.annotations),
                });
                offset += field.bitWidth;
            }
            else {
                const fieldSize = this.estimateSize(field.typeNode);
                const binaryOffsetAnno = field.annotations.find((a) => a.name === "binary_offset");
                const byteOffset = binaryOffsetAnno
                    ? parseInt(binaryOffsetAnno.args[0]?.value ?? "0", 10)
                    : offset;
                fields.push({
                    name: field.name,
                    typeName: this.typeNodeToString(field.typeNode),
                    byteOffset,
                    bitOffset: null,
                    bitWidth: null,
                    minValue: null,
                    maxValue: null,
                    annotations: this.extractAnnotations(field.annotations),
                });
                offset += fieldSize;
            }
        }
        const sizeBytes = dk.isBitpack
            ? Math.ceil(offset / 8)
            : offset;
        return {
            typeName: dk.name,
            kind: "struct",
            sizeBytes,
            alignBytes: dk.isBitpack ? Math.ceil(offset / 8) : 4,
            fields,
            enumVariants: [],
            unionMembers: [],
            flagSlots: [],
            annotations: this.extractAnnotations(decl.annotations),
            memoryLayout: dk.memoryLayout === "soa" ? "soa" : "aos",
        };
    }
    // ── Enum type info ───────────────────────────────────────────
    getEnumTypeInfo(dk, decl) {
        const variants = [];
        let autoValue = 0;
        for (const variant of dk.variants) {
            let value = null;
            if (variant.value) {
                if (variant.value.exprKind.kind === "IntegerLit") {
                    const lit = variant.value.exprKind;
                    value = parseInt(lit.value, lit.radix);
                    autoValue = value + 1;
                }
            }
            else {
                value = autoValue;
                autoValue++;
            }
            variants.push({
                name: variant.name,
                value,
                annotations: this.extractAnnotations(variant.annotations),
            });
        }
        const width = getBitWidth(dk.underlyingType) ?? 32;
        return {
            typeName: dk.name,
            kind: "enum",
            sizeBytes: Math.ceil(width / 8),
            alignBytes: Math.ceil(width / 8),
            fields: [],
            enumVariants: variants,
            unionMembers: [],
            flagSlots: [],
            annotations: this.extractAnnotations(decl.annotations),
            memoryLayout: "enum",
        };
    }
    // ── Flag type info ───────────────────────────────────────────
    getFlagTypeInfo(name, decl) {
        const resolved = this.resolvedFlags.get(name);
        if (!resolved)
            return null;
        return {
            typeName: resolved.name,
            kind: "flag",
            sizeBytes: Math.ceil(resolved.totalBits / 8),
            alignBytes: Math.ceil(resolved.totalBits / 8),
            fields: [],
            enumVariants: [],
            unionMembers: [],
            flagSlots: FlagResolver.getAllSlotInfo(resolved),
            annotations: this.extractAnnotations(decl.annotations),
            memoryLayout: "flag",
        };
    }
    // ── Flag set type info ───────────────────────────────────────
    getFlagSetTypeInfo(name, decl) {
        const resolved = this.resolvedFlags.get(name);
        if (!resolved)
            return null;
        return {
            typeName: resolved.name,
            kind: "flag_set",
            sizeBytes: Math.ceil(resolved.totalBits / 8),
            alignBytes: 8, // flag_set is heap-allocated, pointer-aligned
            fields: [],
            enumVariants: [],
            unionMembers: [],
            flagSlots: FlagResolver.getAllSlotInfo(resolved),
            annotations: this.extractAnnotations(decl.annotations),
            memoryLayout: "flag_set",
        };
    }
    // ── Union type info ──────────────────────────────────────────
    getUnionTypeInfo(dk, decl) {
        const members = [];
        let maxSize = 0;
        for (const member of dk.members) {
            const memberSize = this.estimateSize(member.typeNode);
            if (memberSize > maxSize)
                maxSize = memberSize;
            members.push({
                name: member.name,
                typeName: this.typeNodeToString(member.typeNode),
                annotations: this.extractAnnotations(member.annotations),
            });
        }
        return {
            typeName: dk.name,
            kind: "union",
            sizeBytes: maxSize,
            alignBytes: maxSize,
            fields: [],
            enumVariants: [],
            unionMembers: members,
            flagSlots: [],
            annotations: this.extractAnnotations(decl.annotations),
            memoryLayout: "union",
        };
    }
    // ── Helpers ──────────────────────────────────────────────────
    extractAnnotations(annotations) {
        return annotations.map((a) => ({
            name: a.name,
            args: a.args.map((arg) => {
                switch (arg.kind) {
                    case "StringArg": return `"${arg.value}"`;
                    case "IdentArg": return arg.value;
                    case "NumberArg": return arg.value;
                    case "ListArg": return arg.values.map((v) => v.kind === "IdentArg" ? v.value : "").join(", ");
                }
            }),
        }));
    }
    typeNodeToString(typeNode) {
        if (!typeNode)
            return "unknown";
        const inner = typeNode.inner;
        switch (inner.kind) {
            case "ScalarType": return inner.name;
            case "NamedType": return inner.name;
            case "ArrayType": return `[${inner.length?.exprKind?.value ?? "N"}]${this.typeNodeToString(inner.elem)}`;
            case "SliceType": return `[]${this.typeNodeToString(inner.elem)}`;
            case "MapType": return `map[${this.typeNodeToString(inner.key)}]${this.typeNodeToString(inner.value)}`;
            case "PointerType": return `*${this.typeNodeToString(inner.elem)}`;
            case "VariantType": return "Variant";
            case "FlagType": return `flag[${inner.underlying}]`;
            case "FlagSetType": return "flag_set";
            case "OptionalType": return `?${this.typeNodeToString(inner.elem)}`;
            default: return "unknown";
        }
    }
    estimateSize(typeNode) {
        if (!typeNode)
            return 0;
        const inner = typeNode.inner;
        switch (inner.kind) {
            case "ScalarType": {
                const w = getBitWidth(inner.name);
                return w ? Math.ceil(w / 8) : 4;
            }
            case "NamedType": {
                const info = this.getTypeInfo(inner.name);
                return info ? info.sizeBytes : 4;
            }
            case "PointerType": return 8;
            case "SliceType": return 16; // ptr + length
            case "MapType": return 24; // simplified
            default: return 4;
        }
    }
    /**
     * Export type info as JSON (spec 8.3: AST standardization export).
     */
    exportAsJson(typeName) {
        const info = this.getTypeInfo(typeName);
        if (!info)
            return JSON.stringify({ error: `unknown type '${typeName}'` });
        return JSON.stringify(info, null, 2);
    }
}
//# sourceMappingURL=type_info.js.map
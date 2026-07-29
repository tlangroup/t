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
import { DeclNode } from "../ast/nodes.js";
import { SlotInfo, FlagResolver } from "../flag/bitfield.js";
export interface FieldInfo {
    name: string;
    typeName: string;
    byteOffset: number | null;
    bitOffset: number | null;
    bitWidth: number | null;
    minValue: string | null;
    maxValue: string | null;
    annotations: AnnotationInfo[];
}
export interface AnnotationInfo {
    name: string;
    args: string[];
}
export interface EnumVariantInfo {
    name: string;
    value: number | null;
    annotations: AnnotationInfo[];
}
export interface UnionMemberInfo {
    name: string;
    typeName: string;
    annotations: AnnotationInfo[];
}
export interface TypeInfoResult {
    typeName: string;
    kind: "struct" | "enum" | "flag" | "flag_set" | "union" | "scalar" | "container" | "unknown";
    sizeBytes: number;
    alignBytes: number;
    fields: FieldInfo[];
    enumVariants: EnumVariantInfo[];
    unionMembers: UnionMemberInfo[];
    flagSlots: SlotInfo[];
    annotations: AnnotationInfo[];
    memoryLayout: string;
}
export declare class TypeInfoProvider {
    private flagResolver;
    private typeDecls;
    private resolvedFlags;
    constructor(flagResolver: FlagResolver);
    registerDecl(name: string, decl: DeclNode): void;
    /**
     * Get complete type info for a named type (spec 5.2).
     */
    getTypeInfo(typeName: string): TypeInfoResult | null;
    private getScalarTypeInfo;
    private getStructTypeInfo;
    private getEnumTypeInfo;
    private getFlagTypeInfo;
    private getFlagSetTypeInfo;
    private getUnionTypeInfo;
    private extractAnnotations;
    private typeNodeToString;
    private estimateSize;
    /**
     * Export type info as JSON (spec 8.3: AST standardization export).
     */
    exportAsJson(typeName: string): string;
}
//# sourceMappingURL=type_info.d.ts.map
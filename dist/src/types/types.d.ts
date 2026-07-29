/**
 * t Language - Type System Definitions
 *
 * Defines all types in the t language type system (spec section 2):
 * - Scalar types with explicit bit widths (u8..u64, i8..i64, f16..f64, bool)
 * - Container types: [N]T, []T, map[K]V
 * - Custom types: struct, enum, flag[T], flag_set, union
 * - Variant type
 *
 * No ambiguous "int" — all widths are explicit (spec 2.1).
 */
export declare const SCALAR_TYPES: readonly ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f16", "f32", "f64", "bool"];
export declare const INT_TYPES: string[];
export declare const FLOAT_TYPES: string[];
export declare const UNSIGNED_INT_TYPES: string[];
export declare const SIGNED_INT_TYPES: string[];
export declare const TYPE_BIT_WIDTHS: Record<string, number>;
export declare const TYPE_RANGES: Record<string, {
    min: bigint;
    max: bigint;
}>;
export declare function isScalarType(name: string): boolean;
export declare function isIntType(name: string): boolean;
export declare function isFloatType(name: string): boolean;
export declare function isUnsignedInt(name: string): boolean;
export declare function isSignedInt(name: string): boolean;
export declare function getBitWidth(name: string): number | null;
export type TypeInfo = {
    kind: "Scalar";
    name: string;
    bitWidth: number;
} | {
    kind: "Void";
} | {
    kind: "String";
} | {
    kind: "StringBuilder";
} | {
    kind: "Array";
    elem: TypeInfo;
    length: number;
} | {
    kind: "Slice";
    elem: TypeInfo;
} | {
    kind: "Map";
    key: TypeInfo;
    value: TypeInfo;
} | {
    kind: "Pointer";
    elem: TypeInfo;
} | {
    kind: "Optional";
    elem: TypeInfo;
} | {
    kind: "Struct";
    name: string;
} | {
    kind: "Enum";
    name: string;
    underlying: string;
} | {
    kind: "Flag";
    name: string;
    underlying: string;
} | {
    kind: "FlagSet";
    name: string;
} | {
    kind: "Union";
    name: string;
} | {
    kind: "Variant";
} | {
    kind: "Func";
    name: string;
} | {
    kind: "Named";
    name: string;
} | {
    kind: "Unknown";
};
/**
 * Checks if source type can be explicitly cast to target type.
 * Per spec 2.1: no implicit type conversion — all casts must be explicit.
 */
export declare function canExplicitCast(from: TypeInfo, to: TypeInfo): boolean;
/**
 * Checks if types are exactly equal (no implicit conversion).
 */
export declare function typesEqual(a: TypeInfo, b: TypeInfo): boolean;
/**
 * Returns the common type for binary operations, or null if incompatible.
 * Per spec: no implicit conversion, so types must match exactly.
 */
export declare function getCommonType(a: TypeInfo, b: TypeInfo): TypeInfo | null;
/**
 * String representation of a type for error messages.
 */
export declare function typeToString(t: TypeInfo): string;
//# sourceMappingURL=types.d.ts.map
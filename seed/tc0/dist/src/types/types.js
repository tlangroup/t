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
// ─── Scalar Types ────────────────────────────────────────────────
export const SCALAR_TYPES = [
    // Unsigned integers
    "u8", "u16", "u32", "u64",
    // Signed integers
    "i8", "i16", "i32", "i64",
    // Floats
    "f16", "f32", "f64",
    // Boolean
    "bool",
];
export const INT_TYPES = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64"];
export const FLOAT_TYPES = ["f16", "f32", "f64"];
export const UNSIGNED_INT_TYPES = ["u8", "u16", "u32", "u64"];
export const SIGNED_INT_TYPES = ["i8", "i16", "i32", "i64"];
// Bit widths for scalar types
export const TYPE_BIT_WIDTHS = {
    u8: 8, u16: 16, u32: 32, u64: 64,
    i8: 8, i16: 16, i32: 32, i64: 64,
    f16: 16, f32: 32, f64: 64,
    bool: 1,
};
// Value ranges for integer types
export const TYPE_RANGES = {
    u8: { min: 0n, max: 255n },
    u16: { min: 0n, max: 65535n },
    u32: { min: 0n, max: 4294967295n },
    u64: { min: 0n, max: 18446744073709551615n },
    i8: { min: -128n, max: 127n },
    i16: { min: -32768n, max: 32767n },
    i32: { min: -2147483648n, max: 2147483647n },
    i64: { min: -9223372036854775808n, max: 9223372036854775807n },
};
export function isScalarType(name) {
    return SCALAR_TYPES.includes(name);
}
export function isIntType(name) {
    return INT_TYPES.includes(name);
}
export function isFloatType(name) {
    return FLOAT_TYPES.includes(name);
}
export function isUnsignedInt(name) {
    return UNSIGNED_INT_TYPES.includes(name);
}
export function isSignedInt(name) {
    return SIGNED_INT_TYPES.includes(name);
}
export function getBitWidth(name) {
    return TYPE_BIT_WIDTHS[name] ?? null;
}
// ─── Type Compatibility ──────────────────────────────────────────
/**
 * Checks if source type can be explicitly cast to target type.
 * Per spec 2.1: no implicit type conversion — all casts must be explicit.
 */
export function canExplicitCast(from, to) {
    // Same type is always fine
    if (typesEqual(from, to))
        return true;
    // Integer to integer (different widths) — explicit cast allowed
    if (isIntTypeInfo(from) && isIntTypeInfo(to))
        return true;
    // Float to float — explicit cast allowed
    if (isFloatTypeInfo(from) && isFloatTypeInfo(to))
        return true;
    // Int to float — explicit cast allowed
    if (isIntTypeInfo(from) && isFloatTypeInfo(to))
        return true;
    // Float to int — explicit cast allowed (truncation)
    if (isFloatTypeInfo(from) && isIntTypeInfo(to))
        return true;
    // Bool to int — explicit cast allowed
    if (from.kind === "Scalar" && from.name === "bool" && isIntTypeInfo(to))
        return true;
    // Int to bool — explicit cast allowed
    if (isIntTypeInfo(from) && to.kind === "Scalar" && to.name === "bool")
        return true;
    return false;
}
/**
 * Checks if types are exactly equal (no implicit conversion).
 */
export function typesEqual(a, b) {
    if (a.kind !== b.kind)
        return false;
    switch (a.kind) {
        case "Scalar":
            return a.name === b.name;
        case "Void":
        case "String":
        case "StringBuilder":
        case "Variant":
        case "Unknown":
            return true;
        case "Array": {
            const bb = b;
            return a.length === bb.length && typesEqual(a.elem, bb.elem);
        }
        case "Slice": {
            const bb = b;
            return typesEqual(a.elem, bb.elem);
        }
        case "Map": {
            const bb = b;
            return typesEqual(a.key, bb.key) && typesEqual(a.value, bb.value);
        }
        case "Pointer": {
            const bb = b;
            return typesEqual(a.elem, bb.elem);
        }
        case "Optional": {
            const bb = b;
            return typesEqual(a.elem, bb.elem);
        }
        case "Struct":
        case "Enum":
        case "Flag":
        case "FlagSet":
        case "Union":
        case "Func":
        case "Named":
            return a.name === b.name;
    }
}
function isIntTypeInfo(t) {
    return t.kind === "Scalar" && isIntType(t.name);
}
function isFloatTypeInfo(t) {
    return t.kind === "Scalar" && isFloatType(t.name);
}
/**
 * Returns the common type for binary operations, or null if incompatible.
 * Per spec: no implicit conversion, so types must match exactly.
 */
export function getCommonType(a, b) {
    if (typesEqual(a, b))
        return a;
    // No implicit conversion allowed — return null
    return null;
}
/**
 * String representation of a type for error messages.
 */
export function typeToString(t) {
    switch (t.kind) {
        case "Scalar": return t.name;
        case "Void": return "void";
        case "String": return "string";
        case "StringBuilder": return "StringBuilder";
        case "Array": return `[${t.length}]${typeToString(t.elem)}`;
        case "Slice": return `[]${typeToString(t.elem)}`;
        case "Map": return `map[${typeToString(t.key)}]${typeToString(t.value)}`;
        case "Pointer": return `*${typeToString(t.elem)}`;
        case "Optional": return `?${typeToString(t.elem)}`;
        case "Struct": return t.name;
        case "Enum": return t.name;
        case "Flag": return t.name;
        case "FlagSet": return t.name;
        case "Union": return t.name;
        case "Variant": return "Variant";
        case "Func": return t.name;
        case "Named": return t.name;
        case "Unknown": return "<unknown>";
    }
}
//# sourceMappingURL=types.js.map
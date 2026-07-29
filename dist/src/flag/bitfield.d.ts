/**
 * t Language - Flag / Bitfield System
 *
 * Implements spec section 6: Flag/位域系统终稿 (融合 Zig+Rust 最优设计)
 *
 * Key features:
 * - flag[T] declaration with auto bit allocation (spec 6.1, 6.2)
 * - flag_set for large bitfields exceeding u64 (spec 6.5)
 * - SlotInfo self-introspection structure (spec 5.3)
 * - flag_set(flag_instance, field_name, value) — write multi-bit value (spec 6.4.2)
 * - flag_get(flag_instance, field_name) -> u32 — read multi-bit value (spec 6.4.2)
 * - 1bit vs >=2bit read/write isolation (spec 6.4)
 * - Overflow double-check: compile-time for constants, runtime for variables (spec 6.4.2)
 * - @offset(N) for explicit bit positioning (spec 6.3)
 */
import { DeclNode } from "../ast/nodes.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
export interface SlotInfo {
    name: string;
    startBit: u32;
    bitLength: u32;
    minValue: u32;
    maxValue: u32;
    isSingleBit: boolean;
    annotations: string[];
}
type u32 = number;
export interface ResolvedFlagSlot extends SlotInfo {
    endBit: number;
}
export interface ResolvedFlagDecl {
    name: string;
    underlyingType: string;
    totalBits: number;
    slots: ResolvedFlagSlot[];
    isFlagSet: boolean;
}
export declare class FlagResolver {
    private bag;
    constructor(bag: DiagnosticBag);
    /**
     * Resolve a flag[T] or flag_set declaration into a concrete bit layout.
     * Implements spec 6.1: auto top-down bit allocation, with @offset override.
     */
    resolve(decl: DeclNode): ResolvedFlagDecl | null;
    private resolveFlagDecl;
    private resolveFlagSetDecl;
    /**
     * Get SlotInfo for a specific slot by name (spec 5.3).
     * Used by type_info() for compile-time introspection.
     */
    static getSlotInfo(resolved: ResolvedFlagDecl, slotName: string): SlotInfo | null;
    /**
     * Get all SlotInfo for a flag type (spec 5.3).
     */
    static getAllSlotInfo(resolved: ResolvedFlagDecl): SlotInfo[];
}
/**
 * Runtime flag operations implementing spec 6.4 read/write isolation rules:
 *
 * 1-bit slots: allow | & ^ |= &= ^= operators, but boolean check must be explicit != 0
 * >=2-bit slots: completely forbid direct bit operations, only use flag_set/flag_get
 *
 * flag_set(flag_instance, field_name, value) — write multi-bit value with bounds check
 * flag_get(flag_instance, field_name) -> u32 — read multi-bit value
 */
export declare class FlagOps {
    private bag;
    constructor(bag: DiagnosticBag);
    /**
     * Write a value to a multi-bit flag slot (spec 6.4.2).
     * Performs runtime bounds checking (spec 6.4.2: variable runtime check).
     *
     * Returns the updated flag value, or throws on overflow.
     */
    static flagSetValue(flagValue: bigint, resolved: ResolvedFlagDecl, slotName: string, value: number): bigint;
    /**
     * Read a value from a multi-bit flag slot (spec 6.4.2).
     */
    static flagGetValue(flagValue: bigint, resolved: ResolvedFlagDecl, slotName: string): number;
    /**
     * Check if a single-bit flag is set (spec 6.4.1: explicit != 0 comparison).
     */
    static isFlagSet(flagValue: bigint, resolved: ResolvedFlagDecl, slotName: string): boolean;
    /**
     * Set a single-bit flag (spec 6.4.1: | operator).
     */
    static setSingleBit(flagValue: bigint, resolved: ResolvedFlagDecl, slotName: string): bigint;
    /**
     * Clear a single-bit flag (spec 6.4.1: & ~ operator).
     */
    static clearSingleBit(flagValue: bigint, resolved: ResolvedFlagDecl, slotName: string): bigint;
    /**
     * Toggle a single-bit flag (spec 6.4.1: ^ operator).
     */
    static toggleSingleBit(flagValue: bigint, resolved: ResolvedFlagDecl, slotName: string): bigint;
    /**
     * Validate a compile-time constant assignment to a flag slot (spec 6.4.2).
     * Compile-time constant overflow should be caught at compile time.
     */
    validateConstantAssignment(resolved: ResolvedFlagDecl, slotName: string, value: number, sourceLocation: {
        file: string;
        line: number;
        col: number;
    }): boolean;
}
export declare class FlagOverflowError extends Error {
    slotName: string;
    value: number;
    minValue: number;
    maxValue: number;
    constructor(slotName: string, value: number, minValue: number, maxValue: number);
}
export {};
//# sourceMappingURL=bitfield.d.ts.map
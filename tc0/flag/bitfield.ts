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

import {
    DeclNode, FlagSlot, FlagDecl as FlagDeclAst, FlagSetDecl as FlagSetDeclAst,
} from "../ast/nodes.js";
import {
    DiagnosticBag, ErrorCode, makeSpan,
} from "../diagnostics/diagnostic.js";
import { getBitWidth } from "../types/types.js";

// ─── SlotInfo (spec 5.3) ─────────────────────────────────────────

export interface SlotInfo {
    name: string;
    startBit: u32;
    bitLength: u32;
    minValue: u32;
    maxValue: u32;
    isSingleBit: boolean;  // true = 1bit boolean switch, false = multi-bit value field
    annotations: string[]; // annotation names for quick lookup
}

// Use number for u32 in TypeScript
type u32 = number;

// ─── Resolved Flag Layout ────────────────────────────────────────

export interface ResolvedFlagSlot extends SlotInfo {
    endBit: number;
}

export interface ResolvedFlagDecl {
    name: string;
    underlyingType: string;
    totalBits: number;
    slots: ResolvedFlagSlot[];
    isFlagSet: boolean;  // true for flag_set (dynamic, >64 bits)
}

// ─── Flag Layout Resolver ────────────────────────────────────────

export class FlagResolver {
    private bag: DiagnosticBag;

    constructor(bag: DiagnosticBag) {
        this.bag = bag;
    }

    /**
     * Resolve a flag[T] or flag_set declaration into a concrete bit layout.
     * Implements spec 6.1: auto top-down bit allocation, with @offset override.
     */
    resolve(decl: DeclNode): ResolvedFlagDecl | null {
        const dk = decl.declKind;

        if (dk.kind === "FlagDecl") {
            return this.resolveFlagDecl(dk);
        } else if (dk.kind === "FlagSetDecl") {
            return this.resolveFlagSetDecl(dk);
        }
        return null;
    }

    private resolveFlagDecl(dk: FlagDeclAst): ResolvedFlagDecl {
        const typeWidth = getBitWidth(dk.underlyingType) ?? 32;
        const slots: ResolvedFlagSlot[] = [];
        let autoOffset = 0;

        for (const slot of dk.slots) {
            const startBit = slot.offset !== null ? slot.offset : autoOffset;
            const endBit = startBit + slot.bitWidth;

            // Check overflow (spec 6.4.2: compile-time constant overflow check)
            if (endBit > typeWidth) {
                this.bag.error(
                    ErrorCode.T_FLAG_OVERFLOW,
                    `flag '${dk.name}' slot '${slot.name}' exceeds ${dk.underlyingType} capacity: ` +
                    `uses bits ${startBit}-${endBit - 1}, but ${dk.underlyingType} only has ${typeWidth} bits`,
                    makeSpan("", 0, 0, 0, 0),
                    {
                        validValues: [`0-${typeWidth - 1}`],
                        fixSuggestions: [{
                            description: `reduce bit width or use larger underlying type (u64)`,
                            range: makeSpan("", 0, 0, 0, 0),
                            replacement: `flag[u64]`,
                        }],
                    },
                );
            }

            // Check for overlaps with previously allocated slots
            for (const prev of slots) {
                if (startBit < prev.endBit && endBit > prev.startBit) {
                    this.bag.error(
                        ErrorCode.T_FLAG_OFFSET_CONFLICT,
                        `flag slot '${slot.name}' (bits ${startBit}-${endBit - 1}) overlaps with ` +
                        `'${prev.name}' (bits ${prev.startBit}-${prev.endBit - 1})`,
                        makeSpan("", 0, 0, 0, 0),
                    );
                }
            }

            const maxValue = (1 << slot.bitWidth) - 1;
            const slotInfo: ResolvedFlagSlot = {
                name: slot.name,
                startBit,
                bitLength: slot.bitWidth,
                minValue: 0,
                maxValue,
                isSingleBit: slot.bitWidth === 1,
                endBit,
                annotations: slot.annotations.map((a) => a.name),
            };
            slots.push(slotInfo);

            // Update auto offset: if this slot had explicit offset, continue from its end
            autoOffset = endBit;
        }

        return {
            name: dk.name,
            underlyingType: dk.underlyingType,
            totalBits: typeWidth,
            slots,
            isFlagSet: false,
        };
    }

    private resolveFlagSetDecl(dk: FlagSetDeclAst): ResolvedFlagDecl {
        // flag_set has no fixed underlying type — it's a dynamic-length container
        const slots: ResolvedFlagSlot[] = [];
        let autoOffset = 0;

        for (const slot of dk.slots) {
            const startBit = slot.offset ?? autoOffset;
            const endBit = startBit + slot.bitWidth;
            const maxValue = (1 << slot.bitWidth) - 1;

            slots.push({
                name: slot.name,
                startBit,
                bitLength: slot.bitWidth,
                minValue: 0,
                maxValue,
                isSingleBit: slot.bitWidth === 1,
                endBit,
                annotations: slot.annotations.map((a) => a.name),
            });

            autoOffset = endBit;
        }

        return {
            name: dk.name,
            underlyingType: "dynamic",
            totalBits: autoOffset,
            slots,
            isFlagSet: true,
        };
    }

    /**
     * Get SlotInfo for a specific slot by name (spec 5.3).
     * Used by type_info() for compile-time introspection.
     */
    static getSlotInfo(resolved: ResolvedFlagDecl, slotName: string): SlotInfo | null {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot) return null;
        return {
            name: slot.name,
            startBit: slot.startBit,
            bitLength: slot.bitLength,
            minValue: slot.minValue,
            maxValue: slot.maxValue,
            isSingleBit: slot.isSingleBit,
            annotations: slot.annotations,
        };
    }

    /**
     * Get all SlotInfo for a flag type (spec 5.3).
     */
    static getAllSlotInfo(resolved: ResolvedFlagDecl): SlotInfo[] {
        return resolved.slots.map((s) => ({
            name: s.name,
            startBit: s.startBit,
            bitLength: s.bitLength,
            minValue: s.minValue,
            maxValue: s.maxValue,
            isSingleBit: s.isSingleBit,
            annotations: s.annotations,
        }));
    }
}

// ─── Flag Read/Write Operations (spec 6.4) ──────────────────────

/**
 * Runtime flag operations implementing spec 6.4 read/write isolation rules:
 *
 * 1-bit slots: allow | & ^ |= &= ^= operators, but boolean check must be explicit != 0
 * >=2-bit slots: completely forbid direct bit operations, only use flag_set/flag_get
 *
 * flag_set(flag_instance, field_name, value) — write multi-bit value with bounds check
 * flag_get(flag_instance, field_name) -> u32 — read multi-bit value
 */
export class FlagOps {
    private bag: DiagnosticBag;

    constructor(bag: DiagnosticBag) {
        this.bag = bag;
    }

    /**
     * Write a value to a multi-bit flag slot (spec 6.4.2).
     * Performs runtime bounds checking (spec 6.4.2: variable runtime check).
     *
     * Returns the updated flag value, or throws on overflow.
     */
    static flagSetValue(
        flagValue: bigint,
        resolved: ResolvedFlagDecl,
        slotName: string,
        value: number,
    ): bigint {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot) {
            throw new Error(`unknown flag slot '${slotName}' in flag '${resolved.name}'`);
        }

        if (slot.isSingleBit) {
            throw new Error(
                `flag_set() cannot be used on 1-bit slot '${slotName}'. ` +
                `Use bitwise operators (| & ^) for single-bit flags (spec 6.4.1).`
            );
        }

        // Bounds check (spec 6.4.2: runtime check for variables)
        if (value < slot.minValue || value > slot.maxValue) {
            throw new FlagOverflowError(
                slot.name,
                value,
                slot.minValue,
                slot.maxValue,
            );
        }

        // Clear the slot bits and set new value
        const mask = BigInt((1 << slot.bitLength) - 1) << BigInt(slot.startBit);
        const cleared = flagValue & ~mask;
        const shifted = BigInt(value) << BigInt(slot.startBit);
        return cleared | shifted;
    }

    /**
     * Read a value from a multi-bit flag slot (spec 6.4.2).
     */
    static flagGetValue(
        flagValue: bigint,
        resolved: ResolvedFlagDecl,
        slotName: string,
    ): number {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot) {
            throw new Error(`unknown flag slot '${slotName}' in flag '${resolved.name}'`);
        }

        if (slot.isSingleBit) {
            throw new Error(
                `flag_get() cannot be used on 1-bit slot '${slotName}'. ` +
                `Use bitwise AND with explicit != 0 check (spec 6.4.1).`
            );
        }

        const mask = BigInt((1 << slot.bitLength) - 1);
        const shifted = flagValue >> BigInt(slot.startBit);
        return Number(shifted & mask);
    }

    /**
     * Check if a single-bit flag is set (spec 6.4.1: explicit != 0 comparison).
     */
    static isFlagSet(
        flagValue: bigint,
        resolved: ResolvedFlagDecl,
        slotName: string,
    ): boolean {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot) {
            throw new Error(`unknown flag slot '${slotName}' in flag '${resolved.name}'`);
        }

        if (!slot.isSingleBit) {
            throw new Error(
                `Direct bit check cannot be used on multi-bit slot '${slotName}'. ` +
                `Use flag_get() instead (spec 6.4.2).`
            );
        }

        const bit = (flagValue >> BigInt(slot.startBit)) & 1n;
        return bit !== 0n;  // spec 6.4.1: must be explicit != 0
    }

    /**
     * Set a single-bit flag (spec 6.4.1: | operator).
     */
    static setSingleBit(
        flagValue: bigint,
        resolved: ResolvedFlagDecl,
        slotName: string,
    ): bigint {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot || !slot.isSingleBit) {
            throw new Error(`'${slotName}' is not a single-bit flag slot`);
        }
        return flagValue | (1n << BigInt(slot.startBit));
    }

    /**
     * Clear a single-bit flag (spec 6.4.1: & ~ operator).
     */
    static clearSingleBit(
        flagValue: bigint,
        resolved: ResolvedFlagDecl,
        slotName: string,
    ): bigint {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot || !slot.isSingleBit) {
            throw new Error(`'${slotName}' is not a single-bit flag slot`);
        }
        return flagValue & ~(1n << BigInt(slot.startBit));
    }

    /**
     * Toggle a single-bit flag (spec 6.4.1: ^ operator).
     */
    static toggleSingleBit(
        flagValue: bigint,
        resolved: ResolvedFlagDecl,
        slotName: string,
    ): bigint {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot || !slot.isSingleBit) {
            throw new Error(`'${slotName}' is not a single-bit flag slot`);
        }
        return flagValue ^ (1n << BigInt(slot.startBit));
    }

    /**
     * Validate a compile-time constant assignment to a flag slot (spec 6.4.2).
     * Compile-time constant overflow should be caught at compile time.
     */
    validateConstantAssignment(
        resolved: ResolvedFlagDecl,
        slotName: string,
        value: number,
        sourceLocation: { file: string; line: number; col: number },
    ): boolean {
        const slot = resolved.slots.find((s) => s.name === slotName);
        if (!slot) return false;

        if (value < slot.minValue || value > slot.maxValue) {
            this.bag.error(
                ErrorCode.T_FLAG_OVERFLOW,
                `value ${value} is out of range for flag slot '${slotName}' ` +
                `(valid: ${slot.minValue}-${slot.maxValue}, ${slot.bitLength} bits)`,
                makeSpan(sourceLocation.file, sourceLocation.line, sourceLocation.col,
                         sourceLocation.line, sourceLocation.col + 5),
                {
                    validValues: [`${slot.minValue}-${slot.maxValue}`],
                    fixSuggestions: [{
                        description: `use a value between ${slot.minValue} and ${slot.maxValue}`,
                        range: makeSpan(sourceLocation.file, sourceLocation.line, sourceLocation.col,
                                        sourceLocation.line, sourceLocation.col + 5),
                        replacement: `${slot.maxValue}`,
                    }],
                },
            );
            return false;
        }
        return true;
    }
}

// ─── Flag Overflow Error ─────────────────────────────────────────

export class FlagOverflowError extends Error {
    constructor(
        public slotName: string,
        public value: number,
        public minValue: number,
        public maxValue: number,
    ) {
        super(
            `flag slot '${slotName}' overflow: value ${value} is out of range ` +
            `[${minValue}, ${maxValue}] (${maxValue.toString(2).length} bits)`
        );
        this.name = "FlagOverflowError";
    }
}

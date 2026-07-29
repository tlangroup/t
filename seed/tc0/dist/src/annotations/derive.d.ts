/**
 * t Language - Derive Handler
 *
 * Processes @derive annotations (spec 4.3) and generates corresponding
 * method implementations via AST manipulation / comptime code generation.
 *
 * Derivable traits:
 * - ToString:     auto-generate to_string() serialization
 * - FromString:   auto-generate from_string() deserialization (for CSV config)
 * - Clone:        deep clone method
 * - Copy:         bitwise copy marker
 * - DebugPrint:   debug format printing
 * - BinarySerde:  compact binary serialization/deserialization
 * - Eq/PartialEq: equality comparison
 * - Hash:         hash computation (for map keys)
 *
 * Implementation: comptime via type_info traversal, AST direct generation.
 * No string template concatenation (spec principle 3).
 */
import { DeclNode } from "../ast/nodes.js";
import { DerivableTrait } from "./registry.js";
import { TypeInfo } from "../types/types.js";
export interface GeneratedMethod {
    traitName: DerivableTrait;
    methodName: string;
    signature: string;
    bodyDescription: string;
    generatedCode: string;
}
export interface DeriveResult {
    declName: string;
    declKind: string;
    methods: GeneratedMethod[];
}
export declare class DeriveProcessor {
    /**
     * Process all @derive annotations on a declaration.
     * Returns generated method info for each trait.
     */
    process(decl: DeclNode, typeInfo: TypeInfo | null): DeriveResult;
    private getDeclName;
    private generateForTrait;
    private genToString;
    private genFromString;
    private genClone;
    private genCopy;
    private genDebugPrint;
    private genBinarySerde;
    private genEq;
    private genHash;
    private getFields;
}
//# sourceMappingURL=derive.d.ts.map
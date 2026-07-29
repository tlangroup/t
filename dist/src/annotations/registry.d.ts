/**
 * t Language - Annotation Registry
 *
 * Central registry for all built-in annotations (spec section 4).
 * Validates annotation usage: correct target, valid arguments, no duplicates.
 *
 * Six categories (spec 4.8):
 * 1. Test:          @test, @test_skip, @test_only, @expect_fail, @test_group
 * 2. Derive:        @derive(ToString, FromString, Clone, Copy, DebugPrint, BinarySerde, Eq, Hash)
 * 3. Conditional:   @cfg, @cfg_attr
 * 4. Warning:       @allow, @warn, @deny, @deprecated
 * 5. Layout/ABI:    @repr, @no_padding, @align, @binary_offset, @binary_skip, @bitpack, @offset, @soa, @aos
 * 6. Function/tool: @inline, @no_inline, @must_use, @const_fn, @unsafe, @main, @export_symbol, @link_name, @panic_handler, @doc, @doc_file
 */
import { AnnotationNode, DeclNode } from "../ast/nodes.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
export declare enum AnnotationCategory {
    Test = "test",
    Derive = "derive",
    Conditional = "conditional",
    Warning = "warning",
    Layout = "layout",
    Function = "function",
    Documentation = "documentation",
    Export = "export"
}
export declare const AnnotationTarget: {
    readonly Struct: "struct";
    readonly Enum: "enum";
    readonly Flag: "flag";
    readonly FlagSet: "flag_set";
    readonly Union: "union";
    readonly Func: "func";
    readonly Var: "var";
    readonly Const: "const";
    readonly Field: "field";
    readonly Param: "param";
    readonly EnumVariant: "enum_variant";
    readonly FlagSlot: "flag_slot";
    readonly Global: "global";
};
export type AnnotationTargetType = typeof AnnotationTarget[keyof typeof AnnotationTarget];
export interface AnnotationDef {
    name: string;
    category: AnnotationCategory;
    validTargets: AnnotationTargetType[];
    argSpec: "none" | "string" | "ident" | "ident_list" | "number" | "mixed";
    description: string;
    deprecated?: boolean;
    replacement?: string;
}
export declare const BUILTIN_ANNOTATIONS: AnnotationDef[];
export declare const DERIVABLE_TRAITS: readonly ["ToString", "FromString", "Clone", "Copy", "DebugPrint", "BinarySerde", "Eq", "PartialEq", "Hash"];
export type DerivableTrait = typeof DERIVABLE_TRAITS[number];
export declare const CFG_CONDITIONS: readonly ["debug", "release", "windows", "linux", "mac", "android", "web"];
export declare const VALID_WARNINGS: readonly ["unused", "unused_field", "dead_code", "overflow_literal", "implicit_cast", "bitfield_overlap", "deprecated"];
export declare class AnnotationRegistry {
    private annotations;
    private bag;
    constructor(bag: DiagnosticBag);
    /**
     * Validates an annotation against its definition.
     * Checks: known annotation, valid target, valid arguments.
     */
    validate(annotation: AnnotationNode, target: AnnotationTargetType): void;
    private validateArgs;
    /**
     * Get all annotations of a specific name from a declaration.
     */
    static getAnnotation(decl: DeclNode, name: string): AnnotationNode | null;
    /**
     * Check if a declaration has a specific annotation.
     */
    static hasAnnotation(decl: DeclNode, name: string): boolean;
    /**
     * Get derive traits from a declaration.
     */
    static getDeriveTraits(decl: DeclNode): DerivableTrait[];
    /**
     * Evaluate @cfg condition against the current build configuration.
     * Returns true if the node should be compiled.
     */
    static evaluateCfg(annotation: AnnotationNode, config: BuildConfig): boolean;
}
export interface BuildConfig {
    mode: "debug" | "release";
    platform: "windows" | "linux" | "mac" | "android" | "web";
    features: string[];
}
export declare const DEFAULT_CONFIG: BuildConfig;
//# sourceMappingURL=registry.d.ts.map
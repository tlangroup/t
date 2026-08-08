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

import { AnnotationNode, AnnotationArg, DeclNode } from "../ast/nodes.js";
import { DiagnosticBag, ErrorCode, makeSpan } from "../diagnostics/diagnostic.js";

// ─── Annotation Categories ───────────────────────────────────────

export enum AnnotationCategory {
    Test = "test",
    Derive = "derive",
    Conditional = "conditional",
    Warning = "warning",
    Layout = "layout",
    Function = "function",
    Documentation = "documentation",
    Export = "export",
}

// ─── Annotation Target Types ─────────────────────────────────────

export const AnnotationTarget = {
    Struct: "struct",
    Enum: "enum",
    Flag: "flag",
    FlagSet: "flag_set",
    Union: "union",
    Func: "func",
    Var: "var",
    Const: "const",
    Field: "field",
    Param: "param",
    EnumVariant: "enum_variant",
    FlagSlot: "flag_slot",
    Global: "global",
} as const;

export type AnnotationTargetType = typeof AnnotationTarget[keyof typeof AnnotationTarget];

// ─── Annotation Definition ───────────────────────────────────────

export interface AnnotationDef {
    name: string;
    category: AnnotationCategory;
    validTargets: AnnotationTargetType[];
    argSpec: "none" | "string" | "ident" | "ident_list" | "number" | "mixed";
    description: string;
    deprecated?: boolean;
    replacement?: string;
}

// ─── All Built-in Annotations (spec 4.8) ─────────────────────────

export const BUILTIN_ANNOTATIONS: AnnotationDef[] = [
    // ── Category 1: Test annotations (spec 4.2) ──
    // 全部弃用：测试改用并置式声明 `"name" test { ... }` / `"name" suite { ... }`
    // （tc 侧见 src/parse.tc parse_test_decl、docs/syntax/drafts/decl_test.md）。
    // tc0 不实现新语法，但必须镜像同样的弃用告警，否则 difftest 的 check 通道
    // 会在 tests/samples/*.tc 上与 tc 逐字节分叉。
    { name: "test",       category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "DEPRECATED: use a juxtaposed test declaration", deprecated: true, replacement: "a `\"name\" test { ... }` declaration" },
    { name: "test_skip",  category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "DEPRECATED: use @skip", deprecated: true, replacement: "@skip" },
    { name: "test_only",  category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "DEPRECATED: use @only", deprecated: true, replacement: "@only" },
    { name: "expect_fail",category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "DEPRECATED: use @should_fail", deprecated: true, replacement: "@should_fail" },
    { name: "test_group", category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "string", description: "DEPRECATED: use a suite block", deprecated: true, replacement: "a `\"name\" suite { ... }` block" },
    // 新式测试注解：tc0 只需认得它们（不报 unknown），语义由 tc 实现。
    { name: "skip",        category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "mixed", description: "Skip this test (optional reason string)" },
    { name: "only",        category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Run only the tests marked @only" },
    { name: "should_fail", category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "The test is expected to fail" },
    { name: "tag",         category: AnnotationCategory.Test, validTargets: [AnnotationTarget.Func], argSpec: "ident_list", description: "Attach filter tags to a test" },

    // ── Category 2: Derive annotations (spec 4.3) ──
    { name: "derive",     category: AnnotationCategory.Derive, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Flag, AnnotationTarget.FlagSet, AnnotationTarget.Union], argSpec: "ident_list", description: "Auto-generate trait implementations" },

    // ── Category 3: Conditional compilation (spec 4.4) ──
    { name: "cfg",        category: AnnotationCategory.Conditional, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident", description: "Conditionally compile this node" },
    { name: "cfg_attr",   category: AnnotationCategory.Conditional, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum], argSpec: "mixed", description: "Conditionally apply another annotation" },

    // ── Category 4: Warning control (spec 4.5) ──
    { name: "allow",      category: AnnotationCategory.Warning, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident_list", description: "Suppress warnings" },
    { name: "warn",       category: AnnotationCategory.Warning, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident_list", description: "Promote to warning" },
    { name: "deny",       category: AnnotationCategory.Warning, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident_list", description: "Promote to error" },
    { name: "deprecated", category: AnnotationCategory.Warning, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "string", description: "Mark as deprecated with replacement message" },

    // ── Category 5: Layout / ABI / Serialization (spec 4.6) ──
    { name: "repr",           category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Union], argSpec: "ident", description: "Specify memory representation: C, Packed, Align(N)" },
    { name: "no_padding",     category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Flag], argSpec: "none", description: "Alias for @repr(Packed)" },
    { name: "align",          category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Union], argSpec: "number", description: "Force memory alignment" },
    { name: "bitpack",        category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Struct], argSpec: "ident", description: "Pack struct as bitfield over underlying integer type" },
    { name: "offset",         category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.FlagSlot], argSpec: "number", description: "Force bit offset for flag slot" },
    { name: "binary_offset",  category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Field], argSpec: "number", description: "Force binary serialization byte offset" },
    { name: "binary_skip",    category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Field], argSpec: "none", description: "Skip this field during binary serialization" },
    { name: "soa",            category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Struct], argSpec: "none", description: "Use Structure-of-Arrays layout" },
    { name: "aos",            category: AnnotationCategory.Layout, validTargets: [AnnotationTarget.Struct], argSpec: "none", description: "Use Array-of-Structures layout (default)" },

    // ── Category 6: Function behavior & toolchain (spec 4.7) ──
    { name: "inline",         category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Force inline this function" },
    { name: "no_inline",      category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Prevent inlining this function" },
    { name: "must_use",       category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Return value must be used" },
    { name: "const_fn",       category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Function can be evaluated at compile time" },
    { name: "unsafe",         category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Mark function as containing unsafe operations" },
    { name: "main",           category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Mark program entry point" },
    { name: "export_symbol",  category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "string", description: "Export symbol name for dynamic library" },
    { name: "link_name",      category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "string", description: "Bind to external C library symbol name" },
    { name: "panic_handler",  category: AnnotationCategory.Function, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Custom global panic handler" },

    // ── Documentation annotations ──
    { name: "doc",            category: AnnotationCategory.Documentation, validTargets: [AnnotationTarget.Global], argSpec: "string", description: "Documentation comment" },
    { name: "doc_file",       category: AnnotationCategory.Documentation, validTargets: [AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum], argSpec: "string", description: "Mount external documentation file" },

    // ── Export annotations (spec 4.1) ──
    { name: "export",         category: AnnotationCategory.Export, validTargets: [AnnotationTarget.Field, AnnotationTarget.Func, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "mixed", description: "Export to editor inspector / external config tool" },

    // ── Deprecated / transitional (spec 4.1.5, 9.3) ──
    { name: "auto_convert",   category: AnnotationCategory.Derive, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Enum], argSpec: "none", description: "DEPRECATED: use @derive instead", deprecated: true, replacement: "@derive(FromString)" },
];

// ─── Derivable Traits (spec 4.3) ─────────────────────────────────

export const DERIVABLE_TRAITS = [
    "ToString",
    "FromString",
    "Clone",
    "Copy",
    "DebugPrint",
    "BinarySerde",
    "Eq",
    "PartialEq",
    "Hash",
] as const;

export type DerivableTrait = typeof DERIVABLE_TRAITS[number];

// ─── Valid cfg conditions (spec 4.4) ─────────────────────────────

export const CFG_CONDITIONS = [
    "debug", "release",
    "windows", "linux", "mac", "android", "web",
] as const;

// ─── Valid warning items (spec 4.5) ──────────────────────────────

export const VALID_WARNINGS = [
    "unused", "unused_field", "dead_code",
    "overflow_literal", "implicit_cast",
    "bitfield_overlap", "deprecated",
] as const;

// ─── Annotation Registry ─────────────────────────────────────────

export class AnnotationRegistry {
    private annotations: Map<string, AnnotationDef> = new Map();
    private bag: DiagnosticBag;

    constructor(bag: DiagnosticBag) {
        this.bag = bag;
        for (const def of BUILTIN_ANNOTATIONS) {
            this.annotations.set(def.name, def);
        }
    }

    /**
     * Validates an annotation against its definition.
     * Checks: known annotation, valid target, valid arguments.
     */
    validate(annotation: AnnotationNode, target: AnnotationTargetType): void {
        const def = this.annotations.get(annotation.name);

        if (!def) {
            const tok = annotation.token!;
            this.bag.error(
                ErrorCode.T_ANNOTATION_UNKNOWN,
                `unknown annotation '@${annotation.name}'`,
                makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                { validValues: [...this.annotations.keys()].map((n) => `@${n}`) },
            );
            return;
        }

        // Check deprecated
        if (def.deprecated) {
            const tok = annotation.token!;
            this.bag.warning(
                ErrorCode.T_ANNOTATION_UNKNOWN,
                `annotation '@${annotation.name}' is deprecated${def.replacement ? `, use ${def.replacement} instead` : ""}`,
                makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
            );
        }

        // Check target validity
        if (!def.validTargets.includes(target)) {
            const tok = annotation.token!;
            this.bag.error(
                ErrorCode.T_ANNOTATION_WRONG_TARGET,
                `annotation '@${annotation.name}' cannot be applied to ${target}, valid targets: ${def.validTargets.join(", ")}`,
                makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                { validValues: def.validTargets },
            );
        }

        // Validate arguments
        this.validateArgs(annotation, def);
    }

    private validateArgs(annotation: AnnotationNode, def: AnnotationDef): void {
        const args = annotation.args;
        const tok = annotation.token!;

        switch (def.argSpec) {
            case "none":
                if (args.length > 0) {
                    this.bag.error(
                        ErrorCode.T_ANNOTATION_INVALID_ARG,
                        `annotation '@${annotation.name}' takes no arguments`,
                        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                    );
                }
                break;
            case "string":
                if (args.length !== 1 || args[0].kind !== "StringArg") {
                    this.bag.error(
                        ErrorCode.T_ANNOTATION_INVALID_ARG,
                        `annotation '@${annotation.name}' requires exactly one string argument`,
                        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                        { validValues: ['@${annotation.name}("text")'] },
                    );
                }
                break;
            case "ident":
                if (args.length !== 1 || (args[0].kind !== "IdentArg" && args[0].kind !== "ListArg")) {
                    this.bag.error(
                        ErrorCode.T_ANNOTATION_INVALID_ARG,
                        `annotation '@${annotation.name}' requires one identifier argument`,
                        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                    );
                }
                // Validate specific values
                if (annotation.name === "cfg" && args[0].kind === "IdentArg") {
                    if (!CFG_CONDITIONS.includes(args[0].value as any) && !args[0].value.startsWith("feature=")) {
                        this.bag.error(
                            ErrorCode.T_ANNOTATION_INVALID_ARG,
                            `invalid @cfg condition '${args[0].value}'`,
                            makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                            { validValues: [...CFG_CONDITIONS] },
                        );
                    }
                }
                break;
            case "ident_list":
                if (args.length < 1) {
                    this.bag.error(
                        ErrorCode.T_ANNOTATION_INVALID_ARG,
                        `annotation '@${annotation.name}' requires at least one argument`,
                        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                    );
                }
                // Validate derive traits
                if (annotation.name === "derive") {
                    for (const arg of args) {
                        const traits: string[] = arg.kind === "ListArg"
                            ? arg.values.map((v) => v.kind === "IdentArg" ? v.value : "")
                            : [arg.kind === "IdentArg" ? arg.value : ""];
                        for (const trait of traits) {
                            if (!DERIVABLE_TRAITS.includes(trait as DerivableTrait)) {
                                this.bag.error(
                                    ErrorCode.T_DERIVE_UNSUPPORTED,
                                    `unsupported derive trait '${trait}'`,
                                    makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + 20),
                                    { validValues: [...DERIVABLE_TRAITS] },
                                );
                            }
                        }
                    }
                }
                // Validate warning items
                if (["allow", "warn", "deny"].includes(annotation.name)) {
                    for (const arg of args) {
                        const warnings: string[] = arg.kind === "ListArg"
                            ? arg.values.map((v) => v.kind === "IdentArg" ? v.value : "")
                            : [arg.kind === "IdentArg" ? arg.value : ""];
                        for (const w of warnings) {
                            if (!VALID_WARNINGS.includes(w as any)) {
                                this.bag.error(
                                    ErrorCode.T_ANNOTATION_INVALID_ARG,
                                    `unknown warning item '${w}'`,
                                    makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + 20),
                                    { validValues: [...VALID_WARNINGS] },
                                );
                            }
                        }
                    }
                }
                break;
            case "number":
                if (args.length !== 1 || args[0].kind !== "NumberArg") {
                    this.bag.error(
                        ErrorCode.T_ANNOTATION_INVALID_ARG,
                        `annotation '@${annotation.name}' requires one numeric argument`,
                        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
                    );
                }
                break;
            case "mixed":
                // Mixed args are allowed without strict checking
                break;
        }
    }

    /**
     * Get all annotations of a specific name from a declaration.
     */
    static getAnnotation(decl: DeclNode, name: string): AnnotationNode | null {
        for (const ann of decl.annotations) {
            if (ann.name === name) return ann;
        }
        return null;
    }

    /**
     * Check if a declaration has a specific annotation.
     */
    static hasAnnotation(decl: DeclNode, name: string): boolean {
        return this.getAnnotation(decl, name) !== null;
    }

    /**
     * Get derive traits from a declaration.
     */
    static getDeriveTraits(decl: DeclNode): DerivableTrait[] {
        const deriveAnno = this.getAnnotation(decl, "derive");
        if (!deriveAnno) return [];
        const traits: DerivableTrait[] = [];
        for (const arg of deriveAnno.args) {
            if (arg.kind === "IdentArg") {
                traits.push(arg.value as DerivableTrait);
            } else if (arg.kind === "ListArg") {
                for (const v of arg.values) {
                    if (v.kind === "IdentArg") traits.push(v.value as DerivableTrait);
                }
            }
        }
        return traits;
    }

    /**
     * Evaluate @cfg condition against the current build configuration.
     * Returns true if the node should be compiled.
     */
    static evaluateCfg(annotation: AnnotationNode, config: BuildConfig): boolean {
        if (annotation.args.length === 0) return true;
        const arg = annotation.args[0];
        if (arg.kind !== "IdentArg") return true;
        const condition = arg.value;

        if (condition === "debug") return config.mode === "debug";
        if (condition === "release") return config.mode === "release";
        if (condition === "windows") return config.platform === "windows";
        if (condition === "linux") return config.platform === "linux";
        if (condition === "mac") return config.platform === "mac";
        if (condition === "android") return config.platform === "android";
        if (condition === "web") return config.platform === "web";
        if (condition.startsWith("feature=")) {
            const feature = condition.substring(8);
            return config.features.includes(feature);
        }
        return true;
    }
}

// ─── Build Configuration ─────────────────────────────────────────

export interface BuildConfig {
    mode: "debug" | "release";
    platform: "windows" | "linux" | "mac" | "android" | "web";
    features: string[];
}

export const DEFAULT_CONFIG: BuildConfig = {
    mode: "debug",
    platform: "windows",
    features: [],
};

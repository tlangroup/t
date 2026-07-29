/**
 * t Language - Diagnostics System
 *
 * Dual-output diagnostic system per spec section 8.2:
 * 1. Human-readable text
 * 2. JSON machine diagnostic package (error code, line/col, cause, fix suggestion)
 *
 * Supports AI Agent "error parse -> auto-fix -> recompile" closed loop.
 */
export declare enum Severity {
    Error = "error",
    Warning = "warning",
    Info = "info",
    Note = "note"
}
export interface SourceSpan {
    file: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
}
export declare function makeSpan(file: string, startLine: number, startCol: number, endLine: number, endCol: number): SourceSpan;
/**
 * Structured error codes for machine-parseable diagnostics.
 * Format: T_<CATEGORY>_<NAME>
 */
export declare const ErrorCode: {
    readonly T_LEX_INVALID_CHAR: "T_LEX_INVALID_CHAR";
    readonly T_LEX_UNTERMINATED_STRING: "T_LEX_UNTERMINATED_STRING";
    readonly T_LEX_INVALID_NUMBER: "T_LEX_INVALID_NUMBER";
    readonly T_PARSE_UNEXPECTED_TOKEN: "T_PARSE_UNEXPECTED_TOKEN";
    readonly T_PARSE_EXPECTED_TOKEN: "T_PARSE_EXPECTED_TOKEN";
    readonly T_PARSE_MISSING_SEMI: "T_PARSE_MISSING_SEMI";
    readonly T_PARSE_MISSING_BRACE: "T_PARSE_MISSING_BRACE";
    readonly T_PARSE_MISSING_PAREN: "T_PARSE_MISSING_PAREN";
    readonly T_PARSE_INVALID_EXPR: "T_PARSE_INVALID_EXPR";
    readonly T_PARSE_INVALID_DECL: "T_PARSE_INVALID_DECL";
    readonly T_NAME_TYPE_CAMEL: "T_NAME_TYPE_CAMEL";
    readonly T_NAME_VAR_SNAKE: "T_NAME_VAR_SNAKE";
    readonly T_NAME_CONST_UPPER: "T_NAME_CONST_UPPER";
    readonly T_NAME_ANNOTATION_LOWER: "T_NAME_ANNOTATION_LOWER";
    readonly T_STMT_MISSING_BRACES: "T_STMT_MISSING_BRACES";
    readonly T_STMT_MISSING_SEMI: "T_STMT_MISSING_SEMI";
    readonly T_STMT_TERNARY_FORBIDDEN: "T_STMT_TERNARY_FORBIDDEN";
    readonly T_STMT_GOTO_FORBIDDEN: "T_STMT_GOTO_FORBIDDEN";
    readonly T_STMT_IMPLICIT_BOOL: "T_STMT_IMPLICIT_BOOL";
    readonly T_STMT_MISSING_PARENS: "T_STMT_MISSING_PARENS";
    readonly T_TYPE_MISMATCH: "T_TYPE_MISMATCH";
    readonly T_TYPE_UNKNOWN: "T_TYPE_UNKNOWN";
    readonly T_TYPE_AMBIGUOUS_INT: "T_TYPE_AMBIGUOUS_INT";
    readonly T_TYPE_IMPLICIT_CAST: "T_TYPE_IMPLICIT_CAST";
    readonly T_ANNOTATION_UNKNOWN: "T_ANNOTATION_UNKNOWN";
    readonly T_ANNOTATION_INVALID_ARG: "T_ANNOTATION_INVALID_ARG";
    readonly T_ANNOTATION_WRONG_TARGET: "T_ANNOTATION_WRONG_TARGET";
    readonly T_ANNOTATION_DUPLICATE: "T_ANNOTATION_DUPLICATE";
    readonly T_FLAG_OVERFLOW: "T_FLAG_OVERFLOW";
    readonly T_FLAG_BITOP_FORBIDDEN: "T_FLAG_BITOP_FORBIDDEN";
    readonly T_FLAG_OFFSET_CONFLICT: "T_FLAG_OFFSET_CONFLICT";
    readonly T_DERIVE_UNSUPPORTED: "T_DERIVE_UNSUPPORTED";
    readonly T_CTFE_NOT_CONST: "T_CTFE_NOT_CONST";
    readonly T_CTFE_EVAL_FAILED: "T_CTFE_EVAL_FAILED";
    readonly T_INTERNAL: "T_INTERNAL";
};
export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];
export interface FixSuggestion {
    description: string;
    range: SourceSpan;
    replacement: string;
}
export interface Diagnostic {
    code: ErrorCodeType;
    severity: Severity;
    message: string;
    span: SourceSpan;
    validValues?: string[];
    fixSuggestions?: FixSuggestion[];
    notes?: string[];
}
export declare class DiagnosticBag {
    private diagnostics;
    add(diag: Diagnostic): void;
    error(code: ErrorCodeType, message: string, span: SourceSpan, opts?: {
        validValues?: string[];
        fixSuggestions?: FixSuggestion[];
        notes?: string[];
    }): void;
    warning(code: ErrorCodeType, message: string, span: SourceSpan, opts?: {
        notes?: string[];
    }): void;
    info(code: ErrorCodeType, message: string, span: SourceSpan): void;
    hasErrors(): boolean;
    count(): number;
    getAll(): readonly Diagnostic[];
    clear(): void;
    merge(other: DiagnosticBag): void;
    toHumanReadable(): string;
    toJson(): string;
}
//# sourceMappingURL=diagnostic.d.ts.map
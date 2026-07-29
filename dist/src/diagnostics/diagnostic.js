/**
 * t Language - Diagnostics System
 *
 * Dual-output diagnostic system per spec section 8.2:
 * 1. Human-readable text
 * 2. JSON machine diagnostic package (error code, line/col, cause, fix suggestion)
 *
 * Supports AI Agent "error parse -> auto-fix -> recompile" closed loop.
 */
// ─── Error Severity ───────────────────────────────────────────────
export var Severity;
(function (Severity) {
    Severity["Error"] = "error";
    Severity["Warning"] = "warning";
    Severity["Info"] = "info";
    Severity["Note"] = "note";
})(Severity || (Severity = {}));
export function makeSpan(file, startLine, startCol, endLine, endCol) {
    return { file, startLine, startCol, endLine, endCol };
}
// ─── Error Codes ─────────────────────────────────────────────────
/**
 * Structured error codes for machine-parseable diagnostics.
 * Format: T_<CATEGORY>_<NAME>
 */
export const ErrorCode = {
    // Lexer errors
    T_LEX_INVALID_CHAR: "T_LEX_INVALID_CHAR",
    T_LEX_UNTERMINATED_STRING: "T_LEX_UNTERMINATED_STRING",
    T_LEX_INVALID_NUMBER: "T_LEX_INVALID_NUMBER",
    // Parser errors
    T_PARSE_UNEXPECTED_TOKEN: "T_PARSE_UNEXPECTED_TOKEN",
    T_PARSE_EXPECTED_TOKEN: "T_PARSE_EXPECTED_TOKEN",
    T_PARSE_MISSING_SEMI: "T_PARSE_MISSING_SEMI",
    T_PARSE_MISSING_BRACE: "T_PARSE_MISSING_BRACE",
    T_PARSE_MISSING_PAREN: "T_PARSE_MISSING_PAREN",
    T_PARSE_INVALID_EXPR: "T_PARSE_INVALID_EXPR",
    T_PARSE_INVALID_DECL: "T_PARSE_INVALID_DECL",
    // Naming convention errors (spec 1.1)
    T_NAME_TYPE_CAMEL: "T_NAME_TYPE_CAMEL",
    T_NAME_VAR_SNAKE: "T_NAME_VAR_SNAKE",
    T_NAME_CONST_UPPER: "T_NAME_CONST_UPPER",
    T_NAME_ANNOTATION_LOWER: "T_NAME_ANNOTATION_LOWER",
    // Statement rule errors (spec 1.2)
    T_STMT_MISSING_BRACES: "T_STMT_MISSING_BRACES",
    T_STMT_MISSING_SEMI: "T_STMT_MISSING_SEMI",
    T_STMT_TERNARY_FORBIDDEN: "T_STMT_TERNARY_FORBIDDEN",
    T_STMT_GOTO_FORBIDDEN: "T_STMT_GOTO_FORBIDDEN",
    T_STMT_IMPLICIT_BOOL: "T_STMT_IMPLICIT_BOOL",
    T_STMT_MISSING_PARENS: "T_STMT_MISSING_PARENS",
    // Type errors
    T_TYPE_MISMATCH: "T_TYPE_MISMATCH",
    T_TYPE_UNKNOWN: "T_TYPE_UNKNOWN",
    T_TYPE_AMBIGUOUS_INT: "T_TYPE_AMBIGUOUS_INT",
    T_TYPE_IMPLICIT_CAST: "T_TYPE_IMPLICIT_CAST",
    // Annotation errors
    T_ANNOTATION_UNKNOWN: "T_ANNOTATION_UNKNOWN",
    T_ANNOTATION_INVALID_ARG: "T_ANNOTATION_INVALID_ARG",
    T_ANNOTATION_WRONG_TARGET: "T_ANNOTATION_WRONG_TARGET",
    T_ANNOTATION_DUPLICATE: "T_ANNOTATION_DUPLICATE",
    // Flag/bitfield errors
    T_FLAG_OVERFLOW: "T_FLAG_OVERFLOW",
    T_FLAG_BITOP_FORBIDDEN: "T_FLAG_BITOP_FORBIDDEN",
    T_FLAG_OFFSET_CONFLICT: "T_FLAG_OFFSET_CONFLICT",
    // Derive errors
    T_DERIVE_UNSUPPORTED: "T_DERIVE_UNSUPPORTED",
    // CTFE errors
    T_CTFE_NOT_CONST: "T_CTFE_NOT_CONST",
    T_CTFE_EVAL_FAILED: "T_CTFE_EVAL_FAILED",
    // General
    T_INTERNAL: "T_INTERNAL",
};
// ─── Diagnostic Reporter ─────────────────────────────────────────
export class DiagnosticBag {
    diagnostics = [];
    add(diag) {
        this.diagnostics.push(diag);
    }
    error(code, message, span, opts) {
        this.add({
            code,
            severity: Severity.Error,
            message,
            span,
            validValues: opts?.validValues,
            fixSuggestions: opts?.fixSuggestions,
            notes: opts?.notes,
        });
    }
    warning(code, message, span, opts) {
        this.add({
            code,
            severity: Severity.Warning,
            message,
            span,
            notes: opts?.notes,
        });
    }
    info(code, message, span) {
        this.add({ code, severity: Severity.Info, message, span });
    }
    hasErrors() {
        return this.diagnostics.some((d) => d.severity === Severity.Error);
    }
    count() {
        return this.diagnostics.length;
    }
    getAll() {
        return this.diagnostics;
    }
    clear() {
        this.diagnostics = [];
    }
    merge(other) {
        this.diagnostics.push(...other.diagnostics);
    }
    // ── Human-readable output (spec 8.2.1) ──
    toHumanReadable() {
        const lines = [];
        for (const diag of this.diagnostics) {
            const loc = `${diag.span.file}:${diag.span.startLine}:${diag.span.startCol}`;
            const sev = diag.severity.toUpperCase();
            lines.push(`${loc} ${sev} [${diag.code}]: ${diag.message}`);
            if (diag.validValues && diag.validValues.length > 0) {
                lines.push(`  valid values: ${diag.validValues.join(", ")}`);
            }
            if (diag.fixSuggestions) {
                for (const fix of diag.fixSuggestions) {
                    lines.push(`  fix: ${fix.description}`);
                    lines.push(`    -> replace with: ${fix.replacement}`);
                }
            }
            if (diag.notes) {
                for (const note of diag.notes) {
                    lines.push(`  note: ${note}`);
                }
            }
        }
        const errorCount = this.diagnostics.filter((d) => d.severity === Severity.Error).length;
        const warnCount = this.diagnostics.filter((d) => d.severity === Severity.Warning).length;
        lines.push("");
        lines.push(`${errorCount} error(s), ${warnCount} warning(s)`);
        return lines.join("\n");
    }
    // ── JSON machine diagnostic output (spec 8.2.2) ──
    toJson() {
        return JSON.stringify({
            diagnostics: this.diagnostics.map((d) => ({
                code: d.code,
                severity: d.severity,
                message: d.message,
                location: {
                    file: d.span.file,
                    startLine: d.span.startLine,
                    startCol: d.span.startCol,
                    endLine: d.span.endLine,
                    endCol: d.span.endCol,
                },
                validValues: d.validValues ?? null,
                fixSuggestions: d.fixSuggestions?.map((f) => ({
                    description: f.description,
                    range: {
                        file: f.range.file,
                        startLine: f.range.startLine,
                        startCol: f.range.startCol,
                        endLine: f.range.endLine,
                        endCol: f.range.endCol,
                    },
                    replacement: f.replacement,
                })) ?? null,
                notes: d.notes ?? null,
            })),
            summary: {
                total: this.diagnostics.length,
                errors: this.diagnostics.filter((d) => d.severity === Severity.Error).length,
                warnings: this.diagnostics.filter((d) => d.severity === Severity.Warning).length,
                infos: this.diagnostics.filter((d) => d.severity === Severity.Info).length,
            },
        }, null, 2);
    }
}
//# sourceMappingURL=diagnostic.js.map
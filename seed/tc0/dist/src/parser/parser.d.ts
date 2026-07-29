/**
 * t Language - Parser
 *
 * Recursive descent parser for the t programming language.
 * Implements spec sections 1-6 syntax rules:
 * - Declaration syntax: Name :: <decl_body>
 * - Struct/Enum/Flag/Union/Func declarations
 * - Statement parsing with enforced braces (spec 1.2)
 * - Expression parsing with full precedence
 * - Annotation parsing: @name(args)
 * - Memory layout directives: #aos, #soa
 *
 * Enforces naming conventions (spec 1.1) and statement rules (spec 1.2).
 */
import { Token } from "../lexer/token.js";
import { CompilationUnit } from "../ast/nodes.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
export declare class Parser {
    private tokens;
    private pos;
    private file;
    private bag;
    constructor(tokens: Token[], file: string, bag: DiagnosticBag);
    parse(): CompilationUnit;
    private current;
    private peek;
    private advance;
    private isAtEnd;
    private check;
    private match;
    private expect;
    private tokenRepr;
    private synchronize;
    private parseDeclaration;
    private parseDeclBody;
    private parseStructDecl;
    private parseEnumDecl;
    private parseFlagDecl;
    private parseFlagSetDecl;
    private parseUnionDecl;
    private parseFuncDecl;
    private parseGlobalVar;
    private parseImport;
    private parseTypeAlias;
    private parseAnnotations;
    private parseAnnotationArgs;
    private parseType;
    private parseBlock;
    private parseStatement;
    private parseIfStmt;
    private parseForStmt;
    private parseWhileStmt;
    private parseSwitchStmt;
    private parseReturnStmt;
    private parseLocalVar;
    private parseExprOrAssignStmt;
    private parseExpr;
    private parseAssignment;
    private parseLogicOr;
    private parseLogicAnd;
    private parseBitOr;
    private parseBitXor;
    private parseBitAnd;
    private parseEquality;
    private parseComparison;
    private parseShift;
    private parseAdd;
    private parseMul;
    private parseUnary;
    private parsePostfix;
    private parsePrimary;
    private looksLikeStructLit;
    private parseStructLit;
    private parseArrayLit;
    private parseMapLit;
    private validateDeclName;
    private validateVarName;
    private validateConstName;
}
//# sourceMappingURL=parser.d.ts.map
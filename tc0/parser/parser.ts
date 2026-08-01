/**
 * t Language - Parser
 *
 * Recursive descent parser for the t programming language.
 * Implements spec sections 1-6 syntax rules:
 * - Declaration syntax: Name [::] <decl_body>   (:: optional since 2026-08-01; Name fn(...) / Name struct {...} / Name Type;)
 * - Struct/Enum/Flag/Union/Func declarations
 * - Statement parsing with enforced braces (spec 1.2)
 * - Expression parsing with full precedence
 * - Annotation parsing: @name(args)
 * - Memory layout directives: #aos, #soa
 *
 * Enforces naming conventions (spec 1.1) and statement rules (spec 1.2).
 */

import { Token, TokenType } from "../lexer/token.js";
import {
    AnnotationNode, AnnotationArg,
    AstNode,
    CompilationUnit,
    DeclNode,
    ExprNode,
    FlagSlot,
    FuncParam,
    MemoryLayout,
    StmtNode,
    StructField,
    SwitchCase,
    TypeKind,
    TypeNode,
    EnumVariant,
    UnionMember,
} from "../ast/nodes.js";
import {
    DiagnosticBag, ErrorCode, makeSpan, Severity,
} from "../diagnostics/diagnostic.js";

// ─── Helper constructors ─────────────────────────────────────────

function mkType(inner: TypeKind, token?: Token): TypeNode {
    return { kind: "Type", inner, token };
}

function mkExpr(exprKind: any, token?: Token): ExprNode {
    return { kind: "Expr", exprKind, token };
}

function mkStmt(stmtKind: any, token?: Token): StmtNode {
    return { kind: "Stmt", stmtKind, token };
}

function spanOf(token: Token) {
    return {
        file: token.file,
        startLine: token.line,
        startCol: token.col,
        endLine: token.line,
        endCol: token.col + token.value.length,
    };
}

// ─── Parser ──────────────────────────────────────────────────────

export class Parser {
    private tokens: Token[];
    private pos: number = 0;
    private file: string;
    private bag: DiagnosticBag;

    constructor(tokens: Token[], file: string, bag: DiagnosticBag) {
        this.tokens = tokens;
        this.file = file;
        this.bag = bag;
    }

    parse(): CompilationUnit {
        const declarations: DeclNode[] = [];

        while (!this.isAtEnd()) {
            // Skip stray semicolons between declarations
            if (this.check(TokenType.Semicolon)) {
                this.advance();
                continue;
            }

            const decl = this.parseDeclaration();
            if (decl) {
                declarations.push(decl);
            }
        }

        const moduleName = this.file.replace(/\.tc$/, "").replace(/.*[\\/]/, "");

        return { file: this.file, moduleName, declarations };
    }

    // ── Token helpers ─────────────────────────────────────────────

    private current(): Token {
        return this.tokens[this.pos];
    }

    private peek(offset: number = 0): Token {
        const idx = this.pos + offset;
        return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.pos++;
        return this.tokens[this.pos - 1];
    }

    private isAtEnd(): boolean {
        return this.current().type === TokenType.Eof;
    }

    private check(type: TokenType): boolean {
        return this.current().type === type;
    }

    private match(...types: TokenType[]): Token | null {
        for (const t of types) {
            if (this.check(t)) return this.advance();
        }
        return null;
    }

    private expect(type: TokenType, errorMsg?: string): Token {
        if (this.check(type)) return this.advance();
        const tok = this.current();
        const msg = errorMsg ?? `expected ${TokenType[type]} but found '${tok.value}'`;
        this.bag.error(
            ErrorCode.T_PARSE_EXPECTED_TOKEN,
            msg,
            makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length),
            {
                fixSuggestions: [{
                    description: `insert ${TokenType[type]} here`,
                    range: makeSpan(this.file, tok.line, tok.col, tok.line, tok.col),
                    replacement: this.tokenRepr(type),
                }],
            },
        );
        return tok; // return error token to continue parsing
    }

    private tokenRepr(type: TokenType): string {
        const map: Partial<Record<TokenType, string>> = {
            [TokenType.Semicolon]: ";",
            [TokenType.LBrace]: "{",
            [TokenType.RBrace]: "}",
            [TokenType.LParen]: "(",
            [TokenType.RParen]: ")",
            [TokenType.LBracket]: "[",
            [TokenType.RBracket]: "]",
            [TokenType.Comma]: ",",
            [TokenType.Colon]: ":",
            [TokenType.Arrow]: "->",
            [TokenType.DoubleColon]: "::",
            [TokenType.Assign]: "=",
        };
        return map[type] ?? TokenType[type];
    }

    private synchronize(): void {
        // Skip to next likely declaration start
        while (!this.isAtEnd()) {
            if (this.check(TokenType.Semicolon)) { this.advance(); return; }
            if (this.check(TokenType.RBrace)) { this.advance(); return; }
            this.advance();
        }
    }

    // ─── Declaration parsing ──────────────────────────────────────

    private parseDeclaration(): DeclNode | null {
        // Collect leading annotations
        const annotations = this.parseAnnotations();

        // var / const / import keywords
        if (this.check(TokenType.KwVar)) {
            return this.parseGlobalVar(false);
        }
        if (this.check(TokenType.KwConst)) {
            return this.parseGlobalVar(true);
        }
        if (this.check(TokenType.KwImport)) {
            return this.parseImport(annotations);
        }

        // Type declarations: Name :: <body>
        // Also handle comptime prefix for func/var
        let isComptime = false;
        if (this.check(TokenType.KwComptime)) {
            this.advance();
            isComptime = true;
        }

        if (!this.check(TokenType.Identifier)) {
            const tok = this.current();
            this.bag.error(
                ErrorCode.T_PARSE_INVALID_DECL,
                `expected declaration name but found '${tok.value}'`,
                makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length),
            );
            this.synchronize();
            return null;
        }

        const nameTok = this.advance();
        const name = nameTok.value;

        // Validate naming convention (spec 1.1)
        this.validateDeclName(name, nameTok);

        // The '::' binder is OPTIONAL since the 2026-08-01 migration:
        //   old: Name :: func(...) / Name :: struct { ... } / Name :: Type;
        //   new: Name fn(...)      / Name struct { ... }      / Name Type;
        // Both forms are accepted so tc0 remains a usable reference for migrated sources.
        this.match(TokenType.DoubleColon);

        // Parse declaration body based on next token
        const decl = this.parseDeclBody(name, nameTok, annotations, isComptime);
        return decl;
    }

    private parseDeclBody(
        name: string,
        nameTok: Token,
        annotations: AnnotationNode[],
        isComptime: boolean,
    ): DeclNode {
        const tok = this.current();

        // #soa / #aos memory layout directive
        let memoryLayout: MemoryLayout = "default";
        if (this.check(TokenType.Hash)) {
            const hashTok = this.advance();
            const layoutName = this.advance();
            if (layoutName.type === TokenType.Identifier) {
                if (layoutName.value === "soa") memoryLayout = "soa";
                else if (layoutName.value === "aos") memoryLayout = "aos";
                else {
                    this.bag.error(
                        ErrorCode.T_PARSE_UNEXPECTED_TOKEN,
                        `unknown memory layout directive '#${layoutName.value}'`,
                        makeSpan(this.file, hashTok.line, hashTok.col, layoutName.line, layoutName.col + layoutName.value.length),
                        { validValues: ["#aos", "#soa"] },
                    );
                }
            }
        }

        switch (this.current().type) {
            case TokenType.KwStruct:
                return this.parseStructDecl(name, nameTok, annotations, memoryLayout);
            case TokenType.KwEnum:
                return this.parseEnumDecl(name, nameTok, annotations);
            case TokenType.KwFlag:
                return this.parseFlagDecl(name, nameTok, annotations, false);
            case TokenType.KwUnion:
                return this.parseUnionDecl(name, nameTok, annotations);
            case TokenType.KwFunc:
                return this.parseFuncDecl(name, nameTok, annotations, isComptime);
            default:
                // Could be a type alias: Name :: SomeType;
                // Or flag_set: Name :: flag_set { ... }
                if (this.check(TokenType.Identifier) && this.current().value === "flag_set") {
                    return this.parseFlagSetDecl(name, nameTok, annotations);
                }
                // Type alias: Name :: OtherType;
                return this.parseTypeAlias(name, nameTok, annotations);
        }
    }

    // ── Struct declaration ────────────────────────────────────────

    private parseStructDecl(
        name: string, nameTok: Token, annotations: AnnotationNode[], memoryLayout: MemoryLayout,
    ): DeclNode {
        this.advance(); // 'struct'

        // Check for @bitpack annotation (already parsed, but we need to handle it)
        // Also check for inline annotations after 'struct' keyword
        const postAnnotations = this.parseAnnotations();
        const allAnnotations = [...annotations, ...postAnnotations];

        const bitpackAnno = allAnnotations.find((a) => a.name === "bitpack");
        const isBitpack = bitpackAnno !== undefined;
        let bitpackType: string | null = null;
        if (bitpackAnno && bitpackAnno.args.length > 0) {
            const arg = bitpackAnno.args[0];
            if (arg.kind === "IdentArg") bitpackType = arg.value;
        }

        this.expect(TokenType.LBrace, "expected '{' to start struct body");
        const fields: StructField[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            const fieldName = this.expect(TokenType.Identifier, "expected field name");
            this.expect(TokenType.Colon, "expected ':' after field name");

            if (isBitpack) {
                // bitpack field: name : bit_width;
                const widthTok = this.expect(TokenType.Integer, "expected bit width for @bitpack field");
                const fieldAnnotations = this.parseAnnotations();
                this.expect(TokenType.Semicolon, "expected ';' after field");
                fields.push({
                    name: fieldName.value,
                    typeNode: mkType({ kind: "ScalarType", name: "void" }), // bitpack fields have no type
                    bitWidth: parseInt(widthTok.value, 10),
                    annotations: fieldAnnotations,
                });
            } else {
                const typeNode = this.parseType();
                const fieldAnnotations = this.parseAnnotations();
                this.expect(TokenType.Semicolon, "expected ';' after field declaration");
                fields.push({
                    name: fieldName.value,
                    typeNode,
                    bitWidth: null,
                    annotations: fieldAnnotations,
                });
            }
        }

        this.expect(TokenType.RBrace, "expected '}' to close struct body");

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: allAnnotations,
            declKind: {
                kind: "StructDecl",
                name,
                fields,
                memoryLayout,
                isBitpack,
                bitpackType,
            },
        };
    }

    // ── Enum declaration ──────────────────────────────────────────

    private parseEnumDecl(
        name: string, nameTok: Token, annotations: AnnotationNode[],
    ): DeclNode {
        this.advance(); // 'enum'

        // Optional underlying type: enum : u32 { ... }
        let underlyingType = "u32"; // default
        if (this.match(TokenType.Colon)) {
            const typeTok = this.advance();
            underlyingType = typeTok.value;
        }

        // Post-declaration annotations (e.g. @derive)
        const postAnnotations = this.parseAnnotations();
        const allAnnotations = [...annotations, ...postAnnotations];

        this.expect(TokenType.LBrace, "expected '{' to start enum body");
        const variants: EnumVariant[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            if (this.check(TokenType.At) || (!this.check(TokenType.Identifier))) {
                this.advance(); // skip unexpected token to prevent infinite loop
                continue;
            }
            const varName = this.expect(TokenType.Identifier, "expected enum variant name");

            // Validate naming: enum variants should be PascalCase or UPPER_SNAKE
            // The spec says types are PascalCase, but enum variants are often UPPER_SNAKE
            // We'll be lenient here but check later

            let value: ExprNode | null = null;
            if (this.match(TokenType.Assign)) {
                value = this.parseExpr();
            }

            const varAnnotations = this.parseAnnotations();
            this.match(TokenType.Comma); // optional trailing comma
            variants.push({ name: varName.value, value, annotations: varAnnotations });
        }

        this.expect(TokenType.RBrace, "expected '}' to close enum body");

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: allAnnotations,
            declKind: { kind: "EnumDecl", name, underlyingType, variants },
        };
    }

    // ── Flag declaration: flag[u32] { ... } ───────────────────────

    private parseFlagDecl(
        name: string, nameTok: Token, annotations: AnnotationNode[], isFlagSet: boolean,
    ): DeclNode {
        this.advance(); // 'flag'

        // Parse underlying type: [u32]
        let underlyingType = "u32";
        if (this.match(TokenType.LBracket)) {
            const typeTok = this.advance();
            underlyingType = typeTok.value;
            this.expect(TokenType.RBracket, "expected ']' after flag underlying type");
        }

        // Annotations after type
        const postAnnotations = this.parseAnnotations();
        const allAnnotations = [...annotations, ...postAnnotations];

        this.expect(TokenType.LBrace, "expected '{' to start flag body");
        const slots: FlagSlot[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            // Skip unexpected tokens to prevent infinite loop
            if (!this.check(TokenType.Identifier)) {
                this.advance();
                continue;
            }
            const slotName = this.expect(TokenType.Identifier, "expected flag slot name");
            this.expect(TokenType.Colon, "expected ':' after flag slot name");
            const widthTok = this.expect(TokenType.Integer, "expected bit width for flag slot");
            const bitWidth = parseInt(widthTok.value, 10);

            const slotAnnotations = this.parseAnnotations();

            // Check for @offset(N) annotation
            let offset: number | null = null;
            const offsetAnno = slotAnnotations.find((a) => a.name === "offset");
            if (offsetAnno && offsetAnno.args.length > 0) {
                const arg = offsetAnno.args[0];
                if (arg.kind === "NumberArg") {
                    offset = parseInt(arg.value, 10);
                }
            }

            this.match(TokenType.Comma, TokenType.Semicolon); // accept comma or semicolon separator
            slots.push({ name: slotName.value, bitWidth, offset, annotations: slotAnnotations });
        }

        this.expect(TokenType.RBrace, "expected '}' to close flag body");

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: allAnnotations,
            declKind: { kind: "FlagDecl", name, underlyingType, slots },
        };
    }

    // ── Flag Set declaration: flag_set { ... } ────────────────────

    private parseFlagSetDecl(
        name: string, nameTok: Token, annotations: AnnotationNode[],
    ): DeclNode {
        this.advance(); // 'flag_set'

        const postAnnotations = this.parseAnnotations();
        const allAnnotations = [...annotations, ...postAnnotations];

        this.expect(TokenType.LBrace, "expected '{' to start flag_set body");
        const slots: FlagSlot[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            // Skip unexpected tokens to prevent infinite loop
            if (!this.check(TokenType.Identifier)) {
                this.advance();
                continue;
            }
            const slotName = this.expect(TokenType.Identifier, "expected flag_set slot name");
            this.expect(TokenType.Colon, "expected ':' after flag_set slot name");
            const widthTok = this.expect(TokenType.Integer, "expected bit width");
            const bitWidth = parseInt(widthTok.value, 10);

            const slotAnnotations = this.parseAnnotations();
            this.match(TokenType.Comma, TokenType.Semicolon);
            slots.push({ name: slotName.value, bitWidth, offset: null, annotations: slotAnnotations });
        }

        this.expect(TokenType.RBrace, "expected '}' to close flag_set body");

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: allAnnotations,
            declKind: { kind: "FlagSetDecl", name, slots },
        };
    }

    // ── Union declaration ─────────────────────────────────────────

    private parseUnionDecl(
        name: string, nameTok: Token, annotations: AnnotationNode[],
    ): DeclNode {
        this.advance(); // 'union'

        const postAnnotations = this.parseAnnotations();
        const allAnnotations = [...annotations, ...postAnnotations];

        this.expect(TokenType.LBrace, "expected '{' to start union body");
        const members: UnionMember[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            if (!this.check(TokenType.Identifier)) {
                this.advance();
                continue;
            }
            const memberName = this.expect(TokenType.Identifier, "expected union member name");
            this.expect(TokenType.Colon, "expected ':' after union member name");
            const typeNode = this.parseType();
            const memberAnnotations = this.parseAnnotations();
            this.match(TokenType.Comma, TokenType.Semicolon);
            members.push({ name: memberName.value, typeNode, annotations: memberAnnotations });
        }

        this.expect(TokenType.RBrace, "expected '}' to close union body");

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: allAnnotations,
            declKind: { kind: "UnionDecl", name, underlyingType: null, members },
        };
    }

    // ── Function declaration ──────────────────────────────────────

    private parseFuncDecl(
        name: string, nameTok: Token, annotations: AnnotationNode[], isComptime: boolean,
    ): DeclNode {
        this.advance(); // 'func'
        this.expect(TokenType.LParen, "expected '(' to start parameter list");

        const params: FuncParam[] = [];
        while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
            const paramName = this.expect(TokenType.Identifier, "expected parameter name");
            this.expect(TokenType.Colon, "expected ':' after parameter name");
            const paramType = this.parseType();
            const paramAnnotations = this.parseAnnotations();
            params.push({ name: paramName.value, typeNode: paramType, annotations: paramAnnotations });
            if (!this.match(TokenType.Comma)) break;
        }

        this.expect(TokenType.RParen, "expected ')' to close parameter list");
        this.expect(TokenType.Arrow, "expected '->' before return type");
        const returnType = this.parseType();

        // Post-declaration annotations
        const postAnnotations = this.parseAnnotations();
        const allAnnotations = [...annotations, ...postAnnotations];

        // Body or extern
        let body: StmtNode[] | null = null;
        let isExtern = false;

        if (this.check(TokenType.Semicolon)) {
            this.advance();
            isExtern = true;
        } else if (this.check(TokenType.LBrace)) {
            body = this.parseBlock();
        } else {
            const tok = this.current();
            this.bag.error(
                ErrorCode.T_PARSE_EXPECTED_TOKEN,
                `expected '{' or ';' after function signature but found '${tok.value}'`,
                makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length),
            );
        }

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: allAnnotations,
            declKind: {
                kind: "FuncDecl",
                name,
                params,
                returnType,
                body,
                isExtern,
                isComptime,
            },
        };
    }

    // ── Global var / const ────────────────────────────────────────

    private parseGlobalVar(isConst: boolean): DeclNode {
        const kw = this.advance(); // 'var' or 'const'
        const nameTok = this.expect(TokenType.Identifier, "expected variable name");

        let typeNode: TypeNode | null = null;
        if (this.match(TokenType.Colon)) {
            typeNode = this.parseType();
        }

        let init: ExprNode | null = null;
        if (this.match(TokenType.Assign)) {
            init = this.parseExpr();
        }

        this.expect(TokenType.Semicolon, "expected ';' after variable declaration");

        // Validate naming
        if (isConst) {
            this.validateConstName(nameTok.value, nameTok);
        } else {
            this.validateVarName(nameTok.value, nameTok);
        }

        if (isConst) {
            return {
                kind: "Decl",
                token: nameTok,
                span: spanOf(nameTok),
                annotations: [],
                declKind: {
                    kind: "GlobalConstDecl",
                    name: nameTok.value,
                    typeNode,
                    init: init ?? mkExpr({ kind: "NullLit" }),
                    isComptime: false,
                },
            };
        }

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations: [],
            declKind: {
                kind: "GlobalVarDecl",
                name: nameTok.value,
                typeNode: typeNode ?? mkType({ kind: "ScalarType", name: "void" }),
                init,
                isComptime: false,
            },
        };
    }

    // ── Import ────────────────────────────────────────────────────

    private parseImport(annotations: AnnotationNode[]): DeclNode {
        this.advance(); // 'import'
        const pathTok = this.expect(TokenType.String, "expected import path string");

        let alias: string | null = null;
        if (this.match(TokenType.KwAs)) {
            const aliasTok = this.expect(TokenType.Identifier, "expected alias name");
            alias = aliasTok.value;
        }

        this.expect(TokenType.Semicolon, "expected ';' after import");

        return {
            kind: "Decl",
            token: pathTok,
            span: spanOf(pathTok),
            annotations,
            declKind: { kind: "ImportDecl", path: pathTok.value, alias },
        };
    }

    // ── Type alias: Name :: SomeType; ─────────────────────────────

    private parseTypeAlias(
        name: string, nameTok: Token, annotations: AnnotationNode[],
    ): DeclNode {
        const aliasedType = this.parseType();
        this.expect(TokenType.Semicolon, "expected ';' after type alias");

        return {
            kind: "Decl",
            token: nameTok,
            span: spanOf(nameTok),
            annotations,
            declKind: { kind: "TypeAliasDecl", name, aliasedType },
        };
    }

    // ─── Annotation parsing ───────────────────────────────────────

    private parseAnnotations(): AnnotationNode[] {
        const annotations: AnnotationNode[] = [];

        while (this.check(TokenType.At)) {
            const atTok = this.advance();
            // Accept both identifiers and keywords as annotation names
            // (e.g. @export is a keyword but used as annotation name)
            let nameTok: Token;
            if (this.check(TokenType.Identifier) || this.current().type === TokenType.KwExport) {
                nameTok = this.advance();
            } else {
                nameTok = this.expect(TokenType.Identifier, "expected annotation name after '@'");
            }
            const name = nameTok.value;

            // Validate annotation name is lowercase snake (spec 1.1)
            if (!/^[a-z][a-z0-9_]*$/.test(name)) {
                this.bag.warning(
                    ErrorCode.T_NAME_ANNOTATION_LOWER,
                    `annotation name '${name}' should be lowercase snake_case`,
                    makeSpan(this.file, nameTok.line, nameTok.col, nameTok.line, nameTok.col + name.length),
                );
            }

            const args: AnnotationArg[] = [];

            if (this.match(TokenType.LParen)) {
                args.push(...this.parseAnnotationArgs());
                this.expect(TokenType.RParen, "expected ')' to close annotation arguments");
            }

            annotations.push({
                kind: "Annotation",
                name,
                args,
                token: nameTok,
            });
        }

        return annotations;
    }

    private parseAnnotationArgs(): AnnotationArg[] {
        const args: AnnotationArg[] = [];

        while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
            const tok = this.current();

            if (tok.type === TokenType.String) {
                this.advance();
                args.push({ kind: "StringArg", value: tok.value });
            } else if (tok.type === TokenType.Integer) {
                this.advance();
                args.push({ kind: "NumberArg", value: tok.value });
            } else if (tok.type === TokenType.Identifier) {
                // Could be a list: Clone, BinarySerde, Eq
                const idents: string[] = [this.advance().value];
                while (this.match(TokenType.Comma)) {
                    const id = this.expect(TokenType.Identifier, "expected identifier in annotation list");
                    idents.push(id.value);
                }
                if (idents.length === 1) {
                    args.push({ kind: "IdentArg", value: idents[0] });
                } else {
                    args.push({
                        kind: "ListArg",
                        values: idents.map((v) => ({ kind: "IdentArg" as const, value: v })),
                    });
                }
            } else {
                this.bag.error(
                    ErrorCode.T_ANNOTATION_INVALID_ARG,
                    `invalid annotation argument '${tok.value}'`,
                    makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length),
                );
                this.advance();
            }

            // Optional comma between args
            if (!this.check(TokenType.RParen)) {
                this.match(TokenType.Comma);
            }
        }

        return args;
    }

    // ─── Type parsing ─────────────────────────────────────────────

    private parseType(): TypeNode {
        const tok = this.current();

        // map[K]V
        if (tok.type === TokenType.KwMap) {
            this.advance();
            this.expect(TokenType.LBracket, "expected '[' after 'map'");
            const keyType = this.parseType();
            this.expect(TokenType.RBracket, "expected ']' after map key type");
            const valueType = this.parseType();
            return mkType({ kind: "MapType", key: keyType, value: valueType }, tok);
        }

        // [N]T or []T
        if (tok.type === TokenType.LBracket) {
            this.advance();
            if (this.check(TokenType.RBracket)) {
                this.advance();
                const elem = this.parseType();
                return mkType({ kind: "SliceType", elem }, tok);
            } else {
                const length = this.parseExpr();
                this.expect(TokenType.RBracket, "expected ']' after array length");
                const elem = this.parseType();
                return mkType({ kind: "ArrayType", elem, length }, tok);
            }
        }

        // *T (pointer)
        if (tok.type === TokenType.Star) {
            this.advance();
            const elem = this.parseType();
            return mkType({ kind: "PointerType", elem }, tok);
        }

        // ?T (optional) - though not in spec, we support parsing
        if (tok.type === TokenType.Question) {
            this.advance();
            const elem = this.parseType();
            return mkType({ kind: "OptionalType", elem }, tok);
        }

        // void
        if (tok.type === TokenType.KwVoid) {
            this.advance();
            return mkType({ kind: "ScalarType", name: "void" }, tok);
        }

        // string
        if (tok.type === TokenType.KwString) {
            this.advance();
            return mkType({ kind: "ScalarType", name: "string" }, tok);
        }

        // StringBuilder
        if (tok.type === TokenType.KwStringBuilder) {
            this.advance();
            return mkType({ kind: "ScalarType", name: "StringBuilder" }, tok);
        }

        // Scalar types or named types
        if (tok.type === TokenType.Identifier) {
            this.advance();
            const name = tok.value;

            // Check for flag[T] type reference
            if (name === "flag" && this.match(TokenType.LBracket)) {
                const underlyingTok = this.advance();
                this.expect(TokenType.RBracket, "expected ']' after flag underlying type");
                return mkType({ kind: "FlagType", underlying: underlyingTok.value }, tok);
            }

            // Check for flag_set type reference
            if (name === "flag_set") {
                return mkType({ kind: "FlagSetType" }, tok);
            }

            // Check for Variant type
            if (name === "Variant") {
                return mkType({ kind: "VariantType" }, tok);
            }

            // Check for scalar types
            const scalars = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f16", "f32", "f64", "bool"];
            if (scalars.includes(name)) {
                return mkType({ kind: "ScalarType", name }, tok);
            }

            return mkType({ kind: "NamedType", name }, tok);
        }

        this.bag.error(
            ErrorCode.T_PARSE_UNEXPECTED_TOKEN,
            `expected type but found '${tok.value}'`,
            makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length),
        );
        this.advance();
        return mkType({ kind: "ScalarType", name: "void" }, tok);
    }

    // ─── Block parsing ────────────────────────────────────────────

    private parseBlock(): StmtNode[] {
        this.expect(TokenType.LBrace, "expected '{' to start block");
        const stmts: StmtNode[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            const stmt = this.parseStatement();
            if (stmt) stmts.push(stmt);
        }

        this.expect(TokenType.RBrace, "expected '}' to close block");
        return stmts;
    }

    // ─── Statement parsing ────────────────────────────────────────

    private parseStatement(): StmtNode | null {
        const tok = this.current();

        switch (tok.type) {
            case TokenType.KwIf:
                return this.parseIfStmt();
            case TokenType.KwFor:
                return this.parseForStmt();
            case TokenType.KwWhile:
                return this.parseWhileStmt();
            case TokenType.KwSwitch:
                return this.parseSwitchStmt();
            case TokenType.KwReturn:
                return this.parseReturnStmt();
            case TokenType.KwBreak:
                this.advance();
                this.expect(TokenType.Semicolon, "expected ';' after 'break'");
                return mkStmt({ kind: "BreakStmt" }, tok);
            case TokenType.KwContinue:
                this.advance();
                this.expect(TokenType.Semicolon, "expected ';' after 'continue'");
                return mkStmt({ kind: "ContinueStmt" }, tok);
            case TokenType.KwDefer:
                this.advance();
                return mkStmt({ kind: "DeferStmt", body: this.parseBlock() }, tok);
            case TokenType.KwComptime:
                this.advance();
                if (this.check(TokenType.LBrace)) {
                    return mkStmt({ kind: "ComptimeStmt", body: this.parseBlock() }, tok);
                }
                // comptime expr;
                const expr = this.parseExpr();
                this.expect(TokenType.Semicolon, "expected ';' after comptime expression");
                return mkStmt({ kind: "ExprStmt", expr: mkExpr({ kind: "ComptimeExpr", expr }, tok) }, tok);
            case TokenType.LBrace:
                return mkStmt({ kind: "BlockStmt", body: this.parseBlock() }, tok);
            case TokenType.KwVar:
                return this.parseLocalVar(false);
            case TokenType.KwConst:
                return this.parseLocalVar(true);
            default:
                return this.parseExprOrAssignStmt();
        }
    }

    private parseIfStmt(): StmtNode {
        const tok = this.current();
        this.advance(); // 'if'

        // Enforce parentheses around condition (spec 1.2: multi-priority must use parens)
        this.expect(TokenType.LParen, "expected '(' after 'if'");
        const condition = this.parseExpr();
        this.expect(TokenType.RParen, "expected ')' after if condition");

        // Enforce braces (spec 1.2.1)
        if (!this.check(TokenType.LBrace)) {
            const t = this.current();
            this.bag.error(
                ErrorCode.T_STMT_MISSING_BRACES,
                "if statement body must be wrapped in braces (single-line bodies are not allowed)",
                makeSpan(this.file, t.line, t.col, t.line, t.col + t.value.length),
                { fixSuggestions: [{ description: "wrap body in { }", range: makeSpan(this.file, t.line, t.col, t.line, t.col), replacement: "{ " }] },
            );
        }

        const thenBlock = this.parseBlock();

        let elseBlock: StmtNode[] | null = null;
        if (this.match(TokenType.KwElse)) {
            if (this.check(TokenType.KwIf)) {
                // else if -> wrap in a single-statement block
                elseBlock = [this.parseIfStmt()];
            } else {
                elseBlock = this.parseBlock();
            }
        }

        return mkStmt({ kind: "IfStmt", condition, thenBlock, elseBlock }, tok);
    }

    private parseForStmt(): StmtNode {
        const tok = this.current();
        this.advance(); // 'for'
        this.expect(TokenType.LParen, "expected '(' after 'for'");

        // Check for for-each: for (ident in expr)
        if (this.check(TokenType.Identifier) && this.peek(1).type === TokenType.KwIn) {
            const varName = this.advance().value;
            this.advance(); // 'in'
            const iterable = this.parseExpr();
            this.expect(TokenType.RParen, "expected ')' after for-each iterable");
            const body = this.parseBlock();
            return mkStmt({ kind: "ForEachStmt", varName, iterable, body }, tok);
        }

        // Traditional for: for (init; cond; update)
        let init: StmtNode | null = null;
        if (!this.check(TokenType.Semicolon)) {
            if (this.check(TokenType.KwVar)) {
                init = this.parseLocalVar(false);
            } else if (this.check(TokenType.KwConst)) {
                init = this.parseLocalVar(true);
            } else {
                const expr = this.parseExpr();
                this.expect(TokenType.Semicolon, "expected ';' after for-loop initializer");
                init = mkStmt({ kind: "ExprStmt", expr });
            }
        } else {
            this.advance(); // skip ';'
        }

        let condition: ExprNode | null = null;
        if (!this.check(TokenType.Semicolon)) {
            condition = this.parseExpr();
        }
        this.expect(TokenType.Semicolon, "expected ';' after for-loop condition");

        let update: ExprNode | null = null;
        if (!this.check(TokenType.RParen)) {
            update = this.parseExpr();
        }
        this.expect(TokenType.RParen, "expected ')' after for-loop update");

        const body = this.parseBlock();
        return mkStmt({ kind: "ForStmt", init, condition, update, body }, tok);
    }

    private parseWhileStmt(): StmtNode {
        const tok = this.current();
        this.advance();
        this.expect(TokenType.LParen, "expected '(' after 'while'");
        const condition = this.parseExpr();
        this.expect(TokenType.RParen, "expected ')' after while condition");
        const body = this.parseBlock();
        return mkStmt({ kind: "WhileStmt", condition, body }, tok);
    }

    private parseSwitchStmt(): StmtNode {
        const tok = this.current();
        this.advance();
        this.expect(TokenType.LParen, "expected '(' after 'switch'");
        const expr = this.parseExpr();
        this.expect(TokenType.RParen, "expected ')' after switch expression");
        this.expect(TokenType.LBrace, "expected '{' to start switch body");

        const cases: SwitchCase[] = [];
        let defaultBlock: StmtNode[] | null = null;

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            if (this.match(TokenType.KwCase)) {
                const pattern = this.parseExpr();
                this.expect(TokenType.Colon, "expected ':' after case pattern");
                const caseBody: StmtNode[] = [];
                while (!this.check(TokenType.KwCase) && !this.check(TokenType.KwDefault) && !this.check(TokenType.RBrace) && !this.isAtEnd()) {
                    const s = this.parseStatement();
                    if (s) caseBody.push(s);
                }
                cases.push({ pattern, body: caseBody });
            } else if (this.match(TokenType.KwDefault)) {
                this.expect(TokenType.Colon, "expected ':' after 'default'");
                defaultBlock = [];
                while (!this.check(TokenType.KwCase) && !this.check(TokenType.RBrace) && !this.isAtEnd()) {
                    const s = this.parseStatement();
                    if (s) defaultBlock.push(s);
                }
            } else {
                const t = this.current();
                this.bag.error(
                    ErrorCode.T_PARSE_UNEXPECTED_TOKEN,
                    `expected 'case' or 'default' in switch body but found '${t.value}'`,
                    makeSpan(this.file, t.line, t.col, t.line, t.col + t.value.length),
                );
                this.advance();
            }
        }

        this.expect(TokenType.RBrace, "expected '}' to close switch body");
        return mkStmt({ kind: "SwitchStmt", expr, cases, defaultBlock }, tok);
    }

    private parseReturnStmt(): StmtNode {
        const tok = this.current();
        this.advance();
        let value: ExprNode | null = null;
        if (!this.check(TokenType.Semicolon)) {
            value = this.parseExpr();
        }
        this.expect(TokenType.Semicolon, "expected ';' after return statement");
        return mkStmt({ kind: "ReturnStmt", value }, tok);
    }

    private parseLocalVar(isConst: boolean): StmtNode {
        const tok = this.advance(); // 'var' or 'const'
        const nameTok = this.expect(TokenType.Identifier, "expected variable name");

        let typeNode: TypeNode | null = null;
        if (this.match(TokenType.Colon)) {
            typeNode = this.parseType();
        }

        let init: ExprNode | null = null;
        if (this.match(TokenType.Assign)) {
            init = this.parseExpr();
        }

        this.expect(TokenType.Semicolon, "expected ';' after variable declaration");

        if (isConst) {
            this.validateConstName(nameTok.value, nameTok);
        } else {
            this.validateVarName(nameTok.value, nameTok);
        }

        return mkStmt({ kind: "VarDecl", name: nameTok.value, typeNode, init, isConst }, tok);
    }

    private parseExprOrAssignStmt(): StmtNode {
        const tok = this.current();
        const expr = this.parseExpr();

        // Check for assignment operators
        const assignOps = [
            TokenType.Assign, TokenType.PlusAssign, TokenType.MinusAssign,
            TokenType.StarAssign, TokenType.SlashAssign, TokenType.PercentAssign,
            TokenType.BitAndAssign, TokenType.BitOrAssign, TokenType.BitXorAssign,
            TokenType.ShlAssign, TokenType.ShrAssign,
        ];

        const assignOp = this.match(...assignOps);
        if (assignOp) {
            const value = this.parseExpr();
            this.expect(TokenType.Semicolon, "expected ';' after assignment");
            return mkStmt({ kind: "AssignmentStmt", target: expr, op: assignOp.value, value }, tok);
        }

        this.expect(TokenType.Semicolon, "expected ';' after expression");
        return mkStmt({ kind: "ExprStmt", expr }, tok);
    }

    // ─── Expression parsing (precedence climbing) ─────────────────

    private parseExpr(): ExprNode {
        return this.parseAssignment();
    }

    private parseAssignment(): ExprNode {
        const left = this.parseLogicOr();
        const tok = this.current();

        if (this.match(TokenType.Assign)) {
            const right = this.parseAssignment();
            return mkExpr({ kind: "AssignExpr", op: "=", target: left, value: right }, tok);
        }

        return left;
    }

    private parseLogicOr(): ExprNode {
        let left = this.parseLogicAnd();
        while (this.check(TokenType.Or)) {
            const tok = this.advance();
            const right = this.parseLogicAnd();
            left = mkExpr({ kind: "BinaryExpr", op: "||", left, right }, tok);
        }
        return left;
    }

    private parseLogicAnd(): ExprNode {
        let left = this.parseBitOr();
        while (this.check(TokenType.And)) {
            const tok = this.advance();
            const right = this.parseBitOr();
            left = mkExpr({ kind: "BinaryExpr", op: "&&", left, right }, tok);
        }
        return left;
    }

    private parseBitOr(): ExprNode {
        let left = this.parseBitXor();
        while (this.check(TokenType.BitOr)) {
            const tok = this.advance();
            const right = this.parseBitXor();
            left = mkExpr({ kind: "BinaryExpr", op: "|", left, right }, tok);
        }
        return left;
    }

    private parseBitXor(): ExprNode {
        let left = this.parseBitAnd();
        while (this.check(TokenType.BitXor)) {
            const tok = this.advance();
            const right = this.parseBitAnd();
            left = mkExpr({ kind: "BinaryExpr", op: "^", left, right }, tok);
        }
        return left;
    }

    private parseBitAnd(): ExprNode {
        let left = this.parseEquality();
        while (this.check(TokenType.BitAnd)) {
            const tok = this.advance();
            const right = this.parseEquality();
            left = mkExpr({ kind: "BinaryExpr", op: "&", left, right }, tok);
        }
        return left;
    }

    private parseEquality(): ExprNode {
        let left = this.parseComparison();
        while (this.check(TokenType.Eq) || this.check(TokenType.NotEq)) {
            const tok = this.advance();
            const op = tok.type === TokenType.Eq ? "==" : "!=";
            const right = this.parseComparison();
            left = mkExpr({ kind: "BinaryExpr", op, left, right }, tok);
        }
        return left;
    }

    private parseComparison(): ExprNode {
        let left = this.parseShift();
        while ([TokenType.Lt, TokenType.Gt, TokenType.LtEq, TokenType.GtEq].includes(this.current().type)) {
            const tok = this.advance();
            const ops: Record<number, string> = {
                [TokenType.Lt]: "<", [TokenType.Gt]: ">",
                [TokenType.LtEq]: "<=", [TokenType.GtEq]: ">=",
            };
            const right = this.parseShift();
            left = mkExpr({ kind: "BinaryExpr", op: ops[tok.type], left, right }, tok);
        }
        return left;
    }

    private parseShift(): ExprNode {
        let left = this.parseAdd();
        while (this.check(TokenType.ShiftLeft) || this.check(TokenType.ShiftRight)) {
            const tok = this.advance();
            const op = tok.type === TokenType.ShiftLeft ? "<<" : ">>";
            const right = this.parseAdd();
            left = mkExpr({ kind: "BinaryExpr", op, left, right }, tok);
        }
        return left;
    }

    private parseAdd(): ExprNode {
        let left = this.parseMul();
        while (this.check(TokenType.Plus) || this.check(TokenType.Minus)) {
            const tok = this.advance();
            const op = tok.type === TokenType.Plus ? "+" : "-";
            const right = this.parseMul();
            left = mkExpr({ kind: "BinaryExpr", op, left, right }, tok);
        }
        return left;
    }

    private parseMul(): ExprNode {
        let left = this.parseUnary();
        while ([TokenType.Star, TokenType.Slash, TokenType.Percent].includes(this.current().type)) {
            const tok = this.advance();
            const ops: Record<number, string> = {
                [TokenType.Star]: "*", [TokenType.Slash]: "/", [TokenType.Percent]: "%",
            };
            const right = this.parseUnary();
            left = mkExpr({ kind: "BinaryExpr", op: ops[tok.type], left, right }, tok);
        }
        return left;
    }

    private parseUnary(): ExprNode {
        if ([TokenType.Not, TokenType.Minus, TokenType.BitNot].includes(this.current().type)) {
            const tok = this.advance();
            const ops: Record<number, string> = {
                [TokenType.Not]: "!", [TokenType.Minus]: "-", [TokenType.BitNot]: "~",
            };
            const operand = this.parseUnary();
            return mkExpr({ kind: "UnaryExpr", op: ops[tok.type], operand }, tok);
        }
        return this.parsePostfix();
    }

    private parsePostfix(): ExprNode {
        let expr = this.parsePrimary();

        while (true) {
            if (this.check(TokenType.Dot)) {
                const tok = this.advance();
                const member = this.expect(TokenType.Identifier, "expected member name after '.'");
                expr = mkExpr({ kind: "MemberExpr", object: expr, member: member.value }, tok);
            } else if (this.check(TokenType.LBracket)) {
                const tok = this.advance();
                const index = this.parseExpr();
                this.expect(TokenType.RBracket, "expected ']' after index");
                expr = mkExpr({ kind: "IndexExpr", object: expr, index }, tok);
            } else if (this.check(TokenType.LParen)) {
                const tok = this.advance();
                const args: ExprNode[] = [];
                while (!this.check(TokenType.RParen) && !this.isAtEnd()) {
                    args.push(this.parseExpr());
                    if (!this.match(TokenType.Comma)) break;
                }
                this.expect(TokenType.RParen, "expected ')' after call arguments");
                expr = mkExpr({ kind: "CallExpr", callee: expr, args }, tok);
            } else {
                break;
            }
        }

        // Check for cast: expr as Type
        if (this.check(TokenType.KwAs)) {
            const tok = this.advance();
            const targetType = this.parseType();
            expr = mkExpr({ kind: "CastExpr", expr, targetType }, tok);
        }

        return expr;
    }

    private parsePrimary(): ExprNode {
        const tok = this.current();

        switch (tok.type) {
            case TokenType.Integer: {
                this.advance();
                let radix = 10;
                let val = tok.value;
                if (val.startsWith("0x") || val.startsWith("0X")) { radix = 16; }
                else if (val.startsWith("0b") || val.startsWith("0B")) { radix = 2; }
                return mkExpr({ kind: "IntegerLit", value: val, radix }, tok);
            }
            case TokenType.Float:
                this.advance();
                return mkExpr({ kind: "FloatLit", value: tok.value }, tok);
            case TokenType.String:
                this.advance();
                return mkExpr({ kind: "StringLit", value: tok.value }, tok);
            case TokenType.KwTrue:
                this.advance();
                return mkExpr({ kind: "BoolLit", value: true }, tok);
            case TokenType.KwFalse:
                this.advance();
                return mkExpr({ kind: "BoolLit", value: false }, tok);
            case TokenType.KwNull:
                this.advance();
                return mkExpr({ kind: "NullLit" }, tok);
            case TokenType.Identifier:
                this.advance();
                // Check for struct literal: Name { field: val, ... }
                if (this.check(TokenType.LBrace) && this.looksLikeStructLit()) {
                    return this.parseStructLit(tok.value, tok);
                }
                return mkExpr({ kind: "IdentExpr", name: tok.value }, tok);
            case TokenType.LParen: {
                this.advance();
                const inner = this.parseExpr();
                this.expect(TokenType.RParen, "expected ')' after expression");
                return mkExpr({ kind: "ParenExpr", inner }, tok);
            }
            case TokenType.LBracket:
                return this.parseArrayLit();
            default:
                this.bag.error(
                    ErrorCode.T_PARSE_INVALID_EXPR,
                    `unexpected token '${tok.value}' in expression`,
                    makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length),
                );
                this.advance();
                return mkExpr({ kind: "NullLit" }, tok);
        }
    }

    private looksLikeStructLit(): boolean {
        // Heuristic: if after '{' we see an identifier followed by ':', it's a struct literal
        if (this.peek(1).type === TokenType.RBrace) return true; // empty struct lit
        if (this.peek(1).type === TokenType.Identifier && this.peek(2).type === TokenType.Colon) return true;
        return false;
    }

    private parseStructLit(name: string, tok: Token): ExprNode {
        this.advance(); // '{'
        const fields: { name: string; value: ExprNode }[] = [];

        while (!this.check(TokenType.RBrace) && !this.isAtEnd()) {
            const fieldName = this.expect(TokenType.Identifier, "expected field name in struct literal");
            this.expect(TokenType.Colon, "expected ':' after field name");
            const value = this.parseExpr();
            fields.push({ name: fieldName.value, value });
            if (!this.match(TokenType.Comma)) break;
        }

        this.expect(TokenType.RBrace, "expected '}' to close struct literal");
        return mkExpr({ kind: "StructLit", typeName: name, fields }, tok);
    }

    private parseArrayLit(): ExprNode {
        const tok = this.current();
        this.advance(); // '['
        const elements: ExprNode[] = [];

        // Check for map literal: [key: val, ...]
        const isMapLit = this.check(TokenType.Identifier) ||
                         this.check(TokenType.String) ||
                         this.check(TokenType.Integer);

        if (isMapLit && this.peek(1).type === TokenType.Colon) {
            return this.parseMapLit(tok);
        }

        while (!this.check(TokenType.RBracket) && !this.isAtEnd()) {
            elements.push(this.parseExpr());
            if (!this.match(TokenType.Comma)) break;
        }

        this.expect(TokenType.RBracket, "expected ']' after array elements");
        return mkExpr({ kind: "ArrayLit", elements }, tok);
    }

    private parseMapLit(tok: Token): ExprNode {
        const entries: { key: ExprNode; value: ExprNode }[] = [];

        while (!this.check(TokenType.RBracket) && !this.isAtEnd()) {
            const key = this.parseExpr();
            this.expect(TokenType.Colon, "expected ':' after map key");
            const value = this.parseExpr();
            entries.push({ key, value });
            if (!this.match(TokenType.Comma)) break;
        }

        this.expect(TokenType.RBracket, "expected ']' after map entries");
        return mkExpr({ kind: "MapLit", entries }, tok);
    }

    // ─── Naming convention validation (spec 1.1) ──────────────────

    private validateDeclName(name: string, tok: Token): void {
        // Type declarations (struct/enum/flag/union) must be PascalCase
        // We can't know the type yet, so check if it starts with uppercase
        if (/^[A-Z]/.test(name)) {
            // PascalCase - valid for type declarations
            if (!/^[A-Z][a-zA-Z0-9_]*$/.test(name)) {
                this.bag.warning(
                    ErrorCode.T_NAME_TYPE_CAMEL,
                    `type name '${name}' should be PascalCase (e.g. EntityState)`,
                    makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + name.length),
                );
            }
        }
        // If starts with lowercase, it could be a func or var, which is fine
    }

    private validateVarName(name: string, tok: Token): void {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
            this.bag.warning(
                ErrorCode.T_NAME_VAR_SNAKE,
                `variable name '${name}' should be snake_case (e.g. entity_id)`,
                makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + name.length),
            );
        }
    }

    private validateConstName(name: string, tok: Token): void {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            this.bag.warning(
                ErrorCode.T_NAME_CONST_UPPER,
                `constant name '${name}' should be UPPER_SNAKE_CASE (e.g. MAX_RENDER_LAYER)`,
                makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + name.length),
            );
        }
    }
}

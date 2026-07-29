/**
 * t Language - Lexer / Tokenizer
 *
 * Converts source text into a stream of tokens.
 * Implements spec section 1 (basic syntax) token rules.
 */
import { TokenType, lookupKeyword, } from "./token.js";
import { ErrorCode, makeSpan, } from "../diagnostics/diagnostic.js";
export class Lexer {
    source;
    file;
    pos = 0;
    line = 1;
    col = 1;
    tokens = [];
    bag;
    constructor(source, file, bag) {
        this.source = source;
        this.file = file;
        this.bag = bag;
    }
    tokenize() {
        while (this.pos < this.source.length) {
            const ch = this.source[this.pos];
            // Whitespace
            if (ch === " " || ch === "\t" || ch === "\r") {
                this.advance();
                continue;
            }
            if (ch === "\n") {
                this.advance();
                continue;
            }
            // Comments
            if (ch === "/" && this.peek(1) === "/") {
                this.skipLineComment();
                continue;
            }
            if (ch === "/" && this.peek(1) === "*") {
                this.skipBlockComment();
                continue;
            }
            // Numbers
            if (this.isDigit(ch)) {
                this.lexNumber();
                continue;
            }
            // Strings
            if (ch === '"') {
                this.lexString();
                continue;
            }
            // Identifiers / keywords
            if (this.isIdentStart(ch)) {
                this.lexIdentifier();
                continue;
            }
            // Annotations (@)
            if (ch === "@") {
                this.pushToken(TokenType.At, "@");
                this.advance();
                continue;
            }
            // Memory layout directives (#)
            if (ch === "#") {
                this.pushToken(TokenType.Hash, "#");
                this.advance();
                continue;
            }
            // Operators and punctuation
            this.lexOperator();
        }
        this.pushToken(TokenType.Eof, "");
        return this.tokens;
    }
    // ── Lexing helpers ────────────────────────────────────────────
    advance() {
        const ch = this.source[this.pos];
        this.pos++;
        if (ch === "\n") {
            this.line++;
            this.col = 1;
        }
        else {
            this.col++;
        }
        return ch;
    }
    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.source.length ? this.source[idx] : "\0";
    }
    isDigit(ch) {
        return ch >= "0" && ch <= "9";
    }
    isIdentStart(ch) {
        return ((ch >= "a" && ch <= "z") ||
            (ch >= "A" && ch <= "Z") ||
            ch === "_");
    }
    isIdentContinue(ch) {
        return this.isIdentStart(ch) || this.isDigit(ch);
    }
    isHexDigit(ch) {
        return ((ch >= "0" && ch <= "9") ||
            (ch >= "a" && ch <= "f") ||
            (ch >= "A" && ch <= "F"));
    }
    isBinDigit(ch) {
        return ch === "0" || ch === "1";
    }
    // ── Comment skipping ──────────────────────────────────────────
    skipLineComment() {
        while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
            this.advance();
        }
    }
    skipBlockComment() {
        this.advance(); // /
        this.advance(); // *
        while (this.pos < this.source.length) {
            if (this.source[this.pos] === "*" && this.peek(1) === "/") {
                this.advance();
                this.advance();
                return;
            }
            this.advance();
        }
        this.bag.error(ErrorCode.T_LEX_UNTERMINATED_STRING, "unterminated block comment", makeSpan(this.file, this.line, this.col, this.line, this.col));
    }
    // ── Number lexing ─────────────────────────────────────────────
    lexNumber() {
        const startLine = this.line;
        const startCol = this.col;
        // Hex literal: 0x...
        if (this.source[this.pos] === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
            this.advance(); // 0
            this.advance(); // x
            let hex = "";
            while (this.pos < this.source.length && this.isHexDigit(this.source[this.pos])) {
                hex += this.advance();
            }
            if (hex.length === 0) {
                this.bag.error(ErrorCode.T_LEX_INVALID_NUMBER, "hex literal has no digits after 0x", makeSpan(this.file, startLine, startCol, this.line, this.col));
            }
            this.tokens.push({
                type: TokenType.Integer,
                value: "0x" + hex,
                line: startLine,
                col: startCol,
                file: this.file,
            });
            return;
        }
        // Binary literal: 0b...
        if (this.source[this.pos] === "0" && (this.peek(1) === "b" || this.peek(1) === "B")) {
            this.advance(); // 0
            this.advance(); // b
            let bin = "";
            while (this.pos < this.source.length && this.isBinDigit(this.source[this.pos])) {
                bin += this.advance();
            }
            if (bin.length === 0) {
                this.bag.error(ErrorCode.T_LEX_INVALID_NUMBER, "binary literal has no digits after 0b", makeSpan(this.file, startLine, startCol, this.line, this.col));
            }
            this.tokens.push({
                type: TokenType.Integer,
                value: "0b" + bin,
                line: startLine,
                col: startCol,
                file: this.file,
            });
            return;
        }
        // Decimal / float
        let num = "";
        while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
            num += this.advance();
        }
        // Float: digits.digits
        if (this.source[this.pos] === "." && this.isDigit(this.peek(1))) {
            num += this.advance(); // .
            while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
                num += this.advance();
            }
            // Optional exponent
            if (this.source[this.pos] === "e" || this.source[this.pos] === "E") {
                num += this.advance();
                if (this.source[this.pos] === "+" || this.source[this.pos] === "-") {
                    num += this.advance();
                }
                while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
                    num += this.advance();
                }
            }
            this.tokens.push({
                type: TokenType.Float,
                value: num,
                line: startLine,
                col: startCol,
                file: this.file,
            });
            return;
        }
        this.tokens.push({
            type: TokenType.Integer,
            value: num,
            line: startLine,
            col: startCol,
            file: this.file,
        });
    }
    // ── String lexing ─────────────────────────────────────────────
    lexString() {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // opening "
        let result = "";
        while (this.pos < this.source.length && this.source[this.pos] !== '"') {
            if (this.source[this.pos] === "\\") {
                this.advance(); // backslash
                const esc = this.advance();
                switch (esc) {
                    case "n":
                        result += "\n";
                        break;
                    case "t":
                        result += "\t";
                        break;
                    case "r":
                        result += "\r";
                        break;
                    case '"':
                        result += '"';
                        break;
                    case "\\":
                        result += "\\";
                        break;
                    case "0":
                        result += "\0";
                        break;
                    default:
                        result += esc;
                        this.bag.warning(ErrorCode.T_LEX_INVALID_CHAR, `unknown escape sequence \\${esc}`, makeSpan(this.file, this.line, this.col - 1, this.line, this.col));
                }
            }
            else {
                result += this.advance();
            }
        }
        if (this.pos >= this.source.length) {
            this.bag.error(ErrorCode.T_LEX_UNTERMINATED_STRING, "unterminated string literal", makeSpan(this.file, startLine, startCol, this.line, this.col));
            return;
        }
        this.advance(); // closing "
        this.tokens.push({
            type: TokenType.String,
            value: result,
            line: startLine,
            col: startCol,
            file: this.file,
        });
    }
    // ── Identifier / keyword lexing ───────────────────────────────
    lexIdentifier() {
        const startLine = this.line;
        const startCol = this.col;
        let text = "";
        while (this.pos < this.source.length && this.isIdentContinue(this.source[this.pos])) {
            text += this.advance();
        }
        const kwType = lookupKeyword(text);
        if (kwType !== null) {
            this.tokens.push({
                type: kwType,
                value: text,
                line: startLine,
                col: startCol,
                file: this.file,
            });
        }
        else {
            this.tokens.push({
                type: TokenType.Identifier,
                value: text,
                line: startLine,
                col: startCol,
                file: this.file,
            });
        }
    }
    // ── Operator / punctuation lexing ─────────────────────────────
    lexOperator() {
        const startLine = this.line;
        const startCol = this.col;
        const ch = this.source[this.pos];
        const next = this.peek(1);
        // Two-character operators
        const twoChar = {
            "->": TokenType.Arrow,
            "::": TokenType.DoubleColon,
            "==": TokenType.Eq,
            "!=": TokenType.NotEq,
            "<=": TokenType.LtEq,
            ">=": TokenType.GtEq,
            "&&": TokenType.And,
            "||": TokenType.Or,
            "<<": TokenType.ShiftLeft,
            ">>": TokenType.ShiftRight,
            "..": TokenType.DoubleDot,
            "+=": TokenType.PlusAssign,
            "-=": TokenType.MinusAssign,
            "*=": TokenType.StarAssign,
            "/=": TokenType.SlashAssign,
            "%=": TokenType.PercentAssign,
            "&=": TokenType.BitAndAssign,
            "|=": TokenType.BitOrAssign,
            "^=": TokenType.BitXorAssign,
            "<<=": TokenType.ShlAssign,
            ">>=": TokenType.ShrAssign,
        };
        // Three-character operators (shift-assign)
        const threeChar = this.source.substring(this.pos, this.pos + 3);
        if (threeChar === "<<=" || threeChar === ">>=") {
            this.pushToken(twoChar[threeChar], threeChar);
            this.advance();
            this.advance();
            this.advance();
            return;
        }
        const twoCharKey = ch + next;
        if (twoChar[twoCharKey]) {
            this.pushToken(twoChar[twoCharKey], twoCharKey);
            this.advance();
            this.advance();
            return;
        }
        // Single character
        const singleChar = {
            "+": TokenType.Plus,
            "-": TokenType.Minus,
            "*": TokenType.Star,
            "/": TokenType.Slash,
            "%": TokenType.Percent,
            "=": TokenType.Assign,
            "<": TokenType.Lt,
            ">": TokenType.Gt,
            "!": TokenType.Not,
            "&": TokenType.BitAnd,
            "|": TokenType.BitOr,
            "^": TokenType.BitXor,
            "~": TokenType.BitNot,
            ":": TokenType.Colon,
            ".": TokenType.Dot,
            "?": TokenType.Question,
            "(": TokenType.LParen,
            ")": TokenType.RParen,
            "{": TokenType.LBrace,
            "}": TokenType.RBrace,
            "[": TokenType.LBracket,
            "]": TokenType.RBracket,
            ",": TokenType.Comma,
            ";": TokenType.Semicolon,
        };
        if (singleChar[ch]) {
            this.pushToken(singleChar[ch], ch);
            this.advance();
            return;
        }
        // Unknown character
        this.bag.error(ErrorCode.T_LEX_INVALID_CHAR, `unexpected character '${ch}' (U+${ch.charCodeAt(0).toString(16).padStart(4, "0")})`, makeSpan(this.file, startLine, startCol, startLine, startCol));
        this.advance();
    }
    pushToken(type, value) {
        this.tokens.push({
            type,
            value,
            line: this.line,
            col: this.col,
            file: this.file,
        });
    }
}
//# sourceMappingURL=lexer.js.map
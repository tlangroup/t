/**
 * t Language - Lexer / Tokenizer
 *
 * Converts source text into a stream of tokens.
 * Implements spec section 1 (basic syntax) token rules.
 */
import { Token } from "./token.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
export declare class Lexer {
    private source;
    private file;
    private pos;
    private line;
    private col;
    private tokens;
    private bag;
    constructor(source: string, file: string, bag: DiagnosticBag);
    tokenize(): Token[];
    private advance;
    private peek;
    private isDigit;
    private isIdentStart;
    private isIdentContinue;
    private isHexDigit;
    private isBinDigit;
    private skipLineComment;
    private skipBlockComment;
    private lexNumber;
    private lexString;
    private lexIdentifier;
    private lexOperator;
    private pushToken;
}
//# sourceMappingURL=lexer.d.ts.map
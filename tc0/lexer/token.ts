/**
 * t Language - Token Definitions
 *
 * All token types for the t programming language lexer.
 */

export enum TokenType {
    // ── Literals ──
    Integer,        // 42, 0xFF, 0b1010
    Float,          // 3.14, 1.0
    String,         // "hello"
    Bool,           // true, false
    Identifier,

    // ── Keywords ──
    KwFunc,         // func / fn
    KwStruct,       // struct
    KwEnum,         // enum
    KwFlag,         // flag
    KwUnion,        // union
    KwVar,          // var
    KwConst,        // const
    KwComptime,     // comptime
    KwIf,           // if
    KwElse,         // else
    KwFor,          // for
    KwWhile,        // while
    KwSwitch,       // switch
    KwCase,         // case
    KwDefault,      // default
    KwBreak,        // break
    KwContinue,     // continue
    KwReturn,       // return
    KwTrue,         // true
    KwFalse,        // false
    KwNull,         // null
    KwMap,          // map
    KwImport,       // import
    KwExport,       // export (not the annotation, the keyword)
    KwAs,           // as
    KwIn,           // in (for-for-each)
    KwDefer,        // defer

    // ── Type keywords ──
    KwVoid,
    KwString,       // string type keyword
    KwStringBuilder,// StringBuilder type

    // ── Operators ──
    // Arithmetic
    Plus,           // +
    Minus,          // -
    Star,           // *
    Slash,          // /
    Percent,        // %
    // Assignment
    Assign,         // =
    PlusAssign,     // +=
    MinusAssign,    // -=
    StarAssign,     // *=
    SlashAssign,    // /=
    PercentAssign,  // %=
    // Comparison
    Eq,             // ==
    NotEq,          // !=
    Lt,             // <
    Gt,             // >
    LtEq,           // <=
    GtEq,           // >=
    // Logical
    And,            // &&
    Or,             // ||
    Not,            // !
    // Bitwise
    BitAnd,         // &
    BitOr,          // |
    BitXor,         // ^
    BitNot,         // ~
    ShiftLeft,      // <<
    ShiftRight,     // >>
    BitAndAssign,   // &=
    BitOrAssign,    // |=
    BitXorAssign,   // ^=
    ShlAssign,      // <<=
    ShrAssign,      // >>=
    // Arrow
    Arrow,          // ->
    DoubleColon,    // :: (declaration)
    Colon,          // :
    // Scope / misc
    Dot,            // .
    DoubleDot,      // ..
    Question,       // ? (not ternary, but for optional types if ever needed)

    // ── Delimiters ──
    LParen,         // (
    RParen,         // )
    LBrace,         // {
    RBrace,         // }
    LBracket,       // [
    RBracket,       // ]
    Comma,          // ,
    Semicolon,      // ;
    At,             // @ (annotation prefix)
    Hash,           // # (memory layout directive: #aos, #soa)

    // ── Special ──
    Eof,
    NewLine,        // tracked but usually skipped
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;    // 1-based
    col: number;     // 1-based
    file: string;
}

export function tokenTypeToString(t: TokenType): string {
    return TokenType[t];
}

// Keyword map for fast lookup
const KEYWORDS: Record<string, TokenType> = {
    "func": TokenType.KwFunc,
    "fn": TokenType.KwFunc,   // new syntax: `Name fn(...)` (2026-08-01 migration)
    "struct": TokenType.KwStruct,
    "enum": TokenType.KwEnum,
    "flag": TokenType.KwFlag,
    "union": TokenType.KwUnion,
    "var": TokenType.KwVar,
    "const": TokenType.KwConst,
    "comptime": TokenType.KwComptime,
    "meta": TokenType.KwComptime,   // Phase A: `meta` 元编程关键字，暂别名 KwComptime（后续阶段独立语义）
    "if": TokenType.KwIf,
    "else": TokenType.KwElse,
    "for": TokenType.KwFor,
    "while": TokenType.KwWhile,
    "switch": TokenType.KwSwitch,
    "case": TokenType.KwCase,
    "default": TokenType.KwDefault,
    "break": TokenType.KwBreak,
    "continue": TokenType.KwContinue,
    "return": TokenType.KwReturn,
    "true": TokenType.KwTrue,
    "false": TokenType.KwFalse,
    "null": TokenType.KwNull,
    "map": TokenType.KwMap,
    "import": TokenType.KwImport,
    "export": TokenType.KwExport,
    "as": TokenType.KwAs,
    "in": TokenType.KwIn,
    "defer": TokenType.KwDefer,
    "void": TokenType.KwVoid,
    "string": TokenType.KwString,
    "StringBuilder": TokenType.KwStringBuilder,
};

export function lookupKeyword(text: string): TokenType | null {
    return KEYWORDS[text] ?? null;
}

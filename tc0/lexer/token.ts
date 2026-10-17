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
    // ── §set-ops 引导桥接（gen0 only）────────────────────────────
    // 真实编译器（src/tc.tc + lib/std/rc/cst.tc）已把 `and`/`or` 提升为 bool 关键字，
    // 并把 `&&`/`||` 让位给集合代数。但本 TypeScript 参考实现（tc0，仅作自举 gen0）尚未
    // 同步那套词法/语义改造；源码（src/*.tc）自身全部用 `and`/`or` 写 bool 逻辑，而
    // `&&`/`||` 仅以字符串字面量出现。故此处把 `and`/`or` 直接映射到既有 `And`/`Or`
    // （bool 逻辑）token，使 tc0 能解析新源码并产出与真实编译器一致的 C（bool → C 的
    // &&/||）。tc0 不实现集合代数，但编译编译器源码不需要——真实编译器由 src 生成。
    "and": TokenType.And,
    "or": TokenType.Or,
};

export function lookupKeyword(text: string): TokenType | null {
    return KEYWORDS[text] ?? null;
}

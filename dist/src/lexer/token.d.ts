/**
 * t Language - Token Definitions
 *
 * All token types for the t programming language lexer.
 */
export declare enum TokenType {
    Integer = 0,// 42, 0xFF, 0b1010
    Float = 1,// 3.14, 1.0
    String = 2,// "hello"
    Bool = 3,// true, false
    Identifier = 4,
    KwFunc = 5,// func
    KwStruct = 6,// struct
    KwEnum = 7,// enum
    KwFlag = 8,// flag
    KwUnion = 9,// union
    KwVar = 10,// var
    KwConst = 11,// const
    KwComptime = 12,// comptime
    KwIf = 13,// if
    KwElse = 14,// else
    KwFor = 15,// for
    KwWhile = 16,// while
    KwSwitch = 17,// switch
    KwCase = 18,// case
    KwDefault = 19,// default
    KwBreak = 20,// break
    KwContinue = 21,// continue
    KwReturn = 22,// return
    KwTrue = 23,// true
    KwFalse = 24,// false
    KwNull = 25,// null
    KwMap = 26,// map
    KwImport = 27,// import
    KwExport = 28,// export (not the annotation, the keyword)
    KwAs = 29,// as
    KwIn = 30,// in (for-for-each)
    KwDefer = 31,// defer
    KwVoid = 32,
    KwString = 33,// string type keyword
    KwStringBuilder = 34,// StringBuilder type
    Plus = 35,// +
    Minus = 36,// -
    Star = 37,// *
    Slash = 38,// /
    Percent = 39,// %
    Assign = 40,// =
    PlusAssign = 41,// +=
    MinusAssign = 42,// -=
    StarAssign = 43,// *=
    SlashAssign = 44,// /=
    PercentAssign = 45,// %=
    Eq = 46,// ==
    NotEq = 47,// !=
    Lt = 48,// <
    Gt = 49,// >
    LtEq = 50,// <=
    GtEq = 51,// >=
    And = 52,// &&
    Or = 53,// ||
    Not = 54,// !
    BitAnd = 55,// &
    BitOr = 56,// |
    BitXor = 57,// ^
    BitNot = 58,// ~
    ShiftLeft = 59,// <<
    ShiftRight = 60,// >>
    BitAndAssign = 61,// &=
    BitOrAssign = 62,// |=
    BitXorAssign = 63,// ^=
    ShlAssign = 64,// <<=
    ShrAssign = 65,// >>=
    Arrow = 66,// ->
    DoubleColon = 67,// :: (declaration)
    Colon = 68,// :
    Dot = 69,// .
    DoubleDot = 70,// ..
    Question = 71,// ? (not ternary, but for optional types if ever needed)
    LParen = 72,// (
    RParen = 73,// )
    LBrace = 74,// {
    RBrace = 75,// }
    LBracket = 76,// [
    RBracket = 77,// ]
    Comma = 78,// ,
    Semicolon = 79,// ;
    At = 80,// @ (annotation prefix)
    Hash = 81,// # (memory layout directive: #aos, #soa)
    Eof = 82,
    NewLine = 83
}
export interface Token {
    type: TokenType;
    value: string;
    line: number;
    col: number;
    file: string;
}
export declare function tokenTypeToString(t: TokenType): string;
export declare function lookupKeyword(text: string): TokenType | null;
//# sourceMappingURL=token.d.ts.map
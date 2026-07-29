/**
 * t Language - Token Definitions
 *
 * All token types for the t programming language lexer.
 */
export var TokenType;
(function (TokenType) {
    // ── Literals ──
    TokenType[TokenType["Integer"] = 0] = "Integer";
    TokenType[TokenType["Float"] = 1] = "Float";
    TokenType[TokenType["String"] = 2] = "String";
    TokenType[TokenType["Bool"] = 3] = "Bool";
    TokenType[TokenType["Identifier"] = 4] = "Identifier";
    // ── Keywords ──
    TokenType[TokenType["KwFunc"] = 5] = "KwFunc";
    TokenType[TokenType["KwStruct"] = 6] = "KwStruct";
    TokenType[TokenType["KwEnum"] = 7] = "KwEnum";
    TokenType[TokenType["KwFlag"] = 8] = "KwFlag";
    TokenType[TokenType["KwUnion"] = 9] = "KwUnion";
    TokenType[TokenType["KwVar"] = 10] = "KwVar";
    TokenType[TokenType["KwConst"] = 11] = "KwConst";
    TokenType[TokenType["KwComptime"] = 12] = "KwComptime";
    TokenType[TokenType["KwIf"] = 13] = "KwIf";
    TokenType[TokenType["KwElse"] = 14] = "KwElse";
    TokenType[TokenType["KwFor"] = 15] = "KwFor";
    TokenType[TokenType["KwWhile"] = 16] = "KwWhile";
    TokenType[TokenType["KwSwitch"] = 17] = "KwSwitch";
    TokenType[TokenType["KwCase"] = 18] = "KwCase";
    TokenType[TokenType["KwDefault"] = 19] = "KwDefault";
    TokenType[TokenType["KwBreak"] = 20] = "KwBreak";
    TokenType[TokenType["KwContinue"] = 21] = "KwContinue";
    TokenType[TokenType["KwReturn"] = 22] = "KwReturn";
    TokenType[TokenType["KwTrue"] = 23] = "KwTrue";
    TokenType[TokenType["KwFalse"] = 24] = "KwFalse";
    TokenType[TokenType["KwNull"] = 25] = "KwNull";
    TokenType[TokenType["KwMap"] = 26] = "KwMap";
    TokenType[TokenType["KwImport"] = 27] = "KwImport";
    TokenType[TokenType["KwExport"] = 28] = "KwExport";
    TokenType[TokenType["KwAs"] = 29] = "KwAs";
    TokenType[TokenType["KwIn"] = 30] = "KwIn";
    TokenType[TokenType["KwDefer"] = 31] = "KwDefer";
    // ── Type keywords ──
    TokenType[TokenType["KwVoid"] = 32] = "KwVoid";
    TokenType[TokenType["KwString"] = 33] = "KwString";
    TokenType[TokenType["KwStringBuilder"] = 34] = "KwStringBuilder";
    // ── Operators ──
    // Arithmetic
    TokenType[TokenType["Plus"] = 35] = "Plus";
    TokenType[TokenType["Minus"] = 36] = "Minus";
    TokenType[TokenType["Star"] = 37] = "Star";
    TokenType[TokenType["Slash"] = 38] = "Slash";
    TokenType[TokenType["Percent"] = 39] = "Percent";
    // Assignment
    TokenType[TokenType["Assign"] = 40] = "Assign";
    TokenType[TokenType["PlusAssign"] = 41] = "PlusAssign";
    TokenType[TokenType["MinusAssign"] = 42] = "MinusAssign";
    TokenType[TokenType["StarAssign"] = 43] = "StarAssign";
    TokenType[TokenType["SlashAssign"] = 44] = "SlashAssign";
    TokenType[TokenType["PercentAssign"] = 45] = "PercentAssign";
    // Comparison
    TokenType[TokenType["Eq"] = 46] = "Eq";
    TokenType[TokenType["NotEq"] = 47] = "NotEq";
    TokenType[TokenType["Lt"] = 48] = "Lt";
    TokenType[TokenType["Gt"] = 49] = "Gt";
    TokenType[TokenType["LtEq"] = 50] = "LtEq";
    TokenType[TokenType["GtEq"] = 51] = "GtEq";
    // Logical
    TokenType[TokenType["And"] = 52] = "And";
    TokenType[TokenType["Or"] = 53] = "Or";
    TokenType[TokenType["Not"] = 54] = "Not";
    // Bitwise
    TokenType[TokenType["BitAnd"] = 55] = "BitAnd";
    TokenType[TokenType["BitOr"] = 56] = "BitOr";
    TokenType[TokenType["BitXor"] = 57] = "BitXor";
    TokenType[TokenType["BitNot"] = 58] = "BitNot";
    TokenType[TokenType["ShiftLeft"] = 59] = "ShiftLeft";
    TokenType[TokenType["ShiftRight"] = 60] = "ShiftRight";
    TokenType[TokenType["BitAndAssign"] = 61] = "BitAndAssign";
    TokenType[TokenType["BitOrAssign"] = 62] = "BitOrAssign";
    TokenType[TokenType["BitXorAssign"] = 63] = "BitXorAssign";
    TokenType[TokenType["ShlAssign"] = 64] = "ShlAssign";
    TokenType[TokenType["ShrAssign"] = 65] = "ShrAssign";
    // Arrow
    TokenType[TokenType["Arrow"] = 66] = "Arrow";
    TokenType[TokenType["DoubleColon"] = 67] = "DoubleColon";
    TokenType[TokenType["Colon"] = 68] = "Colon";
    // Scope / misc
    TokenType[TokenType["Dot"] = 69] = "Dot";
    TokenType[TokenType["DoubleDot"] = 70] = "DoubleDot";
    TokenType[TokenType["Question"] = 71] = "Question";
    // ── Delimiters ──
    TokenType[TokenType["LParen"] = 72] = "LParen";
    TokenType[TokenType["RParen"] = 73] = "RParen";
    TokenType[TokenType["LBrace"] = 74] = "LBrace";
    TokenType[TokenType["RBrace"] = 75] = "RBrace";
    TokenType[TokenType["LBracket"] = 76] = "LBracket";
    TokenType[TokenType["RBracket"] = 77] = "RBracket";
    TokenType[TokenType["Comma"] = 78] = "Comma";
    TokenType[TokenType["Semicolon"] = 79] = "Semicolon";
    TokenType[TokenType["At"] = 80] = "At";
    TokenType[TokenType["Hash"] = 81] = "Hash";
    // ── Special ──
    TokenType[TokenType["Eof"] = 82] = "Eof";
    TokenType[TokenType["NewLine"] = 83] = "NewLine";
})(TokenType || (TokenType = {}));
export function tokenTypeToString(t) {
    return TokenType[t];
}
// Keyword map for fast lookup
const KEYWORDS = {
    "func": TokenType.KwFunc,
    "struct": TokenType.KwStruct,
    "enum": TokenType.KwEnum,
    "flag": TokenType.KwFlag,
    "union": TokenType.KwUnion,
    "var": TokenType.KwVar,
    "const": TokenType.KwConst,
    "comptime": TokenType.KwComptime,
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
export function lookupKeyword(text) {
    return KEYWORDS[text] ?? null;
}
//# sourceMappingURL=token.js.map
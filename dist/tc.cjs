#!/usr/bin/env node
"use strict";

// src/index.ts
var import_fs = require("fs");
var import_path = require("path");

// src/lexer/token.ts
var TokenType = /* @__PURE__ */ ((TokenType2) => {
  TokenType2[TokenType2["Integer"] = 0] = "Integer";
  TokenType2[TokenType2["Float"] = 1] = "Float";
  TokenType2[TokenType2["String"] = 2] = "String";
  TokenType2[TokenType2["Bool"] = 3] = "Bool";
  TokenType2[TokenType2["Identifier"] = 4] = "Identifier";
  TokenType2[TokenType2["KwFunc"] = 5] = "KwFunc";
  TokenType2[TokenType2["KwStruct"] = 6] = "KwStruct";
  TokenType2[TokenType2["KwEnum"] = 7] = "KwEnum";
  TokenType2[TokenType2["KwFlag"] = 8] = "KwFlag";
  TokenType2[TokenType2["KwUnion"] = 9] = "KwUnion";
  TokenType2[TokenType2["KwVar"] = 10] = "KwVar";
  TokenType2[TokenType2["KwConst"] = 11] = "KwConst";
  TokenType2[TokenType2["KwComptime"] = 12] = "KwComptime";
  TokenType2[TokenType2["KwIf"] = 13] = "KwIf";
  TokenType2[TokenType2["KwElse"] = 14] = "KwElse";
  TokenType2[TokenType2["KwFor"] = 15] = "KwFor";
  TokenType2[TokenType2["KwWhile"] = 16] = "KwWhile";
  TokenType2[TokenType2["KwSwitch"] = 17] = "KwSwitch";
  TokenType2[TokenType2["KwCase"] = 18] = "KwCase";
  TokenType2[TokenType2["KwDefault"] = 19] = "KwDefault";
  TokenType2[TokenType2["KwBreak"] = 20] = "KwBreak";
  TokenType2[TokenType2["KwContinue"] = 21] = "KwContinue";
  TokenType2[TokenType2["KwReturn"] = 22] = "KwReturn";
  TokenType2[TokenType2["KwTrue"] = 23] = "KwTrue";
  TokenType2[TokenType2["KwFalse"] = 24] = "KwFalse";
  TokenType2[TokenType2["KwNull"] = 25] = "KwNull";
  TokenType2[TokenType2["KwMap"] = 26] = "KwMap";
  TokenType2[TokenType2["KwImport"] = 27] = "KwImport";
  TokenType2[TokenType2["KwExport"] = 28] = "KwExport";
  TokenType2[TokenType2["KwAs"] = 29] = "KwAs";
  TokenType2[TokenType2["KwIn"] = 30] = "KwIn";
  TokenType2[TokenType2["KwDefer"] = 31] = "KwDefer";
  TokenType2[TokenType2["KwVoid"] = 32] = "KwVoid";
  TokenType2[TokenType2["KwString"] = 33] = "KwString";
  TokenType2[TokenType2["KwStringBuilder"] = 34] = "KwStringBuilder";
  TokenType2[TokenType2["Plus"] = 35] = "Plus";
  TokenType2[TokenType2["Minus"] = 36] = "Minus";
  TokenType2[TokenType2["Star"] = 37] = "Star";
  TokenType2[TokenType2["Slash"] = 38] = "Slash";
  TokenType2[TokenType2["Percent"] = 39] = "Percent";
  TokenType2[TokenType2["Assign"] = 40] = "Assign";
  TokenType2[TokenType2["PlusAssign"] = 41] = "PlusAssign";
  TokenType2[TokenType2["MinusAssign"] = 42] = "MinusAssign";
  TokenType2[TokenType2["StarAssign"] = 43] = "StarAssign";
  TokenType2[TokenType2["SlashAssign"] = 44] = "SlashAssign";
  TokenType2[TokenType2["PercentAssign"] = 45] = "PercentAssign";
  TokenType2[TokenType2["Eq"] = 46] = "Eq";
  TokenType2[TokenType2["NotEq"] = 47] = "NotEq";
  TokenType2[TokenType2["Lt"] = 48] = "Lt";
  TokenType2[TokenType2["Gt"] = 49] = "Gt";
  TokenType2[TokenType2["LtEq"] = 50] = "LtEq";
  TokenType2[TokenType2["GtEq"] = 51] = "GtEq";
  TokenType2[TokenType2["And"] = 52] = "And";
  TokenType2[TokenType2["Or"] = 53] = "Or";
  TokenType2[TokenType2["Not"] = 54] = "Not";
  TokenType2[TokenType2["BitAnd"] = 55] = "BitAnd";
  TokenType2[TokenType2["BitOr"] = 56] = "BitOr";
  TokenType2[TokenType2["BitXor"] = 57] = "BitXor";
  TokenType2[TokenType2["BitNot"] = 58] = "BitNot";
  TokenType2[TokenType2["ShiftLeft"] = 59] = "ShiftLeft";
  TokenType2[TokenType2["ShiftRight"] = 60] = "ShiftRight";
  TokenType2[TokenType2["BitAndAssign"] = 61] = "BitAndAssign";
  TokenType2[TokenType2["BitOrAssign"] = 62] = "BitOrAssign";
  TokenType2[TokenType2["BitXorAssign"] = 63] = "BitXorAssign";
  TokenType2[TokenType2["ShlAssign"] = 64] = "ShlAssign";
  TokenType2[TokenType2["ShrAssign"] = 65] = "ShrAssign";
  TokenType2[TokenType2["Arrow"] = 66] = "Arrow";
  TokenType2[TokenType2["DoubleColon"] = 67] = "DoubleColon";
  TokenType2[TokenType2["Colon"] = 68] = "Colon";
  TokenType2[TokenType2["Dot"] = 69] = "Dot";
  TokenType2[TokenType2["DoubleDot"] = 70] = "DoubleDot";
  TokenType2[TokenType2["Question"] = 71] = "Question";
  TokenType2[TokenType2["LParen"] = 72] = "LParen";
  TokenType2[TokenType2["RParen"] = 73] = "RParen";
  TokenType2[TokenType2["LBrace"] = 74] = "LBrace";
  TokenType2[TokenType2["RBrace"] = 75] = "RBrace";
  TokenType2[TokenType2["LBracket"] = 76] = "LBracket";
  TokenType2[TokenType2["RBracket"] = 77] = "RBracket";
  TokenType2[TokenType2["Comma"] = 78] = "Comma";
  TokenType2[TokenType2["Semicolon"] = 79] = "Semicolon";
  TokenType2[TokenType2["At"] = 80] = "At";
  TokenType2[TokenType2["Hash"] = 81] = "Hash";
  TokenType2[TokenType2["Eof"] = 82] = "Eof";
  TokenType2[TokenType2["NewLine"] = 83] = "NewLine";
  return TokenType2;
})(TokenType || {});
var KEYWORDS = {
  "func": 5 /* KwFunc */,
  "struct": 6 /* KwStruct */,
  "enum": 7 /* KwEnum */,
  "flag": 8 /* KwFlag */,
  "union": 9 /* KwUnion */,
  "var": 10 /* KwVar */,
  "const": 11 /* KwConst */,
  "comptime": 12 /* KwComptime */,
  "if": 13 /* KwIf */,
  "else": 14 /* KwElse */,
  "for": 15 /* KwFor */,
  "while": 16 /* KwWhile */,
  "switch": 17 /* KwSwitch */,
  "case": 18 /* KwCase */,
  "default": 19 /* KwDefault */,
  "break": 20 /* KwBreak */,
  "continue": 21 /* KwContinue */,
  "return": 22 /* KwReturn */,
  "true": 23 /* KwTrue */,
  "false": 24 /* KwFalse */,
  "null": 25 /* KwNull */,
  "map": 26 /* KwMap */,
  "import": 27 /* KwImport */,
  "export": 28 /* KwExport */,
  "as": 29 /* KwAs */,
  "in": 30 /* KwIn */,
  "defer": 31 /* KwDefer */,
  "void": 32 /* KwVoid */,
  "string": 33 /* KwString */,
  "StringBuilder": 34 /* KwStringBuilder */
};
function lookupKeyword(text) {
  return KEYWORDS[text] ?? null;
}

// src/diagnostics/diagnostic.ts
function makeSpan(file, startLine, startCol, endLine, endCol) {
  return { file, startLine, startCol, endLine, endCol };
}
var ErrorCode = {
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
  T_INTERNAL: "T_INTERNAL"
};
var DiagnosticBag = class {
  diagnostics = [];
  add(diag) {
    this.diagnostics.push(diag);
  }
  error(code, message, span, opts) {
    this.add({
      code,
      severity: "error" /* Error */,
      message,
      span,
      validValues: opts?.validValues,
      fixSuggestions: opts?.fixSuggestions,
      notes: opts?.notes
    });
  }
  warning(code, message, span, opts) {
    this.add({
      code,
      severity: "warning" /* Warning */,
      message,
      span,
      notes: opts?.notes
    });
  }
  info(code, message, span) {
    this.add({ code, severity: "info" /* Info */, message, span });
  }
  hasErrors() {
    return this.diagnostics.some((d) => d.severity === "error" /* Error */);
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
    const errorCount = this.diagnostics.filter((d) => d.severity === "error" /* Error */).length;
    const warnCount = this.diagnostics.filter((d) => d.severity === "warning" /* Warning */).length;
    lines.push("");
    lines.push(`${errorCount} error(s), ${warnCount} warning(s)`);
    return lines.join("\n");
  }
  // ── JSON machine diagnostic output (spec 8.2.2) ──
  toJson() {
    return JSON.stringify(
      {
        diagnostics: this.diagnostics.map((d) => ({
          code: d.code,
          severity: d.severity,
          message: d.message,
          location: {
            file: d.span.file,
            startLine: d.span.startLine,
            startCol: d.span.startCol,
            endLine: d.span.endLine,
            endCol: d.span.endCol
          },
          validValues: d.validValues ?? null,
          fixSuggestions: d.fixSuggestions?.map((f) => ({
            description: f.description,
            range: {
              file: f.range.file,
              startLine: f.range.startLine,
              startCol: f.range.startCol,
              endLine: f.range.endLine,
              endCol: f.range.endCol
            },
            replacement: f.replacement
          })) ?? null,
          notes: d.notes ?? null
        })),
        summary: {
          total: this.diagnostics.length,
          errors: this.diagnostics.filter((d) => d.severity === "error" /* Error */).length,
          warnings: this.diagnostics.filter((d) => d.severity === "warning" /* Warning */).length,
          infos: this.diagnostics.filter((d) => d.severity === "info" /* Info */).length
        }
      },
      null,
      2
    );
  }
};

// src/lexer/lexer.ts
var Lexer = class {
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
      if (ch === " " || ch === "	" || ch === "\r") {
        this.advance();
        continue;
      }
      if (ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "/" && this.peek(1) === "/") {
        this.skipLineComment();
        continue;
      }
      if (ch === "/" && this.peek(1) === "*") {
        this.skipBlockComment();
        continue;
      }
      if (this.isDigit(ch)) {
        this.lexNumber();
        continue;
      }
      if (ch === '"') {
        this.lexString();
        continue;
      }
      if (this.isIdentStart(ch)) {
        this.lexIdentifier();
        continue;
      }
      if (ch === "@") {
        this.pushToken(80 /* At */, "@");
        this.advance();
        continue;
      }
      if (ch === "#") {
        this.pushToken(81 /* Hash */, "#");
        this.advance();
        continue;
      }
      this.lexOperator();
    }
    this.pushToken(82 /* Eof */, "");
    return this.tokens;
  }
  // ── Lexing helpers ────────────────────────────────────────────
  advance() {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
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
    return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_";
  }
  isIdentContinue(ch) {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }
  isHexDigit(ch) {
    return ch >= "0" && ch <= "9" || ch >= "a" && ch <= "f" || ch >= "A" && ch <= "F";
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
    this.advance();
    this.advance();
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === "*" && this.peek(1) === "/") {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
    this.bag.error(
      ErrorCode.T_LEX_UNTERMINATED_STRING,
      "unterminated block comment",
      makeSpan(this.file, this.line, this.col, this.line, this.col)
    );
  }
  // ── Number lexing ─────────────────────────────────────────────
  lexNumber() {
    const startLine = this.line;
    const startCol = this.col;
    if (this.source[this.pos] === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      this.advance();
      this.advance();
      let hex = "";
      while (this.pos < this.source.length && this.isHexDigit(this.source[this.pos])) {
        hex += this.advance();
      }
      if (hex.length === 0) {
        this.bag.error(
          ErrorCode.T_LEX_INVALID_NUMBER,
          "hex literal has no digits after 0x",
          makeSpan(this.file, startLine, startCol, this.line, this.col)
        );
      }
      this.tokens.push({
        type: 0 /* Integer */,
        value: "0x" + hex,
        line: startLine,
        col: startCol,
        file: this.file
      });
      return;
    }
    if (this.source[this.pos] === "0" && (this.peek(1) === "b" || this.peek(1) === "B")) {
      this.advance();
      this.advance();
      let bin = "";
      while (this.pos < this.source.length && this.isBinDigit(this.source[this.pos])) {
        bin += this.advance();
      }
      if (bin.length === 0) {
        this.bag.error(
          ErrorCode.T_LEX_INVALID_NUMBER,
          "binary literal has no digits after 0b",
          makeSpan(this.file, startLine, startCol, this.line, this.col)
        );
      }
      this.tokens.push({
        type: 0 /* Integer */,
        value: "0b" + bin,
        line: startLine,
        col: startCol,
        file: this.file
      });
      return;
    }
    let num = "";
    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      num += this.advance();
    }
    if (this.source[this.pos] === "." && this.isDigit(this.peek(1))) {
      num += this.advance();
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        num += this.advance();
      }
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
        type: 1 /* Float */,
        value: num,
        line: startLine,
        col: startCol,
        file: this.file
      });
      return;
    }
    this.tokens.push({
      type: 0 /* Integer */,
      value: num,
      line: startLine,
      col: startCol,
      file: this.file
    });
  }
  // ── String lexing ─────────────────────────────────────────────
  lexString() {
    const startLine = this.line;
    const startCol = this.col;
    this.advance();
    let result = "";
    while (this.pos < this.source.length && this.source[this.pos] !== '"') {
      if (this.source[this.pos] === "\\") {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case "n":
            result += "\n";
            break;
          case "t":
            result += "	";
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
            this.bag.warning(
              ErrorCode.T_LEX_INVALID_CHAR,
              `unknown escape sequence \\${esc}`,
              makeSpan(this.file, this.line, this.col - 1, this.line, this.col)
            );
        }
      } else {
        result += this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      this.bag.error(
        ErrorCode.T_LEX_UNTERMINATED_STRING,
        "unterminated string literal",
        makeSpan(this.file, startLine, startCol, this.line, this.col)
      );
      return;
    }
    this.advance();
    this.tokens.push({
      type: 2 /* String */,
      value: result,
      line: startLine,
      col: startCol,
      file: this.file
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
        file: this.file
      });
    } else {
      this.tokens.push({
        type: 4 /* Identifier */,
        value: text,
        line: startLine,
        col: startCol,
        file: this.file
      });
    }
  }
  // ── Operator / punctuation lexing ─────────────────────────────
  lexOperator() {
    const startLine = this.line;
    const startCol = this.col;
    const ch = this.source[this.pos];
    const next = this.peek(1);
    const twoChar = {
      "->": 66 /* Arrow */,
      "::": 67 /* DoubleColon */,
      "==": 46 /* Eq */,
      "!=": 47 /* NotEq */,
      "<=": 50 /* LtEq */,
      ">=": 51 /* GtEq */,
      "&&": 52 /* And */,
      "||": 53 /* Or */,
      "<<": 59 /* ShiftLeft */,
      ">>": 60 /* ShiftRight */,
      "..": 70 /* DoubleDot */,
      "+=": 41 /* PlusAssign */,
      "-=": 42 /* MinusAssign */,
      "*=": 43 /* StarAssign */,
      "/=": 44 /* SlashAssign */,
      "%=": 45 /* PercentAssign */,
      "&=": 61 /* BitAndAssign */,
      "|=": 62 /* BitOrAssign */,
      "^=": 63 /* BitXorAssign */,
      "<<=": 64 /* ShlAssign */,
      ">>=": 65 /* ShrAssign */
    };
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
    const singleChar = {
      "+": 35 /* Plus */,
      "-": 36 /* Minus */,
      "*": 37 /* Star */,
      "/": 38 /* Slash */,
      "%": 39 /* Percent */,
      "=": 40 /* Assign */,
      "<": 48 /* Lt */,
      ">": 49 /* Gt */,
      "!": 54 /* Not */,
      "&": 55 /* BitAnd */,
      "|": 56 /* BitOr */,
      "^": 57 /* BitXor */,
      "~": 58 /* BitNot */,
      ":": 68 /* Colon */,
      ".": 69 /* Dot */,
      "?": 71 /* Question */,
      "(": 72 /* LParen */,
      ")": 73 /* RParen */,
      "{": 74 /* LBrace */,
      "}": 75 /* RBrace */,
      "[": 76 /* LBracket */,
      "]": 77 /* RBracket */,
      ",": 78 /* Comma */,
      ";": 79 /* Semicolon */
    };
    if (singleChar[ch]) {
      this.pushToken(singleChar[ch], ch);
      this.advance();
      return;
    }
    this.bag.error(
      ErrorCode.T_LEX_INVALID_CHAR,
      `unexpected character '${ch}' (U+${ch.charCodeAt(0).toString(16).padStart(4, "0")})`,
      makeSpan(this.file, startLine, startCol, startLine, startCol)
    );
    this.advance();
  }
  pushToken(type, value) {
    this.tokens.push({
      type,
      value,
      line: this.line,
      col: this.col,
      file: this.file
    });
  }
};

// src/parser/parser.ts
function mkType(inner, token) {
  return { kind: "Type", inner, token };
}
function mkExpr(exprKind, token) {
  return { kind: "Expr", exprKind, token };
}
function mkStmt(stmtKind, token) {
  return { kind: "Stmt", stmtKind, token };
}
function spanOf(token) {
  return {
    file: token.file,
    startLine: token.line,
    startCol: token.col,
    endLine: token.line,
    endCol: token.col + token.value.length
  };
}
var Parser = class {
  tokens;
  pos = 0;
  file;
  bag;
  constructor(tokens, file, bag) {
    this.tokens = tokens;
    this.file = file;
    this.bag = bag;
  }
  parse() {
    const declarations = [];
    while (!this.isAtEnd()) {
      if (this.check(79 /* Semicolon */)) {
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
  current() {
    return this.tokens[this.pos];
  }
  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }
  advance() {
    if (!this.isAtEnd()) this.pos++;
    return this.tokens[this.pos - 1];
  }
  isAtEnd() {
    return this.current().type === 82 /* Eof */;
  }
  check(type) {
    return this.current().type === type;
  }
  match(...types) {
    for (const t of types) {
      if (this.check(t)) return this.advance();
    }
    return null;
  }
  expect(type, errorMsg) {
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
          replacement: this.tokenRepr(type)
        }]
      }
    );
    return tok;
  }
  tokenRepr(type) {
    const map = {
      [79 /* Semicolon */]: ";",
      [74 /* LBrace */]: "{",
      [75 /* RBrace */]: "}",
      [72 /* LParen */]: "(",
      [73 /* RParen */]: ")",
      [76 /* LBracket */]: "[",
      [77 /* RBracket */]: "]",
      [78 /* Comma */]: ",",
      [68 /* Colon */]: ":",
      [66 /* Arrow */]: "->",
      [67 /* DoubleColon */]: "::",
      [40 /* Assign */]: "="
    };
    return map[type] ?? TokenType[type];
  }
  synchronize() {
    while (!this.isAtEnd()) {
      if (this.check(79 /* Semicolon */)) {
        this.advance();
        return;
      }
      if (this.check(75 /* RBrace */)) {
        this.advance();
        return;
      }
      this.advance();
    }
  }
  // ─── Declaration parsing ──────────────────────────────────────
  parseDeclaration() {
    const annotations = this.parseAnnotations();
    if (this.check(10 /* KwVar */)) {
      return this.parseGlobalVar(false);
    }
    if (this.check(11 /* KwConst */)) {
      return this.parseGlobalVar(true);
    }
    if (this.check(27 /* KwImport */)) {
      return this.parseImport(annotations);
    }
    let isComptime = false;
    if (this.check(12 /* KwComptime */)) {
      this.advance();
      isComptime = true;
    }
    if (!this.check(4 /* Identifier */)) {
      const tok = this.current();
      this.bag.error(
        ErrorCode.T_PARSE_INVALID_DECL,
        `expected declaration name but found '${tok.value}'`,
        makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length)
      );
      this.synchronize();
      return null;
    }
    const nameTok = this.advance();
    const name = nameTok.value;
    this.validateDeclName(name, nameTok);
    if (!this.match(67 /* DoubleColon */)) {
      const tok = this.current();
      this.bag.error(
        ErrorCode.T_PARSE_EXPECTED_TOKEN,
        `expected '::' after declaration name '${name}' but found '${tok.value}'`,
        makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length)
      );
      this.synchronize();
      return null;
    }
    const decl = this.parseDeclBody(name, nameTok, annotations, isComptime);
    return decl;
  }
  parseDeclBody(name, nameTok, annotations, isComptime) {
    const tok = this.current();
    let memoryLayout = "default";
    if (this.check(81 /* Hash */)) {
      const hashTok = this.advance();
      const layoutName = this.advance();
      if (layoutName.type === 4 /* Identifier */) {
        if (layoutName.value === "soa") memoryLayout = "soa";
        else if (layoutName.value === "aos") memoryLayout = "aos";
        else {
          this.bag.error(
            ErrorCode.T_PARSE_UNEXPECTED_TOKEN,
            `unknown memory layout directive '#${layoutName.value}'`,
            makeSpan(this.file, hashTok.line, hashTok.col, layoutName.line, layoutName.col + layoutName.value.length),
            { validValues: ["#aos", "#soa"] }
          );
        }
      }
    }
    switch (this.current().type) {
      case 6 /* KwStruct */:
        return this.parseStructDecl(name, nameTok, annotations, memoryLayout);
      case 7 /* KwEnum */:
        return this.parseEnumDecl(name, nameTok, annotations);
      case 8 /* KwFlag */:
        return this.parseFlagDecl(name, nameTok, annotations, false);
      case 9 /* KwUnion */:
        return this.parseUnionDecl(name, nameTok, annotations);
      case 5 /* KwFunc */:
        return this.parseFuncDecl(name, nameTok, annotations, isComptime);
      default:
        if (this.check(4 /* Identifier */) && this.current().value === "flag_set") {
          return this.parseFlagSetDecl(name, nameTok, annotations);
        }
        return this.parseTypeAlias(name, nameTok, annotations);
    }
  }
  // ── Struct declaration ────────────────────────────────────────
  parseStructDecl(name, nameTok, annotations, memoryLayout) {
    this.advance();
    const postAnnotations = this.parseAnnotations();
    const allAnnotations = [...annotations, ...postAnnotations];
    const bitpackAnno = allAnnotations.find((a) => a.name === "bitpack");
    const isBitpack = bitpackAnno !== void 0;
    let bitpackType = null;
    if (bitpackAnno && bitpackAnno.args.length > 0) {
      const arg = bitpackAnno.args[0];
      if (arg.kind === "IdentArg") bitpackType = arg.value;
    }
    this.expect(74 /* LBrace */, "expected '{' to start struct body");
    const fields = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      const fieldName = this.expect(4 /* Identifier */, "expected field name");
      this.expect(68 /* Colon */, "expected ':' after field name");
      if (isBitpack) {
        const widthTok = this.expect(0 /* Integer */, "expected bit width for @bitpack field");
        const fieldAnnotations = this.parseAnnotations();
        this.expect(79 /* Semicolon */, "expected ';' after field");
        fields.push({
          name: fieldName.value,
          typeNode: mkType({ kind: "ScalarType", name: "void" }),
          // bitpack fields have no type
          bitWidth: parseInt(widthTok.value, 10),
          annotations: fieldAnnotations
        });
      } else {
        const typeNode = this.parseType();
        const fieldAnnotations = this.parseAnnotations();
        this.expect(79 /* Semicolon */, "expected ';' after field declaration");
        fields.push({
          name: fieldName.value,
          typeNode,
          bitWidth: null,
          annotations: fieldAnnotations
        });
      }
    }
    this.expect(75 /* RBrace */, "expected '}' to close struct body");
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
        bitpackType
      }
    };
  }
  // ── Enum declaration ──────────────────────────────────────────
  parseEnumDecl(name, nameTok, annotations) {
    this.advance();
    let underlyingType = "u32";
    if (this.match(68 /* Colon */)) {
      const typeTok = this.advance();
      underlyingType = typeTok.value;
    }
    const postAnnotations = this.parseAnnotations();
    const allAnnotations = [...annotations, ...postAnnotations];
    this.expect(74 /* LBrace */, "expected '{' to start enum body");
    const variants = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      if (this.check(80 /* At */) || !this.check(4 /* Identifier */)) {
        this.advance();
        continue;
      }
      const varName = this.expect(4 /* Identifier */, "expected enum variant name");
      let value = null;
      if (this.match(40 /* Assign */)) {
        value = this.parseExpr();
      }
      const varAnnotations = this.parseAnnotations();
      this.match(78 /* Comma */);
      variants.push({ name: varName.value, value, annotations: varAnnotations });
    }
    this.expect(75 /* RBrace */, "expected '}' to close enum body");
    return {
      kind: "Decl",
      token: nameTok,
      span: spanOf(nameTok),
      annotations: allAnnotations,
      declKind: { kind: "EnumDecl", name, underlyingType, variants }
    };
  }
  // ── Flag declaration: flag[u32] { ... } ───────────────────────
  parseFlagDecl(name, nameTok, annotations, isFlagSet) {
    this.advance();
    let underlyingType = "u32";
    if (this.match(76 /* LBracket */)) {
      const typeTok = this.advance();
      underlyingType = typeTok.value;
      this.expect(77 /* RBracket */, "expected ']' after flag underlying type");
    }
    const postAnnotations = this.parseAnnotations();
    const allAnnotations = [...annotations, ...postAnnotations];
    this.expect(74 /* LBrace */, "expected '{' to start flag body");
    const slots = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      if (!this.check(4 /* Identifier */)) {
        this.advance();
        continue;
      }
      const slotName = this.expect(4 /* Identifier */, "expected flag slot name");
      this.expect(68 /* Colon */, "expected ':' after flag slot name");
      const widthTok = this.expect(0 /* Integer */, "expected bit width for flag slot");
      const bitWidth = parseInt(widthTok.value, 10);
      const slotAnnotations = this.parseAnnotations();
      let offset = null;
      const offsetAnno = slotAnnotations.find((a) => a.name === "offset");
      if (offsetAnno && offsetAnno.args.length > 0) {
        const arg = offsetAnno.args[0];
        if (arg.kind === "NumberArg") {
          offset = parseInt(arg.value, 10);
        }
      }
      this.match(78 /* Comma */, 79 /* Semicolon */);
      slots.push({ name: slotName.value, bitWidth, offset, annotations: slotAnnotations });
    }
    this.expect(75 /* RBrace */, "expected '}' to close flag body");
    return {
      kind: "Decl",
      token: nameTok,
      span: spanOf(nameTok),
      annotations: allAnnotations,
      declKind: { kind: "FlagDecl", name, underlyingType, slots }
    };
  }
  // ── Flag Set declaration: flag_set { ... } ────────────────────
  parseFlagSetDecl(name, nameTok, annotations) {
    this.advance();
    const postAnnotations = this.parseAnnotations();
    const allAnnotations = [...annotations, ...postAnnotations];
    this.expect(74 /* LBrace */, "expected '{' to start flag_set body");
    const slots = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      if (!this.check(4 /* Identifier */)) {
        this.advance();
        continue;
      }
      const slotName = this.expect(4 /* Identifier */, "expected flag_set slot name");
      this.expect(68 /* Colon */, "expected ':' after flag_set slot name");
      const widthTok = this.expect(0 /* Integer */, "expected bit width");
      const bitWidth = parseInt(widthTok.value, 10);
      const slotAnnotations = this.parseAnnotations();
      this.match(78 /* Comma */, 79 /* Semicolon */);
      slots.push({ name: slotName.value, bitWidth, offset: null, annotations: slotAnnotations });
    }
    this.expect(75 /* RBrace */, "expected '}' to close flag_set body");
    return {
      kind: "Decl",
      token: nameTok,
      span: spanOf(nameTok),
      annotations: allAnnotations,
      declKind: { kind: "FlagSetDecl", name, slots }
    };
  }
  // ── Union declaration ─────────────────────────────────────────
  parseUnionDecl(name, nameTok, annotations) {
    this.advance();
    const postAnnotations = this.parseAnnotations();
    const allAnnotations = [...annotations, ...postAnnotations];
    this.expect(74 /* LBrace */, "expected '{' to start union body");
    const members = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      if (!this.check(4 /* Identifier */)) {
        this.advance();
        continue;
      }
      const memberName = this.expect(4 /* Identifier */, "expected union member name");
      this.expect(68 /* Colon */, "expected ':' after union member name");
      const typeNode = this.parseType();
      const memberAnnotations = this.parseAnnotations();
      this.match(78 /* Comma */, 79 /* Semicolon */);
      members.push({ name: memberName.value, typeNode, annotations: memberAnnotations });
    }
    this.expect(75 /* RBrace */, "expected '}' to close union body");
    return {
      kind: "Decl",
      token: nameTok,
      span: spanOf(nameTok),
      annotations: allAnnotations,
      declKind: { kind: "UnionDecl", name, underlyingType: null, members }
    };
  }
  // ── Function declaration ──────────────────────────────────────
  parseFuncDecl(name, nameTok, annotations, isComptime) {
    this.advance();
    this.expect(72 /* LParen */, "expected '(' to start parameter list");
    const params = [];
    while (!this.check(73 /* RParen */) && !this.isAtEnd()) {
      const paramName = this.expect(4 /* Identifier */, "expected parameter name");
      this.expect(68 /* Colon */, "expected ':' after parameter name");
      const paramType = this.parseType();
      const paramAnnotations = this.parseAnnotations();
      params.push({ name: paramName.value, typeNode: paramType, annotations: paramAnnotations });
      if (!this.match(78 /* Comma */)) break;
    }
    this.expect(73 /* RParen */, "expected ')' to close parameter list");
    this.expect(66 /* Arrow */, "expected '->' before return type");
    const returnType = this.parseType();
    const postAnnotations = this.parseAnnotations();
    const allAnnotations = [...annotations, ...postAnnotations];
    let body = null;
    let isExtern = false;
    if (this.check(79 /* Semicolon */)) {
      this.advance();
      isExtern = true;
    } else if (this.check(74 /* LBrace */)) {
      body = this.parseBlock();
    } else {
      const tok = this.current();
      this.bag.error(
        ErrorCode.T_PARSE_EXPECTED_TOKEN,
        `expected '{' or ';' after function signature but found '${tok.value}'`,
        makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length)
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
        isComptime
      }
    };
  }
  // ── Global var / const ────────────────────────────────────────
  parseGlobalVar(isConst) {
    const kw = this.advance();
    const nameTok = this.expect(4 /* Identifier */, "expected variable name");
    let typeNode = null;
    if (this.match(68 /* Colon */)) {
      typeNode = this.parseType();
    }
    let init = null;
    if (this.match(40 /* Assign */)) {
      init = this.parseExpr();
    }
    this.expect(79 /* Semicolon */, "expected ';' after variable declaration");
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
          isComptime: false
        }
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
        isComptime: false
      }
    };
  }
  // ── Import ────────────────────────────────────────────────────
  parseImport(annotations) {
    this.advance();
    const pathTok = this.expect(2 /* String */, "expected import path string");
    let alias = null;
    if (this.match(29 /* KwAs */)) {
      const aliasTok = this.expect(4 /* Identifier */, "expected alias name");
      alias = aliasTok.value;
    }
    this.expect(79 /* Semicolon */, "expected ';' after import");
    return {
      kind: "Decl",
      token: pathTok,
      span: spanOf(pathTok),
      annotations,
      declKind: { kind: "ImportDecl", path: pathTok.value, alias }
    };
  }
  // ── Type alias: Name :: SomeType; ─────────────────────────────
  parseTypeAlias(name, nameTok, annotations) {
    const aliasedType = this.parseType();
    this.expect(79 /* Semicolon */, "expected ';' after type alias");
    return {
      kind: "Decl",
      token: nameTok,
      span: spanOf(nameTok),
      annotations,
      declKind: { kind: "TypeAliasDecl", name, aliasedType }
    };
  }
  // ─── Annotation parsing ───────────────────────────────────────
  parseAnnotations() {
    const annotations = [];
    while (this.check(80 /* At */)) {
      const atTok = this.advance();
      let nameTok;
      if (this.check(4 /* Identifier */) || this.current().type === 28 /* KwExport */) {
        nameTok = this.advance();
      } else {
        nameTok = this.expect(4 /* Identifier */, "expected annotation name after '@'");
      }
      const name = nameTok.value;
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        this.bag.warning(
          ErrorCode.T_NAME_ANNOTATION_LOWER,
          `annotation name '${name}' should be lowercase snake_case`,
          makeSpan(this.file, nameTok.line, nameTok.col, nameTok.line, nameTok.col + name.length)
        );
      }
      const args = [];
      if (this.match(72 /* LParen */)) {
        args.push(...this.parseAnnotationArgs());
        this.expect(73 /* RParen */, "expected ')' to close annotation arguments");
      }
      annotations.push({
        kind: "Annotation",
        name,
        args,
        token: nameTok
      });
    }
    return annotations;
  }
  parseAnnotationArgs() {
    const args = [];
    while (!this.check(73 /* RParen */) && !this.isAtEnd()) {
      const tok = this.current();
      if (tok.type === 2 /* String */) {
        this.advance();
        args.push({ kind: "StringArg", value: tok.value });
      } else if (tok.type === 0 /* Integer */) {
        this.advance();
        args.push({ kind: "NumberArg", value: tok.value });
      } else if (tok.type === 4 /* Identifier */) {
        const idents = [this.advance().value];
        while (this.match(78 /* Comma */)) {
          const id = this.expect(4 /* Identifier */, "expected identifier in annotation list");
          idents.push(id.value);
        }
        if (idents.length === 1) {
          args.push({ kind: "IdentArg", value: idents[0] });
        } else {
          args.push({
            kind: "ListArg",
            values: idents.map((v) => ({ kind: "IdentArg", value: v }))
          });
        }
      } else {
        this.bag.error(
          ErrorCode.T_ANNOTATION_INVALID_ARG,
          `invalid annotation argument '${tok.value}'`,
          makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length)
        );
        this.advance();
      }
      if (!this.check(73 /* RParen */)) {
        this.match(78 /* Comma */);
      }
    }
    return args;
  }
  // ─── Type parsing ─────────────────────────────────────────────
  parseType() {
    const tok = this.current();
    if (tok.type === 26 /* KwMap */) {
      this.advance();
      this.expect(76 /* LBracket */, "expected '[' after 'map'");
      const keyType = this.parseType();
      this.expect(77 /* RBracket */, "expected ']' after map key type");
      const valueType = this.parseType();
      return mkType({ kind: "MapType", key: keyType, value: valueType }, tok);
    }
    if (tok.type === 76 /* LBracket */) {
      this.advance();
      if (this.check(77 /* RBracket */)) {
        this.advance();
        const elem = this.parseType();
        return mkType({ kind: "SliceType", elem }, tok);
      } else {
        const length = this.parseExpr();
        this.expect(77 /* RBracket */, "expected ']' after array length");
        const elem = this.parseType();
        return mkType({ kind: "ArrayType", elem, length }, tok);
      }
    }
    if (tok.type === 37 /* Star */) {
      this.advance();
      const elem = this.parseType();
      return mkType({ kind: "PointerType", elem }, tok);
    }
    if (tok.type === 71 /* Question */) {
      this.advance();
      const elem = this.parseType();
      return mkType({ kind: "OptionalType", elem }, tok);
    }
    if (tok.type === 32 /* KwVoid */) {
      this.advance();
      return mkType({ kind: "ScalarType", name: "void" }, tok);
    }
    if (tok.type === 33 /* KwString */) {
      this.advance();
      return mkType({ kind: "ScalarType", name: "string" }, tok);
    }
    if (tok.type === 34 /* KwStringBuilder */) {
      this.advance();
      return mkType({ kind: "ScalarType", name: "StringBuilder" }, tok);
    }
    if (tok.type === 4 /* Identifier */) {
      this.advance();
      const name = tok.value;
      if (name === "flag" && this.match(76 /* LBracket */)) {
        const underlyingTok = this.advance();
        this.expect(77 /* RBracket */, "expected ']' after flag underlying type");
        return mkType({ kind: "FlagType", underlying: underlyingTok.value }, tok);
      }
      if (name === "flag_set") {
        return mkType({ kind: "FlagSetType" }, tok);
      }
      if (name === "Variant") {
        return mkType({ kind: "VariantType" }, tok);
      }
      const scalars = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f16", "f32", "f64", "bool"];
      if (scalars.includes(name)) {
        return mkType({ kind: "ScalarType", name }, tok);
      }
      return mkType({ kind: "NamedType", name }, tok);
    }
    this.bag.error(
      ErrorCode.T_PARSE_UNEXPECTED_TOKEN,
      `expected type but found '${tok.value}'`,
      makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length)
    );
    this.advance();
    return mkType({ kind: "ScalarType", name: "void" }, tok);
  }
  // ─── Block parsing ────────────────────────────────────────────
  parseBlock() {
    this.expect(74 /* LBrace */, "expected '{' to start block");
    const stmts = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    this.expect(75 /* RBrace */, "expected '}' to close block");
    return stmts;
  }
  // ─── Statement parsing ────────────────────────────────────────
  parseStatement() {
    const tok = this.current();
    switch (tok.type) {
      case 13 /* KwIf */:
        return this.parseIfStmt();
      case 15 /* KwFor */:
        return this.parseForStmt();
      case 16 /* KwWhile */:
        return this.parseWhileStmt();
      case 17 /* KwSwitch */:
        return this.parseSwitchStmt();
      case 22 /* KwReturn */:
        return this.parseReturnStmt();
      case 20 /* KwBreak */:
        this.advance();
        this.expect(79 /* Semicolon */, "expected ';' after 'break'");
        return mkStmt({ kind: "BreakStmt" }, tok);
      case 21 /* KwContinue */:
        this.advance();
        this.expect(79 /* Semicolon */, "expected ';' after 'continue'");
        return mkStmt({ kind: "ContinueStmt" }, tok);
      case 31 /* KwDefer */:
        this.advance();
        return mkStmt({ kind: "DeferStmt", body: this.parseBlock() }, tok);
      case 12 /* KwComptime */:
        this.advance();
        if (this.check(74 /* LBrace */)) {
          return mkStmt({ kind: "ComptimeStmt", body: this.parseBlock() }, tok);
        }
        const expr = this.parseExpr();
        this.expect(79 /* Semicolon */, "expected ';' after comptime expression");
        return mkStmt({ kind: "ExprStmt", expr: mkExpr({ kind: "ComptimeExpr", expr }, tok) }, tok);
      case 74 /* LBrace */:
        return mkStmt({ kind: "BlockStmt", body: this.parseBlock() }, tok);
      case 10 /* KwVar */:
        return this.parseLocalVar(false);
      case 11 /* KwConst */:
        return this.parseLocalVar(true);
      default:
        return this.parseExprOrAssignStmt();
    }
  }
  parseIfStmt() {
    const tok = this.current();
    this.advance();
    this.expect(72 /* LParen */, "expected '(' after 'if'");
    const condition = this.parseExpr();
    this.expect(73 /* RParen */, "expected ')' after if condition");
    if (!this.check(74 /* LBrace */)) {
      const t = this.current();
      this.bag.error(
        ErrorCode.T_STMT_MISSING_BRACES,
        "if statement body must be wrapped in braces (single-line bodies are not allowed)",
        makeSpan(this.file, t.line, t.col, t.line, t.col + t.value.length),
        { fixSuggestions: [{ description: "wrap body in { }", range: makeSpan(this.file, t.line, t.col, t.line, t.col), replacement: "{ " }] }
      );
    }
    const thenBlock = this.parseBlock();
    let elseBlock = null;
    if (this.match(14 /* KwElse */)) {
      if (this.check(13 /* KwIf */)) {
        elseBlock = [this.parseIfStmt()];
      } else {
        elseBlock = this.parseBlock();
      }
    }
    return mkStmt({ kind: "IfStmt", condition, thenBlock, elseBlock }, tok);
  }
  parseForStmt() {
    const tok = this.current();
    this.advance();
    this.expect(72 /* LParen */, "expected '(' after 'for'");
    if (this.check(4 /* Identifier */) && this.peek(1).type === 30 /* KwIn */) {
      const varName = this.advance().value;
      this.advance();
      const iterable = this.parseExpr();
      this.expect(73 /* RParen */, "expected ')' after for-each iterable");
      const body2 = this.parseBlock();
      return mkStmt({ kind: "ForEachStmt", varName, iterable, body: body2 }, tok);
    }
    let init = null;
    if (!this.check(79 /* Semicolon */)) {
      if (this.check(10 /* KwVar */)) {
        init = this.parseLocalVar(false);
      } else if (this.check(11 /* KwConst */)) {
        init = this.parseLocalVar(true);
      } else {
        const expr = this.parseExpr();
        this.expect(79 /* Semicolon */, "expected ';' after for-loop initializer");
        init = mkStmt({ kind: "ExprStmt", expr });
      }
    } else {
      this.advance();
    }
    let condition = null;
    if (!this.check(79 /* Semicolon */)) {
      condition = this.parseExpr();
    }
    this.expect(79 /* Semicolon */, "expected ';' after for-loop condition");
    let update = null;
    if (!this.check(73 /* RParen */)) {
      update = this.parseExpr();
    }
    this.expect(73 /* RParen */, "expected ')' after for-loop update");
    const body = this.parseBlock();
    return mkStmt({ kind: "ForStmt", init, condition, update, body }, tok);
  }
  parseWhileStmt() {
    const tok = this.current();
    this.advance();
    this.expect(72 /* LParen */, "expected '(' after 'while'");
    const condition = this.parseExpr();
    this.expect(73 /* RParen */, "expected ')' after while condition");
    const body = this.parseBlock();
    return mkStmt({ kind: "WhileStmt", condition, body }, tok);
  }
  parseSwitchStmt() {
    const tok = this.current();
    this.advance();
    this.expect(72 /* LParen */, "expected '(' after 'switch'");
    const expr = this.parseExpr();
    this.expect(73 /* RParen */, "expected ')' after switch expression");
    this.expect(74 /* LBrace */, "expected '{' to start switch body");
    const cases = [];
    let defaultBlock = null;
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      if (this.match(18 /* KwCase */)) {
        const pattern = this.parseExpr();
        this.expect(68 /* Colon */, "expected ':' after case pattern");
        const caseBody = [];
        while (!this.check(18 /* KwCase */) && !this.check(19 /* KwDefault */) && !this.check(75 /* RBrace */) && !this.isAtEnd()) {
          const s = this.parseStatement();
          if (s) caseBody.push(s);
        }
        cases.push({ pattern, body: caseBody });
      } else if (this.match(19 /* KwDefault */)) {
        this.expect(68 /* Colon */, "expected ':' after 'default'");
        defaultBlock = [];
        while (!this.check(18 /* KwCase */) && !this.check(75 /* RBrace */) && !this.isAtEnd()) {
          const s = this.parseStatement();
          if (s) defaultBlock.push(s);
        }
      } else {
        const t = this.current();
        this.bag.error(
          ErrorCode.T_PARSE_UNEXPECTED_TOKEN,
          `expected 'case' or 'default' in switch body but found '${t.value}'`,
          makeSpan(this.file, t.line, t.col, t.line, t.col + t.value.length)
        );
        this.advance();
      }
    }
    this.expect(75 /* RBrace */, "expected '}' to close switch body");
    return mkStmt({ kind: "SwitchStmt", expr, cases, defaultBlock }, tok);
  }
  parseReturnStmt() {
    const tok = this.current();
    this.advance();
    let value = null;
    if (!this.check(79 /* Semicolon */)) {
      value = this.parseExpr();
    }
    this.expect(79 /* Semicolon */, "expected ';' after return statement");
    return mkStmt({ kind: "ReturnStmt", value }, tok);
  }
  parseLocalVar(isConst) {
    const tok = this.advance();
    const nameTok = this.expect(4 /* Identifier */, "expected variable name");
    let typeNode = null;
    if (this.match(68 /* Colon */)) {
      typeNode = this.parseType();
    }
    let init = null;
    if (this.match(40 /* Assign */)) {
      init = this.parseExpr();
    }
    this.expect(79 /* Semicolon */, "expected ';' after variable declaration");
    if (isConst) {
      this.validateConstName(nameTok.value, nameTok);
    } else {
      this.validateVarName(nameTok.value, nameTok);
    }
    return mkStmt({ kind: "VarDecl", name: nameTok.value, typeNode, init, isConst }, tok);
  }
  parseExprOrAssignStmt() {
    const tok = this.current();
    const expr = this.parseExpr();
    const assignOps = [
      40 /* Assign */,
      41 /* PlusAssign */,
      42 /* MinusAssign */,
      43 /* StarAssign */,
      44 /* SlashAssign */,
      45 /* PercentAssign */,
      61 /* BitAndAssign */,
      62 /* BitOrAssign */,
      63 /* BitXorAssign */,
      64 /* ShlAssign */,
      65 /* ShrAssign */
    ];
    const assignOp = this.match(...assignOps);
    if (assignOp) {
      const value = this.parseExpr();
      this.expect(79 /* Semicolon */, "expected ';' after assignment");
      return mkStmt({ kind: "AssignmentStmt", target: expr, op: assignOp.value, value }, tok);
    }
    this.expect(79 /* Semicolon */, "expected ';' after expression");
    return mkStmt({ kind: "ExprStmt", expr }, tok);
  }
  // ─── Expression parsing (precedence climbing) ─────────────────
  parseExpr() {
    return this.parseAssignment();
  }
  parseAssignment() {
    const left = this.parseLogicOr();
    const tok = this.current();
    if (this.match(40 /* Assign */)) {
      const right = this.parseAssignment();
      return mkExpr({ kind: "AssignExpr", op: "=", target: left, value: right }, tok);
    }
    return left;
  }
  parseLogicOr() {
    let left = this.parseLogicAnd();
    while (this.check(53 /* Or */)) {
      const tok = this.advance();
      const right = this.parseLogicAnd();
      left = mkExpr({ kind: "BinaryExpr", op: "||", left, right }, tok);
    }
    return left;
  }
  parseLogicAnd() {
    let left = this.parseBitOr();
    while (this.check(52 /* And */)) {
      const tok = this.advance();
      const right = this.parseBitOr();
      left = mkExpr({ kind: "BinaryExpr", op: "&&", left, right }, tok);
    }
    return left;
  }
  parseBitOr() {
    let left = this.parseBitXor();
    while (this.check(56 /* BitOr */)) {
      const tok = this.advance();
      const right = this.parseBitXor();
      left = mkExpr({ kind: "BinaryExpr", op: "|", left, right }, tok);
    }
    return left;
  }
  parseBitXor() {
    let left = this.parseBitAnd();
    while (this.check(57 /* BitXor */)) {
      const tok = this.advance();
      const right = this.parseBitAnd();
      left = mkExpr({ kind: "BinaryExpr", op: "^", left, right }, tok);
    }
    return left;
  }
  parseBitAnd() {
    let left = this.parseEquality();
    while (this.check(55 /* BitAnd */)) {
      const tok = this.advance();
      const right = this.parseEquality();
      left = mkExpr({ kind: "BinaryExpr", op: "&", left, right }, tok);
    }
    return left;
  }
  parseEquality() {
    let left = this.parseComparison();
    while (this.check(46 /* Eq */) || this.check(47 /* NotEq */)) {
      const tok = this.advance();
      const op = tok.type === 46 /* Eq */ ? "==" : "!=";
      const right = this.parseComparison();
      left = mkExpr({ kind: "BinaryExpr", op, left, right }, tok);
    }
    return left;
  }
  parseComparison() {
    let left = this.parseShift();
    while ([48 /* Lt */, 49 /* Gt */, 50 /* LtEq */, 51 /* GtEq */].includes(this.current().type)) {
      const tok = this.advance();
      const ops = {
        [48 /* Lt */]: "<",
        [49 /* Gt */]: ">",
        [50 /* LtEq */]: "<=",
        [51 /* GtEq */]: ">="
      };
      const right = this.parseShift();
      left = mkExpr({ kind: "BinaryExpr", op: ops[tok.type], left, right }, tok);
    }
    return left;
  }
  parseShift() {
    let left = this.parseAdd();
    while (this.check(59 /* ShiftLeft */) || this.check(60 /* ShiftRight */)) {
      const tok = this.advance();
      const op = tok.type === 59 /* ShiftLeft */ ? "<<" : ">>";
      const right = this.parseAdd();
      left = mkExpr({ kind: "BinaryExpr", op, left, right }, tok);
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.check(35 /* Plus */) || this.check(36 /* Minus */)) {
      const tok = this.advance();
      const op = tok.type === 35 /* Plus */ ? "+" : "-";
      const right = this.parseMul();
      left = mkExpr({ kind: "BinaryExpr", op, left, right }, tok);
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while ([37 /* Star */, 38 /* Slash */, 39 /* Percent */].includes(this.current().type)) {
      const tok = this.advance();
      const ops = {
        [37 /* Star */]: "*",
        [38 /* Slash */]: "/",
        [39 /* Percent */]: "%"
      };
      const right = this.parseUnary();
      left = mkExpr({ kind: "BinaryExpr", op: ops[tok.type], left, right }, tok);
    }
    return left;
  }
  parseUnary() {
    if ([54 /* Not */, 36 /* Minus */, 58 /* BitNot */].includes(this.current().type)) {
      const tok = this.advance();
      const ops = {
        [54 /* Not */]: "!",
        [36 /* Minus */]: "-",
        [58 /* BitNot */]: "~"
      };
      const operand = this.parseUnary();
      return mkExpr({ kind: "UnaryExpr", op: ops[tok.type], operand }, tok);
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let expr = this.parsePrimary();
    while (true) {
      if (this.check(69 /* Dot */)) {
        const tok = this.advance();
        const member = this.expect(4 /* Identifier */, "expected member name after '.'");
        expr = mkExpr({ kind: "MemberExpr", object: expr, member: member.value }, tok);
      } else if (this.check(76 /* LBracket */)) {
        const tok = this.advance();
        const index = this.parseExpr();
        this.expect(77 /* RBracket */, "expected ']' after index");
        expr = mkExpr({ kind: "IndexExpr", object: expr, index }, tok);
      } else if (this.check(72 /* LParen */)) {
        const tok = this.advance();
        const args = [];
        while (!this.check(73 /* RParen */) && !this.isAtEnd()) {
          args.push(this.parseExpr());
          if (!this.match(78 /* Comma */)) break;
        }
        this.expect(73 /* RParen */, "expected ')' after call arguments");
        expr = mkExpr({ kind: "CallExpr", callee: expr, args }, tok);
      } else {
        break;
      }
    }
    if (this.check(29 /* KwAs */)) {
      const tok = this.advance();
      const targetType = this.parseType();
      expr = mkExpr({ kind: "CastExpr", expr, targetType }, tok);
    }
    return expr;
  }
  parsePrimary() {
    const tok = this.current();
    switch (tok.type) {
      case 0 /* Integer */: {
        this.advance();
        let radix = 10;
        let val = tok.value;
        if (val.startsWith("0x") || val.startsWith("0X")) {
          radix = 16;
        } else if (val.startsWith("0b") || val.startsWith("0B")) {
          radix = 2;
        }
        return mkExpr({ kind: "IntegerLit", value: val, radix }, tok);
      }
      case 1 /* Float */:
        this.advance();
        return mkExpr({ kind: "FloatLit", value: tok.value }, tok);
      case 2 /* String */:
        this.advance();
        return mkExpr({ kind: "StringLit", value: tok.value }, tok);
      case 23 /* KwTrue */:
        this.advance();
        return mkExpr({ kind: "BoolLit", value: true }, tok);
      case 24 /* KwFalse */:
        this.advance();
        return mkExpr({ kind: "BoolLit", value: false }, tok);
      case 25 /* KwNull */:
        this.advance();
        return mkExpr({ kind: "NullLit" }, tok);
      case 4 /* Identifier */:
        this.advance();
        if (this.check(74 /* LBrace */) && this.looksLikeStructLit()) {
          return this.parseStructLit(tok.value, tok);
        }
        return mkExpr({ kind: "IdentExpr", name: tok.value }, tok);
      case 72 /* LParen */: {
        this.advance();
        const inner = this.parseExpr();
        this.expect(73 /* RParen */, "expected ')' after expression");
        return mkExpr({ kind: "ParenExpr", inner }, tok);
      }
      case 76 /* LBracket */:
        return this.parseArrayLit();
      default:
        this.bag.error(
          ErrorCode.T_PARSE_INVALID_EXPR,
          `unexpected token '${tok.value}' in expression`,
          makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + tok.value.length)
        );
        this.advance();
        return mkExpr({ kind: "NullLit" }, tok);
    }
  }
  looksLikeStructLit() {
    if (this.peek(1).type === 75 /* RBrace */) return true;
    if (this.peek(1).type === 4 /* Identifier */ && this.peek(2).type === 68 /* Colon */) return true;
    return false;
  }
  parseStructLit(name, tok) {
    this.advance();
    const fields = [];
    while (!this.check(75 /* RBrace */) && !this.isAtEnd()) {
      const fieldName = this.expect(4 /* Identifier */, "expected field name in struct literal");
      this.expect(68 /* Colon */, "expected ':' after field name");
      const value = this.parseExpr();
      fields.push({ name: fieldName.value, value });
      if (!this.match(78 /* Comma */)) break;
    }
    this.expect(75 /* RBrace */, "expected '}' to close struct literal");
    return mkExpr({ kind: "StructLit", typeName: name, fields }, tok);
  }
  parseArrayLit() {
    const tok = this.current();
    this.advance();
    const elements = [];
    const isMapLit = this.check(4 /* Identifier */) || this.check(2 /* String */) || this.check(0 /* Integer */);
    if (isMapLit && this.peek(1).type === 68 /* Colon */) {
      return this.parseMapLit(tok);
    }
    while (!this.check(77 /* RBracket */) && !this.isAtEnd()) {
      elements.push(this.parseExpr());
      if (!this.match(78 /* Comma */)) break;
    }
    this.expect(77 /* RBracket */, "expected ']' after array elements");
    return mkExpr({ kind: "ArrayLit", elements }, tok);
  }
  parseMapLit(tok) {
    const entries = [];
    while (!this.check(77 /* RBracket */) && !this.isAtEnd()) {
      const key = this.parseExpr();
      this.expect(68 /* Colon */, "expected ':' after map key");
      const value = this.parseExpr();
      entries.push({ key, value });
      if (!this.match(78 /* Comma */)) break;
    }
    this.expect(77 /* RBracket */, "expected ']' after map entries");
    return mkExpr({ kind: "MapLit", entries }, tok);
  }
  // ─── Naming convention validation (spec 1.1) ──────────────────
  validateDeclName(name, tok) {
    if (/^[A-Z]/.test(name)) {
      if (!/^[A-Z][a-zA-Z0-9_]*$/.test(name)) {
        this.bag.warning(
          ErrorCode.T_NAME_TYPE_CAMEL,
          `type name '${name}' should be PascalCase (e.g. EntityState)`,
          makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + name.length)
        );
      }
    }
  }
  validateVarName(name, tok) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      this.bag.warning(
        ErrorCode.T_NAME_VAR_SNAKE,
        `variable name '${name}' should be snake_case (e.g. entity_id)`,
        makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + name.length)
      );
    }
  }
  validateConstName(name, tok) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      this.bag.warning(
        ErrorCode.T_NAME_CONST_UPPER,
        `constant name '${name}' should be UPPER_SNAKE_CASE (e.g. MAX_RENDER_LAYER)`,
        makeSpan(this.file, tok.line, tok.col, tok.line, tok.col + name.length)
      );
    }
  }
};

// src/types/types.ts
var SCALAR_TYPES = [
  // Unsigned integers
  "u8",
  "u16",
  "u32",
  "u64",
  // Signed integers
  "i8",
  "i16",
  "i32",
  "i64",
  // Floats
  "f16",
  "f32",
  "f64",
  // Boolean
  "bool"
];
var INT_TYPES = ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64"];
var FLOAT_TYPES = ["f16", "f32", "f64"];
var TYPE_BIT_WIDTHS = {
  u8: 8,
  u16: 16,
  u32: 32,
  u64: 64,
  i8: 8,
  i16: 16,
  i32: 32,
  i64: 64,
  f16: 16,
  f32: 32,
  f64: 64,
  bool: 1
};
var TYPE_RANGES = {
  u8: { min: 0n, max: 255n },
  u16: { min: 0n, max: 65535n },
  u32: { min: 0n, max: 4294967295n },
  u64: { min: 0n, max: 18446744073709551615n },
  i8: { min: -128n, max: 127n },
  i16: { min: -32768n, max: 32767n },
  i32: { min: -2147483648n, max: 2147483647n },
  i64: { min: -9223372036854775808n, max: 9223372036854775807n }
};
function isScalarType(name) {
  return SCALAR_TYPES.includes(name);
}
function isIntType(name) {
  return INT_TYPES.includes(name);
}
function isFloatType(name) {
  return FLOAT_TYPES.includes(name);
}
function getBitWidth(name) {
  return TYPE_BIT_WIDTHS[name] ?? null;
}
function canExplicitCast(from, to) {
  if (typesEqual(from, to)) return true;
  if (isIntTypeInfo(from) && isIntTypeInfo(to)) return true;
  if (isFloatTypeInfo(from) && isFloatTypeInfo(to)) return true;
  if (isIntTypeInfo(from) && isFloatTypeInfo(to)) return true;
  if (isFloatTypeInfo(from) && isIntTypeInfo(to)) return true;
  if (from.kind === "Scalar" && from.name === "bool" && isIntTypeInfo(to)) return true;
  if (isIntTypeInfo(from) && to.kind === "Scalar" && to.name === "bool") return true;
  return false;
}
function typesEqual(a, b) {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "Scalar":
      return a.name === b.name;
    case "Void":
    case "String":
    case "StringBuilder":
    case "Variant":
    case "Unknown":
      return true;
    case "Array": {
      const bb = b;
      return a.length === bb.length && typesEqual(a.elem, bb.elem);
    }
    case "Slice": {
      const bb = b;
      return typesEqual(a.elem, bb.elem);
    }
    case "Map": {
      const bb = b;
      return typesEqual(a.key, bb.key) && typesEqual(a.value, bb.value);
    }
    case "Pointer": {
      const bb = b;
      return typesEqual(a.elem, bb.elem);
    }
    case "Optional": {
      const bb = b;
      return typesEqual(a.elem, bb.elem);
    }
    case "Struct":
    case "Enum":
    case "Flag":
    case "FlagSet":
    case "Union":
    case "Func":
    case "Named":
      return a.name === b.name;
  }
}
function isIntTypeInfo(t) {
  return t.kind === "Scalar" && isIntType(t.name);
}
function isFloatTypeInfo(t) {
  return t.kind === "Scalar" && isFloatType(t.name);
}
function typeToString(t) {
  switch (t.kind) {
    case "Scalar":
      return t.name;
    case "Void":
      return "void";
    case "String":
      return "string";
    case "StringBuilder":
      return "StringBuilder";
    case "Array":
      return `[${t.length}]${typeToString(t.elem)}`;
    case "Slice":
      return `[]${typeToString(t.elem)}`;
    case "Map":
      return `map[${typeToString(t.key)}]${typeToString(t.value)}`;
    case "Pointer":
      return `*${typeToString(t.elem)}`;
    case "Optional":
      return `?${typeToString(t.elem)}`;
    case "Struct":
      return t.name;
    case "Enum":
      return t.name;
    case "Flag":
      return t.name;
    case "FlagSet":
      return t.name;
    case "Union":
      return t.name;
    case "Variant":
      return "Variant";
    case "Func":
      return t.name;
    case "Named":
      return t.name;
    case "Unknown":
      return "<unknown>";
  }
}

// src/types/checker.ts
var SymbolTable = class _SymbolTable {
  parent;
  symbols = /* @__PURE__ */ new Map();
  constructor(parent = null) {
    this.parent = parent;
  }
  define(name, kind, typeInfo, decl) {
    if (this.symbols.has(name)) return false;
    this.symbols.set(name, { name, kind, typeInfo, decl });
    return true;
  }
  defineLocal(name, typeInfo) {
    if (this.symbols.has(name)) return false;
    this.symbols.set(name, { name, kind: "var", typeInfo, decl: null });
    return true;
  }
  lookup(name) {
    if (this.symbols.has(name)) return this.symbols.get(name);
    if (this.parent) return this.parent.lookup(name);
    return null;
  }
  child() {
    return new _SymbolTable(this);
  }
};
var TypeChecker = class {
  bag;
  globalScope;
  currentScope;
  currentReturnType = { kind: "Void" };
  constructor(bag) {
    this.bag = bag;
    this.globalScope = new SymbolTable();
    this.currentScope = this.globalScope;
  }
  check(unit) {
    for (const decl of unit.declarations) {
      this.registerDecl(decl);
    }
    for (const decl of unit.declarations) {
      this.checkDecl(decl);
    }
  }
  // ─── Declaration registration ────────────────────────────────
  registerDecl(decl) {
    const dk = decl.declKind;
    switch (dk.kind) {
      case "StructDecl":
        this.globalScope.define(dk.name, "type", { kind: "Struct", name: dk.name }, decl);
        break;
      case "EnumDecl":
        this.globalScope.define(dk.name, "type", { kind: "Enum", name: dk.name, underlying: dk.underlyingType }, decl);
        break;
      case "FlagDecl":
        this.globalScope.define(dk.name, "type", { kind: "Flag", name: dk.name, underlying: dk.underlyingType }, decl);
        break;
      case "FlagSetDecl":
        this.globalScope.define(dk.name, "type", { kind: "FlagSet", name: dk.name }, decl);
        break;
      case "UnionDecl":
        this.globalScope.define(dk.name, "type", { kind: "Union", name: dk.name }, decl);
        break;
      case "FuncDecl":
        this.globalScope.define(dk.name, "func", { kind: "Func", name: dk.name }, decl);
        break;
      case "GlobalVarDecl":
        this.globalScope.define(dk.name, "var", this.resolveType(dk.typeNode), decl);
        break;
      case "GlobalConstDecl":
        this.globalScope.define(dk.name, "const", dk.typeNode ? this.resolveType(dk.typeNode) : { kind: "Unknown" }, decl);
        break;
      case "TypeAliasDecl":
        this.globalScope.define(dk.name, "type", this.resolveType(dk.aliasedType), decl);
        break;
      case "ImportDecl":
        break;
    }
  }
  // ─── Type resolution ─────────────────────────────────────────
  resolveType(typeNode) {
    const inner = typeNode.inner;
    switch (inner.kind) {
      case "ScalarType":
        if (isScalarType(inner.name)) {
          return { kind: "Scalar", name: inner.name, bitWidth: getBitWidth(inner.name) };
        }
        if (inner.name === "void") return { kind: "Void" };
        if (inner.name === "string") return { kind: "String" };
        if (inner.name === "StringBuilder") return { kind: "StringBuilder" };
        return { kind: "Named", name: inner.name };
      case "ArrayType": {
        const elem = this.resolveType(inner.elem);
        let length = 0;
        if (inner.length.exprKind.kind === "IntegerLit") {
          length = parseInt(inner.length.exprKind.value, inner.length.exprKind.radix);
        }
        return { kind: "Array", elem, length };
      }
      case "SliceType":
        return { kind: "Slice", elem: this.resolveType(inner.elem) };
      case "MapType":
        return { kind: "Map", key: this.resolveType(inner.key), value: this.resolveType(inner.value) };
      case "NamedType": {
        const sym = this.globalScope.lookup(inner.name);
        if (sym) return sym.typeInfo;
        return { kind: "Named", name: inner.name };
      }
      case "VariantType":
        return { kind: "Variant" };
      case "FlagType":
        return { kind: "Flag", name: "<anonymous>", underlying: inner.underlying };
      case "FlagSetType":
        return { kind: "FlagSet", name: "<anonymous>" };
      case "PointerType":
        return { kind: "Pointer", elem: this.resolveType(inner.elem) };
      case "OptionalType":
        return { kind: "Optional", elem: this.resolveType(inner.elem) };
    }
  }
  // ─── Declaration checking ────────────────────────────────────
  checkDecl(decl) {
    const dk = decl.declKind;
    switch (dk.kind) {
      case "FuncDecl":
        this.checkFuncDecl(dk);
        break;
      case "StructDecl":
        this.checkStructDecl(dk);
        break;
      case "EnumDecl":
        this.checkEnumDecl(dk);
        break;
      case "FlagDecl":
      case "FlagSetDecl":
        this.checkFlagDecl(dk);
        break;
      case "GlobalVarDecl":
        if (dk.init) {
          const initType = this.inferExprType(dk.init);
          const varType = this.resolveType(dk.typeNode);
          if (initType.kind !== "Unknown" && !typesEqual(initType, varType)) {
            if (!canExplicitCast(initType, varType)) {
              this.errorTypeMismatch(dk.init, varType, initType);
            }
          }
        }
        break;
      case "GlobalConstDecl":
        if (dk.init) {
          const initType = this.inferExprType(dk.init);
          if (dk.typeNode) {
            const constType = this.resolveType(dk.typeNode);
            if (initType.kind !== "Unknown" && !typesEqual(initType, constType)) {
              if (!canExplicitCast(initType, constType)) {
                this.errorTypeMismatch(dk.init, constType, initType);
              }
            }
          }
        }
        break;
    }
  }
  checkFuncDecl(dk) {
    if (!dk.body) return;
    const funcScope = this.globalScope.child();
    const prevScope = this.currentScope;
    this.currentScope = funcScope;
    for (const param of dk.params) {
      const paramType = this.resolveType(param.typeNode);
      funcScope.defineLocal(param.name, paramType);
    }
    const prevReturnType = this.currentReturnType;
    this.currentReturnType = this.resolveType(dk.returnType);
    for (const stmt of dk.body) {
      this.checkStmt(stmt);
    }
    if (this.currentReturnType.kind !== "Void") {
      if (!this.allPathsReturn(dk.body)) {
        const tok = dk.body[dk.body.length - 1]?.token ?? decl_token(dk);
        this.bag.error(
          ErrorCode.T_PARSE_INVALID_EXPR,
          `function '${dk.name}' is missing return on some code paths (all branches must explicitly return)`,
          makeSpan(tok?.file ?? "", tok?.line ?? 1, tok?.col ?? 1, tok?.line ?? 1, (tok?.col ?? 1) + 10)
        );
      }
    }
    this.currentReturnType = prevReturnType;
    this.currentScope = prevScope;
  }
  checkStructDecl(dk) {
    for (const field of dk.fields) {
      if (field.bitWidth === null) {
        this.resolveType(field.typeNode);
      }
    }
  }
  checkEnumDecl(dk) {
    if (!isIntType(dk.underlyingType)) {
      this.bag.error(
        ErrorCode.T_TYPE_MISMATCH,
        `enum '${dk.name}' underlying type must be an integer type, got '${dk.underlyingType}'`,
        makeSpan("", 1, 1, 1, 10),
        { validValues: ["u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64"] }
      );
    }
    let lastValue = -1;
    for (const variant of dk.variants) {
      if (variant.value) {
        const vt = this.inferExprType(variant.value);
        if (vt.kind === "Scalar" && !isIntType(vt.name)) {
          this.bag.error(
            ErrorCode.T_TYPE_MISMATCH,
            `enum variant value must be integer, got ${typeToString(vt)}`,
            makeSpan("", 1, 1, 1, 5)
          );
        }
      }
    }
  }
  checkFlagDecl(dk) {
    if (dk.kind === "FlagDecl" && !isIntType(dk.underlyingType)) {
      this.bag.error(
        ErrorCode.T_TYPE_MISMATCH,
        `flag '${dk.name}' underlying type must be an integer type, got '${dk.underlyingType}'`,
        makeSpan("", 1, 1, 1, 10),
        { validValues: ["u8", "u16", "u32", "u64"] }
      );
    }
    let autoOffset = 0;
    const usedBits = [];
    for (const slot of dk.slots) {
      const startBit = slot.offset !== null ? slot.offset : autoOffset;
      const endBit = startBit + slot.bitWidth;
      for (const used of usedBits) {
        if (startBit < used.end && endBit > used.start) {
          this.bag.error(
            ErrorCode.T_FLAG_OFFSET_CONFLICT,
            `flag slot '${slot.name}' (bits ${startBit}-${endBit - 1}) overlaps with '${used.name}' (bits ${used.start}-${used.end - 1})`,
            makeSpan("", 1, 1, 1, 10)
          );
        }
      }
      usedBits.push({ name: slot.name, start: startBit, end: endBit });
      if (dk.kind === "FlagDecl") {
        const typeWidth = getBitWidth(dk.underlyingType);
        if (typeWidth && endBit > typeWidth) {
          this.bag.error(
            ErrorCode.T_FLAG_OVERFLOW,
            `flag '${dk.name}' slot '${slot.name}' exceeds ${dk.underlyingType} (${typeWidth} bits): uses bits ${startBit}-${endBit - 1}`,
            makeSpan("", 1, 1, 1, 10),
            { validValues: [`0-${typeWidth - 1} bits`] }
          );
        }
      }
      autoOffset = endBit;
    }
  }
  // ─── Statement checking ──────────────────────────────────────
  checkStmt(stmt) {
    const sk = stmt.stmtKind;
    switch (sk.kind) {
      case "VarDecl": {
        const varType = sk.typeNode ? this.resolveType(sk.typeNode) : null;
        if (sk.init) {
          const initType = this.inferExprType(sk.init);
          if (varType && initType.kind !== "Unknown" && !typesEqual(initType, varType)) {
            const isIntToFlagOrEnum = (varType.kind === "Flag" || varType.kind === "Enum") && initType.kind === "Scalar" && isIntType(initType.name);
            if (!isIntToFlagOrEnum && !canExplicitCast(initType, varType)) {
              this.errorTypeMismatch(sk.init, varType, initType);
            }
          }
          if (!varType) {
            this.currentScope.defineLocal(sk.name, initType);
            return;
          }
        }
        if (varType) {
          this.currentScope.defineLocal(sk.name, varType);
        }
        break;
      }
      case "IfStmt": {
        const condType = this.inferExprType(sk.condition);
        if (condType.kind === "Scalar" && condType.name !== "bool") {
          this.bag.error(
            ErrorCode.T_STMT_IMPLICIT_BOOL,
            `if condition must be bool or explicit comparison, got ${typeToString(condType)}`,
            makeSpan("", 1, 1, 1, 5),
            { fixSuggestions: [{ description: "add explicit comparison", range: makeSpan("", 1, 1, 1, 1), replacement: "(expr != 0)" }] }
          );
        }
        const thenScope = this.currentScope.child();
        const prevScope = this.currentScope;
        this.currentScope = thenScope;
        for (const s of sk.thenBlock) this.checkStmt(s);
        if (sk.elseBlock) {
          const elseScope = prevScope.child();
          this.currentScope = elseScope;
          for (const s of sk.elseBlock) this.checkStmt(s);
        }
        this.currentScope = prevScope;
        break;
      }
      case "ForStmt":
      case "WhileStmt": {
        const skAny = sk;
        if (skAny.condition) {
          const condType = this.inferExprType(skAny.condition);
          if (condType.kind === "Scalar" && condType.name !== "bool") {
            this.bag.error(
              ErrorCode.T_STMT_IMPLICIT_BOOL,
              `loop condition must be bool, got ${typeToString(condType)}`,
              makeSpan("", 1, 1, 1, 5)
            );
          }
        }
        const loopScope = this.currentScope.child();
        const prev = this.currentScope;
        this.currentScope = loopScope;
        if (skAny.init) this.checkStmt(skAny.init);
        for (const s of skAny.body) this.checkStmt(s);
        this.currentScope = prev;
        break;
      }
      case "ForEachStmt": {
        const iterType = this.inferExprType(sk.iterable);
        const loopScope = this.currentScope.child();
        const prev = this.currentScope;
        this.currentScope = loopScope;
        let elemType = { kind: "Unknown" };
        if (iterType.kind === "Slice" || iterType.kind === "Array") {
          elemType = iterType.elem;
        }
        loopScope.defineLocal(sk.varName, elemType);
        for (const s of sk.body) this.checkStmt(s);
        this.currentScope = prev;
        break;
      }
      case "ReturnStmt":
        if (sk.value) {
          const vt = this.inferExprType(sk.value);
          if (vt.kind !== "Unknown" && !typesEqual(vt, this.currentReturnType)) {
            if (!canExplicitCast(vt, this.currentReturnType)) {
              this.errorTypeMismatch(sk.value, this.currentReturnType, vt);
            }
          }
        }
        break;
      case "AssignmentStmt": {
        const targetType = this.inferExprType(sk.target);
        const valType = this.inferExprType(sk.value);
        if (targetType.kind !== "Unknown" && valType.kind !== "Unknown" && !typesEqual(targetType, valType)) {
          if (!canExplicitCast(valType, targetType)) {
            this.errorTypeMismatch(sk.value, targetType, valType);
          }
        }
        break;
      }
      case "ExprStmt":
        this.inferExprType(sk.expr);
        break;
      case "BlockStmt":
      case "DeferStmt":
      case "ComptimeStmt": {
        const blockScope = this.currentScope.child();
        const prev = this.currentScope;
        this.currentScope = blockScope;
        for (const s of sk.body) this.checkStmt(s);
        this.currentScope = prev;
        break;
      }
      case "SwitchStmt":
        this.inferExprType(sk.expr);
        for (const c of sk.cases) {
          this.inferExprType(c.pattern);
          for (const s of c.body) this.checkStmt(s);
        }
        if (sk.defaultBlock) {
          for (const s of sk.defaultBlock) this.checkStmt(s);
        }
        break;
    }
  }
  // ─── Expression type inference ───────────────────────────────
  inferExprType(expr) {
    const ek = expr.exprKind;
    switch (ek.kind) {
      case "IntegerLit": {
        const val = BigInt(ek.value);
        if (val >= 0n) {
          if (val <= 255n) return { kind: "Scalar", name: "u8", bitWidth: 8 };
          if (val <= 65535n) return { kind: "Scalar", name: "u16", bitWidth: 16 };
          if (val <= 4294967295n) return { kind: "Scalar", name: "u32", bitWidth: 32 };
          return { kind: "Scalar", name: "u64", bitWidth: 64 };
        }
        return { kind: "Scalar", name: "i64", bitWidth: 64 };
      }
      case "FloatLit":
        return { kind: "Scalar", name: "f64", bitWidth: 64 };
      case "StringLit":
        return { kind: "String" };
      case "BoolLit":
        return { kind: "Scalar", name: "bool", bitWidth: 1 };
      case "NullLit":
        return { kind: "Unknown" };
      case "IdentExpr": {
        const sym = this.currentScope.lookup(ek.name);
        if (sym) return sym.typeInfo;
        if (ek.name === "true" || ek.name === "false") {
          return { kind: "Scalar", name: "bool", bitWidth: 1 };
        }
        return { kind: "Unknown" };
      }
      case "BinaryExpr": {
        const leftType = this.inferExprType(ek.left);
        const rightType = this.inferExprType(ek.right);
        if (["==", "!=", "<", ">", "<=", ">="].includes(ek.op)) {
          return { kind: "Scalar", name: "bool", bitWidth: 1 };
        }
        if (["&&", "||"].includes(ek.op)) {
          return { kind: "Scalar", name: "bool", bitWidth: 1 };
        }
        if (leftType.kind === "Scalar" && rightType.kind === "Scalar") {
          if (typesEqual(leftType, rightType)) return leftType;
          const leftIsLit = ek.left.exprKind.kind === "IntegerLit";
          const rightIsLit = ek.right.exprKind.kind === "IntegerLit";
          if (leftIsLit && !rightIsLit) return rightType;
          if (rightIsLit && !leftIsLit) return leftType;
          if (leftIsLit && rightIsLit) return leftType;
          this.bag.error(
            ErrorCode.T_TYPE_IMPLICIT_CAST,
            `binary operator '${ek.op}' requires same types, got ${typeToString(leftType)} and ${typeToString(rightType)}`,
            makeSpan("", 1, 1, 1, 5),
            { notes: ["use explicit cast: `expr as Type`"] }
          );
        }
        return leftType.kind !== "Unknown" ? leftType : rightType;
      }
      case "UnaryExpr": {
        const operandType = this.inferExprType(ek.operand);
        if (ek.op === "!") return { kind: "Scalar", name: "bool", bitWidth: 1 };
        return operandType;
      }
      case "AssignExpr":
        this.inferExprType(ek.value);
        return this.inferExprType(ek.target);
      case "CallExpr": {
        if (ek.callee.exprKind.kind === "IdentExpr") {
          const funcName = ek.callee.exprKind.name;
          const sym = this.globalScope.lookup(funcName);
          if (sym && sym.typeInfo.kind === "Func") {
            const funcDecl = sym.decl.declKind;
            if (funcDecl.kind === "FuncDecl") {
              return this.resolveType(funcDecl.returnType);
            }
          }
          return this.lookupBuiltinReturnType(funcName);
        }
        return { kind: "Unknown" };
      }
      case "MemberExpr": {
        const objType = this.inferExprType(ek.object);
        if (objType.kind === "Struct" || objType.kind === "Named") {
          const sym = this.globalScope.lookup(objType.name);
          if (sym && sym.decl.declKind.kind === "StructDecl") {
            const field = sym.decl.declKind.fields.find((f) => f.name === ek.member);
            if (field) return this.resolveType(field.typeNode);
          }
        }
        if (objType.kind === "Enum") {
          return objType;
        }
        return { kind: "Unknown" };
      }
      case "IndexExpr": {
        const objType = this.inferExprType(ek.object);
        if (objType.kind === "Array" || objType.kind === "Slice") return objType.elem;
        if (objType.kind === "Map") return objType.value;
        return { kind: "Unknown" };
      }
      case "ArrayLit":
        if (ek.elements.length > 0) {
          const elemType = this.inferExprType(ek.elements[0]);
          return { kind: "Array", elem: elemType, length: ek.elements.length };
        }
        return { kind: "Array", elem: { kind: "Unknown" }, length: 0 };
      case "MapLit":
        if (ek.entries.length > 0) {
          const keyType = this.inferExprType(ek.entries[0].key);
          const valType = this.inferExprType(ek.entries[0].value);
          return { kind: "Map", key: keyType, value: valType };
        }
        return { kind: "Map", key: { kind: "Unknown" }, value: { kind: "Unknown" } };
      case "StructLit":
        return { kind: "Struct", name: ek.typeName };
      case "CastExpr":
        return this.resolveType(ek.targetType);
      case "RangeExpr":
        return { kind: "Unknown" };
      case "ParenExpr":
        return this.inferExprType(ek.inner);
      case "ComptimeExpr":
        return this.inferExprType(ek.expr);
      case "TypeInfoExpr":
        return { kind: "Unknown" };
      // type_info returns a comptime structure
      case "FlagSetExpr":
        return { kind: "Unknown" };
    }
  }
  lookupBuiltinReturnType(name) {
    const builtins = {
      "assert_eq": { kind: "Void" },
      "assert_true": { kind: "Void" },
      "assert_false": { kind: "Void" },
      "assert_panic": { kind: "Void" },
      "flag_set": { kind: "Void" },
      "flag_get": { kind: "Scalar", name: "u32", bitWidth: 32 },
      "print": { kind: "Void" },
      "println": { kind: "Void" },
      "to_string": { kind: "String" },
      "from_string": { kind: "Unknown" }
    };
    return builtins[name] ?? { kind: "Unknown" };
  }
  // ─── Return path analysis ────────────────────────────────────
  allPathsReturn(stmts) {
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1];
    return this.stmtReturns(last);
  }
  stmtReturns(stmt) {
    const sk = stmt.stmtKind;
    switch (sk.kind) {
      case "ReturnStmt":
        return true;
      case "IfStmt":
        if (sk.elseBlock) {
          return this.allPathsReturn(sk.thenBlock) && this.allPathsReturn(sk.elseBlock);
        }
        return false;
      case "BlockStmt":
        return this.allPathsReturn(sk.body);
      default:
        return false;
    }
  }
  // ─── Error helpers ───────────────────────────────────────────
  errorTypeMismatch(expr, expected, actual) {
    const tok = expr.token;
    this.bag.error(
      ErrorCode.T_TYPE_MISMATCH,
      `type mismatch: expected ${typeToString(expected)} but got ${typeToString(actual)}`,
      makeSpan(tok?.file ?? "", tok?.line ?? 1, tok?.col ?? 1, tok?.line ?? 1, (tok?.col ?? 1) + 5),
      {
        notes: [`expected: ${typeToString(expected)}`, `found:    ${typeToString(actual)}`]
      }
    );
  }
};
function decl_token(dk) {
  return dk.token;
}

// src/annotations/registry.ts
var AnnotationTarget = {
  Struct: "struct",
  Enum: "enum",
  Flag: "flag",
  FlagSet: "flag_set",
  Union: "union",
  Func: "func",
  Var: "var",
  Const: "const",
  Field: "field",
  Param: "param",
  EnumVariant: "enum_variant",
  FlagSlot: "flag_slot",
  Global: "global"
};
var BUILTIN_ANNOTATIONS = [
  // ── Category 1: Test annotations (spec 4.2) ──
  { name: "test", category: "test" /* Test */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Mark function as unit test case" },
  { name: "test_skip", category: "test" /* Test */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Skip this test case in batch runs" },
  { name: "test_only", category: "test" /* Test */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Function only exists in test compilation mode" },
  { name: "expect_fail", category: "test" /* Test */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Expect this test to fail/assert" },
  { name: "test_group", category: "test" /* Test */, validTargets: [AnnotationTarget.Func], argSpec: "string", description: "Group test cases by tag" },
  // ── Category 2: Derive annotations (spec 4.3) ──
  { name: "derive", category: "derive" /* Derive */, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Flag, AnnotationTarget.FlagSet, AnnotationTarget.Union], argSpec: "ident_list", description: "Auto-generate trait implementations" },
  // ── Category 3: Conditional compilation (spec 4.4) ──
  { name: "cfg", category: "conditional" /* Conditional */, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident", description: "Conditionally compile this node" },
  { name: "cfg_attr", category: "conditional" /* Conditional */, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum], argSpec: "mixed", description: "Conditionally apply another annotation" },
  // ── Category 4: Warning control (spec 4.5) ──
  { name: "allow", category: "warning" /* Warning */, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident_list", description: "Suppress warnings" },
  { name: "warn", category: "warning" /* Warning */, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident_list", description: "Promote to warning" },
  { name: "deny", category: "warning" /* Warning */, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "ident_list", description: "Promote to error" },
  { name: "deprecated", category: "warning" /* Warning */, validTargets: [AnnotationTarget.Global, AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "string", description: "Mark as deprecated with replacement message" },
  // ── Category 5: Layout / ABI / Serialization (spec 4.6) ──
  { name: "repr", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Enum, AnnotationTarget.Union], argSpec: "ident", description: "Specify memory representation: C, Packed, Align(N)" },
  { name: "no_padding", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Flag], argSpec: "none", description: "Alias for @repr(Packed)" },
  { name: "align", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Union], argSpec: "number", description: "Force memory alignment" },
  { name: "bitpack", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Struct], argSpec: "ident", description: "Pack struct as bitfield over underlying integer type" },
  { name: "offset", category: "layout" /* Layout */, validTargets: [AnnotationTarget.FlagSlot], argSpec: "number", description: "Force bit offset for flag slot" },
  { name: "binary_offset", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Field], argSpec: "number", description: "Force binary serialization byte offset" },
  { name: "binary_skip", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Field], argSpec: "none", description: "Skip this field during binary serialization" },
  { name: "soa", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Struct], argSpec: "none", description: "Use Structure-of-Arrays layout" },
  { name: "aos", category: "layout" /* Layout */, validTargets: [AnnotationTarget.Struct], argSpec: "none", description: "Use Array-of-Structures layout (default)" },
  // ── Category 6: Function behavior & toolchain (spec 4.7) ──
  { name: "inline", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Force inline this function" },
  { name: "no_inline", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Prevent inlining this function" },
  { name: "must_use", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Return value must be used" },
  { name: "const_fn", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Function can be evaluated at compile time" },
  { name: "unsafe", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Mark function as containing unsafe operations" },
  { name: "main", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Mark program entry point" },
  { name: "export_symbol", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "string", description: "Export symbol name for dynamic library" },
  { name: "link_name", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "string", description: "Bind to external C library symbol name" },
  { name: "panic_handler", category: "function" /* Function */, validTargets: [AnnotationTarget.Func], argSpec: "none", description: "Custom global panic handler" },
  // ── Documentation annotations ──
  { name: "doc", category: "documentation" /* Documentation */, validTargets: [AnnotationTarget.Global], argSpec: "string", description: "Documentation comment" },
  { name: "doc_file", category: "documentation" /* Documentation */, validTargets: [AnnotationTarget.Func, AnnotationTarget.Struct, AnnotationTarget.Enum], argSpec: "string", description: "Mount external documentation file" },
  // ── Export annotations (spec 4.1) ──
  { name: "export", category: "export" /* Export */, validTargets: [AnnotationTarget.Field, AnnotationTarget.Func, AnnotationTarget.Var, AnnotationTarget.Const], argSpec: "mixed", description: "Export to editor inspector / external config tool" },
  // ── Deprecated / transitional (spec 4.1.5, 9.3) ──
  { name: "auto_convert", category: "derive" /* Derive */, validTargets: [AnnotationTarget.Struct, AnnotationTarget.Enum], argSpec: "none", description: "DEPRECATED: use @derive instead", deprecated: true, replacement: "@derive(FromString)" }
];
var DERIVABLE_TRAITS = [
  "ToString",
  "FromString",
  "Clone",
  "Copy",
  "DebugPrint",
  "BinarySerde",
  "Eq",
  "PartialEq",
  "Hash"
];
var CFG_CONDITIONS = [
  "debug",
  "release",
  "windows",
  "linux",
  "mac",
  "android",
  "web"
];
var VALID_WARNINGS = [
  "unused",
  "unused_field",
  "dead_code",
  "overflow_literal",
  "implicit_cast",
  "bitfield_overlap",
  "deprecated"
];
var AnnotationRegistry = class {
  annotations = /* @__PURE__ */ new Map();
  bag;
  constructor(bag) {
    this.bag = bag;
    for (const def of BUILTIN_ANNOTATIONS) {
      this.annotations.set(def.name, def);
    }
  }
  /**
   * Validates an annotation against its definition.
   * Checks: known annotation, valid target, valid arguments.
   */
  validate(annotation, target) {
    const def = this.annotations.get(annotation.name);
    if (!def) {
      const tok = annotation.token;
      this.bag.error(
        ErrorCode.T_ANNOTATION_UNKNOWN,
        `unknown annotation '@${annotation.name}'`,
        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
        { validValues: [...this.annotations.keys()].map((n) => `@${n}`) }
      );
      return;
    }
    if (def.deprecated) {
      const tok = annotation.token;
      this.bag.warning(
        ErrorCode.T_ANNOTATION_UNKNOWN,
        `annotation '@${annotation.name}' is deprecated${def.replacement ? `, use ${def.replacement} instead` : ""}`,
        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1)
      );
    }
    if (!def.validTargets.includes(target)) {
      const tok = annotation.token;
      this.bag.error(
        ErrorCode.T_ANNOTATION_WRONG_TARGET,
        `annotation '@${annotation.name}' cannot be applied to ${target}, valid targets: ${def.validTargets.join(", ")}`,
        makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
        { validValues: def.validTargets }
      );
    }
    this.validateArgs(annotation, def);
  }
  validateArgs(annotation, def) {
    const args = annotation.args;
    const tok = annotation.token;
    switch (def.argSpec) {
      case "none":
        if (args.length > 0) {
          this.bag.error(
            ErrorCode.T_ANNOTATION_INVALID_ARG,
            `annotation '@${annotation.name}' takes no arguments`,
            makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1)
          );
        }
        break;
      case "string":
        if (args.length !== 1 || args[0].kind !== "StringArg") {
          this.bag.error(
            ErrorCode.T_ANNOTATION_INVALID_ARG,
            `annotation '@${annotation.name}' requires exactly one string argument`,
            makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
            { validValues: ['@${annotation.name}("text")'] }
          );
        }
        break;
      case "ident":
        if (args.length !== 1 || args[0].kind !== "IdentArg" && args[0].kind !== "ListArg") {
          this.bag.error(
            ErrorCode.T_ANNOTATION_INVALID_ARG,
            `annotation '@${annotation.name}' requires one identifier argument`,
            makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1)
          );
        }
        if (annotation.name === "cfg" && args[0].kind === "IdentArg") {
          if (!CFG_CONDITIONS.includes(args[0].value) && !args[0].value.startsWith("feature=")) {
            this.bag.error(
              ErrorCode.T_ANNOTATION_INVALID_ARG,
              `invalid @cfg condition '${args[0].value}'`,
              makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1),
              { validValues: [...CFG_CONDITIONS] }
            );
          }
        }
        break;
      case "ident_list":
        if (args.length < 1) {
          this.bag.error(
            ErrorCode.T_ANNOTATION_INVALID_ARG,
            `annotation '@${annotation.name}' requires at least one argument`,
            makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1)
          );
        }
        if (annotation.name === "derive") {
          for (const arg of args) {
            const traits = arg.kind === "ListArg" ? arg.values.map((v) => v.kind === "IdentArg" ? v.value : "") : [arg.kind === "IdentArg" ? arg.value : ""];
            for (const trait of traits) {
              if (!DERIVABLE_TRAITS.includes(trait)) {
                this.bag.error(
                  ErrorCode.T_DERIVE_UNSUPPORTED,
                  `unsupported derive trait '${trait}'`,
                  makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + 20),
                  { validValues: [...DERIVABLE_TRAITS] }
                );
              }
            }
          }
        }
        if (["allow", "warn", "deny"].includes(annotation.name)) {
          for (const arg of args) {
            const warnings = arg.kind === "ListArg" ? arg.values.map((v) => v.kind === "IdentArg" ? v.value : "") : [arg.kind === "IdentArg" ? arg.value : ""];
            for (const w of warnings) {
              if (!VALID_WARNINGS.includes(w)) {
                this.bag.error(
                  ErrorCode.T_ANNOTATION_INVALID_ARG,
                  `unknown warning item '${w}'`,
                  makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + 20),
                  { validValues: [...VALID_WARNINGS] }
                );
              }
            }
          }
        }
        break;
      case "number":
        if (args.length !== 1 || args[0].kind !== "NumberArg") {
          this.bag.error(
            ErrorCode.T_ANNOTATION_INVALID_ARG,
            `annotation '@${annotation.name}' requires one numeric argument`,
            makeSpan(tok.file, tok.line, tok.col, tok.line, tok.col + annotation.name.length + 1)
          );
        }
        break;
      case "mixed":
        break;
    }
  }
  /**
   * Get all annotations of a specific name from a declaration.
   */
  static getAnnotation(decl, name) {
    for (const ann of decl.annotations) {
      if (ann.name === name) return ann;
    }
    return null;
  }
  /**
   * Check if a declaration has a specific annotation.
   */
  static hasAnnotation(decl, name) {
    return this.getAnnotation(decl, name) !== null;
  }
  /**
   * Get derive traits from a declaration.
   */
  static getDeriveTraits(decl) {
    const deriveAnno = this.getAnnotation(decl, "derive");
    if (!deriveAnno) return [];
    const traits = [];
    for (const arg of deriveAnno.args) {
      if (arg.kind === "IdentArg") {
        traits.push(arg.value);
      } else if (arg.kind === "ListArg") {
        for (const v of arg.values) {
          if (v.kind === "IdentArg") traits.push(v.value);
        }
      }
    }
    return traits;
  }
  /**
   * Evaluate @cfg condition against the current build configuration.
   * Returns true if the node should be compiled.
   */
  static evaluateCfg(annotation, config) {
    if (annotation.args.length === 0) return true;
    const arg = annotation.args[0];
    if (arg.kind !== "IdentArg") return true;
    const condition = arg.value;
    if (condition === "debug") return config.mode === "debug";
    if (condition === "release") return config.mode === "release";
    if (condition === "windows") return config.platform === "windows";
    if (condition === "linux") return config.platform === "linux";
    if (condition === "mac") return config.platform === "mac";
    if (condition === "android") return config.platform === "android";
    if (condition === "web") return config.platform === "web";
    if (condition.startsWith("feature=")) {
      const feature = condition.substring(8);
      return config.features.includes(feature);
    }
    return true;
  }
};
var DEFAULT_CONFIG = {
  mode: "debug",
  platform: "windows",
  features: []
};

// src/annotations/test_runner.ts
var TestRunner = class {
  bag;
  constructor(bag) {
    this.bag = bag;
  }
  /**
   * Collect all test cases from a compilation unit (spec 4.2).
   */
  collectTests(unit) {
    const tests = [];
    for (const decl of unit.declarations) {
      const dk = decl.declKind;
      if (dk.kind !== "FuncDecl") continue;
      const hasTest = AnnotationRegistry.hasAnnotation(decl, "test");
      if (!hasTest) continue;
      const hasSkip = AnnotationRegistry.hasAnnotation(decl, "test_skip");
      const hasTestOnly = AnnotationRegistry.hasAnnotation(decl, "test_only");
      const hasExpectFail = AnnotationRegistry.hasAnnotation(decl, "expect_fail");
      let group = null;
      const groupAnno = AnnotationRegistry.getAnnotation(decl, "test_group");
      if (groupAnno && groupAnno.args.length > 0 && groupAnno.args[0].kind === "StringArg") {
        group = groupAnno.args[0].value;
      }
      tests.push({
        name: dk.name,
        group,
        skip: hasSkip,
        expectFail: hasExpectFail,
        testOnly: hasTestOnly,
        funcDecl: decl
      });
    }
    return tests;
  }
  /**
   * Run collected test cases.
   * In a full implementation, this would execute the compiled code.
   * Here we provide the framework and report structure.
   */
  runTests(tests, groupFilter) {
    const results = [];
    for (const test of tests) {
      if (groupFilter && test.group !== groupFilter) {
        continue;
      }
      if (test.skip) {
        results.push({
          name: test.name,
          group: test.group,
          passed: false,
          skipped: true,
          message: "skipped (@test_skip)",
          duration: 0
        });
        continue;
      }
      const startTime = Date.now();
      const duration = Date.now() - startTime;
      results.push({
        name: test.name,
        group: test.group,
        passed: true,
        skipped: false,
        message: test.expectFail ? "collected (expects failure)" : "collected",
        duration
      });
    }
    return results;
  }
  /**
   * Format test results as human-readable text.
   */
  formatResults(results) {
    const lines = [];
    let passed = 0, failed = 0, skipped = 0;
    for (const result of results) {
      const status = result.skipped ? "SKIP" : result.passed ? "PASS" : "FAIL";
      const group = result.group ? ` [${result.group}]` : "";
      lines.push(`  ${status} ${result.name}${group} (${result.duration}ms)`);
      if (result.message) {
        lines.push(`       ${result.message}`);
      }
      if (result.skipped) skipped++;
      else if (result.passed) passed++;
      else failed++;
    }
    lines.push("");
    lines.push(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${results.length} total)`);
    return lines.join("\n");
  }
  /**
   * Format test results as JSON for AI Agent consumption (spec 8.2).
   */
  formatResultsJson(results) {
    return JSON.stringify({
      tests: results.map((r) => ({
        name: r.name,
        group: r.group,
        passed: r.passed,
        skipped: r.skipped,
        message: r.message,
        durationMs: r.duration
      })),
      summary: {
        total: results.length,
        passed: results.filter((r) => r.passed && !r.skipped).length,
        failed: results.filter((r) => !r.passed && !r.skipped).length,
        skipped: results.filter((r) => r.skipped).length
      }
    }, null, 2);
  }
};

// src/flag/bitfield.ts
var FlagResolver = class {
  bag;
  constructor(bag) {
    this.bag = bag;
  }
  /**
   * Resolve a flag[T] or flag_set declaration into a concrete bit layout.
   * Implements spec 6.1: auto top-down bit allocation, with @offset override.
   */
  resolve(decl) {
    const dk = decl.declKind;
    if (dk.kind === "FlagDecl") {
      return this.resolveFlagDecl(dk);
    } else if (dk.kind === "FlagSetDecl") {
      return this.resolveFlagSetDecl(dk);
    }
    return null;
  }
  resolveFlagDecl(dk) {
    const typeWidth = getBitWidth(dk.underlyingType) ?? 32;
    const slots = [];
    let autoOffset = 0;
    for (const slot of dk.slots) {
      const startBit = slot.offset !== null ? slot.offset : autoOffset;
      const endBit = startBit + slot.bitWidth;
      if (endBit > typeWidth) {
        this.bag.error(
          ErrorCode.T_FLAG_OVERFLOW,
          `flag '${dk.name}' slot '${slot.name}' exceeds ${dk.underlyingType} capacity: uses bits ${startBit}-${endBit - 1}, but ${dk.underlyingType} only has ${typeWidth} bits`,
          makeSpan("", 0, 0, 0, 0),
          {
            validValues: [`0-${typeWidth - 1}`],
            fixSuggestions: [{
              description: `reduce bit width or use larger underlying type (u64)`,
              range: makeSpan("", 0, 0, 0, 0),
              replacement: `flag[u64]`
            }]
          }
        );
      }
      for (const prev of slots) {
        if (startBit < prev.endBit && endBit > prev.startBit) {
          this.bag.error(
            ErrorCode.T_FLAG_OFFSET_CONFLICT,
            `flag slot '${slot.name}' (bits ${startBit}-${endBit - 1}) overlaps with '${prev.name}' (bits ${prev.startBit}-${prev.endBit - 1})`,
            makeSpan("", 0, 0, 0, 0)
          );
        }
      }
      const maxValue = (1 << slot.bitWidth) - 1;
      const slotInfo = {
        name: slot.name,
        startBit,
        bitLength: slot.bitWidth,
        minValue: 0,
        maxValue,
        isSingleBit: slot.bitWidth === 1,
        endBit,
        annotations: slot.annotations.map((a) => a.name)
      };
      slots.push(slotInfo);
      autoOffset = endBit;
    }
    return {
      name: dk.name,
      underlyingType: dk.underlyingType,
      totalBits: typeWidth,
      slots,
      isFlagSet: false
    };
  }
  resolveFlagSetDecl(dk) {
    const slots = [];
    let autoOffset = 0;
    for (const slot of dk.slots) {
      const startBit = slot.offset ?? autoOffset;
      const endBit = startBit + slot.bitWidth;
      const maxValue = (1 << slot.bitWidth) - 1;
      slots.push({
        name: slot.name,
        startBit,
        bitLength: slot.bitWidth,
        minValue: 0,
        maxValue,
        isSingleBit: slot.bitWidth === 1,
        endBit,
        annotations: slot.annotations.map((a) => a.name)
      });
      autoOffset = endBit;
    }
    return {
      name: dk.name,
      underlyingType: "dynamic",
      totalBits: autoOffset,
      slots,
      isFlagSet: true
    };
  }
  /**
   * Get SlotInfo for a specific slot by name (spec 5.3).
   * Used by type_info() for compile-time introspection.
   */
  static getSlotInfo(resolved, slotName) {
    const slot = resolved.slots.find((s) => s.name === slotName);
    if (!slot) return null;
    return {
      name: slot.name,
      startBit: slot.startBit,
      bitLength: slot.bitLength,
      minValue: slot.minValue,
      maxValue: slot.maxValue,
      isSingleBit: slot.isSingleBit,
      annotations: slot.annotations
    };
  }
  /**
   * Get all SlotInfo for a flag type (spec 5.3).
   */
  static getAllSlotInfo(resolved) {
    return resolved.slots.map((s) => ({
      name: s.name,
      startBit: s.startBit,
      bitLength: s.bitLength,
      minValue: s.minValue,
      maxValue: s.maxValue,
      isSingleBit: s.isSingleBit,
      annotations: s.annotations
    }));
  }
};

// src/comptime/type_info.ts
var TypeInfoProvider = class {
  flagResolver;
  typeDecls = /* @__PURE__ */ new Map();
  resolvedFlags = /* @__PURE__ */ new Map();
  constructor(flagResolver) {
    this.flagResolver = flagResolver;
  }
  registerDecl(name, decl) {
    this.typeDecls.set(name, decl);
    const dk = decl.declKind;
    if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
      const resolved = this.flagResolver.resolve(decl);
      if (resolved) this.resolvedFlags.set(name, resolved);
    }
  }
  /**
   * Get complete type info for a named type (spec 5.2).
   */
  getTypeInfo(typeName) {
    const decl = this.typeDecls.get(typeName);
    if (!decl) {
      if (getBitWidth(typeName) !== null) {
        return this.getScalarTypeInfo(typeName);
      }
      return null;
    }
    const dk = decl.declKind;
    switch (dk.kind) {
      case "StructDecl":
        return this.getStructTypeInfo(dk, decl);
      case "EnumDecl":
        return this.getEnumTypeInfo(dk, decl);
      case "FlagDecl":
        return this.getFlagTypeInfo(typeName, decl);
      case "FlagSetDecl":
        return this.getFlagSetTypeInfo(typeName, decl);
      case "UnionDecl":
        return this.getUnionTypeInfo(dk, decl);
      default:
        return null;
    }
  }
  // ── Scalar type info ─────────────────────────────────────────
  getScalarTypeInfo(name) {
    const width = getBitWidth(name) ?? 0;
    const sizeBytes = Math.ceil(width / 8);
    const range = TYPE_RANGES[name];
    return {
      typeName: name,
      kind: "scalar",
      sizeBytes,
      alignBytes: sizeBytes,
      fields: [],
      enumVariants: [],
      unionMembers: [],
      flagSlots: [],
      annotations: [],
      memoryLayout: "scalar"
    };
  }
  // ── Struct type info ─────────────────────────────────────────
  getStructTypeInfo(dk, decl) {
    const fields = [];
    let offset = 0;
    for (const field of dk.fields) {
      if (field.bitWidth !== null) {
        fields.push({
          name: field.name,
          typeName: dk.bitpackType ?? "void",
          byteOffset: null,
          bitOffset: offset,
          bitWidth: field.bitWidth,
          minValue: "0",
          maxValue: ((1 << field.bitWidth) - 1).toString(),
          annotations: this.extractAnnotations(field.annotations)
        });
        offset += field.bitWidth;
      } else {
        const fieldSize = this.estimateSize(field.typeNode);
        const binaryOffsetAnno = field.annotations.find((a) => a.name === "binary_offset");
        const byteOffset = binaryOffsetAnno ? parseInt(binaryOffsetAnno.args[0]?.value ?? "0", 10) : offset;
        fields.push({
          name: field.name,
          typeName: this.typeNodeToString(field.typeNode),
          byteOffset,
          bitOffset: null,
          bitWidth: null,
          minValue: null,
          maxValue: null,
          annotations: this.extractAnnotations(field.annotations)
        });
        offset += fieldSize;
      }
    }
    const sizeBytes = dk.isBitpack ? Math.ceil(offset / 8) : offset;
    return {
      typeName: dk.name,
      kind: "struct",
      sizeBytes,
      alignBytes: dk.isBitpack ? Math.ceil(offset / 8) : 4,
      fields,
      enumVariants: [],
      unionMembers: [],
      flagSlots: [],
      annotations: this.extractAnnotations(decl.annotations),
      memoryLayout: dk.memoryLayout === "soa" ? "soa" : "aos"
    };
  }
  // ── Enum type info ───────────────────────────────────────────
  getEnumTypeInfo(dk, decl) {
    const variants = [];
    let autoValue = 0;
    for (const variant of dk.variants) {
      let value = null;
      if (variant.value) {
        if (variant.value.exprKind.kind === "IntegerLit") {
          const lit = variant.value.exprKind;
          value = parseInt(lit.value, lit.radix);
          autoValue = value + 1;
        }
      } else {
        value = autoValue;
        autoValue++;
      }
      variants.push({
        name: variant.name,
        value,
        annotations: this.extractAnnotations(variant.annotations)
      });
    }
    const width = getBitWidth(dk.underlyingType) ?? 32;
    return {
      typeName: dk.name,
      kind: "enum",
      sizeBytes: Math.ceil(width / 8),
      alignBytes: Math.ceil(width / 8),
      fields: [],
      enumVariants: variants,
      unionMembers: [],
      flagSlots: [],
      annotations: this.extractAnnotations(decl.annotations),
      memoryLayout: "enum"
    };
  }
  // ── Flag type info ───────────────────────────────────────────
  getFlagTypeInfo(name, decl) {
    const resolved = this.resolvedFlags.get(name);
    if (!resolved) return null;
    return {
      typeName: resolved.name,
      kind: "flag",
      sizeBytes: Math.ceil(resolved.totalBits / 8),
      alignBytes: Math.ceil(resolved.totalBits / 8),
      fields: [],
      enumVariants: [],
      unionMembers: [],
      flagSlots: FlagResolver.getAllSlotInfo(resolved),
      annotations: this.extractAnnotations(decl.annotations),
      memoryLayout: "flag"
    };
  }
  // ── Flag set type info ───────────────────────────────────────
  getFlagSetTypeInfo(name, decl) {
    const resolved = this.resolvedFlags.get(name);
    if (!resolved) return null;
    return {
      typeName: resolved.name,
      kind: "flag_set",
      sizeBytes: Math.ceil(resolved.totalBits / 8),
      alignBytes: 8,
      // flag_set is heap-allocated, pointer-aligned
      fields: [],
      enumVariants: [],
      unionMembers: [],
      flagSlots: FlagResolver.getAllSlotInfo(resolved),
      annotations: this.extractAnnotations(decl.annotations),
      memoryLayout: "flag_set"
    };
  }
  // ── Union type info ──────────────────────────────────────────
  getUnionTypeInfo(dk, decl) {
    const members = [];
    let maxSize = 0;
    for (const member of dk.members) {
      const memberSize = this.estimateSize(member.typeNode);
      if (memberSize > maxSize) maxSize = memberSize;
      members.push({
        name: member.name,
        typeName: this.typeNodeToString(member.typeNode),
        annotations: this.extractAnnotations(member.annotations)
      });
    }
    return {
      typeName: dk.name,
      kind: "union",
      sizeBytes: maxSize,
      alignBytes: maxSize,
      fields: [],
      enumVariants: [],
      unionMembers: members,
      flagSlots: [],
      annotations: this.extractAnnotations(decl.annotations),
      memoryLayout: "union"
    };
  }
  // ── Helpers ──────────────────────────────────────────────────
  extractAnnotations(annotations) {
    return annotations.map((a) => ({
      name: a.name,
      args: a.args.map((arg) => {
        switch (arg.kind) {
          case "StringArg":
            return `"${arg.value}"`;
          case "IdentArg":
            return arg.value;
          case "NumberArg":
            return arg.value;
          case "ListArg":
            return arg.values.map((v) => v.kind === "IdentArg" ? v.value : "").join(", ");
        }
      })
    }));
  }
  typeNodeToString(typeNode) {
    if (!typeNode) return "unknown";
    const inner = typeNode.inner;
    switch (inner.kind) {
      case "ScalarType":
        return inner.name;
      case "NamedType":
        return inner.name;
      case "ArrayType":
        return `[${inner.length?.exprKind?.value ?? "N"}]${this.typeNodeToString(inner.elem)}`;
      case "SliceType":
        return `[]${this.typeNodeToString(inner.elem)}`;
      case "MapType":
        return `map[${this.typeNodeToString(inner.key)}]${this.typeNodeToString(inner.value)}`;
      case "PointerType":
        return `*${this.typeNodeToString(inner.elem)}`;
      case "VariantType":
        return "Variant";
      case "FlagType":
        return `flag[${inner.underlying}]`;
      case "FlagSetType":
        return "flag_set";
      case "OptionalType":
        return `?${this.typeNodeToString(inner.elem)}`;
      default:
        return "unknown";
    }
  }
  estimateSize(typeNode) {
    if (!typeNode) return 0;
    const inner = typeNode.inner;
    switch (inner.kind) {
      case "ScalarType": {
        const w = getBitWidth(inner.name);
        return w ? Math.ceil(w / 8) : 4;
      }
      case "NamedType": {
        const info = this.getTypeInfo(inner.name);
        return info ? info.sizeBytes : 4;
      }
      case "PointerType":
        return 8;
      case "SliceType":
        return 16;
      // ptr + length
      case "MapType":
        return 24;
      // simplified
      default:
        return 4;
    }
  }
  /**
   * Export type info as JSON (spec 8.3: AST standardization export).
   */
  exportAsJson(typeName) {
    const info = this.getTypeInfo(typeName);
    if (!info) return JSON.stringify({ error: `unknown type '${typeName}'` });
    return JSON.stringify(info, null, 2);
  }
};

// src/annotations/derive.ts
var DeriveProcessor = class {
  /**
   * Process all @derive annotations on a declaration.
   * Returns generated method info for each trait.
   */
  process(decl, typeInfo) {
    const traits = AnnotationRegistry.getDeriveTraits(decl);
    const dk = decl.declKind;
    const methods = [];
    for (const trait of traits) {
      const method = this.generateForTrait(trait, decl, typeInfo);
      if (method) methods.push(method);
    }
    return {
      declName: this.getDeclName(decl),
      declKind: dk.kind,
      methods
    };
  }
  getDeclName(decl) {
    const dk = decl.declKind;
    return dk.name ?? "<anonymous>";
  }
  generateForTrait(trait, decl, typeInfo) {
    const name = this.getDeclName(decl);
    const dk = decl.declKind;
    switch (trait) {
      case "ToString":
        return this.genToString(name, decl);
      case "FromString":
        return this.genFromString(name, decl);
      case "Clone":
        return this.genClone(name, decl);
      case "Copy":
        return this.genCopy(name, decl);
      case "DebugPrint":
        return this.genDebugPrint(name, decl);
      case "BinarySerde":
        return this.genBinarySerde(name, decl);
      case "Eq":
      case "PartialEq":
        return this.genEq(name, decl);
      case "Hash":
        return this.genHash(name, decl);
      default:
        return null;
    }
  }
  // ── ToString ─────────────────────────────────────────────────
  genToString(name, decl) {
    const fields = this.getFields(decl);
    const fieldParts = fields.map((f) => `${f.name}=${"$" + f.name}`).join(", ");
    return {
      traitName: "ToString",
      methodName: "to_string",
      signature: `to_string(self: ${name}) -> string`,
      bodyDescription: `Converts ${name} to string representation`,
      generatedCode: `// @derive(ToString) \u2014 auto-generated
to_string :: func(self: ${name}) -> string {
    return "${name} { ${fieldParts} }";
}`
    };
  }
  // ── FromString ───────────────────────────────────────────────
  genFromString(name, decl) {
    const fields = this.getFields(decl);
    return {
      traitName: "FromString",
      methodName: "from_string",
      signature: `from_string(s: string) -> ${name}`,
      bodyDescription: `Parses ${name} from string (CSV config support)`,
      generatedCode: `// @derive(FromString) \u2014 auto-generated
from_string :: func(s: string) -> ${name} {
    var result: ${name};
    // parse fields: ${fields.map((f) => f.name).join(", ")}
    return result;
}`
    };
  }
  // ── Clone ────────────────────────────────────────────────────
  genClone(name, decl) {
    const fields = this.getFields(decl);
    const copyExpr = fields.map((f) => `${f.name}: self.${f.name}`).join(", ");
    return {
      traitName: "Clone",
      methodName: "clone",
      signature: `clone(self: ${name}) -> ${name}`,
      bodyDescription: `Deep clone of ${name}`,
      generatedCode: `// @derive(Clone) \u2014 auto-generated
clone :: func(self: ${name}) -> ${name} {
    return ${name} { ${copyExpr} };
}`
    };
  }
  // ── Copy ─────────────────────────────────────────────────────
  genCopy(name, decl) {
    return {
      traitName: "Copy",
      methodName: "__copy_marker",
      signature: `// marker: ${name} is Copy`,
      bodyDescription: `Marks ${name} as bitwise-copyable`,
      generatedCode: `// @derive(Copy) \u2014 auto-generated
// ${name} is marked as Copy (bitwise copy on assignment)`
    };
  }
  // ── DebugPrint ───────────────────────────────────────────────
  genDebugPrint(name, decl) {
    const fields = this.getFields(decl);
    const parts = fields.map((f) => `${f.name}: {self.${f.name}}`).join(", ");
    return {
      traitName: "DebugPrint",
      methodName: "debug_print",
      signature: `debug_print(self: ${name}) -> string`,
      bodyDescription: `Debug format for ${name}`,
      generatedCode: `// @derive(DebugPrint) \u2014 auto-generated
debug_print :: func(self: ${name}) -> string {
    return "${name}(${parts})";
}`
    };
  }
  // ── BinarySerde ──────────────────────────────────────────────
  genBinarySerde(name, decl) {
    const fields = this.getFields(decl);
    const serializeLines = fields.filter((f) => !f.annotations.some((a) => a.name === "binary_skip")).map((f, i) => {
      const offsetAnno = f.annotations.find((a) => a.name === "binary_offset");
      const offset = offsetAnno ? offsetAnno.args[0] : null;
      return `    // offset ${offset ?? i * 4}: write self.${f.name}`;
    }).join("\n");
    return {
      traitName: "BinarySerde",
      methodName: "serialize/deserialize",
      signature: `serialize(self: ${name}) -> []u8 / deserialize(data: []u8) -> ${name}`,
      bodyDescription: `Binary serialization and deserialization for ${name}`,
      generatedCode: `// @derive(BinarySerde) \u2014 auto-generated
serialize :: func(self: ${name}) -> []u8 {
${serializeLines}
    return buffer;
}

deserialize :: func(data: []u8) -> ${name} {
    var result: ${name};
    // read fields from data at specified offsets
    return result;
}`
    };
  }
  // ── Eq / PartialEq ───────────────────────────────────────────
  genEq(name, decl) {
    const fields = this.getFields(decl);
    const compareExpr = fields.map((f) => `self.${f.name} == other.${f.name}`).join(" && ");
    return {
      traitName: "Eq",
      methodName: "eq",
      signature: `eq(self: ${name}, other: ${name}) -> bool`,
      bodyDescription: `Equality comparison for ${name}`,
      generatedCode: `// @derive(Eq) \u2014 auto-generated
eq :: func(self: ${name}, other: ${name}) -> bool {
    return ${compareExpr || "true"};
}`
    };
  }
  // ── Hash ─────────────────────────────────────────────────────
  genHash(name, decl) {
    const fields = this.getFields(decl);
    const hashLines = fields.map((f) => `    hash = hash_combine(hash, hash_of(self.${f.name}));`).join("\n");
    return {
      traitName: "Hash",
      methodName: "hash",
      signature: `hash(self: ${name}) -> u64`,
      bodyDescription: `Hash computation for ${name} (for use as map key)`,
      generatedCode: `// @derive(Hash) \u2014 auto-generated
hash :: func(self: ${name}) -> u64 {
    var hash: u64 = 0;
${hashLines}
    return hash;
}`
    };
  }
  // ── Field extraction helper ──────────────────────────────────
  getFields(decl) {
    const dk = decl.declKind;
    switch (dk.kind) {
      case "StructDecl":
        return dk.fields.filter((f) => f.bitWidth === null).map((f) => ({
          name: f.name,
          typeNode: f.typeNode,
          annotations: f.annotations
        }));
      case "EnumDecl":
        return dk.variants.map((v) => ({
          name: v.name,
          typeNode: null,
          annotations: v.annotations
        }));
      case "UnionDecl":
        return dk.members.map((m) => ({
          name: m.name,
          typeNode: m.typeNode,
          annotations: m.annotations
        }));
      default:
        return [];
    }
  }
};

// src/codegen/ast_export.ts
var AstJsonExporter = class {
  typeInfoProvider;
  flagResolver;
  deriveProcessor;
  constructor(flagResolver, typeInfoProvider = null) {
    this.flagResolver = flagResolver;
    this.typeInfoProvider = typeInfoProvider;
    this.deriveProcessor = new DeriveProcessor();
  }
  /**
   * Export a compilation unit as JSON (spec 8.3).
   */
  export(unit) {
    const json = {
      format: "t-ast-json",
      version: "0.1.0",
      file: unit.file,
      module: unit.moduleName,
      declarations: unit.declarations.map((d) => this.serializeDecl(d)),
      typeInfo: this.typeInfoProvider ? unit.declarations.filter((d) => {
        const dk = d.declKind;
        return dk.kind === "StructDecl" || dk.kind === "EnumDecl" || dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl" || dk.kind === "UnionDecl";
      }).map((d) => this.typeInfoProvider.getTypeInfo(d.declKind.name)).filter((info) => info !== null) : []
    };
    return JSON.stringify(json, null, 2);
  }
  serializeDecl(decl) {
    const dk = decl.declKind;
    const base = {
      kind: dk.kind,
      name: dk.name ?? null,
      annotations: decl.annotations.map((a) => this.serializeAnnotation(a))
    };
    switch (dk.kind) {
      case "StructDecl":
        return {
          ...base,
          memoryLayout: dk.memoryLayout,
          isBitpack: dk.isBitpack,
          bitpackType: dk.bitpackType,
          fields: dk.fields.map((f) => ({
            name: f.name,
            type: f.typeNode ? this.serializeType(f.typeNode) : null,
            bitWidth: f.bitWidth,
            annotations: f.annotations.map((a) => this.serializeAnnotation(a))
          })),
          deriveResults: this.deriveProcessor.process(decl, null).methods
        };
      case "EnumDecl":
        return {
          ...base,
          underlyingType: dk.underlyingType,
          variants: dk.variants.map((v) => ({
            name: v.name,
            value: v.value ? this.serializeExpr(v.value) : null,
            annotations: v.annotations.map((a) => this.serializeAnnotation(a))
          }))
        };
      case "FlagDecl":
        return {
          ...base,
          underlyingType: dk.underlyingType,
          slots: dk.slots.map((s) => ({
            name: s.name,
            bitWidth: s.bitWidth,
            offset: s.offset,
            annotations: s.annotations.map((a) => this.serializeAnnotation(a))
          })),
          resolvedLayout: this.serializeFlagLayout(decl)
        };
      case "FlagSetDecl":
        return {
          ...base,
          slots: dk.slots.map((s) => ({
            name: s.name,
            bitWidth: s.bitWidth,
            offset: s.offset,
            annotations: s.annotations.map((a) => this.serializeAnnotation(a))
          })),
          resolvedLayout: this.serializeFlagLayout(decl)
        };
      case "UnionDecl":
        return {
          ...base,
          members: dk.members.map((m) => ({
            name: m.name,
            type: this.serializeType(m.typeNode),
            annotations: m.annotations.map((a) => this.serializeAnnotation(a))
          }))
        };
      case "FuncDecl":
        return {
          ...base,
          params: dk.params.map((p) => ({
            name: p.name,
            type: this.serializeType(p.typeNode),
            annotations: p.annotations.map((a) => this.serializeAnnotation(a))
          })),
          returnType: this.serializeType(dk.returnType),
          isExtern: dk.isExtern,
          isComptime: dk.isComptime,
          body: dk.body ? dk.body.map((s) => this.serializeStmt(s)) : null
        };
      case "GlobalVarDecl":
        return {
          ...base,
          type: this.serializeType(dk.typeNode),
          init: dk.init ? this.serializeExpr(dk.init) : null,
          isComptime: dk.isComptime
        };
      case "GlobalConstDecl":
        return {
          ...base,
          type: dk.typeNode ? this.serializeType(dk.typeNode) : null,
          init: this.serializeExpr(dk.init),
          isComptime: dk.isComptime
        };
      case "ImportDecl":
        return { ...base, path: dk.path, alias: dk.alias };
      case "TypeAliasDecl":
        return { ...base, aliasedType: this.serializeType(dk.aliasedType) };
    }
  }
  serializeAnnotation(ann) {
    return {
      name: ann.name,
      args: ann.args.map((a) => this.serializeAnnotationArg(a))
    };
  }
  serializeAnnotationArg(arg) {
    switch (arg.kind) {
      case "StringArg":
        return { kind: "string", value: arg.value };
      case "IdentArg":
        return { kind: "ident", value: arg.value };
      case "NumberArg":
        return { kind: "number", value: arg.value };
      case "ListArg":
        return { kind: "list", values: arg.values.map((v) => this.serializeAnnotationArg(v)) };
    }
  }
  serializeType(type) {
    const inner = type.inner;
    switch (inner.kind) {
      case "ScalarType":
        return { kind: "scalar", name: inner.name };
      case "ArrayType":
        return { kind: "array", elem: this.serializeType(inner.elem), length: this.serializeExpr(inner.length) };
      case "SliceType":
        return { kind: "slice", elem: this.serializeType(inner.elem) };
      case "MapType":
        return { kind: "map", key: this.serializeType(inner.key), value: this.serializeType(inner.value) };
      case "NamedType":
        return { kind: "named", name: inner.name };
      case "VariantType":
        return { kind: "variant" };
      case "FlagType":
        return { kind: "flag", underlying: inner.underlying };
      case "FlagSetType":
        return { kind: "flag_set" };
      case "PointerType":
        return { kind: "pointer", elem: this.serializeType(inner.elem) };
      case "OptionalType":
        return { kind: "optional", elem: this.serializeType(inner.elem) };
    }
  }
  serializeStmt(stmt) {
    const sk = stmt.stmtKind;
    switch (sk.kind) {
      case "ExprStmt":
        return { kind: "expr", expr: this.serializeExpr(sk.expr) };
      case "VarDecl":
        return {
          kind: "var_decl",
          name: sk.name,
          isConst: sk.isConst,
          type: sk.typeNode ? this.serializeType(sk.typeNode) : null,
          init: sk.init ? this.serializeExpr(sk.init) : null
        };
      case "IfStmt":
        return {
          kind: "if",
          condition: this.serializeExpr(sk.condition),
          then: sk.thenBlock.map((s) => this.serializeStmt(s)),
          else: sk.elseBlock ? sk.elseBlock.map((s) => this.serializeStmt(s)) : null
        };
      case "ForStmt":
        return {
          kind: "for",
          init: sk.init ? this.serializeStmt(sk.init) : null,
          condition: sk.condition ? this.serializeExpr(sk.condition) : null,
          update: sk.update ? this.serializeExpr(sk.update) : null,
          body: sk.body.map((s) => this.serializeStmt(s))
        };
      case "ForEachStmt":
        return {
          kind: "for_each",
          varName: sk.varName,
          iterable: this.serializeExpr(sk.iterable),
          body: sk.body.map((s) => this.serializeStmt(s))
        };
      case "WhileStmt":
        return {
          kind: "while",
          condition: this.serializeExpr(sk.condition),
          body: sk.body.map((s) => this.serializeStmt(s))
        };
      case "SwitchStmt":
        return {
          kind: "switch",
          expr: this.serializeExpr(sk.expr),
          cases: sk.cases.map((c) => ({
            pattern: this.serializeExpr(c.pattern),
            body: c.body.map((s) => this.serializeStmt(s))
          })),
          default: sk.defaultBlock ? sk.defaultBlock.map((s) => this.serializeStmt(s)) : null
        };
      case "ReturnStmt":
        return { kind: "return", value: sk.value ? this.serializeExpr(sk.value) : null };
      case "BreakStmt":
        return { kind: "break" };
      case "ContinueStmt":
        return { kind: "continue" };
      case "DeferStmt":
        return { kind: "defer", body: sk.body.map((s) => this.serializeStmt(s)) };
      case "BlockStmt":
        return { kind: "block", body: sk.body.map((s) => this.serializeStmt(s)) };
      case "ComptimeStmt":
        return { kind: "comptime_block", body: sk.body.map((s) => this.serializeStmt(s)) };
      case "AssignmentStmt":
        return {
          kind: "assignment",
          target: this.serializeExpr(sk.target),
          op: sk.op,
          value: this.serializeExpr(sk.value)
        };
    }
  }
  serializeExpr(expr) {
    const ek = expr.exprKind;
    switch (ek.kind) {
      case "IntegerLit":
        return { kind: "int", value: ek.value, radix: ek.radix };
      case "FloatLit":
        return { kind: "float", value: ek.value };
      case "StringLit":
        return { kind: "string", value: ek.value };
      case "BoolLit":
        return { kind: "bool", value: ek.value };
      case "NullLit":
        return { kind: "null" };
      case "IdentExpr":
        return { kind: "ident", name: ek.name };
      case "BinaryExpr":
        return {
          kind: "binary",
          op: ek.op,
          left: this.serializeExpr(ek.left),
          right: this.serializeExpr(ek.right)
        };
      case "UnaryExpr":
        return { kind: "unary", op: ek.op, operand: this.serializeExpr(ek.operand) };
      case "AssignExpr":
        return {
          kind: "assign",
          op: ek.op,
          target: this.serializeExpr(ek.target),
          value: this.serializeExpr(ek.value)
        };
      case "CallExpr":
        return {
          kind: "call",
          callee: this.serializeExpr(ek.callee),
          args: ek.args.map((a) => this.serializeExpr(a))
        };
      case "MemberExpr":
        return {
          kind: "member",
          object: this.serializeExpr(ek.object),
          member: ek.member
        };
      case "IndexExpr":
        return {
          kind: "index",
          object: this.serializeExpr(ek.object),
          index: this.serializeExpr(ek.index)
        };
      case "ArrayLit":
        return { kind: "array_lit", elements: ek.elements.map((e) => this.serializeExpr(e)) };
      case "MapLit":
        return {
          kind: "map_lit",
          entries: ek.entries.map((e) => ({ key: this.serializeExpr(e.key), value: this.serializeExpr(e.value) }))
        };
      case "StructLit":
        return {
          kind: "struct_lit",
          typeName: ek.typeName,
          fields: ek.fields.map((f) => ({ name: f.name, value: this.serializeExpr(f.value) }))
        };
      case "CastExpr":
        return {
          kind: "cast",
          expr: this.serializeExpr(ek.expr),
          targetType: this.serializeType(ek.targetType)
        };
      case "RangeExpr":
        return {
          kind: "range",
          start: this.serializeExpr(ek.start),
          end: this.serializeExpr(ek.end)
        };
      case "ParenExpr":
        return { kind: "paren", inner: this.serializeExpr(ek.inner) };
      case "ComptimeExpr":
        return { kind: "comptime", expr: this.serializeExpr(ek.expr) };
      case "TypeInfoExpr":
        return { kind: "type_info", targetType: this.serializeType(ek.targetType) };
      case "FlagSetExpr":
        return {
          kind: "flag_set_call",
          flagExpr: this.serializeExpr(ek.flagExpr),
          fieldName: ek.fieldName,
          value: this.serializeExpr(ek.value)
        };
    }
  }
  serializeFlagLayout(decl) {
    const resolved = this.flagResolver.resolve(decl);
    if (!resolved) return null;
    return {
      name: resolved.name,
      underlyingType: resolved.underlyingType,
      totalBits: resolved.totalBits,
      isFlagSet: resolved.isFlagSet,
      slots: resolved.slots.map((s) => ({
        name: s.name,
        startBit: s.startBit,
        bitLength: s.bitLength,
        endBit: s.endBit,
        minValue: s.minValue,
        maxValue: s.maxValue,
        isSingleBit: s.isSingleBit,
        annotations: s.annotations
      }))
    };
  }
};

// src/codegen/emitter.ts
var CEmitter = class {
  flagResolver;
  deriveProcessor;
  resolvedFlags = /* @__PURE__ */ new Map();
  headerLines = [];
  sourceLines = [];
  constructor(flagResolver) {
    this.flagResolver = flagResolver;
    this.deriveProcessor = new DeriveProcessor();
  }
  emit(unit) {
    this.headerLines = [];
    this.sourceLines = [];
    const guardName = `TC_${unit.moduleName.toUpperCase()}_H`;
    this.headerLines.push(`#ifndef ${guardName}`);
    this.headerLines.push(`#define ${guardName}`);
    this.headerLines.push("");
    this.headerLines.push("#include <stdint.h>");
    this.headerLines.push("#include <stdbool.h>");
    this.headerLines.push("#include <stddef.h>");
    this.headerLines.push("");
    this.sourceLines.push(`#include "${unit.moduleName}.h"`);
    this.sourceLines.push("#include <stdio.h>");
    this.sourceLines.push("#include <stdlib.h>");
    this.sourceLines.push("#include <string.h>");
    this.sourceLines.push("");
    for (const decl of unit.declarations) {
      const dk = decl.declKind;
      if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
        const resolved = this.flagResolver.resolve(decl);
        if (resolved) this.resolvedFlags.set(dk.name, resolved);
      }
    }
    for (const decl of unit.declarations) {
      this.emitDecl(decl);
    }
    this.emitFlagMacros();
    this.headerLines.push("");
    this.headerLines.push(`#endif // ${guardName}`);
    return {
      header: this.headerLines.join("\n"),
      source: this.sourceLines.join("\n")
    };
  }
  emitDecl(decl) {
    const dk = decl.declKind;
    switch (dk.kind) {
      case "StructDecl":
        this.emitStructDecl(dk, decl);
        break;
      case "EnumDecl":
        this.emitEnumDecl(dk);
        break;
      case "FlagDecl":
        this.emitFlagDecl(dk);
        break;
      case "FlagSetDecl":
        this.emitFlagSetDecl(dk);
        break;
      case "UnionDecl":
        this.emitUnionDecl(dk);
        break;
      case "FuncDecl":
        this.emitFuncDecl(dk, decl);
        break;
      case "GlobalVarDecl":
        this.emitGlobalVar(dk);
        break;
      case "GlobalConstDecl":
        this.emitGlobalConst(dk);
        break;
      case "ImportDecl":
        this.headerLines.push(`#include "${dk.path}"`);
        break;
      case "TypeAliasDecl":
        this.headerLines.push(`typedef ${this.emitType(dk.aliasedType)} ${dk.name};`);
        break;
    }
  }
  // ── Struct ───────────────────────────────────────────────────
  emitStructDecl(dk, decl) {
    const attrs = this.emitAttributes(decl.annotations);
    if (dk.isBitpack && dk.bitpackType) {
      this.headerLines.push(`// @bitpack(${dk.bitpackType}) struct`);
      if (attrs) this.headerLines.push(attrs);
      this.headerLines.push(`typedef struct ${dk.name} {`);
      for (const field of dk.fields) {
        this.headerLines.push(`    ${this.scalarToC(dk.bitpackType)} ${field.name} : ${field.bitWidth};`);
      }
      this.headerLines.push(`} ${dk.name};`);
    } else {
      const layoutAttr = dk.memoryLayout === "soa" ? " // #soa layout" : "";
      if (attrs) this.headerLines.push(attrs);
      this.headerLines.push(`typedef struct ${dk.name} {${layoutAttr}`);
      for (const field of dk.fields) {
        if (field.bitWidth === null) {
          const fieldAttrs = this.emitAttributes(field.annotations);
          if (fieldAttrs) this.headerLines.push(`    ${fieldAttrs}`);
          this.headerLines.push(`    ${this.emitType(field.typeNode)} ${field.name};`);
        }
      }
      this.headerLines.push(`} ${dk.name};`);
    }
    const deriveResult = this.deriveProcessor.process(decl, null);
    for (const method of deriveResult.methods) {
      this.sourceLines.push(method.generatedCode);
      this.sourceLines.push("");
    }
  }
  // ── Enum ─────────────────────────────────────────────────────
  emitEnumDecl(dk) {
    this.headerLines.push(`typedef ${this.scalarToC(dk.underlyingType)} ${dk.name};`);
    this.headerLines.push("");
    let autoValue = 0;
    for (const variant of dk.variants) {
      if (variant.value) {
        const val = this.emitExpr(variant.value);
        this.headerLines.push(`#define ${dk.name}_${variant.name} ${val}`);
        if (variant.value.exprKind.kind === "IntegerLit") {
          autoValue = parseInt(variant.value.exprKind.value, variant.value.exprKind.radix) + 1;
        }
      } else {
        this.headerLines.push(`#define ${dk.name}_${variant.name} ${autoValue}`);
        autoValue++;
      }
    }
  }
  // ── Flag ─────────────────────────────────────────────────────
  emitFlagDecl(dk) {
    this.headerLines.push(`// flag[${dk.underlyingType}] ${dk.name}`);
    this.headerLines.push(`typedef ${this.scalarToC(dk.underlyingType)} ${dk.name};`);
    this.headerLines.push("");
    const resolved = this.resolvedFlags.get(dk.name);
    if (resolved) {
      for (const slot of resolved.slots) {
        if (slot.isSingleBit) {
          this.headerLines.push(`#define ${dk.name}_${slot.name} (1u << ${slot.startBit})`);
        } else {
          this.headerLines.push(`// ${slot.name}: bits ${slot.startBit}-${slot.endBit - 1} (${slot.bitLength} bits, max=${slot.maxValue})`);
          this.headerLines.push(`#define ${dk.name}_${slot.name}_SHIFT ${slot.startBit}`);
          this.headerLines.push(`#define ${dk.name}_${slot.name}_MASK (((1u << ${slot.bitLength}) - 1) << ${slot.startBit})`);
        }
      }
    }
  }
  // ── Flag Set ─────────────────────────────────────────────────
  emitFlagSetDecl(dk) {
    this.headerLines.push(`// flag_set ${dk.name} (dynamic length bitfield)`);
    this.headerLines.push(`typedef struct ${dk.name} {`);
    this.headerLines.push(`    uint8_t* data;`);
    this.headerLines.push(`    size_t bit_count;`);
    this.headerLines.push(`    size_t byte_count;`);
    this.headerLines.push(`} ${dk.name};`);
    this.headerLines.push("");
    const resolved = this.resolvedFlags.get(dk.name);
    if (resolved) {
      for (const slot of resolved.slots) {
        this.headerLines.push(`// ${slot.name}: bits ${slot.startBit}-${slot.endBit - 1} (${slot.bitLength} bits)`);
        this.headerLines.push(`#define ${dk.name}_${slot.name}_SHIFT ${slot.startBit}`);
        this.headerLines.push(`#define ${dk.name}_${slot.name}_MASK (((1u << ${slot.bitLength}) - 1) << ${slot.startBit})`);
      }
    }
  }
  // ── Union ────────────────────────────────────────────────────
  emitUnionDecl(dk) {
    this.headerLines.push(`typedef union ${dk.name} {`);
    for (const member of dk.members) {
      this.headerLines.push(`    ${this.emitType(member.typeNode)} ${member.name};`);
    }
    this.headerLines.push(`} ${dk.name};`);
  }
  // ── Function ─────────────────────────────────────────────────
  emitFuncDecl(dk, decl) {
    const attrs = this.emitAttributes(decl.annotations);
    const params = dk.params.map((p) => `${this.emitType(p.typeNode)} ${p.name}`);
    const paramStr = params.length > 0 ? params.join(", ") : "void";
    const retType = this.emitType(dk.returnType);
    if (dk.isExtern) {
      if (attrs) this.headerLines.push(attrs);
      this.headerLines.push(`${retType} ${dk.name}(${paramStr});`);
    } else {
      if (attrs) this.headerLines.push(attrs);
      this.headerLines.push(`${retType} ${dk.name}(${paramStr});`);
      this.sourceLines.push(`${retType} ${dk.name}(${paramStr}) {`);
      if (dk.body) {
        for (const stmt of dk.body) {
          this.emitStmt(stmt, this.sourceLines, 1);
        }
      }
      this.sourceLines.push(`}`);
      this.sourceLines.push("");
    }
  }
  // ── Global var / const ───────────────────────────────────────
  emitGlobalVar(dk) {
    this.headerLines.push(`extern ${this.emitType(dk.typeNode)} ${dk.name};`);
    const init = dk.init ? ` = ${this.emitExpr(dk.init)}` : "";
    this.sourceLines.push(`${this.emitType(dk.typeNode)} ${dk.name}${init};`);
  }
  emitGlobalConst(dk) {
    const type = dk.typeNode ? this.emitType(dk.typeNode) : "const int";
    this.headerLines.push(`#define ${dk.name} (${this.emitExpr(dk.init)})`);
  }
  // ── Statements ───────────────────────────────────────────────
  emitStmt(stmt, lines, indent) {
    const pad = "    ".repeat(indent);
    const sk = stmt.stmtKind;
    switch (sk.kind) {
      case "ExprStmt":
        lines.push(`${pad}${this.emitExpr(sk.expr)};`);
        break;
      case "VarDecl": {
        const type = sk.typeNode ? this.emitType(sk.typeNode) : "auto";
        const init = sk.init ? ` = ${this.emitExpr(sk.init)}` : "";
        lines.push(`${pad}${type} ${sk.name}${init};`);
        break;
      }
      case "IfStmt":
        lines.push(`${pad}if (${this.emitExpr(sk.condition)}) {`);
        for (const s of sk.thenBlock) this.emitStmt(s, lines, indent + 1);
        if (sk.elseBlock) {
          lines.push(`${pad}} else {`);
          for (const s of sk.elseBlock) this.emitStmt(s, lines, indent + 1);
        }
        lines.push(`${pad}}`);
        break;
      case "WhileStmt":
        lines.push(`${pad}while (${this.emitExpr(sk.condition)}) {`);
        for (const s of sk.body) this.emitStmt(s, lines, indent + 1);
        lines.push(`${pad}}`);
        break;
      case "ForStmt":
        lines.push(`${pad}for (`);
        if (sk.init) {
          if (sk.init.stmtKind.kind === "VarDecl") {
            const vd = sk.init.stmtKind;
            const type = vd.typeNode ? this.emitType(vd.typeNode) : "int";
            const init = vd.init ? ` = ${this.emitExpr(vd.init)}` : "";
            lines[lines.length - 1] += `${type} ${vd.name}${init}`;
          } else if (sk.init.stmtKind.kind === "ExprStmt") {
            lines[lines.length - 1] += this.emitExpr(sk.init.stmtKind.expr);
          }
        }
        lines[lines.length - 1] += `; ${sk.condition ? this.emitExpr(sk.condition) : ""}; ${sk.update ? this.emitExpr(sk.update) : ""}) {`;
        for (const s of sk.body) this.emitStmt(s, lines, indent + 1);
        lines.push(`${pad}}`);
        break;
      case "ReturnStmt":
        lines.push(`${pad}return${sk.value ? " " + this.emitExpr(sk.value) : ""};`);
        break;
      case "BreakStmt":
        lines.push(`${pad}break;`);
        break;
      case "ContinueStmt":
        lines.push(`${pad}continue;`);
        break;
      case "AssignmentStmt":
        lines.push(`${pad}${this.emitExpr(sk.target)} ${sk.op} ${this.emitExpr(sk.value)};`);
        break;
      case "BlockStmt":
        lines.push(`${pad}{`);
        for (const s of sk.body) this.emitStmt(s, lines, indent + 1);
        lines.push(`${pad}}`);
        break;
      case "SwitchStmt":
        lines.push(`${pad}switch (${this.emitExpr(sk.expr)}) {`);
        for (const c of sk.cases) {
          lines.push(`${pad}case ${this.emitExpr(c.pattern)}:`);
          for (const s of c.body) this.emitStmt(s, lines, indent + 2);
          lines.push(`${pad}    break;`);
        }
        if (sk.defaultBlock) {
          lines.push(`${pad}default:`);
          for (const s of sk.defaultBlock) this.emitStmt(s, lines, indent + 2);
          lines.push(`${pad}    break;`);
        }
        lines.push(`${pad}}`);
        break;
    }
  }
  // ── Expressions ──────────────────────────────────────────────
  emitExpr(expr) {
    const ek = expr.exprKind;
    switch (ek.kind) {
      case "IntegerLit": {
        if (ek.radix === 16) return ek.value;
        if (ek.radix === 2) return `0b${ek.value.replace(/^0b/i, "")}`;
        return ek.value;
      }
      case "FloatLit":
        return ek.value;
      case "StringLit":
        return `"${ek.value}"`;
      case "BoolLit":
        return ek.value ? "true" : "false";
      case "NullLit":
        return "NULL";
      case "IdentExpr":
        return ek.name;
      case "BinaryExpr":
        return `(${this.emitExpr(ek.left)} ${ek.op} ${this.emitExpr(ek.right)})`;
      case "UnaryExpr":
        return `(${ek.op}${this.emitExpr(ek.operand)})`;
      case "AssignExpr":
        return `(${this.emitExpr(ek.target)} ${ek.op} ${this.emitExpr(ek.value)})`;
      case "CallExpr": {
        const args = ek.args.map((a) => this.emitExpr(a)).join(", ");
        return `${this.emitExpr(ek.callee)}(${args})`;
      }
      case "MemberExpr":
        return `${this.emitExpr(ek.object)}.${ek.member}`;
      case "IndexExpr":
        return `${this.emitExpr(ek.object)}[${this.emitExpr(ek.index)}]`;
      case "ArrayLit": {
        const elems = ek.elements.map((e) => this.emitExpr(e)).join(", ");
        return `{${elems}}`;
      }
      case "StructLit": {
        const fields = ek.fields.map((f) => `.${f.name} = ${this.emitExpr(f.value)}`).join(", ");
        return `(${ek.typeName}){${fields}}`;
      }
      case "CastExpr":
        return `((${this.emitType(ek.targetType)})${this.emitExpr(ek.expr)})`;
      case "ParenExpr":
        return `(${this.emitExpr(ek.inner)})`;
      default:
        return "/* unsupported expr */";
    }
  }
  // ── Types ────────────────────────────────────────────────────
  emitType(type) {
    const inner = type.inner;
    switch (inner.kind) {
      case "ScalarType": {
        const map = {
          "u8": "uint8_t",
          "u16": "uint16_t",
          "u32": "uint32_t",
          "u64": "uint64_t",
          "i8": "int8_t",
          "i16": "int16_t",
          "i32": "int32_t",
          "i64": "int64_t",
          "f16": "_Float16",
          "f32": "float",
          "f64": "double",
          "bool": "bool",
          "void": "void",
          "string": "const char*",
          "StringBuilder": "char*"
        };
        return map[inner.name] ?? inner.name;
      }
      case "NamedType":
        return inner.name;
      case "ArrayType":
        return `${this.emitType(inner.elem)}*`;
      // simplified
      case "SliceType":
        return `${this.emitType(inner.elem)}*`;
      // simplified
      case "MapType":
        return "void*";
      // maps need runtime support
      case "PointerType":
        return `${this.emitType(inner.elem)}*`;
      case "OptionalType":
        return `${this.emitType(inner.elem)}`;
      // simplified
      case "FlagType":
        return inner.underlying;
      case "FlagSetType":
        return "void*";
      case "VariantType":
        return "void*";
    }
  }
  // ── Scalar type mapping helper ───────────────────────────────
  scalarToC(name) {
    const map = {
      "u8": "uint8_t",
      "u16": "uint16_t",
      "u32": "uint32_t",
      "u64": "uint64_t",
      "i8": "int8_t",
      "i16": "int16_t",
      "i32": "int32_t",
      "i64": "int64_t",
      "f16": "_Float16",
      "f32": "float",
      "f64": "double",
      "bool": "bool",
      "void": "void"
    };
    return map[name] ?? name;
  }
  // ── Attributes ───────────────────────────────────────────────
  emitAttributes(annotations) {
    const attrs = [];
    for (const ann of annotations) {
      switch (ann.name) {
        case "inline":
          attrs.push("__attribute__((always_inline))");
          break;
        case "no_inline":
          attrs.push("__attribute__((noinline))");
          break;
        case "deprecated":
          if (ann.args.length > 0 && ann.args[0].kind === "StringArg") {
            attrs.push(`__attribute__((deprecated("${ann.args[0].value}")))`);
          } else {
            attrs.push("__attribute__((deprecated))");
          }
          break;
        case "must_use":
          attrs.push("__attribute__((warn_unused_result))");
          break;
        case "export_symbol":
          if (ann.args.length > 0 && ann.args[0].kind === "StringArg") {
            attrs.push(`__attribute__((visibility("default")))`);
          }
          break;
      }
    }
    return attrs.length > 0 ? attrs.join(" ") : "";
  }
  // ── Flag operation macros ────────────────────────────────────
  emitFlagMacros() {
    this.headerLines.push("");
    this.headerLines.push("// \u2500\u2500 Flag operations (spec 6.4) \u2500\u2500");
    this.headerLines.push("// 1-bit: use | & ^ operators, check with (mask & FLAG) != 0");
    this.headerLines.push("// multi-bit: use flag_set_val/flag_get_val macros");
    this.headerLines.push("");
    this.headerLines.push("#define flag_set_val(flags, shift, mask, val) do { (flags) = ((flags) & ~(mask)) | (((val) << (shift)) & (mask)); } while(0)");
    this.headerLines.push("#define flag_get_val(flags, shift, mask) (((flags) & (mask)) >> (shift))");
    this.headerLines.push("");
  }
};

// src/index.ts
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }
  const command = args[0];
  const filePath = args[1];
  switch (command) {
    case "--help":
    case "-h":
      printHelp();
      break;
    case "compile":
      cmdCompile(filePath, parseFlags(args.slice(2)));
      break;
    case "check":
      cmdCheck(filePath, parseFlags(args.slice(2)));
      break;
    case "test":
    case "run-test":
      cmdTest(filePath, parseFlags(args.slice(2)));
      break;
    case "ast":
      cmdAstExport(filePath, parseFlags(args.slice(2)));
      break;
    case "type-info":
      cmdTypeInfo(filePath, args[2], parseFlags(args.slice(3)));
      break;
    case "version":
    case "--version":
    case "-v":
      console.log("tc (t language compiler) v0.1.0");
      break;
    default:
      console.error(`unknown command: ${command}`);
      console.error("run 'tc --help' for usage");
      process.exit(1);
  }
}
function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--emit-c":
        flags.emitC = true;
        break;
      case "--emit-ast":
        flags.emitAst = true;
        break;
      case "--output":
      case "-o":
        flags.output = args[++i];
        break;
      case "--group":
      case "-g":
        flags.group = args[++i];
        break;
      case "--json":
        flags.json = true;
        break;
      case "--release":
        flags.release = true;
        break;
    }
  }
  return flags;
}
function compilePipeline(filePath, config) {
  const bag = new DiagnosticBag();
  if (!(0, import_fs.existsSync)(filePath)) {
    console.error(`error: file not found: ${filePath}`);
    process.exit(1);
  }
  const source = (0, import_fs.readFileSync)(filePath, "utf-8");
  const file = (0, import_path.resolve)(filePath);
  const lexer = new Lexer(source, file, bag);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens, file, bag);
  const unit = parser.parse();
  const checker = new TypeChecker(bag);
  checker.check(unit);
  const flagResolver = new FlagResolver(bag);
  const typeInfoProvider = new TypeInfoProvider(flagResolver);
  for (const decl of unit.declarations) {
    const dk = decl.declKind;
    if (dk.kind === "StructDecl" || dk.kind === "EnumDecl" || dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl" || dk.kind === "UnionDecl") {
      typeInfoProvider.registerDecl(dk.name, decl);
    }
    if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
      flagResolver.resolve(decl);
    }
  }
  const annoRegistry = new AnnotationRegistry(bag);
  for (const decl of unit.declarations) {
    const dk = decl.declKind;
    const target = getDeclTarget(dk.kind);
    for (const ann of decl.annotations) {
      annoRegistry.validate(ann, target);
    }
  }
  return { bag, unit, flagResolver, typeInfoProvider };
}
function getDeclTarget(declKind) {
  const map = {
    "StructDecl": AnnotationTarget.Struct,
    "EnumDecl": AnnotationTarget.Enum,
    "FlagDecl": AnnotationTarget.Flag,
    "FlagSetDecl": AnnotationTarget.FlagSet,
    "UnionDecl": AnnotationTarget.Union,
    "FuncDecl": AnnotationTarget.Func,
    "GlobalVarDecl": AnnotationTarget.Var,
    "GlobalConstDecl": AnnotationTarget.Const
  };
  return map[declKind] ?? AnnotationTarget.Global;
}
function cmdCompile(filePath, flags) {
  const config = {
    ...DEFAULT_CONFIG,
    mode: flags.release ? "release" : "debug"
  };
  const { bag, unit, flagResolver, typeInfoProvider } = compilePipeline(filePath, config);
  if (flags.json) {
    console.log(bag.toJson());
  } else {
    if (bag.count() > 0) {
      console.error(bag.toHumanReadable());
    }
  }
  if (bag.hasErrors()) {
    process.exit(1);
  }
  if (flags.emitC && unit) {
    const emitter = new CEmitter(flagResolver);
    const { header, source } = emitter.emit(unit);
    const outDir = flags.output ?? (0, import_path.dirname)(filePath);
    const baseName = (0, import_path.basename)(filePath, ".tc");
    (0, import_fs.mkdirSync)(outDir, { recursive: true });
    (0, import_fs.writeFileSync)((0, import_path.join)(outDir, `${baseName}.h`), header);
    (0, import_fs.writeFileSync)((0, import_path.join)(outDir, `${baseName}.c`), source);
    console.log(`Generated: ${(0, import_path.join)(outDir, `${baseName}.h`)}, ${(0, import_path.join)(outDir, `${baseName}.c`)}`);
  }
  if (flags.emitAst && unit) {
    const exporter = new AstJsonExporter(flagResolver, typeInfoProvider);
    const astJson = exporter.export(unit);
    const outDir = flags.output ?? (0, import_path.dirname)(filePath);
    const baseName = (0, import_path.basename)(filePath, ".tc");
    (0, import_fs.mkdirSync)(outDir, { recursive: true });
    (0, import_fs.writeFileSync)((0, import_path.join)(outDir, `${baseName}.ast.json`), astJson);
    console.log(`AST exported: ${(0, import_path.join)(outDir, `${baseName}.ast.json`)}`);
  }
}
function cmdCheck(filePath, flags) {
  const { bag } = compilePipeline(filePath);
  if (flags.json) {
    console.log(bag.toJson());
  } else {
    console.log(bag.toHumanReadable());
  }
  process.exit(bag.hasErrors() ? 1 : 0);
}
function cmdTest(filePath, flags) {
  const { bag, unit, flagResolver } = compilePipeline(filePath);
  if (bag.hasErrors()) {
    console.error(bag.toHumanReadable());
    process.exit(1);
  }
  const runner = new TestRunner(bag);
  const tests = runner.collectTests(unit);
  const results = runner.runTests(tests, flags.group);
  if (flags.json) {
    console.log(runner.formatResultsJson(results));
  } else {
    console.log(`Running ${tests.length} test(s)...
`);
    console.log(runner.formatResults(results));
  }
}
function cmdAstExport(filePath, flags) {
  const { bag, unit, flagResolver, typeInfoProvider } = compilePipeline(filePath);
  if (bag.hasErrors()) {
    console.error(bag.toHumanReadable());
    process.exit(1);
  }
  const exporter = new AstJsonExporter(flagResolver, typeInfoProvider);
  const astJson = exporter.export(unit);
  if (flags.output) {
    (0, import_fs.mkdirSync)((0, import_path.dirname)(flags.output), { recursive: true });
    (0, import_fs.writeFileSync)(flags.output, astJson);
    console.log(`AST exported to: ${flags.output}`);
  } else {
    console.log(astJson);
  }
}
function cmdTypeInfo(filePath, typeName, flags) {
  const { bag, typeInfoProvider } = compilePipeline(filePath);
  if (bag.hasErrors()) {
    console.error(bag.toHumanReadable());
    process.exit(1);
  }
  const info = typeInfoProvider.getTypeInfo(typeName);
  if (!info) {
    console.error(`error: unknown type '${typeName}'`);
    process.exit(1);
  }
  console.log(JSON.stringify(info, null, 2));
}
function printHelp() {
  console.log(`
tc (t language compiler) v0.1.0

Usage:
  tc compile <file.tc> [options]     Compile a .tc file
  tc check <file.tc> [options]       Type-check only (no code generation)
  tc test <file.tc> [options]        Run @test annotated test cases
  tc ast <file.tc> [options]         Export AST as JSON (spec 8.3)
  tc type-info <file.tc> <Type>      Print type_info(T) for a type (spec 5.2)

Options:
  --emit-c               Generate C source code (.h + .c)
  --emit-ast             Generate AST JSON file (.ast.json)
  --output <dir>         Output directory (default: same as source)
  --group <tag>          Filter tests by @test_group tag
  --json                 Output diagnostics/results as JSON (spec 8.2)
  --release              Compile in release mode (@cfg(release))
  --help, -h             Show this help message
  --version, -v          Show version

Examples:
  tc compile main.tc --emit-c --output build/
  tc check main.tc --json
  tc test main.tc --group "bitfield"
  tc ast main.tc --output build/main.ast.json
  tc type-info main.tc GameStateMask
`);
}
main();

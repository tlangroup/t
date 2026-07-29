#!/usr/bin/env node
/**
 * t Language - CLI Entry Point
 *
 * The `tc` command-line tool.
 *
 * Usage:
 *   tc compile <file.tc> [--emit-c] [--emit-ast] [--output <dir>]
 *   tc check <file.tc>
 *   tc test <file.tc> [--group <tag>]
 *   tc ast <file.tc> [--output <file>]
 *   tc type-info <file.tc> <TypeName>
 *   tc --help
 *
 * All diagnostics output dual format: human-readable + JSON (spec 8.2).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join, basename, resolve } from "path";
import { Lexer } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import { TypeChecker } from "./types/checker.js";
import { AnnotationRegistry, AnnotationTarget, DEFAULT_CONFIG } from "./annotations/registry.js";
import { TestRunner } from "./annotations/test_runner.js";
import { FlagResolver } from "./flag/bitfield.js";
import { TypeInfoProvider } from "./comptime/type_info.js";
import { AstJsonExporter } from "./codegen/ast_export.js";
import { CEmitter } from "./codegen/emitter.js";
import { DiagnosticBag } from "./diagnostics/diagnostic.js";
// ─── CLI ─────────────────────────────────────────────────────────
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
    // Read source
    if (!existsSync(filePath)) {
        console.error(`error: file not found: ${filePath}`);
        process.exit(1);
    }
    const source = readFileSync(filePath, "utf-8");
    const file = resolve(filePath);
    // Lex
    const lexer = new Lexer(source, file, bag);
    const tokens = lexer.tokenize();
    // Parse
    const parser = new Parser(tokens, file, bag);
    const unit = parser.parse();
    // Type check
    const checker = new TypeChecker(bag);
    checker.check(unit);
    // Flag resolution
    const flagResolver = new FlagResolver(bag);
    const typeInfoProvider = new TypeInfoProvider(flagResolver);
    // Register types and resolve flags
    for (const decl of unit.declarations) {
        const dk = decl.declKind;
        if (dk.kind === "StructDecl" || dk.kind === "EnumDecl" ||
            dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl" ||
            dk.kind === "UnionDecl") {
            typeInfoProvider.registerDecl(dk.name, decl);
        }
        if (dk.kind === "FlagDecl" || dk.kind === "FlagSetDecl") {
            flagResolver.resolve(decl);
        }
    }
    // Annotation validation
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
        "GlobalConstDecl": AnnotationTarget.Const,
    };
    return map[declKind] ?? AnnotationTarget.Global;
}
// ─── Commands ────────────────────────────────────────────────────
function cmdCompile(filePath, flags) {
    const config = {
        ...DEFAULT_CONFIG,
        mode: flags.release ? "release" : "debug",
    };
    const { bag, unit, flagResolver, typeInfoProvider } = compilePipeline(filePath, config);
    // Output diagnostics
    if (flags.json) {
        console.log(bag.toJson());
    }
    else {
        if (bag.count() > 0) {
            console.error(bag.toHumanReadable());
        }
    }
    if (bag.hasErrors()) {
        process.exit(1);
    }
    // Emit C code
    if (flags.emitC && unit) {
        const emitter = new CEmitter(flagResolver);
        const { header, source } = emitter.emit(unit);
        const outDir = flags.output ?? dirname(filePath);
        const baseName = basename(filePath, ".tc");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, `${baseName}.h`), header);
        writeFileSync(join(outDir, `${baseName}.c`), source);
        console.log(`Generated: ${join(outDir, `${baseName}.h`)}, ${join(outDir, `${baseName}.c`)}`);
    }
    // Emit AST JSON
    if (flags.emitAst && unit) {
        const exporter = new AstJsonExporter(flagResolver, typeInfoProvider);
        const astJson = exporter.export(unit);
        const outDir = flags.output ?? dirname(filePath);
        const baseName = basename(filePath, ".tc");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, `${baseName}.ast.json`), astJson);
        console.log(`AST exported: ${join(outDir, `${baseName}.ast.json`)}`);
    }
}
function cmdCheck(filePath, flags) {
    const { bag } = compilePipeline(filePath);
    if (flags.json) {
        console.log(bag.toJson());
    }
    else {
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
    }
    else {
        console.log(`Running ${tests.length} test(s)...\n`);
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
        mkdirSync(dirname(flags.output), { recursive: true });
        writeFileSync(flags.output, astJson);
        console.log(`AST exported to: ${flags.output}`);
    }
    else {
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
// ─── Help ────────────────────────────────────────────────────────
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
// ─── Entry ───────────────────────────────────────────────────────
main();
//# sourceMappingURL=index.js.map
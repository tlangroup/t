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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { dirname, join, basename, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import { Lexer } from "./lexer/lexer.js";
import { tokenTypeToString } from "./lexer/token.js";
import { Parser } from "./parser/parser.js";
import { TypeChecker } from "./types/checker.js";
import { AnnotationRegistry, AnnotationTarget, BuildConfig, DEFAULT_CONFIG } from "./annotations/registry.js";
import { DeriveProcessor } from "./annotations/derive.js";
import { TestRunner } from "./annotations/test_runner.js";
import { FlagResolver } from "./flag/bitfield.js";
import { TypeInfoProvider } from "./comptime/type_info.js";
import { CtfeEngine } from "./comptime/ctfe.js";
import { AstJsonExporter } from "./codegen/ast_export.js";
import { ParseJsonExporter } from "./codegen/parse_export.js";
import { CEmitter } from "./codegen/emitter.js";
import { DiagnosticBag } from "./diagnostics/diagnostic.js";

// ─── CLI ─────────────────────────────────────────────────────────

function main(): void {
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
        case "build":
            cmdBuild(filePath, parseFlags(args.slice(2)));
            break;
        case "lex":
            cmdLex(filePath, parseFlags(args.slice(2)));
            break;
        case "parse":
            cmdParse(filePath, parseFlags(args.slice(2)));
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

// ─── Flag parsing ────────────────────────────────────────────────

interface CliFlags {
    emitC?: boolean;
    emitAst?: boolean;
    output?: string;
    group?: string;
    json?: boolean;
    release?: boolean;
}

function parseFlags(args: string[]): CliFlags {
    const flags: CliFlags = {};
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--emit-c": flags.emitC = true; break;
            case "--emit-ast": flags.emitAst = true; break;
            case "--output": case "-o": flags.output = args[++i]; break;
            case "--group": case "-g": flags.group = args[++i]; break;
            case "--json": flags.json = true; break;
            case "--release": flags.release = true; break;
        }
    }
    return flags;
}

// ─── Shared pipeline ─────────────────────────────────────────────

interface CompilationResult {
    bag: DiagnosticBag;
    unit: any | null;
    flagResolver: FlagResolver;
    typeInfoProvider: TypeInfoProvider;
}

function compilePipeline(filePath: string, config?: BuildConfig): CompilationResult {
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

function getDeclTarget(declKind: string): AnnotationTargetType {
    const map: Record<string, AnnotationTargetType> = {
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

type AnnotationTargetType = typeof AnnotationTarget[keyof typeof AnnotationTarget];

// ─── Commands ────────────────────────────────────────────────────

function cmdCompile(filePath: string, flags: CliFlags): void {
    const config: BuildConfig = {
        ...DEFAULT_CONFIG,
        mode: flags.release ? "release" : "debug",
    };
    const { bag, unit, flagResolver, typeInfoProvider } = compilePipeline(filePath, config);

    // Output diagnostics
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

// ─── build: .tc → C → exe ────────────────────────────────────────

interface CCompiler {
    kind: "gcc" | "msvc";
    path: string;
    env?: Record<string, string>;  // extra env (MSVC INCLUDE/LIB)
}

/** Locate the newest MSVC toolchain (cl.exe) + Windows SDK, if installed. */
function findMsvc(): CCompiler | null {
    const vsRoots = [
        "C:\\Program Files\\Microsoft Visual Studio\\2022",
        "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019",
    ];
    for (const vsRoot of vsRoots) {
        if (!existsSync(vsRoot)) continue;
        for (const edition of ["Enterprise", "Professional", "Community", "BuildTools"]) {
            const msvcDir = join(vsRoot, edition, "VC", "Tools", "MSVC");
            if (!existsSync(msvcDir)) continue;
            const versions = readdirSync(msvcDir).sort().reverse();
            for (const ver of versions) {
                const cl = join(msvcDir, ver, "bin", "Hostx64", "x64", "cl.exe");
                if (!existsSync(cl)) continue;
                // Windows SDK
                const kits = "C:\\Program Files (x86)\\Windows Kits\\10";
                const incRoot = join(kits, "include");
                if (!existsSync(incRoot)) continue;
                const kitVers = readdirSync(incRoot).filter(v => /^10\./.test(v)).sort().reverse();
                if (kitVers.length === 0) continue;
                const kitVer = kitVers[0];
                const msvcBase = join(msvcDir, ver);
                return {
                    kind: "msvc",
                    path: cl,
                    env: {
                        INCLUDE: [
                            join(msvcBase, "include"),
                            join(kits, "include", kitVer, "ucrt"),
                            join(kits, "include", kitVer, "um"),
                            join(kits, "include", kitVer, "shared"),
                        ].join(";"),
                        LIB: [
                            join(msvcBase, "lib", "x64"),
                            join(kits, "lib", kitVer, "ucrt", "x64"),
                            join(kits, "lib", kitVer, "um", "x64"),
                        ].join(";"),
                    },
                };
            }
        }
    }
    return null;
}

/** Locate a usable C compiler. Priority: $TC_CC > gcc/mingw > MSVC > PATH. */
function findCCompiler(): CCompiler | null {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const gccCandidates = [
        process.env.TC_CC,
        join(home, "choco", "lib", "mingw", "tools", "install", "mingw64", "bin", "gcc.exe"),
        join(home, "choco", "bin", "gcc.exe"),
        "C:\\ProgramData\\chocolatey\\lib\\mingw\\tools\\install\\mingw64\\bin\\gcc.exe",
        "C:\\ProgramData\\chocolatey\\bin\\gcc.exe",
        "C:\\mingw64\\bin\\gcc.exe",
    ].filter((p): p is string => !!p);

    for (const p of gccCandidates) {
        if (existsSync(p)) return { kind: "gcc", path: p };
    }
    const msvc = findMsvc();
    if (msvc) return msvc;
    // Fall back to PATH lookup
    for (const name of ["gcc", "clang", "cc"]) {
        try {
            execSync(`${name} --version`, { stdio: "pipe" });
            return { kind: "gcc", path: name };
        } catch { /* not found, keep looking */ }
    }
    return null;
}

/** Project root = directory containing this compiled file's package (src/.. or dist/..). */
function projectRoot(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "..");
}

function cmdBuild(filePath: string, flags: CliFlags): void {
    const config: BuildConfig = {
        ...DEFAULT_CONFIG,
        mode: flags.release ? "release" : "debug",
    };
    const { bag, unit, flagResolver } = compilePipeline(filePath, config);

    if (bag.count() > 0) {
        console.error(bag.toHumanReadable());
    }
    if (bag.hasErrors()) {
        process.exit(1);
    }

    // 1. Emit C
    const emitter = new CEmitter(flagResolver);
    const { header, source } = emitter.emit(unit);

    const outDir = flags.output ?? join(dirname(filePath), "build");
    const baseName = basename(filePath, ".tc");
    mkdirSync(outDir, { recursive: true });

    const hPath = join(outDir, `${baseName}.h`);
    const cPath = join(outDir, `${baseName}.c`);
    writeFileSync(hPath, header);
    writeFileSync(cPath, source);

    // 2. Locate C compiler + runtime
    const cc = findCCompiler();
    if (!cc) {
        console.error("error: no C compiler found (tried $TC_CC, gcc, clang, cc)");
        console.error("hint: install mingw (e.g. 'choco install mingw') or set TC_CC=<path-to-gcc>");
        process.exit(1);
    }

    const runtimeDir = join(projectRoot(), "runtime");
    const runtimeC = join(runtimeDir, "t_runtime.c");
    if (!existsSync(runtimeC)) {
        console.error(`error: runtime not found: ${runtimeC}`);
        process.exit(1);
    }

    // 3. Compile & link
    const exePath = join(outDir, `${baseName}${process.platform === "win32" ? ".exe" : ""}`);
    let cmd: string;
    let env = process.env;
    if (cc.kind === "msvc") {
        const opt = flags.release ? "/O2" : "/Od";
        cmd = `"${cc.path}" /nologo /std:c11 /utf-8 ${opt} /I"${runtimeDir}" /I"${outDir}" "${cPath}" "${runtimeC}" /Fo"${outDir}\\\\" /Fe"${exePath}"`;
        env = { ...process.env, ...cc.env };
    } else {
        const opt = flags.release ? "-O2" : "-O0 -g";
        cmd = `"${cc.path}" -std=c11 ${opt} -I"${runtimeDir}" -I"${outDir}" "${cPath}" "${runtimeC}" -o "${exePath}"`;
    }
    try {
        execSync(cmd, { stdio: ["pipe", "pipe", "inherit"], env });
    } catch {
        console.error(`error: C compilation failed (command: ${cmd})`);
        process.exit(1);
    }

    console.log(`Built: ${exePath}`);
}

// ─── lex: export token stream (for difftest) ─────────────────────

/**
 * tc parse <file.tc> — 输出纯语法层 AST JSON（紧凑格式）。
 * 这是 src parser (M6) 的字节级对拍基准：只依赖 token 流，
 * 不含任何类型检查 / derive / flag 布局等语义信息。
 */
function cmdParse(filePath: string, flags: CliFlags): void {
    if (!filePath || !existsSync(filePath)) {
        console.error(`error: file not found: ${filePath}`);
        process.exit(1);
    }
    const source = readFileSync(filePath, "utf-8");
    const file = resolve(filePath);
    const bag = new DiagnosticBag();

    const lexer = new Lexer(source, file, bag);
    const tokens = lexer.tokenize();
    if (bag.hasErrors()) {
        console.error(bag.toHumanReadable());
        process.exit(1);
    }

    const parser = new Parser(tokens, file, bag);
    const unit = parser.parse();
    if (bag.hasErrors()) {
        console.error(bag.toHumanReadable());
        process.exit(1);
    }

    const text = new ParseJsonExporter().export(unit);
    if (flags.output) {
        mkdirSync(dirname(flags.output), { recursive: true });
        writeFileSync(flags.output, text);
    } else {
        console.log(text);
    }
}

function cmdLex(filePath: string, flags: CliFlags): void {
    if (!filePath || !existsSync(filePath)) {
        console.error(`error: file not found: ${filePath}`);
        process.exit(1);
    }
    const source = readFileSync(filePath, "utf-8");
    const file = resolve(filePath);
    const bag = new DiagnosticBag();

    const lexer = new Lexer(source, file, bag);
    const tokens = lexer.tokenize();

    if (bag.hasErrors()) {
        console.error(bag.toHumanReadable());
        process.exit(1);
    }

    const out = tokens.map(t => ({
        type: tokenTypeToString(t.type),
        value: t.value,
        line: t.line,
        col: t.col,
    }));

    const text = JSON.stringify(out, null, flags.json ? 0 : 2);
    if (flags.output) {
        mkdirSync(dirname(flags.output), { recursive: true });
        writeFileSync(flags.output, text);
        console.log(`Tokens exported to: ${flags.output}`);
    } else {
        console.log(text);
    }
}

function cmdCheck(filePath: string, flags: CliFlags): void {
    const { bag } = compilePipeline(filePath);

    if (flags.json) {
        console.log(bag.toJson());
    } else {
        console.log(bag.toHumanReadable());
    }

    process.exit(bag.hasErrors() ? 1 : 0);
}

function cmdTest(filePath: string, flags: CliFlags): void {
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
        console.log(`Running ${tests.length} test(s)...\n`);
        console.log(runner.formatResults(results));
    }
}

function cmdAstExport(filePath: string, flags: CliFlags): void {
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
    } else {
        console.log(astJson);
    }
}

function cmdTypeInfo(filePath: string, typeName: string, flags: CliFlags): void {
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

function printHelp(): void {
    console.log(`
tc (t language compiler) v0.1.0

Usage:
  tc compile <file.tc> [options]     Compile a .tc file
  tc build <file.tc> [options]       Compile .tc → C → native executable
  tc lex <file.tc> [options]         Export token stream as JSON
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

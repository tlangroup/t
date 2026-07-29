/**
 * t Language - Test Runner
 *
 * Implements spec section 4.2: test annotation system.
 *
 * Collects all @test annotated functions and runs them:
 * - @test: marks test case
 * - @test_skip: skip this test
 * - @test_only: only in test compilation mode
 * - @expect_fail: expect assertion failure
 * - @test_group("tag"): group for filtering
 *
 * Built-in assertions (spec 4.2):
 * - assert_eq(actual, expected, message)
 * - assert_true(condition, message)
 * - assert_false(condition)
 * - assert_panic(expr, expected_error)
 */
import { CompilationUnit, DeclNode } from "../ast/nodes.js";
import { DiagnosticBag } from "../diagnostics/diagnostic.js";
export interface TestCase {
    name: string;
    group: string | null;
    skip: boolean;
    expectFail: boolean;
    testOnly: boolean;
    funcDecl: DeclNode;
}
export interface TestResult {
    name: string;
    group: string | null;
    passed: boolean;
    skipped: boolean;
    message: string;
    duration: number;
}
export declare class TestRunner {
    private bag;
    constructor(bag: DiagnosticBag);
    /**
     * Collect all test cases from a compilation unit (spec 4.2).
     */
    collectTests(unit: CompilationUnit): TestCase[];
    /**
     * Run collected test cases.
     * In a full implementation, this would execute the compiled code.
     * Here we provide the framework and report structure.
     */
    runTests(tests: TestCase[], groupFilter?: string): TestResult[];
    /**
     * Format test results as human-readable text.
     */
    formatResults(results: TestResult[]): string;
    /**
     * Format test results as JSON for AI Agent consumption (spec 8.2).
     */
    formatResultsJson(results: TestResult[]): string;
}
//# sourceMappingURL=test_runner.d.ts.map
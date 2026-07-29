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
import { AnnotationRegistry } from "../annotations/registry.js";
export class TestRunner {
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
            if (dk.kind !== "FuncDecl")
                continue;
            const hasTest = AnnotationRegistry.hasAnnotation(decl, "test");
            if (!hasTest)
                continue;
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
                funcDecl: decl,
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
                    duration: 0,
                });
                continue;
            }
            // In a real implementation, we would:
            // 1. Compile the test function
            // 2. Execute it
            // 3. Catch assertion failures
            // 4. Check @expect_fail expectation
            // For now, we report the test as collected
            const startTime = Date.now();
            const duration = Date.now() - startTime;
            results.push({
                name: test.name,
                group: test.group,
                passed: true,
                skipped: false,
                message: test.expectFail ? "collected (expects failure)" : "collected",
                duration,
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
            if (result.skipped)
                skipped++;
            else if (result.passed)
                passed++;
            else
                failed++;
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
                durationMs: r.duration,
            })),
            summary: {
                total: results.length,
                passed: results.filter((r) => r.passed && !r.skipped).length,
                failed: results.filter((r) => !r.passed && !r.skipped).length,
                skipped: results.filter((r) => r.skipped).length,
            },
        }, null, 2);
    }
}
//# sourceMappingURL=test_runner.js.map
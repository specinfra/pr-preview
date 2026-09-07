"use strict";
const assert = require("assert"),
    createLogger = require("../lib/logger");

function capture(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(a => typeof a == "string" ? a : JSON.stringify(a)).join(" "));
    try { fn(); } finally { console.log = original; }
    return lines;
}

const JOB = { id: "acme/spec/7", url: "https://github.com/acme/spec/pull/7" };

suite("Logger", function() {

    test("a successful update is one line", function() {
        const { logResult } = createLogger({});
        const lines = capture(() => logResult({ job: JOB, updated: true }, "synchronize"));
        assert.deepEqual(lines, ["https://github.com/acme/spec/pull/7 (synchronize): updated"]);
    });

    test("a skipped update says why", function() {
        const { logResult } = createLogger({});
        const lines = capture(() => logResult({ job: JOB, skipReason: "PR is already merged" }, "opened"));
        assert.deepEqual(lines, ["https://github.com/acme/spec/pull/7 (opened): no update (PR is already merged)"]);
    });

    test("a dry run and a body edited during the build are both mentioned", function() {
        const { logResult } = createLogger({});
        const lines = capture(() => logResult({ job: JOB, updated: "Not a live run!", bodyChanged: true }, "edited"));
        assert.deepEqual(lines, ["https://github.com/acme/spec/pull/7 (edited): not a live run (would have updated; body edited during build)"]);
    });

    test("a dismissed job is one line naming the reason", function() {
        const { logResult } = createLogger({});
        const error = new Error("Not Found");
        error.noConfig = true;
        error.dismissalReason = "no .pr-preview.json, repo hasn't opted into previews";
        const lines = capture(() => logResult({ job: JOB, error }, "opened"));
        assert.deepEqual(lines, ["https://github.com/acme/spec/pull/7 (opened): dismissed (no .pr-preview.json, repo hasn't opted into previews)"]);
    });

    test("a real error logs its detail, stack only when asked", function() {
        const error = new Error("boom");
        error.data = { request_url: "https://example.test" };
        const reportingError = new Error("GitHub is down");
        const result = { job: JOB, error, errorReported: false, errorReportingError: reportingError };

        const quiet = capture(() => createLogger({}).logResult(result, "opened"));
        assert.deepEqual(quiet, [
            "https://github.com/acme/spec/pull/7 (opened): failed (Error: boom)",
            "    Additionally, reporting it on the PR failed:",
            "        Error: GitHub is down",
            JSON.stringify(error.data)
        ]);

        const verbose = capture(() => createLogger({ displayStackTraces: true }).logResult(result, "opened"));
        assert.equal(verbose.length, quiet.length + 2, "both stacks should be logged");
        assert(verbose[3].startsWith("Error: GitHub is down\n"));
        assert(verbose[verbose.length - 1].startsWith("Error: boom\n"));
    });

    test("an error withheld from the PR says why", function() {
        const { logResult } = createLogger({});
        const result = { job: JOB, error: new Error("boom"), errorNotReportedReason: "not a live run" };
        const lines = capture(() => logResult(result, "opened"));
        assert.deepEqual(lines, [
            "https://github.com/acme/spec/pull/7 (opened): failed (Error: boom)",
            "    Not reported on the PR: not a live run."
        ]);
    });

    test("logError indents the headline", function() {
        const lines = capture(() => createLogger({}).logError(new TypeError("bad"), "  "));
        assert.deepEqual(lines, ["  TypeError: bad"]);
    });
});

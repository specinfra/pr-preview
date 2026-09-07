"use strict";
const assert = require("assert"),
    memoryLogger = require("./support/memory-logger"),
    { createLogger, configFromEnv, jobLogger, logStatus, logResult, statusMessage } = require("../lib/logger");

const JOB = { id: "acme/spec/7", url: "https://github.com/acme/spec/pull/7", action: "synchronize" };

function failure() {
    const error = new Error("boom");
    error.data = { request_url: "https://example.test" };
    const reportingError = new Error("GitHub is down");
    return { job: JOB, error, errorReported: false, errorReportingError: reportingError };
}

// The record with its noise (time, pid, hostname) left out.
function fields(record) {
    const { time, pid, hostname, ...rest } = record;
    return rest;
}

suite("Logger", function() {

    test("a job logger binds the PR and the action", function() {
        const log = memoryLogger();
        jobLogger(log, JOB).info("hello");
        jobLogger(log, { id: "acme/spec/8" }).info("hello");
        const [withAction, withoutAction] = log.records();
        assert.equal(withAction.pr, "https://github.com/acme/spec/pull/7");
        assert.equal(withAction.action, "synchronize");
        assert.equal(withoutAction.pr, "https://github.com/acme/spec/pull/8", "derived from the id");
        assert.equal(withoutAction.action, undefined);
    });

    test("statusMessage is the shape of every job message", function() {
        assert.equal(statusMessage("updated"), "updated");
        assert.equal(statusMessage("no update", ["PR is already merged"]), "no update (PR is already merged)");
        assert.equal(statusMessage("updated", [null, "body edited during build"]), "updated (body edited during build)");
    });

    test("logStatus puts the status and reason in fields and in the message", function() {
        const log = memoryLogger();
        logStatus(jobLogger(log, JOB), "info", "skipped", "already queued");
        logStatus(log, "warn", "ignored", undefined, { event: "ping" });
        const [skipped, ignored] = log.records().map(fields);
        assert.deepEqual(skipped, {
            level: 30, pr: JOB.url, action: "synchronize",
            status: "skipped", reason: "already queued", msg: "skipped (already queued)"
        });
        assert.deepEqual(ignored, { level: 40, status: "ignored", event: "ping", msg: "ignored" });
    });

    suite("logResult", function() {

        test("a successful update is one info record", function() {
            const log = memoryLogger();
            logResult(jobLogger(log, JOB), { job: JOB, updated: true });
            const [record] = log.records();
            assert.equal(record.level, 30);
            assert.equal(record.status, "updated");
            assert.equal(record.msg, "updated");
            assert.equal(record.reason, undefined);
        });

        test("a skipped update says why", function() {
            const log = memoryLogger();
            logResult(log, { job: JOB, skipReason: "PR is already merged" });
            const [record] = log.records();
            assert.equal(record.status, "no update");
            assert.equal(record.reason, "PR is already merged");
            assert.equal(record.msg, "no update (PR is already merged)");
        });

        test("a dry run and a body edited during the build are both mentioned", function() {
            const log = memoryLogger();
            logResult(log, { job: JOB, updated: "Not a live run!", bodyChanged: true });
            const [record] = log.records();
            assert.equal(record.status, "not a live run");
            assert.equal(record.reason, "would have updated");
            assert.equal(record.bodyChanged, true);
            assert.equal(record.msg, "not a live run (would have updated; body edited during build)");
        });

        test("a dismissed job is a warning naming the reason, with no error attached", function() {
            const log = memoryLogger();
            const error = new Error("Not Found");
            error.noConfig = true;
            error.dismissalReason = "no .pr-preview.json, repo hasn't opted into previews";
            logResult(log, { job: JOB, error });
            const [record] = log.records();
            assert.equal(record.level, 40);
            assert.equal(record.status, "dismissed");
            assert.equal(record.reason, "no .pr-preview.json, repo hasn't opted into previews");
            assert.equal(record.msg, "dismissed (no .pr-preview.json, repo hasn't opted into previews)");
            assert.equal(record.err, undefined);
        });

        test("a real error is an error record carrying the error, its data and the reporting failure", function() {
            const log = memoryLogger();
            logResult(log, failure());
            const [record] = log.records();
            assert.equal(record.level, 50);
            assert.equal(record.status, "failed");
            assert.equal(record.msg, "failed");
            assert.deepEqual(record.err, { type: "Error", message: "boom", data: { request_url: "https://example.test" } });
            assert.deepEqual(record.reportingError, { type: "Error", message: "GitHub is down" });
            assert.equal(record.notReported, undefined);
        });

        test("an error withheld from the PR says why", function() {
            const log = memoryLogger();
            logResult(log, { job: JOB, error: new Error("boom"), errorNotReportedReason: "not a live run" });
            const [record] = log.records();
            assert.equal(record.notReported, "not a live run");
            assert.deepEqual(record.err, { type: "Error", message: "boom" });
        });

        test("stacks are only included when asked for", function() {
            const log = memoryLogger({ displayStackTraces: true });
            logResult(log, failure());
            const [record] = log.records();
            assert(record.err.stack.startsWith("Error: boom\n"));
            assert(record.reportingError.stack.startsWith("Error: GitHub is down\n"));
        });
    });

    test("debug is off by default and the level is configurable", function() {
        const quiet = memoryLogger();
        quiet.debug("chatter");
        quiet.info("outcome");
        assert.deepEqual(quiet.messages(), ["outcome"]);

        const verbose = memoryLogger({ logLevel: "debug" });
        verbose.debug("chatter");
        assert.deepEqual(verbose.messages(), ["chatter"]);

        const silent = createLogger({ logLevel: "silent" });
        silent.error("nothing");
    });

    test("configFromEnv reads the logging variables", function() {
        assert.deepEqual(configFromEnv({}),
            { logFormat: undefined, logLevel: undefined, displayStackTraces: false });
        assert.deepEqual(configFromEnv({ LOG_FORMAT: "json", LOG_LEVEL: "debug", DISPLAY_STACK_TRACES: "yes" }),
            { logFormat: "json", logLevel: "debug", displayStackTraces: true });
    });

    suite("pretty printing (the default)", function() {
        const pretty = config => memoryLogger(Object.assign({ logFormat: "pretty" }, config));
        // No timestamp (the terminal is live and a log stream stamps lines
        // itself) and no name: the process is the whole app.
        const LINE = /^(DEBUG|INFO|WARN|ERROR): (.*)$/;
        const body = line => {
            const match = LINE.exec(line);
            assert(match, line);
            return `${match[1]}: ${match[2]}`;
        };

        test("a job line is the PR, the action and the message, with nothing repeated under it", function() {
            const log = pretty();
            logResult(jobLogger(log, JOB), { job: JOB, updated: true, bodyChanged: true });
            logStatus(jobLogger(log, { id: "acme/spec/8" }), "info", "skipped", "already queued");
            assert.deepEqual(log.lines().map(body), [
                "INFO: https://github.com/acme/spec/pull/7 (synchronize): updated (body edited during build)",
                "INFO: https://github.com/acme/spec/pull/8: skipped (already queued)"
            ]);
        });

        test("a module line is prefixed with the module", function() {
            const log = pretty({ logLevel: "debug" });
            log.child({ module: "s3" }).debug({ key: "k", url: "https://example.test" }, "Found k at https://example.test.");
            assert.deepEqual(log.lines().map(body), ["DEBUG: s3: Found k at https://example.test."]);
        });

        test("error detail is indented under the line, the error first", function() {
            const log = pretty();
            logResult(jobLogger(log, JOB), Object.assign(failure(), { errorNotReportedReason: "not a live run" }));
            const [head, ...detail] = log.lines();
            assert.equal(body(head), "ERROR: https://github.com/acme/spec/pull/7 (synchronize): failed");
            assert.deepEqual(detail, [
                "    err: Error: boom",
                "        data: {",
                '          "request_url": "https://example.test"',
                "        }",
                '    notReported: "not a live run"',
                "    reportingError: Error: GitHub is down"
            ]);
        });

        test("the stack replaces the headline of the error when asked for", function() {
            const log = pretty({ displayStackTraces: true });
            log.error({ err: new TypeError("bad") }, "/config: request failed");
            const [head, first, second] = log.lines();
            assert.equal(body(head), "ERROR: /config: request failed");
            assert.equal(first, "    err: TypeError: bad");
            assert(/^        at /.test(second), second);
        });
    });
});

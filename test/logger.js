"use strict";
const assert = require("assert"),
    { Writable } = require("stream"),
    createLogger = require("../lib/logger");

// A logger writing to memory. `records()` parses what it wrote as JSON, so
// tests can look at the fields; `text()` gives the raw output.
function memoryLogger(config) {
    let out = "";
    const destination = new Writable({ write(chunk, encoding, cb) { out += chunk; cb(); } });
    const logger = createLogger(Object.assign({ destination, colorize: false }, config));
    logger.text = () => out;
    logger.lines = () => out.split("\n").filter(Boolean);
    logger.records = () => logger.lines().map(line => JSON.parse(line));
    logger.messages = () => logger.records().map(r => r.msg);
    return logger;
}

const json = config => memoryLogger(Object.assign({ logFormat: "json" }, config));

const JOB = { id: "acme/spec/7", url: "https://github.com/acme/spec/pull/7" };

function failure() {
    const error = new Error("boom");
    error.data = { request_url: "https://example.test" };
    const reportingError = new Error("GitHub is down");
    return { job: JOB, error, errorReported: false, errorReportingError: reportingError };
}

suite("Logger", function() {

    test("a successful update is one info line", function() {
        const logger = json();
        logger.logResult({ job: JOB, updated: true }, "synchronize");
        assert.deepEqual(logger.messages(), ["https://github.com/acme/spec/pull/7 (synchronize): updated"]);
        assert.equal(logger.records()[0].level, 30);
    });

    test("a skipped update says why", function() {
        const logger = json();
        logger.logResult({ job: JOB, skipReason: "PR is already merged" }, "opened");
        assert.deepEqual(logger.messages(), ["https://github.com/acme/spec/pull/7 (opened): no update (PR is already merged)"]);
    });

    test("a dry run and a body edited during the build are both mentioned", function() {
        const logger = json();
        logger.logResult({ job: JOB, updated: "Not a live run!", bodyChanged: true }, "edited");
        assert.deepEqual(logger.messages(), ["https://github.com/acme/spec/pull/7 (edited): not a live run (would have updated; body edited during build)"]);
    });

    test("a job without a URL is named by its id", function() {
        const logger = json();
        logger.logResult({ job: { id: "acme/spec/8" }, updated: true }, "startup-queue");
        assert.deepEqual(logger.messages(), ["https://github.com/acme/spec/pull/8 (startup-queue): updated"]);
    });

    test("a dismissed job is one info line naming the reason, with no error attached", function() {
        const logger = json();
        const error = new Error("Not Found");
        error.noConfig = true;
        error.dismissalReason = "no .pr-preview.json, repo hasn't opted into previews";
        logger.logResult({ job: JOB, error }, "opened");
        const [record] = logger.records();
        assert.equal(record.msg, "https://github.com/acme/spec/pull/7 (opened): dismissed (no .pr-preview.json, repo hasn't opted into previews)");
        assert.equal(record.level, 30);
        assert.equal(record.err, undefined);
    });

    test("a real error is an error record carrying the error, its data and the reporting failure", function() {
        const logger = json();
        logger.logResult(failure(), "opened");
        const [record] = logger.records();
        assert.equal(record.level, 50);
        assert.equal(record.msg, "https://github.com/acme/spec/pull/7 (opened): failed (Error: boom)");
        assert.deepEqual(record.err, { type: "Error", message: "boom", data: { request_url: "https://example.test" } });
        assert.deepEqual(record.reportingError, { type: "Error", message: "GitHub is down" });
        assert.equal(record.notReportedReason, undefined);
    });

    test("stacks are only included when asked for", function() {
        const logger = json({ displayStackTraces: true });
        logger.logResult(failure(), "opened");
        const [record] = logger.records();
        assert(record.err.stack.startsWith("Error: boom\n"));
        assert(record.reportingError.stack.startsWith("Error: GitHub is down\n"));
    });

    test("an error withheld from the PR says why", function() {
        const logger = json();
        logger.logResult({ job: JOB, error: new Error("boom"), errorNotReportedReason: "not a live run" }, "opened");
        const [record] = logger.records();
        assert.equal(record.msg, "https://github.com/acme/spec/pull/7 (opened): failed (Error: boom)");
        assert.equal(record.notReportedReason, "not a live run");
        assert.deepEqual(record.err, { type: "Error", message: "boom" });
    });

    test("logError heads the record with its context and the error", function() {
        const logger = json();
        const error = new TypeError("bad");
        error.data = { errors: [1] };
        logger.logError(error, "/config: request failed");
        logger.logError(new TypeError("bad"));
        const [withContext, bare] = logger.records();
        assert.equal(withContext.msg, "/config: request failed (TypeError: bad)");
        assert.equal(withContext.level, 50);
        assert.deepEqual(withContext.err, { type: "TypeError", message: "bad", data: { errors: [1] } });
        assert.equal(bare.msg, "TypeError: bad");
    });

    test("log formats its arguments like console.log", function() {
        const logger = json();
        logger.log("Express server listening on port %d in %s mode", 5000, "test");
        logger.log("App started in", "12ms.");
        assert.deepEqual(logger.messages(), [
            "Express server listening on port 5000 in test mode",
            "App started in 12ms."
        ]);
    });

    test("the level is configurable", function() {
        const logger = json({ logLevel: "error" });
        logger.log("routine");
        logger.logError(new Error("boom"));
        assert.deepEqual(logger.messages(), ["Error: boom"]);
    });

    test("configFromEnv reads the logging variables", function() {
        assert.deepEqual(createLogger.configFromEnv({}),
            { logFormat: undefined, logLevel: undefined, displayStackTraces: false });
        assert.deepEqual(createLogger.configFromEnv({ LOG_FORMAT: "json", LOG_LEVEL: "debug", DISPLAY_STACK_TRACES: "yes" }),
            { logFormat: "json", logLevel: "debug", displayStackTraces: true });
    });

    suite("pretty printing (the default)", function() {
        const LINE = /^\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d{4}\] (INFO|ERROR): (.*)$/;

        test("a line is a timestamp, the level and the message", function() {
            const logger = memoryLogger();
            logger.logResult({ job: JOB, updated: true }, "synchronize");
            const [line] = logger.lines();
            const match = LINE.exec(line);
            assert(match, line);
            assert.equal(match[1], "INFO");
            assert.equal(match[2], "https://github.com/acme/spec/pull/7 (synchronize): updated");
        });

        test("error detail is indented under the line, the error first", function() {
            const logger = memoryLogger();
            logger.logResult(Object.assign(failure(), { errorNotReportedReason: "not a live run" }), "opened");
            const [head, ...detail] = logger.lines();
            assert(LINE.test(head) && head.endsWith("ERROR: https://github.com/acme/spec/pull/7 (opened): failed (Error: boom)"), head);
            assert.deepEqual(detail, [
                "    err: Error: boom",
                "        data: {",
                '          "request_url": "https://example.test"',
                "        }",
                '    notReportedReason: "not a live run"',
                "    reportingError: Error: GitHub is down"
            ]);
        });

        test("the stack replaces the headline of the error when asked for", function() {
            const logger = memoryLogger({ displayStackTraces: true });
            logger.logError(new TypeError("bad"), "/config: request failed");
            const [head, first, second] = logger.lines();
            assert(head.endsWith("ERROR: /config: request failed (TypeError: bad)"), head);
            assert.equal(first, "    err: TypeError: bad");
            assert(/^        at /.test(second), second);
        });

        test("an error with nothing to add to its line is not repeated under it", function() {
            const logger = memoryLogger();
            logger.logError(new TypeError("bad"), "/config: request failed");
            logger.logResult({ job: JOB, error: new Error("boom") }, "opened");
            assert.equal(logger.lines().length, 2, logger.text());
        });
    });
});

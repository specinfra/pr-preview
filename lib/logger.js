"use strict";
const util = require("util");
const { dismissalReason } = require("./utils/error-utils");

// Log viewers (and the hosting platform's log drain) treat each line as a
// separate entry, so objects are serialized to a single line instead of being
// pretty-printed across many. Everything else is passed through untouched,
// which keeps stack traces readable when they're explicitly logged on their own
// and leaves console.log's format specifiers (%s, %d) working.
function formatArg(arg) {
    if (arg === null || typeof arg != "object") return arg;
    return util.inspect(arg, { breakLength: Infinity, compact: true })
        .replace(/\s*\n\s*/g, " ");
}

function createLogger(config) {
    function logArgs() {
        var args = Array.prototype.map.call(arguments, formatArg);
        process.nextTick(function() {
            console.log.apply(console, args);
        });
    }

    function logResult(r, action) {
        var err = r.error;

        // We're all good. Log outcome and exit.
        if (!err) {
            let skipped = r.skipReason ? ` (no update: ${ r.skipReason })` : "";
            logArgs(`${r.job.id}: ${ action }${ skipped }`);
            logArgs(r);
            return;
        }

        // These are well understood error paths.
        // They shouldn't trigger error messages.
        // Log why the job was dismissed and exit.
        let dismissal = dismissalReason(err);
        if (dismissal) {
            logArgs(`${r.job.id}: ${ action } (dismissed: ${ dismissal })`);
            return;
        }

        // Those are real issues.
        // Log in details
        logArgs(`${r.job.id}: ${ action } (${err.name}: ${err.message})`);
        if (r.errorNotReportedReason) {
            logArgs(`    Not reported on the PR: ${ r.errorNotReportedReason }.`);
        }
        if (r.errorRenderingErrorMsg) {
            logArgs(`    Additionally, triggered the following error while attempting to render the error msg to the client: ${r.errorRenderingErrorMsg.name}: ${r.errorRenderingErrorMsg.message}`);
        }
        if (err.data) { logArgs(err.data) };
        if (err.stack && config.displayStackTraces) { logArgs(err.stack) };
        logArgs(r);
    }

    return { logArgs, logResult };
}

module.exports = createLogger;

"use strict";
const { dismissalReason } = require("./utils/error-utils");

const INDENT = "    ";

function createLogger(config) {
    config = config || {};

    function log(...args) {
        console.log(...args);
    }

    // One error, in as much detail as the config allows: the headline, any
    // structured data the thrower attached, and the stack when asked for.
    function logError(err, indent) {
        indent = indent || "";
        log(`${indent}${err.name}: ${err.message}`);
        if (err.data) log(err.data);
        if (err.stack && config.displayStackTraces) log(err.stack);
    }

    function outcome(r) {
        if (r.skipReason) return `no update: ${r.skipReason}`;
        if (r.updated === true) return "updated";
        return "not a live run, would have updated";
    }

    // The one-line record of a processed job, plus detail for real errors.
    function logResult(r, action) {
        const id = r.job.id;
        const err = r.error;

        if (!err) {
            const edited = r.bodyChanged ? ", body edited during build" : "";
            log(`${id}: ${action} (${outcome(r)}${edited})`);
            return;
        }

        // Well understood error paths: say why the job was dismissed and stop.
        const dismissal = dismissalReason(err);
        if (dismissal) {
            log(`${id}: ${action} (dismissed: ${dismissal})`);
            return;
        }

        // Real issues: log in detail.
        log(`${id}: ${action} (${err.name}: ${err.message})`);
        if (r.errorNotReportedReason) {
            log(`${INDENT}Not reported on the PR: ${r.errorNotReportedReason}.`);
        }
        if (r.errorReportingError) {
            log(`${INDENT}Additionally, reporting it on the PR failed:`);
            logError(r.errorReportingError, INDENT + INDENT);
        }
        if (err.data) log(err.data);
        if (err.stack && config.displayStackTraces) log(err.stack);
    }

    return { log, logError, logResult };
}

module.exports = createLogger;

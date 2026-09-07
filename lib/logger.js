"use strict";
const { dismissalReason } = require("./utils/error-utils");
const prUrl = require("./utils/pr-url");

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

    // Every per-job line reads "<url> (<action>): <status> (<detail>)".
    function jobLine(job, action, status, details) {
        const url = job.url || prUrl(job.id);
        const detail = (details || []).filter(Boolean).join("; ");
        return `${url} (${action}): ${status}${detail ? ` (${detail})` : ""}`;
    }

    function outcome(r) {
        const edited = r.bodyChanged ? "body edited during build" : null;
        if (r.skipReason) return ["no update", [r.skipReason, edited]];
        if (r.updated === true) return ["updated", [edited]];
        return ["not a live run", ["would have updated", edited]];
    }

    // The one-line record of a processed job, plus detail for real errors.
    function logResult(r, action) {
        const err = r.error;

        if (!err) {
            log(jobLine(r.job, action, ...outcome(r)));
            return;
        }

        // Well understood error paths: say why the job was dismissed and stop.
        const dismissal = dismissalReason(err);
        if (dismissal) {
            log(jobLine(r.job, action, "dismissed", [dismissal]));
            return;
        }

        // Real issues: log in detail.
        log(jobLine(r.job, action, "failed", [`${err.name}: ${err.message}`]));
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

    return { log, logError, logResult, jobLine };
}

module.exports = createLogger;

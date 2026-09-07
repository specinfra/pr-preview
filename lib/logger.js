"use strict";
const pino = require("pino");
const pinoPretty = require("pino-pretty");
const { dismissalReason } = require("./utils/error-utils");
const prUrl = require("./utils/pr-url");

// Logging is pino. Every record is named pr-preview and says what it is
// about in fields: a job's `pr` and `action` (bound on a child logger from
// jobLogger()), its `status` and `reason`, an `err` with the error's data
// and, when DISPLAY_STACK_TRACES=yes, its stack. The message is the
// readable sentence. Modules that log on their own bind a `module`.
//
// Two formats write the same records:
// - pretty, the default: one line per record, "<pr> (<action>): <msg>" for
//   a job, with error detail indented beneath. Fields the line already
//   conveys are left out (PRETTY_HIDDEN), and so is the time: the line is
//   read live in a terminal, or in a log stream that stamps each line
//   itself (Clever Cloud does), where a second timestamp is just noise.
// - json, with LOG_FORMAT=json: newline-delimited JSON with every field,
//   for a log collector.
//
// Levels: debug is the build's chatter (fetches, cache hits, file reads),
// info is what happened to a job, warn is a job dismissed or a request
// refused, error is a real failure. LOG_LEVEL (default info) sets the
// threshold.

const NAME = "pr-preview";

// Fields the pretty line already conveys, so they aren't repeated under it,
// plus the time (see above).
const PRETTY_HIDDEN = [
    "time", "pid", "hostname", "module", "pr", "action", "status", "reason", "bodyChanged",
    "running", "event", "method", "url", "key", "path", "config", "includes"
];

function configFromEnv(env) {
    env = env || process.env;
    return {
        logFormat: env.LOG_FORMAT,
        logLevel: env.LOG_LEVEL,
        displayStackTraces: env.DISPLAY_STACK_TRACES === "yes"
    };
}

// An error is logged as { type, message, data, stack }: what the PR error
// report shows too (docs/error-handling.md), with the stack only when asked.
function errorSerializer(config) {
    return function serializeError(err) {
        if (!err || typeof err != "object") return err;
        const out = { type: err.name || "Error", message: err.message };
        if (err.data !== undefined) out.data = err.data;
        if (err.stack && config.displayStackTraces) out.stack = err.stack;
        return out;
    };
}

// How a serialized error reads under its line when pretty-printing: the
// stack when there is one (its first line names the error), the
// "Type: message" headline otherwise, then any attached data.
function prettifyError(err) {
    if (!err || typeof err != "object") return String(err);
    const lines = [err.stack || `${err.type}: ${err.message}`];
    if (err.data !== undefined) {
        lines.push(`    data: ${JSON.stringify(err.data, null, 2).replace(/\n/g, "\n    ")}`);
    }
    return lines.join("\n");
}

// The pretty line: "<module>: <pr> (<action>): <msg>", whichever apply.
function messageFormat(log, messageKey) {
    let msg = log[messageKey] || "";
    if (log.pr) msg = `${log.pr}${log.action ? ` (${log.action})` : ""}: ${msg}`;
    if (log.module) msg = `${log.module}: ${msg}`;
    return msg;
}

// `config` takes the keys of configFromEnv(), plus `destination` (a writable
// stream, in place of stdout) and `colorize` (in place of TTY detection).
function createLogger(config) {
    config = config || {};
    const serializeError = errorSerializer(config);
    const options = {
        name: NAME,
        level: config.logLevel || "info",
        serializers: { err: serializeError, reportingError: serializeError }
    };
    if (config.logFormat == "json") {
        return pino(options, config.destination || pino.destination({ sync: true }));
    }
    return pino(options, pinoPretty({
        destination: config.destination || 1,
        sync: true,
        colorize: config.colorize,
        ignore: PRETTY_HIDDEN.join(","),
        messageFormat,
        // Printed in this order, after the line they belong to.
        errorLikeObjectKeys: ["err", "notReported", "reportingError"],
        customPrettifiers: { err: prettifyError, reportingError: prettifyError }
    }));
}

// A job's logger: everything logged through it names the PR and the action.
function jobLogger(log, job) {
    const bindings = { pr: job.url || prUrl(job.id) };
    if (job.action) bindings.action = job.action;
    return log.child(bindings);
}

// "<status> (<detail>; <detail>)", the shape of every job message.
function statusMessage(status, details) {
    const detail = (details || []).filter(Boolean).join("; ");
    return `${status}${detail ? ` (${detail})` : ""}`;
}

// One record of a job's status: `status` and `reason` as fields, and the
// same as the message.
function logStatus(log, level, status, reason, fields) {
    log[level](Object.assign({ status, reason }, fields), statusMessage(status, [reason]));
}

function outcome(r) {
    if (r.skipReason) return { status: "no update", reason: r.skipReason };
    if (r.updated === true) return { status: "updated" };
    return { status: "not a live run", reason: "would have updated" };
}

// The record of a processed job: its outcome, or for a real error the
// error itself, why the PR wasn't told, or what went wrong telling it.
function logResult(log, r) {
    const err = r.error;

    if (!err) {
        const { status, reason } = outcome(r);
        const fields = { status, reason };
        const details = [reason];
        if (r.bodyChanged) {
            fields.bodyChanged = true;
            details.push("body edited during build");
        }
        log.info(fields, statusMessage(status, details));
        return;
    }

    // Well understood error paths: say why the job was dismissed and stop.
    const dismissal = dismissalReason(err);
    if (dismissal) {
        logStatus(log, "warn", "dismissed", dismissal);
        return;
    }

    const fields = { status: "failed", err };
    if (r.errorNotReportedReason) fields.notReported = r.errorNotReportedReason;
    if (r.errorReportingError) fields.reportingError = r.errorReportingError;
    log.error(fields, "failed");
}

module.exports = {
    // The app's logger, configured from the environment. index.js hands it
    // down; modules that aren't handed one use it directly.
    logger: createLogger(configFromEnv()),
    createLogger,
    configFromEnv,
    jobLogger,
    logStatus,
    logResult,
    statusMessage
};

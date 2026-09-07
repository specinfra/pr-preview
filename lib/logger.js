"use strict";
const { format } = require("util");
const pino = require("pino");
const pinoPretty = require("pino-pretty");
const { dismissalReason } = require("./utils/error-utils");
const prUrl = require("./utils/pr-url");

// The logger is pino underneath. By default it pretty-prints, one readable
// line per event with any error detail indented beneath it; LOG_FORMAT=json
// switches to newline-delimited JSON for log collectors. Every record has
// the same fields either way, so the two formats say the same thing.
//
// What it reads from the environment (see DEPLOYMENT.md):
//   LOG_FORMAT           "pretty" (default) or "json"
//   LOG_LEVEL            a pino level name, default "info"
//   DISPLAY_STACK_TRACES "yes" to include stack traces in error records
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

// How a serialized error reads under its log line when pretty-printing:
// the stack when there is one (its first line names the error), the
// "Type: message" headline otherwise, then any attached data. An `err`
// whose headline the log line already carries is left out altogether.
function errorPrettifier(skipWhenRedundant) {
    return function prettifyError(err) {
        if (!err || typeof err != "object") return skipWhenRedundant ? undefined : String(err);
        const hasStack = !!err.stack;
        const hasData = err.data !== undefined;
        if (skipWhenRedundant && !hasStack && !hasData) return undefined;
        const lines = [hasStack ? err.stack : `${err.type}: ${err.message}`];
        if (hasData) {
            lines.push(`    data: ${JSON.stringify(err.data, null, 2).replace(/\n/g, "\n    ")}`);
        }
        return lines.join("\n");
    };
}

function createPino(config) {
    const serializeError = errorSerializer(config);
    const options = {
        level: config.logLevel || "info",
        serializers: { err: serializeError, reportingError: serializeError }
    };
    if (config.logFormat == "json") {
        return pino(options, config.destination || pino.destination({ sync: true }));
    }
    const pretty = pinoPretty({
        destination: config.destination || 1,
        sync: true,
        colorize: config.colorize,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
        // Listed so they print in this order, after the line they belong to.
        errorLikeObjectKeys: ["err", "notReportedReason", "reportingError"],
        customPrettifiers: {
            err: errorPrettifier(true),
            reportingError: errorPrettifier(false)
        }
    });
    return pino(options, pretty);
}

function headline(err) {
    if (!err || typeof err != "object") return String(err);
    return `${err.name || "Error"}: ${err.message}`;
}

// `config` takes the keys of configFromEnv(), plus `destination` (a writable
// stream, in place of stdout) and `colorize` (in place of TTY detection).
function createLogger(config) {
    config = config || {};
    const logger = createPino(config);

    // A plain informational line. Arguments are formatted like console.log's.
    function log(...args) {
        logger.info(format(...args));
    }

    // One error, with `message` as the context it happened in. The record
    // carries the error's data and, when the config allows it, its stack.
    function logError(err, message) {
        logger.error({ err }, message ? `${message} (${headline(err)})` : headline(err));
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
            logger.info(jobLine(r.job, action, ...outcome(r)));
            return;
        }

        // Well understood error paths: say why the job was dismissed and stop.
        const dismissal = dismissalReason(err);
        if (dismissal) {
            logger.info(jobLine(r.job, action, "dismissed", [dismissal]));
            return;
        }

        // Real issues: log in detail, including why the PR wasn't told, or
        // what went wrong telling it.
        const record = { err };
        if (r.errorNotReportedReason) record.notReportedReason = r.errorNotReportedReason;
        if (r.errorReportingError) record.reportingError = r.errorReportingError;
        logger.error(record, jobLine(r.job, action, "failed", [headline(err)]));
    }

    return { log, logError, logResult, jobLine };
}

// The app-wide logger: what index.js uses, and what modules that aren't
// handed one (the cache, the fetch mixins, the Wattsi client) use too. It is
// created from the environment the first time anything logs through it.
let shared = null;
function sharedLogger() {
    if (!shared) shared = createLogger(configFromEnv(process.env));
    return shared;
}

module.exports = createLogger;
module.exports.configFromEnv = configFromEnv;
module.exports.shared = {
    log: (...args) => sharedLogger().log(...args),
    logError: (...args) => sharedLogger().logError(...args),
    logResult: (...args) => sharedLogger().logResult(...args)
};

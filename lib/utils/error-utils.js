"use strict";

// Errors flagged with one of these describe an expected, non-actionable
// outcome. The job is dismissed rather than reported back to the PR, so the
// log line is the only trace it leaves: each flag has a fallback label, and
// the thrower can set `dismissalReason` to say something more specific.
const DISMISSAL_LABELS = {
    noConfig: "no usable config",
    prMerged: "PR is already merged",
    aborted: "build aborted"
};

// Flags `err` as a dismissal of kind `flag`, with `reason` as what the log
// will say. Returns the error so it can be thrown in one go.
function dismiss(err, flag, reason) {
    if (!(flag in DISMISSAL_LABELS)) {
        throw new TypeError(`Unknown dismissal flag: ${flag}`);
    }
    err[flag] = true;
    if (reason) err.dismissalReason = reason;
    return err;
}

// The reason a dismissed error was dismissed, or null for a real error.
function dismissalReason(error) {
    if (!error) return null;
    let flag = Object.keys(DISMISSAL_LABELS).find(k => error[k]);
    if (!flag) return null;
    return error.dismissalReason || DISMISSAL_LABELS[flag];
}

module.exports = { dismiss, dismissalReason };

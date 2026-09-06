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

function dismissalReason(error) {
    if (!error) return null;
    let flag = Object.keys(DISMISSAL_LABELS).find(k => error[k]);
    if (!flag) return null;
    return error.dismissalReason || DISMISSAL_LABELS[flag];
}

function isInternalError(error) {
    return !!dismissalReason(error);
}

module.exports = { isInternalError, dismissalReason };

"use strict";
const assert = require("assert"),
    { dismiss, dismissalReason } = require("../lib/utils/error-utils");

suite("Dismissal reasons", function() {

    test("plain errors are not dismissals", function() {
        assert.equal(dismissalReason(new Error("boom")), null);
        assert.equal(dismissalReason(null), null);
    });

    test("each flag falls back to a label", function() {
        ["noConfig", "prMerged", "aborted"].forEach(flag => {
            let err = new Error("boom");
            err[flag] = true;
            assert(dismissalReason(err), `${flag} should have a fallback label`);
        });
    });

    test("an explicit reason wins over the label", function() {
        let err = new Error("Not Found");
        err.noConfig = true;
        err.dismissalReason = "couldn't read .pr-preview.json";
        assert.equal(dismissalReason(err), "couldn't read .pr-preview.json");
    });

    test("dismiss() flags the error and returns it", function() {
        let err = new Error("boom");
        assert.strictEqual(dismiss(err, "aborted", "gave up"), err);
        assert.equal(err.aborted, true);
        assert.equal(dismissalReason(err), "gave up");
    });

    test("dismiss() without a reason falls back to the label", function() {
        let err = dismiss(new Error("boom"), "prMerged");
        assert.equal(err.prMerged, true);
        assert.equal(dismissalReason(err), "PR is already merged");
    });

    test("dismiss() rejects unknown flags", function() {
        assert.throws(() => dismiss(new Error("boom"), "raceCondition"), TypeError);
    });
});

suite("PR URLs", function() {
    const prUrl = require("../lib/utils/pr-url");

    test("maps a job id to the PR's GitHub URL", function() {
        assert.equal(prUrl("org/repo/42"), "https://github.com/org/repo/pull/42");
    });
});

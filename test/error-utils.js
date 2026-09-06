"use strict";
const assert = require("assert"),
    { isInternalError, dismissalReason } = require("../lib/utils/error-utils");

suite("Dismissal reasons", function() {

    test("plain errors are not dismissals", function() {
        assert.equal(isInternalError(new Error("boom")), false);
        assert.equal(dismissalReason(new Error("boom")), null);
        assert.equal(dismissalReason(null), null);
    });

    test("each flag falls back to a label", function() {
        ["noConfig", "prMerged", "aborted"].forEach(flag => {
            let err = new Error("boom");
            err[flag] = true;
            assert.equal(isInternalError(err), true);
            assert(dismissalReason(err), `${flag} should have a fallback label`);
        });
    });

    test("an explicit reason wins over the label", function() {
        let err = new Error("Not Found");
        err.noConfig = true;
        err.dismissalReason = "couldn't read .pr-preview.json";
        assert.equal(dismissalReason(err), "couldn't read .pr-preview.json");
    });
});

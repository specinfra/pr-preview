"use strict";
const assert = require("assert"),
    Controller = require("../lib/controller");

function fakePR(overrides) {
    return Object.assign({
        payload: { head: { sha: "abc123" } },
        isMerged: false,
        config: { src_file: "index.bs", type: "bikeshed" },
        touchesSrcFile: () => true,
        requiresPreview: () => true
    }, overrides);
}

suite("Controller.updateSkipReason", function() {
    const controller = new Controller();

    test("no reason when the PR does warrant an update", function() {
        assert.equal(controller.updateSkipReason(fakePR()), null);
        assert.equal(controller.needsUpdate(fakePR()), true);
    });

    test("names each condition that dismisses the PR", function() {
        const cases = [
            [{ payload: null }, "PR was never loaded"],
            [{ isMerged: true }, "PR is already merged"],
            [{ touchesSrcFile: () => false }, "no change to index.bs or the files it includes"],
            [{ requiresPreview: () => false }, "PR body opts out with <!-- no preview -->"]
        ];

        cases.forEach(([overrides, expected]) => {
            const pr = fakePR(overrides);
            assert.equal(controller.updateSkipReason(pr), expected);
            assert.equal(controller.needsUpdate(pr), false);
        });
    });
});

suite("Controller.updateBody skip reasons", function() {
    const controller = new Controller();

    test("reports why no update was attempted", function() {
        return controller.updateBody(fakePR({ touchesSrcFile: () => false }), {}).then(r => {
            assert.equal(r.needsUpdate, false);
            assert.equal(r.skipReason, "no change to index.bs or the files it includes");
        });
    });

    test("reports an already up to date body", function() {
        const pr = fakePR({
            body: "rendered",
            cacheAll: () => Promise.resolve(),
            checkForChanges: () => Promise.resolve({ hasCommitChanges: false, hasBodyChanges: false })
        });
        controller.render = () => "rendered";

        return controller.updateBody(pr, {}).then(r => {
            assert.equal(r.needsUpdate, false);
            assert.equal(r.skipReason, "rendered body is already up to date");
        });
    });
});

suite("Controller.reportSkipReason", function() {
    const controller = new Controller();
    const withEnv = (env, fn) => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = env;
        try { return fn(); } finally { process.env.NODE_ENV = original; }
    };

    test("outside production, nothing is reported", function() {
        withEnv("development", _ => assert.equal(
            controller.reportSkipReason(fakePR(), {}, new Error("boom")),
            "not a live run"));
    });

    test("a dismissed error carries its own reason through", function() {
        const err = new Error("Not Found");
        err.noConfig = true;
        err.dismissalReason = "couldn't read .pr-preview.json: Not Found";

        withEnv("production", _ => assert.equal(
            controller.reportSkipReason(fakePR(), {}, err),
            "couldn't read .pr-preview.json: Not Found"));
    });

    test("a real error on a PR needing no preview says which condition applied", function() {
        withEnv("production", _ => assert.equal(
            controller.reportSkipReason(fakePR({ isMerged: true }), {}, new Error("boom")),
            "PR is already merged"));
    });
});

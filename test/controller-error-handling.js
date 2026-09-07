"use strict";
const assert = require("assert"),
    Controller = require("../lib/controller"),
    PR = require("../lib/models/pr");

const JOB = { id: "acme/spec/7", installation_id: 1, forcedUpdate: false };

const silentLogger = { log() {}, logError() {}, logResult() {} };

function withEnv(env, fn) {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = env;
    return Promise.resolve().then(fn).finally(() => { process.env.NODE_ENV = original; });
}

// handlePullRequest() builds its own PR, so the only seam is PR.prototype.init.
function stubInit(fn) {
    const original = PR.prototype.init;
    PR.prototype.init = fn;
    return () => { PR.prototype.init = original; };
}

function loadedPR(pr) {
    pr.payload = { head: { sha: "abc123" }, body: "", merged: false };
    pr.config = { type: "bikeshed", src_file: "index.bs" };
    pr.touchesSrcFile = () => true;
    pr.requiresPreview = () => true;
}

suite("Controller.handlePullRequest", function() {
    let restore;
    teardown(() => { if (restore) restore(); restore = null; });

    test("resolves to a result even when the PR can't be built", function() {
        const controller = new Controller({ logger: silentLogger });
        restore = stubInit(function() { throw new Error("no such PR"); });

        return controller.handlePullRequest(JOB).then(r => {
            assert.equal(r.success, false);
            assert.equal(r.requeue, false);
            assert.equal(r.error.message, "no such PR");
            assert.equal(r.job, JOB);
        });
    });

    test("resolves to a result when the job id is not even a string", function() {
        const controller = new Controller({ logger: silentLogger });
        return controller.handlePullRequest({ id: 42 }).then(r => {
            assert.equal(r.success, false);
            assert(r.error instanceof TypeError);
        });
    });

    test("carries the requeue flag of an aborted build through", function() {
        const controller = new Controller({ logger: silentLogger });
        restore = stubInit(function() {
            loadedPR(this);
            this.cacheAll = () => Promise.resolve();
            this.checkForChanges = () => Promise.resolve({ hasCommitChanges: true });
        });

        return controller.handlePullRequest(JOB).then(r => {
            assert.equal(r.success, false);
            assert.equal(r.requeue, true);
            assert.equal(r.error.aborted, true);
        });
    });

    test("says why an error was kept off the PR", function() {
        const controller = new Controller({ logger: silentLogger });
        restore = stubInit(function() { throw new Error("boom"); });

        return withEnv("production", () => controller.handlePullRequest(JOB)).then(r => {
            assert.equal(r.errorReported, false);
            assert.equal(r.errorNotReportedReason, "PR was never loaded");
        });
    });

    test("records a failure to report the error instead of throwing", function() {
        const controller = new Controller({ logger: silentLogger });
        restore = stubInit(function() {
            loadedPR(this);
            this.updateBody = () => Promise.reject(new Error("GitHub is down"));
            throw new Error("boom");
        });

        return withEnv("production", () => controller.handlePullRequest(JOB)).then(r => {
            assert.equal(r.error.message, "boom");
            assert.equal(r.errorReported, false);
            assert.equal(r.errorReportingError.message, "GitHub is down");
        });
    });

    test("reports the error on the PR when it should", function() {
        const controller = new Controller({ logger: silentLogger });
        let posted = null;
        restore = stubInit(function() {
            loadedPR(this);
            this.updateBody = body => { posted = body; return Promise.resolve(); };
            throw new Error("boom");
        });

        return withEnv("production", () => controller.handlePullRequest(JOB)).then(r => {
            assert.equal(r.errorReported, true);
            assert(posted.includes("boom"), "error message should be posted on the PR");
        });
    });
});

suite("Controller.processQueue", function() {
    test("requeues a job whose build was aborted, once it is released", function() {
        const controller = new Controller({ logger: silentLogger });
        const results = [];
        let attempts = 0;
        controller.handlePullRequest = job => {
            attempts++;
            assert(controller.currently_running.has(job.id), "job should be marked as running");
            return Promise.resolve({ job, requeue: attempts == 1 });
        };

        controller.queueJob(JOB);
        return controller.processQueue(r => results.push(r)).then(() => {
            assert.equal(attempts, 2);
            assert.equal(results.length, 2);
            assert.equal(controller.queue.length, 0);
            assert.equal(controller.currently_running.size, 0);
        });
    });

    test("keeps draining the queue when a result handler throws", function() {
        const logged = [];
        const controller = new Controller({
            logger: { log: (...args) => logged.push(args.join(" ")), logError: err => logged.push(err.message) }
        });
        controller.handlePullRequest = job => Promise.resolve({ job, requeue: false });
        controller.queueJob({ id: "a/b/1" });
        controller.queueJob({ id: "a/b/2" });

        const seen = [];
        return controller.processQueue(r => {
            seen.push(r.job.id);
            if (r.job.id == "a/b/1") throw new Error("handler broke");
        }).then(() => {
            assert.deepEqual(seen, ["a/b/1", "a/b/2"]);
            assert(logged.includes("handler broke"));
            assert.equal(controller.currently_running.size, 0);
        });
    });
});

suite("Controller.reportSkipReason", function() {
    const controller = new Controller({ logger: silentLogger });

    test("an unloaded PR has nowhere to post to, even when forced", function() {
        return withEnv("production", () => {
            const pr = new PR("acme/spec/7", { id: 1 });
            assert.equal(controller.reportSkipReason(pr, { forcedUpdate: true }, new Error("boom")),
                "PR was never loaded");
            assert.equal(controller.reportSkipReason(null, { forcedUpdate: true }, new Error("boom")),
                "PR was never loaded");
        });
    });

    test("shouldReportError is the negation", function() {
        return withEnv("production", () => {
            const pr = new PR("acme/spec/7", { id: 1 });
            loadedPR(pr);
            assert.equal(controller.shouldReportError(pr, JOB, new Error("boom")), true);
            pr.touchesSrcFile = () => false;
            assert.equal(controller.shouldReportError(pr, JOB, new Error("boom")), false);
            assert.equal(controller.shouldReportError(pr, { forcedUpdate: true }, new Error("boom")), true);
        });
    });
});

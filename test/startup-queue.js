"use strict";
const assert = require("assert"),
    { parseStartupQueue, processStartupQueue } = require("../lib/startup-queue");

function logger() {
    const lines = [];
    return {
        lines,
        log: (...args) => lines.push(args.join(" ")),
        logError: err => lines.push(err.message),
        logResult: (r, action) => lines.push(`${r.job.id}: ${action}`)
    };
}

suite("Startup queue", function() {

    test("parses a valid queue", function() {
        const l = logger();
        assert.deepEqual(parseStartupQueue('[{"id":"a/b/1"}]', l), [{ id: "a/b/1" }]);
        assert.deepEqual(l.lines, []);
    });

    test("rejects anything unusable with one logged reason", function() {
        const cases = [
            [undefined, "No startup queue present"],
            ["not json", /Invalid JSON in STARTUP_QUEUE/],
            ['{"id":"a/b/1"}', "Startup queue must be an array"],
            ["[]", "Startup queue is empty"],
            ['[{"id":"a/b/1"},{"id":2}]', /string 'id' property/]
        ];
        cases.forEach(([env, expected]) => {
            const l = logger();
            assert.equal(parseStartupQueue(env, l), null);
            assert.equal(l.lines.length, 1, `${env}: expected exactly one line`);
            if (expected instanceof RegExp) {
                assert(expected.test(l.lines[0]), l.lines[0]);
            } else {
                assert.equal(l.lines[0], expected);
            }
        });
    });

    test("queues every job, notes duplicates and waits for the queue to drain", function() {
        const l = logger();
        const handled = [];
        const controller = {
            queue: [],
            queueJob(job) {
                job.url = `https://github.com/a/b/pull/${job.id.split("/")[2]}`;
                if (this.queue.some(j => j.id == job.id)) return { job, queued: false, skipReason: "already queued" };
                this.queue.push(job);
                return { job, queued: true, skipReason: null };
            },
            async processQueue(onResult) {
                while (this.queue.length) {
                    const job = this.queue.shift();
                    handled.push(job.id);
                    onResult({ job });
                }
            }
        };

        const queue = [{ id: "a/b/1" }, { id: "a/b/2" }, { id: "a/b/1" }];
        return processStartupQueue(queue, controller, l).then(() => {
            assert.deepEqual(handled, ["a/b/1", "a/b/2"]);
            assert.deepEqual(l.lines, [
                "Queuing 3 startup jobs: https://github.com/a/b/pull/1, https://github.com/a/b/pull/2, https://github.com/a/b/pull/1",
                "https://github.com/a/b/pull/1 (startup-queue): skipped (already queued)",
                "a/b/1: startup-queue",
                "a/b/2: startup-queue"
            ]);
        });
    });
});

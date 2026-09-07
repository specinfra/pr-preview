"use strict";
const prUrl = require("./utils/pr-url");

// Reads STARTUP_QUEUE, a JSON array of jobs to process as soon as the app
// starts. Returns the jobs, or null (with the reason logged) when there is
// nothing usable.
function parseStartupQueue(startupQueueEnv, logger) {
    const { log } = logger;

    if (!startupQueueEnv) {
        log("No startup queue present");
        return null;
    }

    let queue;
    try {
        queue = JSON.parse(startupQueueEnv);
    } catch (error) {
        log(`Invalid JSON in STARTUP_QUEUE: ${error.message}`);
        return null;
    }

    if (!Array.isArray(queue)) {
        log("Startup queue must be an array");
        return null;
    }

    if (queue.length === 0) {
        log("Startup queue is empty");
        return null;
    }

    if (!queue.every(item => item && typeof item.id === "string")) {
        log("Invalid queue items - all items must have a string 'id' property");
        return null;
    }

    return queue;
}

// Queues every job from the startup queue and processes them. Resolves once
// the queue has been drained.
async function processStartupQueue(queue, controller, logger) {
    const { log, logResult } = logger;

    if (!queue) {
        return;
    }

    log(`Queuing ${queue.length} startup jobs: ${queue.map(item => prUrl(item.id)).join(", ")}`);

    queue.forEach(item => {
        const queueResult = controller.queueJob(item);
        if (!queueResult.queued) {
            log(`${queueResult.job.url}: startup-queue (skipped: ${queueResult.skipReason})`);
        }
    });

    await controller.processQueue(r => logResult(r, "startup-queue"));
}

module.exports = {
    parseStartupQueue,
    processStartupQueue
};

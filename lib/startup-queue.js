"use strict";
const prUrl = require("./utils/pr-url");
const { jobLogger, logStatus } = require("./logger");

// Reads STARTUP_QUEUE, a JSON array of jobs to process as soon as the app
// starts. Returns the jobs, or null (with the reason logged) when there is
// nothing usable.
function parseStartupQueue(startupQueueEnv, log) {
    if (!startupQueueEnv) {
        log.info("No startup queue present");
        return null;
    }

    let queue;
    try {
        queue = JSON.parse(startupQueueEnv);
    } catch (error) {
        log.warn(`Invalid JSON in STARTUP_QUEUE: ${error.message}`);
        return null;
    }

    if (!Array.isArray(queue)) {
        log.warn("Startup queue must be an array");
        return null;
    }

    if (queue.length === 0) {
        log.warn("Startup queue is empty");
        return null;
    }

    if (!queue.every(item => item && typeof item.id === "string")) {
        log.warn("Invalid queue items - all items must have a string 'id' property");
        return null;
    }

    return queue;
}

// Queues every job from the startup queue, as the "startup-queue" action,
// and processes them. Resolves once the queue has been drained.
async function processStartupQueue(queue, controller, log) {
    if (!queue) {
        return;
    }

    log.info(`Queuing ${queue.length} startup jobs: ${queue.map(item => prUrl(item.id)).join(", ")}`);

    queue.forEach(item => {
        item.action = "startup-queue";
        const queueResult = controller.queueJob(item);
        if (!queueResult.queued) {
            logStatus(jobLogger(log, queueResult.job), "info", "skipped", queueResult.skipReason);
        }
    });

    await controller.processQueue();
}

module.exports = {
    parseStartupQueue,
    processStartupQueue
};

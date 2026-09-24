"use strict";
var t0 = Date.now();
if (process.env.NODE_ENV === "dev") {
    // Load local env variables
    require("./env");
}

const createApp = require("./lib/app"),
    Controller = require("./lib/controller"),
    { logger, memory, installProcessHandlers } = require("./lib/logger"),
    { parseStartupQueue, processStartupQueue } = require("./lib/startup-queue");

var config = {
    githubSecret: process.env.GITHUB_SECRET,
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV
};

const controller = new Controller({ logger });

const queue = parseStartupQueue(process.env.STARTUP_QUEUE, logger);
if (queue) {
    processStartupQueue(queue, controller, logger).catch(error => {
        logger.error({ err: error }, "Unexpected error during startup queue processing");
    });
}

var app = createApp(controller, config, logger);
var port = config.port;
var server = app.listen(port, function() {
    logger.info("Express server listening on port %d in %s mode", port, app.settings.env);
    logger.info({ memory: memory(), ms: Date.now() - t0 }, "App started in %dms.", Date.now() - t0);
});
server.on("error", function(err) {
    logger.fatal({ err }, "server error");
    process.exit(1);
});
installProcessHandlers(logger, function(done) {
    server.close(done);
});
// A periodic memory snapshot, cheap and invaluable when hunting down
// an instance that runs out of memory.
setInterval(function() {
    logger.info({ memory: memory() }, "memory usage");
}, 60000).unref();

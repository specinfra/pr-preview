"use strict";
var t0 = Date.now();
if (process.env.NODE_ENV === "dev") {
    // Load local env variables
    require("./env");
}

const createApp = require("./lib/app"),
    Controller = require("./lib/controller"),
    { logger } = require("./lib/logger"),
    { parseStartupQueue, processStartupQueue } = require("./lib/startup-queue"),
    { parseAllowedOrgs } = require("./lib/allowed-orgs");

var config = {
    githubSecret: process.env.GITHUB_SECRET,
    port: process.env.PORT || 5000,
    nodeEnv: process.env.NODE_ENV,
    allowedOrgs: parseAllowedOrgs(process.env.ALLOWED_ORGS)
};

const controller = new Controller({ logger, allowedOrgs: config.allowedOrgs });

const queue = parseStartupQueue(process.env.STARTUP_QUEUE, logger);
if (queue) {
    processStartupQueue(queue, controller, logger).catch(error => {
        logger.error({ err: error }, "Unexpected error during startup queue processing");
    });
}

var app = createApp(controller, config, logger);
var port = config.port;
app.listen(port, function() {
    logger.info("Express server listening on port %d in %s mode", port, app.settings.env);
    logger.info("App started in %dms.", Date.now() - t0);
});

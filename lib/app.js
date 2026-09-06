"use strict";

const express = require("express"),
    bodyParser = require('body-parser'),
    xhub = require('@snyk/express-x-hub'),
    createLogger = require('./logger');

module.exports = function createApp(controller, config) {
    const { logArgs, logResult } = createLogger(config);
    const BODY_LIMIT = '5Mb';
    var app = express();
    app.use(xhub({ algorithm: 'sha1', secret: config.githubSecret, limit: BODY_LIMIT }));
    app.use(bodyParser.json({ limit: BODY_LIMIT }));

    app.post('/github-hook', function (req, res, next) {
        if (config.nodeEnv != 'production' || (typeof req.isXHubValid === 'function' && req.isXHubValid())) {
            res.send(new Date().toISOString());
            var payload = req.body;
            if (payload.issue_comment) { // Depends on increased app permission
                logArgs("comment");
            } else if (payload.issue) { // Also depends on increased app permission
                logArgs("issue");
            } else if (payload.pull_request) {
                if (payload.sender && payload.sender.login == "pr-preview[bot]") {
                    logArgs("skipping auto-generated changes");
                } else {
                    let action = payload.action
                    switch(action) {
                        case "opened":
                        case "edited":
                        case "reopened":
                        case "synchronize":
                            const queueResult = controller.queuePullRequest(payload);
                            if (!queueResult.queued) {
                                logArgs(`Skipping PR ${queueResult.job.id}: ${queueResult.skipReason}`);
                            } else {
                                controller.processQueue(r => logResult(r, action), logArgs);
                            }
                    }
                }
            } else {
                logArgs("Unknown request", JSON.stringify(payload, null, 4));
            }
        } else {
            logArgs("Unverified request", req);
        }
        next();
    });

    app.post('/config', bodyParser.urlencoded({ extended: false }), async function (req, res, next) {
        try {
            let params = req.body;
            let url;
            if (params.validate) {
              url = await controller.getUrl(req.body);
            } else {
              url = await controller.pullRequestUrl(req.body);
            }
            res.redirect(url);
        } catch (err) {
            res.status(400).send({ error: err.message });
            logArgs(`${err.name}: ${err.message}\n${err.stack}`);
        } finally {
            next();
        }
    });

    return app;
};
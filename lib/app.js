"use strict";

const express = require("express"),
    bodyParser = require('body-parser'),
    xhub = require('@snyk/express-x-hub'),
    createLogger = require('./logger'),
    prUrl = require('./utils/pr-url');

// The pull_request actions that warrant (re)building a preview.
const PR_ACTIONS = ["opened", "edited", "reopened", "synchronize"];

module.exports = function createApp(controller, config, logger) {
    const { log, logError, logResult } = logger || createLogger(config);
    const BODY_LIMIT = '5Mb';
    var app = express();
    app.use(xhub({ algorithm: 'sha1', secret: config.githubSecret, limit: BODY_LIMIT }));
    app.use(bodyParser.json({ limit: BODY_LIMIT }));

    // The webhook only acts on pull_request events for a handful of actions.
    // Everything else is acknowledged and logged as ignored, in the same
    // "<url> (<action>): <status> (<detail>)" shape as processed jobs, so the
    // log says what arrived and what became of it.
    app.post('/github-hook', function (req, res, next) {
        if (config.nodeEnv != 'production' || (typeof req.isXHubValid === 'function' && req.isXHubValid())) {
            res.send(new Date().toISOString());
            const payload = req.body;
            const event = req.headers["x-github-event"] || "unnamed";
            const action = payload.action;
            const repo = payload.repository && payload.repository.full_name;

            if (payload.issue_comment || payload.issue) {
                // Only delivered if the app is granted the issues permission.
                const kind = payload.issue_comment ? "issue_comment" : "issues";
                const url = payload.issue.html_url || `https://github.com/${repo}/issues/${payload.issue.number}`;
                log(`${url} (${kind} ${action}): ignored (only pull_request events are handled)`);
            } else if (payload.pull_request) {
                const url = payload.pull_request.html_url ||
                    prUrl(`${payload.pull_request.base.repo.full_name}/${payload.number}`);
                if (payload.sender && payload.sender.login == "pr-preview[bot]") {
                    log(`${url} (${action}): ignored (triggered by our own update)`);
                } else if (!PR_ACTIONS.includes(action)) {
                    log(`${url} (${action}): ignored (not an action we build on)`);
                } else {
                    const queueResult = controller.queuePullRequest(payload);
                    if (!queueResult.queued) {
                        log(`${queueResult.job.url} (${action}): skipped (${queueResult.skipReason})`);
                    } else {
                        controller.processQueue(r => logResult(r, action));
                    }
                }
            } else {
                log(`${event} event: ignored (only pull_request events are handled; payload keys: ${Object.keys(payload).join(", ")})`);
            }
        } else {
            // X-Forwarded-For is set by the client and only trustworthy insofar as the
            // reverse proxy in front of us overwrites it. Logged as reported, not trusted.
            log("Unverified request", req.method, req.originalUrl,
                req.headers["x-forwarded-for"] || req.socket.remoteAddress);
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
            logError(err, `${req.originalUrl}: request failed`);
        } finally {
            next();
        }
    });

    return app;
};
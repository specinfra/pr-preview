"use strict";

const express = require("express"),
    bodyParser = require('body-parser'),
    xhub = require('@snyk/express-x-hub'),
    { logger, jobLogger, logStatus } = require('./logger'),
    prUrl = require('./utils/pr-url');

// The pull_request actions that warrant (re)building a preview.
const PR_ACTIONS = ["opened", "edited", "reopened", "synchronize"];

const ONLY_PULL_REQUESTS = "only pull_request events are handled";

module.exports = function createApp(controller, config, log) {
    log = log || logger;
    const BODY_LIMIT = '5Mb';
    var app = express();
    app.use(xhub({ algorithm: 'sha1', secret: config.githubSecret, limit: BODY_LIMIT }));
    app.use(bodyParser.json({ limit: BODY_LIMIT }));

    // The webhook only acts on pull_request events for a handful of actions.
    // Everything else is acknowledged and logged as ignored, with the same
    // status and reason fields as a processed job, so the log says what
    // arrived and what became of it.
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
                log.info({ event: kind, action, url, status: "ignored", reason: ONLY_PULL_REQUESTS },
                    `${url} (${kind} ${action}): ignored (${ONLY_PULL_REQUESTS})`);
            } else if (payload.pull_request) {
                const url = payload.pull_request.html_url ||
                    prUrl(`${payload.pull_request.base.repo.full_name}/${payload.number}`);
                const jobLog = jobLogger(log, { url, action });
                if (payload.sender && payload.sender.login == "pr-preview[bot]") {
                    logStatus(jobLog, "info", "ignored", "triggered by our own update");
                } else if (!PR_ACTIONS.includes(action)) {
                    logStatus(jobLog, "info", "ignored", "not an action we build on");
                } else {
                    const queueResult = controller.queuePullRequest(payload);
                    if (!queueResult.queued) {
                        logStatus(jobLog, "info", "skipped", queueResult.skipReason);
                    } else {
                        controller.processQueue();
                    }
                }
            } else {
                const keys = Object.keys(payload).join(", ");
                log.info({ event, status: "ignored", reason: ONLY_PULL_REQUESTS },
                    `${event} event: ignored (${ONLY_PULL_REQUESTS}; payload keys: ${keys})`);
            }
        } else {
            // X-Forwarded-For is set by the client and only trustworthy insofar as the
            // reverse proxy in front of us overwrites it. Logged as reported, not trusted.
            const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            log.warn({ method: req.method, url: req.originalUrl, ip },
                `Unverified request: ${req.method} ${req.originalUrl} from ${ip}`);
        }
        next();
    });

    // Deployment health check. Clever Cloud calls the path named in
    // CC_HEALTH_CHECK_PATH once the process is up and treats a 2xx as a
    // validated deploy; anything else fails it. Every build happens on
    // remote services, so there is no local dependency to probe: a process
    // that answers at all is a healthy one. The queue counts are for a
    // human reading the response, not for the check.
    app.get('/health', function (req, res) {
        res.json({
            status:  "ok",
            uptime:  Math.round(process.uptime()),
            queued:  controller.queue.length,
            running: controller.currently_running.size
        });
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
            res.status(err.status || 400).send({ error: err.message });
            log.error({ err, url: req.originalUrl }, `${req.originalUrl}: request failed`);
        } finally {
            next();
        }
    });

    return app;
};
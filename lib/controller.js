"use strict";
const PR = require("./models/pr");
const Head = require("./models/branch").Head;
const ViewBody = require("./views/body");
const ViewError = require("./views/error");
const Config = require("./models/config");
const { logger, jobLogger, logResult } = require("./logger");
const github = require("simple-github");
const { dismiss, dismissalReason } = require("./utils/error-utils");
const prUrl = require("./utils/pr-url");
const { isOrgAllowed, ownerFromId, orgNotAllowedError } = require("./allowed-orgs");

class Controller {
    constructor(options) {
        options = options || {};
        this.log = options.logger || logger;
        // `null` means the app isn't restricted to any organization.
        this.allowedOrgs = options.allowedOrgs || null;
        this.currently_running = new Set();
        this.previewer_cache = new Map();
        this.renderer = new ViewBody();
        this.errorRenderer = new ViewError();
        this.queue = [];
    }

    setCache(params, pr) {
        let k = this.cacheKey(params);
        let c = require("urlencode")(params.config);
        let f = ".pr-preview.json";
        let pr_url = `https://github.com/${pr.owner}/${pr.repo}/new/${pr.payload.base.ref}?filename=${f}&value=${c}`;
        this.log.debug({ key: k, url: pr_url }, `cache:set ${k}`);
        this.previewer_cache.set(k, pr_url);
    }

    cacheKey(params) {
        return `${params.owner}/${params.repo}/${params.config}`;
    }

    getCache(params) {
        let k = this.cacheKey(params);
        this.log.debug({ key: k }, `cache:get ${k}`);
        return this.previewer_cache.get(k);
    }

    async getUrl(params) {
        let regex = /^[a-z0-9-_]+$/i;
        let owner = params.owner.trim();
        let repo = params.repo.trim();
        if (!regex.test(owner) || !regex.test(repo)) {
            throw new TypeError("Invalid repo or owner name");
        }
        if (!isOrgAllowed(owner, this.allowedOrgs)) {
            throw orgNotAllowedError(owner);
        }
        let config = JSON.parse(params.config);
        Config.validate(config);
        
        const headers = await require("./auth")(false);
        const prs = await github({
            headers: headers
        }).request("GET /repos/:owner/:repo/pulls?state=all&per_page=1", {
            repo: repo,
            owner: owner,
            limit: 1
        });
        
        if (!prs.length) {
            throw new Error(`No pull requests to test with on ${owner}/${repo}. Sorry!`);
        }
        
        let pr = new PR(`${ prs[0].base.repo.full_name }/${ prs[0].id }`, { id: -1 });
        pr.payload = prs[0];
        pr.config = config;
        let h = Head.fromPR(pr);
        
        await this.testUrl(h.github_url);
        const url = await h.getUrl(h.urlOptions());
        
        // cache stuff to make pr request faster
        this.setCache(params, pr);
        return url;
    }

    async pullRequestUrl(params) {
        let url = this.getCache(params);
        if (url) return url;
        await this.getUrl(params);
        return this.getCache(params);
    }

    async testUrl(url) {
        return new Promise((resolve, reject) => {
            require("request")({ url: url, method: "head" }, (err, response) => {
                if (err) { return reject(err); }
                if (response.statusCode != 200) {
                    return reject(new Error(`${response.statusCode} ${response.statusMessage} for ${url}.`));
                }
                resolve();
            });
        });
    }
    
    queuePullRequest(payload, force) {
        const job = {
            installation_id: payload.installation.id,
            id:              `${payload.pull_request.base.repo.full_name}/${payload.number}`,
            url:             payload.pull_request.html_url,
            action:          payload.action,
            forcedUpdate:    !!force
        };
        return this.queueJob(job);
    }
    
    queueJob(job) {
        // Startup-queue jobs come with an id only; every job gets a URL for the log.
        job.url = job.url || prUrl(job.id);

        if (!isOrgAllowed(ownerFromId(job.id), this.allowedOrgs)) {
            return {
                job,
                queued: false,
                skipReason: 'organization not allowed'
            };
        }

        // Check if job is already in queue or currently running
        const isDuplicateInQueue = this.queue.some(queuedJob => queuedJob.id === job.id);
        const isCurrentlyRunning = this.currently_running.has(job.id);

        if (isDuplicateInQueue || isCurrentlyRunning) {
            return {
                job,
                queued: false,
                skipReason: isCurrentlyRunning ? 'already processing' : 'already queued'
            };
        }

        this.queue.push(job);
        return {
            job,
            queued: true,
            skipReason: null
        };
    }

    // Drains the queue, logging each job's result and handing it to
    // `onResult` when given. A job that asked to be requeued goes back on the
    // queue once it is no longer marked as running, so the duplicate check in
    // queueJob() lets it through.
    async processQueue(onResult) {
        while (this.queue.length > 0) {
            const job = this.queue.shift();
            this.currently_running.add(job.id);
            const log = jobLogger(this.log, job);
            const running = [...this.currently_running].map(prUrl);
            log.info({ status: "starting", running }, `starting (currently running: ${running.join(", ")})`);

            let requeue = false;
            try {
                const result = await this.handlePullRequest(job);
                requeue = result.requeue;
                logResult(log, result);
                if (onResult) onResult(result);
            } catch (err) {
                // handlePullRequest() reports its own failures in the result,
                // so only a failing result handler lands here.
                log.error({ err }, "result handler failed");
            } finally {
                this.currently_running.delete(job.id);
                if (requeue) {
                    this.queueJob(job);
                }
            }
        }
    }

    // Processes one job and always resolves to a result describing what
    // happened, never rejects: every error ends up in `result.error`, along
    // with whether it was reported on the PR and why not otherwise.
    async handlePullRequest(job) {
        let result = {
            job,
            success: false,
            requeue: false,
            config: null,
            error: null,
            needsUpdate: false,
            updated: false,
            bodyChanged: false,
            content: null,
            skipReason: null
        };
        let pr = null;

        try {
            pr = new PR(job.id, { id: job.installation_id });
            await pr.init({ debug: process.env.DEBUG_SIMPLE_GITHUB == "yes" });
            result.config = pr.config;
            Object.assign(result, await this.updateBody(pr, job));
            result.success = true;
        } catch (err) {
            if (err.errors) {
                err.data = { errors: err.errors };
            }
            result.error = err;
            result.requeue = !!err.requeue;

            const notReported = this.reportSkipReason(pr, job, err);
            if (notReported) {
                result.errorReported = false;
                result.errorNotReportedReason = notReported;
            } else {
                Object.assign(result, await this.reportError(pr, err));
            }
        }

        return result;
    }

    needsUpdate(pr) {
        return !this.updateSkipReason(pr);
    }

    // Why this PR doesn't warrant an update, or null when it does. Every branch
    // here used to be an unexplained no-op in the log.
    updateSkipReason(pr) {
        if (!pr.payload) return "PR was never loaded";
        if (pr.isMerged) return "PR is already merged";
        if (!pr.touchesSrcFile()) return `no change to ${pr.config.src_file} or the files it includes`;
        if (!pr.requiresPreview()) return "PR body opts out with <!-- no preview -->";
        return null;
    }

    shouldReportError(pr, job, error) {
        return !this.reportSkipReason(pr, job, error);
    }

    // Why this error is kept off the PR, or null when it should be reported
    // there: only real errors, only in production, and only on PRs that
    // wanted a preview in the first place (or were forced).
    reportSkipReason(pr, job, error) {
        if (process.env.NODE_ENV != "production") return "not a live run";
        const dismissal = dismissalReason(error);
        if (dismissal) return dismissal;
        if (!pr || !pr.payload) return "PR was never loaded";
        if (job.forcedUpdate) return null;
        return this.updateSkipReason(pr);
    }

    render(pr) {
        return this.renderer.render(pr);
    }
    
    renderError(pr, err) {
        return this.errorRenderer.render(pr, err);
    }
    
    // Posts the error on the PR. Never throws: a failure to report is itself
    // part of the result, so the log can mention both.
    async reportError(pr, error) {
        try {
            await pr.updateBody(this.renderError(pr, error));
            return { errorReported: true };
        } catch (reportingError) {
            return { errorReported: false, errorReportingError: reportingError };
        }
    }

    async updateBody(pr, job) {
        let needsUpdate = false;
        let updated = false;
        let bodyChanged = false;
        let content = null;
        let skipReason = null;

        if (job.forcedUpdate || this.needsUpdate(pr)) {

            await pr.cacheAll();

            // Check for changes that occurred during build
            const changeInfo = await pr.checkForChanges();

            if (changeInfo.hasCommitChanges) {
                const err = dismiss(new Error("New commits pushed during build"),
                    "aborted", "new commits pushed during build, requeued");
                err.requeue = true;
                throw err;
            }

            if (changeInfo.hasBodyChanges) {
                // Update the cached body to use latest content
                pr.body = changeInfo.currentBody;
                bodyChanged = true;
            }

            const newBod = this.render(pr);
            needsUpdate = pr.body != newBod.trim();
            content = newBod;

            if (needsUpdate) {
                if (process.env.NODE_ENV == "production") {
                    await pr.updateBody(newBod);
                    updated = true;
                } else {
                    updated = "Not a live run!";
                }
            } else {
                skipReason = "rendered body is already up to date";
            }
        } else {
            skipReason = this.updateSkipReason(pr);
        }

        return {
            needsUpdate,
            updated,
            bodyChanged,
            content,
            skipReason
        };
    }
}

module.exports = Controller;

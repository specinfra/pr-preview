"use strict";
const PR = require("./models/pr");
const Head = require("./models/branch").Head;
const ViewBody = require("./views/body");
const ViewError = require("./views/error");
const Config = require("./models/config");
const github = require("simple-github");
const { isInternalError, dismissalReason } = require("./utils/error-utils");

class Controller {
    constructor() {
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
        console.log("cache:set", k, pr_url);
        this.previewer_cache.set(k, pr_url);
    }

    cacheKey(params) {
        return `${params.owner}/${params.repo}/${params.config}`;
    }

    getCache(params) {
        let k = this.cacheKey(params);
        console.log("cache:get", k);
        return this.previewer_cache.get(k);
    }

    async getUrl(params) {
        let regex = /^[a-z0-9-_]+$/i;
        let owner = params.owner.trim();
        let repo = params.repo.trim();
        if (!regex.test(owner) || !regex.test(repo)) {
            throw new TypeError("Invalid repo or owner name");
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
            forcedUpdate:    !!force
        };
        return this.queueJob(job);
    }
    
    queueJob(job) {
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
    
    async processQueue(callback, errorCallback) {
        while (this.queue.length > 0) {
            const job = this.queue.shift();

            // Add to currently_running before processing
            this.currently_running.add(job.id);
            console.log(`Starting ${job.id}. Currently running:`, [...this.currently_running]);

            let shouldRequeue = false;

            try {
                const processingResult = await this.handlePullRequest(job);
                callback(processingResult);

                // Check if we should requeue after processing
                if (processingResult.requeue) {
                    shouldRequeue = true;
                }
            } catch (error) {
                // Check if error indicates we should requeue
                if (error.requeue) {
                    shouldRequeue = true;
                }
                errorCallback(error);
            } finally {
                // Release from currently_running first
                this.currently_running.delete(job.id);

                // Then requeue if needed (after job is no longer marked as running)
                if (shouldRequeue) {
                    this.queueJob(job);
                }
            }
        }
    }

    async handlePullRequest(job) {
        let pr = new PR(job.id, { id: job.installation_id });
        let success = false;
        let config = null;
        let error = null;
        let updateResult = { needsUpdate: false, updated: false, bodyChanged: false, content: null };
        let errorResult = null;

        try {
            await pr.init({ debug: process.env.DEBUG_SIMPLE_GITHUB == "yes" });
            config = pr.config;
            updateResult = await this.updateBody(pr, job);

            success = true;
        } catch (err) {
            error = err;
            if (err.errors) {
                err.data = { errors: err.errors };
            }

            if (this.shouldReportError(pr, job, error)) {
                errorResult = await this.reportError(pr, error);
            } else {
                errorResult = {
                    errorReported: false,
                    errorNotReportedReason: this.reportSkipReason(pr, job, error)
                };
            }
        }

        return {
            job,
            success,
            config,
            error,
            ...updateResult,
            ...errorResult
        };
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
        return process.env.NODE_ENV == "production" &&
            !isInternalError(error) &&
            (job.forcedUpdate || this.needsUpdate(pr));
    }

    // Mirrors shouldReportError, in the same order, to name the condition that
    // kept this error off the PR.
    reportSkipReason(pr, job, error) {
        if (process.env.NODE_ENV != "production") return "not a live run";
        if (isInternalError(error)) return dismissalReason(error);
        if (job.forcedUpdate) return null;
        return this.updateSkipReason(pr);
    }

    render(pr) {
        return this.renderer.render(pr);
    }
    
    renderError(pr, err) {
        return this.errorRenderer.render(pr, err);
    }
    
    async reportError(pr, error) {
        let newBod = this.renderError(pr, error);
        let errorReported = false;
        let errorRenderingErrorMsg = null;

        try {
            await pr.updateBody(newBod);
            errorReported = true;
        } catch (error2) {
            errorRenderingErrorMsg = error2;
        }

        return { errorReported, errorRenderingErrorMsg };
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
                const err = new Error("New commits pushed during build");
                err.aborted = true;
                err.requeue = true;
                err.dismissalReason = "new commits pushed during build, requeued";
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

"use strict";
const Config = require("./config");
const Spec = require("./spec");
const GithubAPI = require("../github-api");
const GH_API = require("../GH_API");
const { dismiss } = require("../utils/error-utils");

class PR {
    constructor(id, installation) {
        if (typeof id != "string") {
            throw new TypeError(`Incorrect Id: ${ JSON.stringify(id, null, 4) }`)
        }

        if (typeof installation != "object") {
            throw new TypeError(`Incorrect Installation object: ${ JSON.stringify(installation, null, 4) }`)
        }

        this._id = id;
        this._installation = installation;
        let parts = id.split("/");
        this._owner = parts[0];
        this._repo = parts[1];
        this._number = parts[2];
    }

    async init(options) {
        await this.setupApi(options);
        await this.requestConfig();
        await this.requestPR();
        await this.requestIncludes();
        await this.requestMergeBase();
        await this.getPreviewFiles();
    }

    request(url, options, body) {
        return this._api.request(url, options, body);
    }

    async requestPR() {
        const payload = await this.request(GH_API.GET_PR);
        this.payload = payload;
        if (this.isMerged) {
            throw dismiss(new Error("PR is already merged."), "prMerged");
        }
    }

    async setupApi(options) {
        this._api = new GithubAPI(this, options);
        const headers = await this._api.requestAuthHeaders();
        this._api.setAuthHeaders(headers);
    }

    async requestConfig() {
        const config = await new Config(this).request();
        this.config = config;
        this.specs = Spec.fromConfig(this, config);
    }

    get config() {
        if (!("_config" in this)) {
            throw new Error("Invalid state, missing _config");
        }
        return this._config;
    }

    set config(config) {
        return this._config = config;
    }

    async requestCommits() {
        const commits = await this.request(GH_API.GET_PR_COMMITS);
        this.commits = commits;
    }

    async requestMergeBase() {
        const payload = await this.request(GH_API.GET_COMPARE_COMMITS, {
            base: this.payload.base.sha,
            head: this.payload.head.sha
        });
        this.merge_base_sha = payload.merge_base_commit.sha;
        this.files = payload.files;
    }

    get commits() {
        if (!("_commits" in this)) {
            throw new Error("Invalid state, missing _commits");
        }
        return this._commits;
    }

    set commits(commits) {
        return this._commits = commits;
    }

    get head_sha() {
        return this.payload.head.sha;
    }

    get isMerged() {
        return this.payload.merged;
    }

    get merge_base_sha() {
        if (!("_merge_base_sha" in this)) {
            throw new Error("Invalid state, missing _merge_base_sha");
        }
        return this._merge_base_sha;
    }

    set merge_base_sha(merge_base_sha) {
        return this._merge_base_sha = merge_base_sha;
    }

    get files() {
        if (!("_files" in this)) {
            throw new Error("Invalid state, missing _files");
        }
        return this._files;
    }

    set files(files) {
        return this._files = files;
    }

    get specs() {
        if (!("_specs" in this)) {
            throw new Error("Invalid state, missing _specs");
        }
        return this._specs;
    }

    set specs(specs) {
        return this._specs = specs;
    }

    get isMultiSpec() {
        return Config.isMultiSpec(this.config);
    }

    // The specs previewed for this PR: the ones it changes, or all of them
    // when it changes none (an update forced on such a PR builds everything).
    get built_specs() {
        let touched = this.specs.filter(s => s.touchesSrcFile());
        return touched.length ? touched : this.specs;
    }

    async updateBody(content) {
        return await this.request(GH_API.PATCH_PR, null, {
            body: content
        });
    }

    get payload() {
        return this._payload;
    }

    set payload(payload) {
        return this._payload = payload;
    }

    get installation() {
        return this._installation;
    }

    get number() {
        return this._number;
    }

    get owner() {
        return this._owner;
    }

    get repo() {
        return this._repo;
    }

    get id() {
        return this._id;
    }

    get body() {
        return this._body = this._body || (this.payload.body || "").replace(/\r\n/g, "\n").trim();
    }

    set body(value) {
        this._body = value;
    }

    get aws_s3_bucket() {
        if (process.env.ALLOW_MULTIPLE_AWS_BUCKETS == "no") {
            return process.env.AWS_BUCKET_NAME;
        }
        return this.owner == "whatwg" ? process.env.WHATWG_AWS_BUCKET_NAME : process.env.AWS_BUCKET_NAME;
    }

    requiresPreview() {
        return !(/<!--\s*no preview\s*-->/.test(this.body));
    }

    // Scanned one spec at a time, to keep a repo with many specs from
    // flooding GitHub with requests.
    async requestIncludes() {
        for (let spec of this.specs) {
            await spec.requestIncludes();
        }
    }

    touchesSrcFile() {
        return this.specs.some(s => s.touchesSrcFile());
    }

    async getPreviewFiles() {
        for (let spec of this.built_specs) {
            await spec.getPreviewFiles();
        }
    }

    async cacheAll() {
        for (let spec of this.built_specs) {
            await spec.cacheAll();
        }
    }

    // Removes the Wattsi scratch files, if any. Called once the job is over,
    // whether it succeeded, failed or was skipped, so failed builds don't pile
    // up in the tmp dir.
    async cleanup() {
        // No specs when the job failed before the config was read.
        for (let spec of this._specs || []) {
            await spec.cleanup();
        }
    }

    async checkForChanges() {
        // Make fresh API call to get current PR state
        const currentPayload = await this.request(GH_API.GET_PR);
        const initialHeadSha = this.payload.head.sha;
        const initialBody = this.body;

        const currentHeadSha = currentPayload.head.sha;
        const currentBody = (currentPayload.body || "").replace(/\r\n/g, "\n").trim();

        return {
            hasCommitChanges: initialHeadSha !== currentHeadSha,
            hasBodyChanges: initialBody !== currentBody,
            currentHeadSha: currentHeadSha,
            currentBody: currentBody,
            initialHeadSha: initialHeadSha,
            initialBody: initialBody
        };
    }
}

module.exports = PR;

"use strict";
const Head = require("./branch").Head;
const Base = require("./branch").Base;
const MergeBase = require("./branch").MergeBase;
const File = require("./file");
const WattsiFile = File.WattsiFile;
const AddedWattsiFile = File.AddedWattsiFile;
const RemovedWattsiFile = File.RemovedWattsiFile;
const UnchangedWattsiFile = File.UnchangedWattsiFile;
const AuxWattsiFile = File.AuxWattsiFile;
const Config = require("./config");
const GithubAPI = require("../github-api");
const GH_API = require("../GH_API");
const WattsiClient = require("../wattsi-client");
const scanIncludes = require("../scan-includes");
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
    }

    get config() {
        if (!("_config" in this)) {
            throw new Error("Invalid state, missing _config");
        }
        return this._config;
    }

    get postProcessingConfig() {
        return this.config.post_processing;
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

    get preview_files() {
        if (!("_preview_files" in this)) {
            throw new Error("Invalid state, missing _preview_files");
        }
        return this._preview_files;
    }

    set preview_files(preview_files) {
        return this._preview_files = preview_files;
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

    get processor() {
        return this.config.type.toLowerCase();
    }

    get aws_s3_bucket() {
        if (process.env.ALLOW_MULTIPLE_AWS_BUCKETS == "no") {
            return process.env.AWS_BUCKET_NAME;
        }
        return this.owner == "whatwg" ? process.env.WHATWG_AWS_BUCKET_NAME : process.env.AWS_BUCKET_NAME;
    }

    get isMultipage() {
        return !!this.config.multipage;
    }

    requiresPreview() {
        return !(/<!--\s*no preview\s*-->/.test(this.body));
    }

    async requestIncludes() {
        this.includes = await scanIncludes(Head.fromPR(this).github_repo_url, this.config.src_file, this.config.type);
    }

    touchesSrcFile() {
        let relFiles = this.getRelevantSrcFiles();
        return this.files.some(f => relFiles.includes(f.filename));
    }

    getRelevantSrcFiles() {
        return [this.config.src_file, ...(this.includes || [])];
    }

    async getPreviewFiles() {
        if (this.processor == "wattsi") {
            this.wattsi = new WattsiClient(this);
            await this.wattsi.getFilenames();
            this.preview_files = [];
            this.unchanged_files = [];
            this.aux_files = [];

            this.wattsi.modifiedFiles.forEach(f => {
                this.preview_files.push(new WattsiFile(this, this.wattsi, f));
            });
            this.wattsi.addedFiles.forEach(f => {
                this.preview_files.push(new AddedWattsiFile(this, this.wattsi, f));
            });
            this.wattsi.removedFiles.forEach(f => {
                this.unchanged_files.push(new RemovedWattsiFile(this, this.wattsi, f));
            });
            this.wattsi.unchangedFiles.forEach(f => {
                this.unchanged_files.push(new UnchangedWattsiFile(this, this.wattsi, f));
            });

            // Per-PR auxiliary resources: xrefs.json so dfn panels show PR-accurate
            // cross-references, and a rewritten html-dfn.js that fetches it relatively.
            this.aux_files.push(new AuxWattsiFile(this, this.wattsi, "xrefs.json", this.wattsi.xrefsPath));
            this.aux_files.push(new AuxWattsiFile(this, this.wattsi, "html-dfn.js", this.wattsi.dfnJsPath));
        } else {
            this.preview_files = [ new File(this) ];
        }
    }

    async cacheAll() {
        async function next(files) {
            if (files.length) {
                let file = files.pop();
                await file.cache();
                await next(files);
            }
        }

        await next(this.preview_files.slice(0));

        if (this.unchanged_files) {
            await next(this.unchanged_files.slice(0));
        }

        if (this.aux_files) {
            await next(this.aux_files.slice(0));
        }

        if (this.wattsi) {
            await this.wattsi.cleanup();
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

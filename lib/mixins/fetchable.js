"use strict";

const cache = require("../cache");
const request = require("request");
const urlencode = require("urlencode");
const mustache = require("mustache");
const postProcessor = require("../post-processor");
const fetchUrl = require("../fetch-url");
const log = require("../logger").logger.child({ module: "fetch" });
const services = require("../services");

mustache.escape = v => v;

module.exports = (superclass) => class extends superclass {
    getUrl(options) {
        if (this.pr.processor == "bikeshed") {
            return this.getBikeshedUrl(options);
        }

        if (this.pr.processor == "respec") {
            return this.getRespecUrl(options);
        }

        if (this.pr.processor == "html") {
            return this.getHtmlUrl(options);
        }

        throw new Error(`Unknown processor ${ this.pr.processor }`);
    }

    getService() {
        if (this.pr.processor == "bikeshed" || this.pr.processor == "respec") {
            return services.SPECGENERATOR;
        }

        return null;
    }

    getBikeshedUrl(data) {
        let query = this.getQuery(data, "&", true);
        // bikeshed's --die-on option defaults to "fatal". Override to ignore
        // errors where possible, for use cases where we don't care about
        // fatal errors.
        if (this.ignore_bikeshed_errors) {
            query += "&die-on=nothing";
        }
        return {
            method: "POST",
            url: `https://www.w3.org/publications/spec-generator/?type=bikeshed-spec&output=html&url=${ urlencode(this.github_url) }${ query }`
        }
    }

    getRespecUrl(data) {
        let query = this.getQuery(data, "?");
        // The server also recognizes a die-on parameter for respec, but that
        // option is only used to opt in to stricter validation, not to opt out
        // of it. Therefore we do not need to set die-on like getBikeshedUrl.
        // Relevant server source: https://github.com/w3c/spec-generator/blob/4df462fe31a0acaf1033f277fbe00e71038a5bed/generators/respec.ts#L180-L184
        return `https://www.w3.org/publications/spec-generator/?type=respec&output=html&url=${urlencode(this.github_url + query)}`
    }

    getHtmlUrl(data) {
        return this.github_url + this.getQuery(data, "?");
    }

    get file_path() {
        return `${ this.owner }/${ this.repo }/${ this.sha }/${ this.pr.config.src_file }`;
    }

    get github_url() {
        return `https://raw.githubusercontent.com/${ this.file_path }`;
    }

    get github_repo_url() {
        return `https://raw.githubusercontent.com/${ this.owner }/${ this.repo }/${ this.sha }/`;
    }

    getQuery(data, prefix, encode) {
        let params = this.pr.config.params || {};
        let str = Object.keys(params).map(k => {
            if (!Array.isArray(params[k])) {
                params[k] = [params[k]];
            }

            return params[k].map(value => {
                let tmpl = String(value);
                let v = mustache.render(tmpl, data);
                return `${ k }=${ encode ? urlencode(v) : v }`;
            }).join("&");
        }).join("&");

        if (str.length > 0) return prefix + str;
        return str;
    }

    urlOptions() {
        return {
            config:       this.pr.config,
            pull_request: this.pr.payload,
            owner:        this.owner,
            repo:         this.repo,
            branch:       this.ref,
            sha:          this.sha,
            short_sha:    this.short_sha,
            url:          this.cache_url
        };
    }

    fetch() {
        var url = this.getUrl(this.urlOptions());
        // getUrl() returns either a URL string or a request object.
        const method = typeof url == "string" ? "GET" : url.method || "GET";
        const target = typeof url == "string" ? url : url.url;
        log.debug({ method, url: target }, `${method} ${target}`);
        var postProcess = postProcessor(this.pr.postProcessingConfig) || postProcessor.noop;
        return fetchUrl(url, this.getService()).then(postProcess);
    }
};

"use strict";
const EMPTYPAGE = "https://s3.amazonaws.com/pr-preview/emptypage.html";
const mix = require("../mix");
const ImmutableCache = require("../mixins/immutable-cache");
const Uploadable = require("../mixins/uploadable");
const HTMLDIFF_SERVICE = require("../services").HTMLDIFF;
const log = require("../logger").logger.child({ module: "spec-diff" });

const urlencode = require("urlencode");
const fetchUrl = require("../fetch-url");
const fs = require("fs");

class SpecDiff extends mix().with(ImmutableCache) {
    constructor(head, base, filename, transform) {
        super();
        this.head = head;
        this.base = base;
        this.filename = filename;
        this.transform = transform;
    }

    get in_same_repo() {
        return this.head.owner == this.base.owner;
    }
    get key() {
        let h = this.head;
        let b = this.base;
        let number = b.pr.number;
        let suffix = this.filename ? `/${ this.filename }` : ".html"
        if (this.aws_s3_bucket == "whatpr.org") {
            // /repo/45/3834774...7dfd134.html
            // /repo/45/3834774...7dfd134/foo.html
            return `${ b.repo }/${ number }/${ b.short_sha }...${ h.short_sha }${ suffix }`;
        } else {
            // owner/repo/45/3834774...7dfd134.html
            // owner/repo/45/3834774...contributor:7dfd134.html
            // owner/repo/45/3834774...7dfd134/foo.html
            // owner/repo/45/3834774...contributor:7dfd134/foo.html
            let prefix = this.in_same_repo ? "" : h.owner + ":";
            return `${ b.owner }/${ b.repo }/${ number }/${ b.short_sha }...${ prefix }${ h.short_sha }${ suffix }`;
        }
    }

    getHtmlDiffUrl() {
        let base = urlencode(this.base.cache_url);
        let head = urlencode(this.head.cache_url);
        return `https://services.w3.org/htmldiff?doc1=${ base }&doc2=${ head }`;
    }

    get aws_s3_bucket() {
        return this.head.aws_s3_bucket;
    }

    fetch() {
        let url = this.getHtmlDiffUrl()
        log.debug({ method: "GET", url }, `GET ${url}`);
        let promise = fetchUrl(url, HTMLDIFF_SERVICE);
        return this.transform ? promise.then(this.transform) : promise;
    }
}

class AddedFileSpecDiff extends SpecDiff {
    getHtmlDiffUrl() {
        let head = urlencode(this.head.cache_url);
        return `https://services.w3.org/htmldiff?doc1=${ EMPTYPAGE }&doc2=${ head }`;
    }
}

class RemovedFileSpecDiff extends SpecDiff {
    getHtmlDiffUrl() {
        let base = urlencode(this.base.cache_url);
        return `https://services.w3.org/htmldiff?doc1=${ base }&doc2=${ EMPTYPAGE }`;
    }
}

class NoSpecDiff extends mix(SpecDiff).with(Uploadable) {
    constructor(head, base, filepath, filename) {
        super(head, base, filename);
        this.filepath = filepath;
    }
    
    fetch() {
        log.debug({ path: this.filepath }, `Read ${this.filepath}`);
        return new Promise((resolve, reject) => {
            fs.readFile(this.filepath, "utf8", (err, body) => {
                if (err) {
                    err.data = { filepath: this.filepath };
                    reject(err);
                } else {
                    resolve(body);
                }
            });
        }).then(html => html + '<script src="https://w3c.github.io/htmldiff-nav/index.js"></script>');
    }
}

module.exports = SpecDiff;
module.exports.AddedFileSpecDiff = AddedFileSpecDiff;
module.exports.RemovedFileSpecDiff = RemovedFileSpecDiff;
module.exports.NoSpecDiff = NoSpecDiff;

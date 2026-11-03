"use strict";
const assert = require("assert"),
    Branch = require("../../lib/models/branch"),
    PR = require("../../lib/models/pr"),
    Spec = require("../../lib/models/spec");

const payload = require("../fixtures/pr");

function specFixture(config) {
    let pr = new PR("heycam/webidl/283", { id: 234 });
    pr.payload = payload.pull_request;
    return new Spec(pr, config || {});
}

function baseFixture(config) {
    return new Branch.Base({
        spec: specFixture(config),
        owner: "heycam",
        repo: "webidl",
        branch: "gh-pages",
        sha: "3834774ee2e6df7fe0af770783a6b76a3fc56867"
    });
}

function headFixture(config) {
    return new Branch.Head({
        spec: specFixture(config),
        owner: "tobie",
        repo: "webidl",
        branch: "interface-objs",
        sha: "7dfd134ee2e6df7fe0af770783a6b76a3fc56867"
    });
}

function mergeBaseFixture(config) {
    return new Branch.MergeBase({
        spec: specFixture(config),
        owner: "tobie",
        repo: "webidl",
        branch: "gh-pages",
        sha: "2eb8839fcbc6f04cae8fede477ced39cdbb07329"
    });
}

suite("Branch model", function() {

    test("Test constructor throws when no args are present", function() {
        assert.throws(_ => new Branch(), TypeError);
    });

    test("Test constructor throws with missing options", function() {
        assert.throws(_ => new Branch({}), TypeError);
    });

    test("Test constructor doesn't throw when the right arguments are present", function() {
        let spec = specFixture();
        let b = new Branch({
            spec: spec,
            owner: "heycam",
            repo: "webidl",
            branch: "master",
            sha: "2eb8839fcbc6f04cae8fede477ced39cdbb07329"
        });
        assert(b instanceof Branch);
        assert.equal(spec, b.spec);
        assert.equal(spec.pr, b.pr);
    });

    test("Test getters", function() {
        let h = headFixture();
        let b = baseFixture();
        process.env.AWS_BUCKET_NAME = "bar";
        assert.equal(h.owner, "tobie");
        assert.equal(h.repo, "webidl");
        assert.equal(h.branch, "interface-objs");
        assert.equal(h.ref, "interface-objs");
        assert.equal(h.sha, "7dfd134ee2e6df7fe0af770783a6b76a3fc56867");
        assert.equal(h.short_sha, "7dfd134");
        assert.equal(b.key, "heycam/webidl/pull/283/3834774.html");
        assert.equal(h.key, "tobie/webidl/pull/283.html");
        assert.equal(h.cache_url, "https://bar.s3.amazonaws.com/tobie/webidl/pull/283.html");
        h = headFixture({ src_file: "foo.bs" });
        assert.equal(h.github_url, "https://raw.githubusercontent.com/tobie/webidl/7dfd134ee2e6df7fe0af770783a6b76a3fc56867/foo.bs");
    });

    test("Test Base getters", function() {
        let b = baseFixture();
        process.env.AWS_BUCKET_NAME = "bar";
        assert.equal(b.key, "heycam/webidl/pull/283/3834774.html");
        assert.equal(b.cache_url, "https://bar.s3.amazonaws.com/heycam/webidl/pull/283/3834774.html");
    });

    test("Test MergeBase getters", function() {
        let b = mergeBaseFixture();
        assert.equal(b.sha, "2eb8839fcbc6f04cae8fede477ced39cdbb07329");
    });

    const RESPEC_URL = "https://www.w3.org/publications/spec-generator/?type=respec&output=html&url=https%3A%2F%2Fraw.githubusercontent.com%2Ftobie%2Fwebidl%2F7dfd134ee2e6df7fe0af770783a6b76a3fc56867%2F";

    test("Test getUrl", function() {
        let h = new Branch.Head({
            spec: specFixture({
                src_file: "Overview.html",
                type: "respec"
            }),
            owner: "tobie",
            repo: "webidl",
            branch: "gh-pages",
            sha: "7dfd134ee2e6df7fe0af770783a6b76a3fc56867"
        });
        assert.equal(h.getUrl(h.urlOptions()), RESPEC_URL + "Overview.html");
    });

    test("Test getUrl with options", function() {
        let h = headFixture({
            src_file: "index.html",
            type: "respec",
            params: { "specStatus": "REC" }
        });
        assert.equal(h.getUrl(h.urlOptions()), RESPEC_URL + "index.html%3FspecStatus%3DREC");
    });

    test("Test getUrl with template strings", function() {
        let h = headFixture({
            src_file: "index.html",
            type: "respec",
            params: { "subtitle": "PR #{{ pull_request.number }}" }
        });
        assert.equal(h.getUrl(h.urlOptions()), RESPEC_URL + "index.html%3Fsubtitle%3DPR%20%23283");
    });
    
    const BIKESHED_URL = "https://www.w3.org/publications/spec-generator/?type=bikeshed-spec&output=html&url=https%3A%2F%2Fraw.githubusercontent.com%2Ftobie%2Fwebidl%2F7dfd134ee2e6df7fe0af770783a6b76a3fc56867%2F";
    const BIKESHED_URL_FOR_MERGE_BASE = BIKESHED_URL.replace(
        // sha from headFixture:
        "7dfd134ee2e6df7fe0af770783a6b76a3fc56867",
        // sha from mergeBaseFixture:
        "2eb8839fcbc6f04cae8fede477ced39cdbb07329"
    );
    
    test('Test getUrl basic', function() {
        let h = headFixture({
            type: "bikeshed",
            src_file: "index.bs"
        });
        assert.deepEqual(h.getUrl(h.urlOptions()), {
            method: "POST",
            url: BIKESHED_URL + "index.bs"
        });
    });

    test('Test getUrl with non standard src file name', function() {
        let h = headFixture({
            src_file: "url.bs",
            type: "bikeshed"
        });
        
        assert.deepEqual(h.getUrl(h.urlOptions()), {
            method: "POST",
            url: BIKESHED_URL + "url.bs"
        });
    });
    
    test('Test getUrl with specific status', function() {
        let h = headFixture({
            src_file: "index.bs",
            type: "bikeshed",
            params: { "md-status": "REC" }
        });
        assert.deepEqual(h.getUrl(h.urlOptions()), {
            method: "POST",
            url: BIKESHED_URL + "index.bs&md-status=REC"
        });
    });

    test('Test getUrl using templating', function() {
        let h = headFixture({
            title: "FOO BAR",
            src_file: "index.bs",
            type: "bikeshed",
            params: {
                "md-title": "{{config.title}} {{owner}}/{{repo}}/{{branch}}#{{pull_request.number}}-{{short_sha}}"
            }
        });
        assert.deepEqual(h.getUrl(h.urlOptions()), {
            method: "POST",
            url: BIKESHED_URL +  "index.bs&md-title=FOO%20BAR%20tobie%2Fwebidl%2Finterface-objs%23283-7dfd134"
        });
    });

    test('Test getUrl templating gracefully handles non strings', function() {
        let h = headFixture({
            src_file: "index.bs",
            type: "bikeshed",
            params: {
                "die-on": "nothing"
            }
        });
        assert.deepEqual(h.getUrl(h.urlOptions()), {
            method: "POST",
            url: BIKESHED_URL + "index.bs&die-on=nothing"
        });
    });

    test('Test getUrl sets die-on=nothing for merge base', function() {
        let b = mergeBaseFixture({
            src_file: "index.bs",
            type: "bikeshed"
        });
        assert.deepEqual(b.getUrl(b.urlOptions()), {
            method: "POST",
            url: BIKESHED_URL_FOR_MERGE_BASE + "index.bs&die-on=nothing"
        });
        // Note: other getUrl tests already verify getUrl against headFixture,
        // and the absence of "die-on" flag in those URLs provide the desired
        // sanity check that our implementation does not unnecessarily ignore
        // errors for anything but the merge base.
    });

    test('Test urlOptions', function() {
        let config = {
            src_file: "index.bs",
            type: "bikeshed",
            params: {
                "die-on": "nothing"
            }
        }
        let h = headFixture(config);
        process.env.AWS_BUCKET_NAME = "bar";
        assert.deepEqual(h.urlOptions(), {
            config:       config,
            pull_request: payload.pull_request,
            owner:        "tobie",
            repo:         "webidl",
            branch:       "interface-objs",
            sha:          "7dfd134ee2e6df7fe0af770783a6b76a3fc56867",
            short_sha:    "7dfd134",
            url:          "https://bar.s3.amazonaws.com/tobie/webidl/pull/283.html"
        });
    });
});

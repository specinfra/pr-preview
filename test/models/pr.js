"use strict";
const assert = require("assert"),
    PR = require("../../lib/models/pr"),
    Spec = require("../../lib/models/spec");
const payload = require("../fixtures/pr");

suite("PR model", function() {
 
    test("constructor throws when no args are present", function() {
        assert.throws(_ => new PR(), TypeError);
    });
    
    test("constructor throws when an incorrect arg is present", function() {
        assert.throws(_ => new PR({}), TypeError);
    });
    
    test("constructor throws when an incorrect arg is present", function() {
        assert.throws(_ => new PR("foo", 123), TypeError);
    });
    
    test("constructor doesn't throw when the right arguments is present", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        assert(pr instanceof PR);
    });

const BODY = `* Extract legacy callback interface objects
  out of interface objects. Closes #78.
* Clarify that legacy callback interfaces are function objects.
* Give them a length property. Closes #279. Closes #83.
* Require new for Named Constructors. Closes #275.
* Rely on ES abstract operations for defining,
  named constructors, interface objects, and
  legacy callback interface objects.
* Disallow using the [NoInterfaceObject] on
  callback interfaces with constants.
* Don't require an interface prototype object for constants.
  Callback interfaces do not have an interface prototype object.
  Their constants sit on the legacy callback interface object itself.
  Closes #281.

<!--
    This comment and the below content is programmatically generated.
    You may add a comma-separated list of anchors you'd like a
    direct link to below (e.g. #idl-serializers, #idl-sequence):
    #foo, #bar
    Don't remove this comment or modify anything below this line.
    If you don't want a preview generated for this pull request,
    just replace the whole of this comment's content by \"no preview\"
    and remove what's below.
-->
***
[Preview](https://rawcdn.githack.com/tobie/webidl/7dfd134/index.html) | [Diff w/ current ED](https://services.w3.org/htmldiff?doc1=https%3A%2F%2Fheycam.github.io%2Fwebidl%2F&doc2=https%3A%2F%2Frawcdn.githack.com%2Ftobie%2Fwebidl%2F7dfd134%2Findex.html) | [Diff w/ base](https://services.w3.org/htmldiff?doc1=https%3A%2F%2Fcdn.rawgit.com%2Fheycam%2Fwebidl%2F3834774%2Findex.html&doc2=https%3A%2F%2Frawcdn.githack.com%2Ftobie%2Fwebidl%2F7dfd134%2Findex.html)`;
    
    test("getters", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        assert.deepEqual(pr.installation, { id: 234 });
        assert.equal(pr.number, 283);
        assert.equal(pr.owner, "heycam");
        assert.equal(pr.repo, "webidl");
        assert.equal(pr.id, "heycam/webidl/283");
        pr.payload = payload.pull_request;
        assert.equal(pr.body, BODY);
    });
    
    test("get/set config", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        assert.throws(_ => pr.config, Error);
        let c = {};
        assert.equal(pr.config = c, c);
        assert.equal(pr.config, c);
    });
    
    test("get/set files", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        assert.throws(_ => pr.files, Error);
        let f = [{}];
        assert.equal(pr.files = f, f);
        assert.equal(pr.files, f);
    });
    
    test("get/set commits", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        assert.throws(_ => pr.commits, Error);
        let c = {};
        assert.equal(pr.commits = c, c);
        assert.equal(pr.commits, c);
    });
    
    test("requiresPreview()", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = payload.pull_request;
        assert(pr.requiresPreview());
        pr = new PR("heycam/webidl/283", { id: 234 });
        let clone = JSON.parse(JSON.stringify(payload.pull_request))
        clone.body = "some content <!--no preview-->";
        pr.payload = clone;
        assert.equal(pr.requiresPreview(), false);
    });
    
    test("touchesSrcFile() is true when any spec is touched", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.files = require("../fixtures/files");
        pr.config = { src_file: "index.bs", type: "bikeshed" };
        pr.specs = Spec.fromConfig(pr, pr.config);
        assert(pr.touchesSrcFile());
        pr.config = [{ src_file: "foo.bs", type: "bikeshed" }, { src_file: "index.bs", type: "bikeshed" }];
        pr.specs = Spec.fromConfig(pr, pr.config);
        assert(pr.touchesSrcFile());
        pr.config = [{ src_file: "foo.bs", type: "bikeshed" }, { src_file: "bar.bs", type: "bikeshed" }];
        pr.specs = Spec.fromConfig(pr, pr.config);
        assert.equal(pr.touchesSrcFile(), false);
    });

    test("isMultiSpec", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.config = { src_file: "index.bs", type: "bikeshed" };
        assert.equal(pr.isMultiSpec, false);
        pr.config = [{ src_file: "index.bs", type: "bikeshed" }];
        assert.equal(pr.isMultiSpec, true);
    });

    test("built_specs are the touched specs, or all of them when none is", function() {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.files = require("../fixtures/files");
        pr.config = [{ src_file: "foo.bs", type: "bikeshed" }, { src_file: "index.bs", type: "bikeshed" }, { src_file: "bar.bs", type: "bikeshed" }];
        pr.specs = Spec.fromConfig(pr, pr.config);
        assert.deepEqual(pr.built_specs.map(s => s.src_file), ["index.bs"]);
        pr.files = [];
        assert.deepEqual(pr.built_specs.map(s => s.src_file), ["foo.bs", "index.bs", "bar.bs"]);
    });

    test("checkForChanges detects commit changes", function(done) {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = {
            head: { sha: "abc123" },
            body: "Original body"
        };

        // Mock the request method to simulate fresh API response with new commit
        pr.request = function() {
            return Promise.resolve({
                head: { sha: "def456" },
                body: "Original body"
            });
        };

        pr.checkForChanges().then(changeInfo => {
            assert.equal(changeInfo.hasCommitChanges, true);
            assert.equal(changeInfo.hasBodyChanges, false);
            assert.equal(changeInfo.initialHeadSha, "abc123");
            assert.equal(changeInfo.currentHeadSha, "def456");
            done();
        }).catch(done);
    });

    test("checkForChanges detects body changes", function(done) {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = {
            head: { sha: "abc123" },
            body: "Original body"
        };

        // Mock the request method to simulate fresh API response with edited body
        pr.request = function() {
            return Promise.resolve({
                head: { sha: "abc123" },
                body: "Updated body content"
            });
        };

        pr.checkForChanges().then(changeInfo => {
            assert.equal(changeInfo.hasCommitChanges, false);
            assert.equal(changeInfo.hasBodyChanges, true);
            assert.equal(changeInfo.initialBody, "Original body");
            assert.equal(changeInfo.currentBody, "Updated body content");
            done();
        }).catch(done);
    });

    test("checkForChanges detects no changes", function(done) {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = {
            head: { sha: "abc123" },
            body: "Same body"
        };

        // Mock the request method to simulate no changes
        pr.request = function() {
            return Promise.resolve({
                head: { sha: "abc123" },
                body: "Same body"
            });
        };

        pr.checkForChanges().then(changeInfo => {
            assert.equal(changeInfo.hasCommitChanges, false);
            assert.equal(changeInfo.hasBodyChanges, false);
            done();
        }).catch(done);
    });

    test("updateBody sets requeue flag when commits change", function(done) {
        const Controller = require("../../lib/controller");
        let controller = new Controller();

        // Create a mock PR
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = {
            head: { sha: "abc123" },
            body: "Original body"
        };
        pr.config = { type: "respec" };

        // Mock all the methods we need
        pr.cacheAll = () => Promise.resolve();
        pr.checkForChanges = () => Promise.resolve({
            hasCommitChanges: true,
            hasBodyChanges: false,
            initialHeadSha: "abc123",
            currentHeadSha: "def456"
        });

        let job = {
            id: "heycam/webidl/283",
            installation_id: 234,
            forcedUpdate: false
        };

        // Mock needsUpdate to return true
        controller.needsUpdate = () => true;

        controller.updateBody(pr, job).then(updateResult => {
            // This should not be reached when commits change during build
            done(new Error("Expected updateBody to throw an error"));
        }).catch(error => {
            // The error should be thrown when commits change during build
            assert.equal(error.message, "New commits pushed during build");
            assert.equal(error.aborted, true);
            assert.equal(error.requeue, true);
            done();
        });
    });


    test("aborted errors are not reported as user-facing errors", function(done) {
        const Controller = require("../../lib/controller");
        let controller = new Controller();

        // Create a mock PR
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.payload = {
            head: { sha: "abc123" },
            body: "Original body",
            merged: false
        };
        pr.config = { type: "respec" };
        pr.touchesSrcFile = () => true;
        pr.requiresPreview = () => true;

        // Create a result with an aborted error
        let result = {
            id: "heycam/webidl/283",
            installation_id: 234,
            error: new Error("New commits pushed during build"),
            forcedUpdate: false
        };
        result.error.aborted = true;

        // Set NODE_ENV to production to enable error reporting
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        // Test shouldReportError - it should return false for aborted errors
        let shouldReport = controller.shouldReportError(pr, result, result.error);
        assert.equal(shouldReport, false, "Aborted errors should not be reported");

        // Restore original environment
        process.env.NODE_ENV = originalEnv;
        done();
    });

});

suite("PR job with several specs", function() {
    const GH_API = require("../../lib/GH_API");
    const File = require("../../lib/models/file");
    const ORIGINAL = {
        requestIncludes: Spec.prototype.requestIncludes,
        getPreviewFiles: Spec.prototype.getPreviewFiles,
        cache: File.prototype.cache
    };
    let calls;

    setup(function() {
        calls = [];
        // Scanning includes fetches from GitHub: "other.bs" includes "index.bs",
        // which the fixture PR changes.
        Spec.prototype.requestIncludes = function() {
            calls.push(["includes", this.src_file]);
            this.includes = this.src_file == "other.bs" ? ["index.bs"] : [];
            return Promise.resolve();
        };
        Spec.prototype.getPreviewFiles = function() {
            calls.push(["preview files", this.src_file]);
            return ORIGINAL.getPreviewFiles.call(this);
        };
        File.prototype.cache = function() {
            calls.push(["cache", this.filename]);
            return Promise.resolve();
        };
    });

    teardown(function() {
        Spec.prototype.requestIncludes = ORIGINAL.requestIncludes;
        Spec.prototype.getPreviewFiles = ORIGINAL.getPreviewFiles;
        File.prototype.cache = ORIGINAL.cache;
    });

    // A PR whose GitHub API calls are answered from fixtures.
    function prWithConfig(config) {
        let pr = new PR("heycam/webidl/283", { id: 234 });
        pr.setupApi = () => Promise.resolve();
        pr.request = url => {
            calls.push(["github", url]);
            switch (url) {
                case GH_API.GET_CONFIG_FILE:
                    return Promise.resolve({ type: "file", content: Buffer.from(JSON.stringify(config)).toString("base64") });
                case GH_API.GET_PR:
                    return Promise.resolve(payload.pull_request);
                case GH_API.GET_COMPARE_COMMITS:
                    return Promise.resolve({
                        merge_base_commit: { sha: "c2fd513de33ea3f053495f4e135614db6e6aa617" },
                        files: require("../fixtures/files")
                    });
            }
            throw new Error(`Unexpected request ${url}`);
        };
        return pr;
    }

    test("scans every spec's includes, then builds and caches only the specs the PR changes", function() {
        let pr = prWithConfig([
            { src_file: "index.bs", type: "bikeshed", name: "Index" },
            { src_file: "unrelated.bs", type: "bikeshed" },
            { src_file: "other.bs", type: "bikeshed" }
        ]);
        return pr.init().then(() => {
            assert(pr.isMultiSpec);
            assert.deepEqual(pr.built_specs.map(s => s.src_file), ["index.bs", "other.bs"]);
            return pr.cacheAll();
        }).then(() => {
            assert.deepEqual(calls, [
                ["github", GH_API.GET_CONFIG_FILE],
                ["github", GH_API.GET_PR],
                ["includes", "index.bs"],
                ["includes", "unrelated.bs"],
                ["includes", "other.bs"],
                ["github", GH_API.GET_COMPARE_COMMITS],
                ["preview files", "index.bs"],
                ["preview files", "other.bs"],
                ["cache", "index.html"],
                ["cache", "other.html"]
            ]);
            assert.equal(pr.specs[1].preview_files, undefined, "an unchanged spec gets no preview files");
        });
    });

    test("renders a body listing only the specs the PR changes, by name", function() {
        process.env.AWS_BUCKET_NAME = "bar";
        const BodyView = require("../../lib/views/body");
        let pr = prWithConfig([
            { src_file: "index.bs", type: "bikeshed", name: "Index" },
            { src_file: "unrelated.bs", type: "bikeshed" },
            { src_file: "other.bs", type: "bikeshed" }
        ]);
        return pr.init().then(() => {
            let links = new BodyView().content(pr).split("\n").map(line => line.match(/>([^<]+)<\/a>/)[1]);
            assert.deepEqual(links, ["Index", "/other.html"]);
        });
    });

    test("a single-spec config builds its spec under the PR's own key", function() {
        process.env.AWS_BUCKET_NAME = "bar";
        let pr = prWithConfig({ src_file: "index.bs", type: "bikeshed" });
        return pr.init().then(() => {
            assert.equal(pr.isMultiSpec, false);
            assert.deepEqual(pr.built_specs.map(s => s.src_file), ["index.bs"]);
            assert.equal(pr.specs[0].preview_files[0].head.key, "tobie/webidl/pull/283.html");
        });
    });
});

"use strict";
const assert = require("assert"),
    PR = require("../../lib/models/pr"),
    Spec = require("../../lib/models/spec"),
    Head = require("../../lib/models/branch").Head,
    File = require("../../lib/models/file"),
    WattsiClient = require("../../lib/wattsi-client");

const payload = require("../fixtures/pr");

function prFixture() {
    let pr = new PR("heycam/webidl/283", { id: 234 });
    pr.payload = payload.pull_request;
    pr.files = require("../fixtures/files");
    return pr;
}

suite("Spec model", function() {
    test("a single-spec config makes one spec without a filename", function() {
        let specs = Spec.fromConfig(prFixture(), { src_file: "index.bs", type: "bikeshed" });
        assert.equal(specs.length, 1);
        assert.equal(specs[0].src_file, "index.bs");
        assert.equal(specs[0].filename, undefined);
        assert.equal(specs[0].config.params["md-warning"], "not ready");
    });

    test("a multi-spec config makes one spec per entry, each with its own filename", function() {
        let specs = Spec.fromConfig(prFixture(), [{ src_file: "index.bs", type: "bikeshed" }, { src_file: "css-grid-2/Overview.bs", type: "bikeshed", name: "CSS Grid Level 2" }]);
        assert.deepEqual(specs.map(s => s.filename), ["index.html", "css-grid-2/Overview.html"]);
        assert.deepEqual(specs.map(s => s.name), ["/index.html", "CSS Grid Level 2"]);
        assert.deepEqual(specs.map(s => s.processor), ["bikeshed", "bikeshed"]);
    });

    test("processor is always lowercase", function() {
        let spec = new Spec(prFixture(), { type: "Bikeshed" });
        assert.equal(spec.processor, "bikeshed");
    });

    test("touchesSrcFile() looks at the source and its includes", function() {
        let pr = prFixture();
        assert(new Spec(pr, { src_file: "index.bs" }).touchesSrcFile());
        let spec = new Spec(pr, { src_file: "foo.bs" });
        assert.equal(spec.touchesSrcFile(), false);
        spec.includes = ["index.bs"];
        assert(spec.touchesSrcFile());
    });

    test("previews of a multi-spec config go under the PR's, at the spec's filename", function() {
        process.env.AWS_BUCKET_NAME = "bar";
        let pr = prFixture();
        let [spec] = Spec.fromConfig(pr, [{ src_file: "css-grid-2/Overview.bs", type: "bikeshed" }]);
        return spec.getPreviewFiles().then(() => {
            assert.equal(spec.preview_files.length, 1);
            assert.equal(spec.preview_files[0].head.key, "tobie/webidl/pull/283/css-grid-2/Overview.html");
        });
    });

    test("the preview of a single-spec config keeps the PR's own key", function() {
        process.env.AWS_BUCKET_NAME = "bar";
        let [spec] = Spec.fromConfig(prFixture(), { type: "bikeshed", src_file: "index.bs" });
        return spec.getPreviewFiles().then(() => {
            assert.equal(spec.preview_files[0].head.key, "tobie/webidl/pull/283.html");
        });
    });

    test("each spec's own config feeds its URL templates", function() {
        let specs = Spec.fromConfig(prFixture(), [
            { src_file: "a.bs", type: "bikeshed", title: "A", params: { "md-title": "{{ config.title }} #{{ pull_request.number }}" } },
            { src_file: "b.html", type: "respec", title: "B", params: { subtitle: "{{ config.title }}" } }
        ]);
        let [a, b] = specs.map(spec => Head.fromSpec(spec));
        assert.equal(a.getUrl(a.urlOptions()).url,
            "https://www.w3.org/publications/spec-generator/?type=bikeshed-spec&output=html&url=" +
            "https%3A%2F%2Fraw.githubusercontent.com%2Ftobie%2Fwebidl%2F7dfd134ee2e6df7fe0af770783a6b76a3fc56867%2Fa.bs" +
            "&md-title=A%20%23283&md-warning=not%20ready");
        assert.equal(b.getUrl(b.urlOptions()),
            "https://www.w3.org/publications/spec-generator/?type=respec&output=html&url=" +
            "https%3A%2F%2Fraw.githubusercontent.com%2Ftobie%2Fwebidl%2F7dfd134ee2e6df7fe0af770783a6b76a3fc56867%2Fb.html%3Fsubtitle%3DB%26isPreview%3Dtrue");
        assert.equal(a.urlOptions().config, specs[0].config);
        assert.equal(b.urlOptions().config, specs[1].config);
    });

    test("each spec's post-processing is its own", function() {
        let specs = Spec.fromConfig(prFixture(), [
            { src_file: "a.bs", type: "bikeshed", post_processing: { name: "emu-algify" } },
            { src_file: "b.bs", type: "bikeshed" }
        ]);
        let [a, b] = specs.map(spec => Head.fromSpec(spec));
        assert.deepEqual(a.spec.postProcessingConfig, { name: "emu-algify" });
        assert.equal(b.spec.postProcessingConfig, undefined);
    });
});

suite("Spec model, Wattsi", function() {
    const ORIGINAL = {
        getFilenames: WattsiClient.prototype.getFilenames,
        cleanup: WattsiClient.prototype.cleanup
    };
    let cleanups;

    setup(function() {
        cleanups = 0;
        WattsiClient.prototype.getFilenames = function() {
            this.modifiedFiles = ["modified.html"];
            this.addedFiles = ["added.html"];
            this.removedFiles = ["removed.html"];
            this.unchangedFiles = ["unchanged.html"];
            return Promise.resolve();
        };
        WattsiClient.prototype.cleanup = function() {
            cleanups++;
            return Promise.resolve();
        };
    });

    teardown(function() {
        Object.assign(WattsiClient.prototype, ORIGINAL);
    });

    function wattsiSpec() {
        let pr = prFixture();
        pr.merge_base_sha = "c2fd513de33ea3f053495f4e135614db6e6aa617";
        return Spec.fromConfig(pr, { src_file: "source", type: "wattsi" })[0];
    }

    test("sorts Wattsi's pages into previewed, unchanged and auxiliary files", function() {
        let spec = wattsiSpec();
        assert(spec.isMultipage, "Wattsi specs default to multipage");
        return spec.getPreviewFiles().then(() => {
            assert.deepEqual(spec.preview_files.map(f => [f.constructor.name, f.filename]), [
                ["WattsiFile", "modified.html"],
                ["AddedWattsiFile", "added.html"]
            ]);
            assert.deepEqual(spec.unchanged_files.map(f => [f.constructor.name, f.filename]), [
                ["RemovedWattsiFile", "removed.html"],
                ["UnchangedWattsiFile", "unchanged.html"]
            ]);
            assert.deepEqual(spec.aux_files.map(f => f.filename), ["xrefs.json", "html-dfn.js"]);
            assert.equal(spec.aux_files[0].head.filepath, spec.wattsi.xrefsPath);
            assert.equal(spec.aux_files[1].head.filepath, spec.wattsi.dfnJsPath);
            assert.equal(spec.preview_files[0].head.key, "tobie/webidl/pull/283/modified.html");
        });
    });

    test("caches previews, then unchanged files, then auxiliary files, each group last first", function() {
        let spec = wattsiSpec();
        return spec.getPreviewFiles().then(() => {
            let cached = [];
            [...spec.preview_files, ...spec.unchanged_files, ...spec.aux_files].forEach(f => {
                f.cache = () => { cached.push(f.filename); return Promise.resolve(); };
            });
            return spec.cacheAll().then(() => {
                assert.deepEqual(cached, [
                    "added.html", "modified.html",
                    "unchanged.html", "removed.html",
                    "html-dfn.js", "xrefs.json"
                ]);
            });
        });
    });

    test("cleans up the Wattsi scratch files, and only once built", function() {
        let spec = wattsiSpec();
        return spec.cleanup().then(() => {
            assert.equal(cleanups, 0);
            return spec.getPreviewFiles();
        }).then(() => spec.cleanup()).then(() => {
            assert.equal(cleanups, 1);
        });
    });
});

"use strict";
const assert = require("assert"),
    Config = require("../../lib/models/config");

suite("Config validation", function() {

    test("empty object", function() {
        assert.throws(_ => Config.validate({}));
    });
    
    test("null/undef", function() {
        assert.throws(_ => Config.validate());
        assert.throws(_ => Config.validate(null));
    });
    
    test("inccorect type", function() {
        assert.throws(_ => Config.validate({
            src_file: "foo.bs",
            type: "test"
        }));
    });
    
    test("correct type, no params", function() {
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec"
        }));
        
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "ReSpec"
        }));
        
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "bikeshed"
        }));
        
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "Bikeshed"
        }));
    });
    
    test("correct type, empty params", function() {
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            params: {}
        }));
    });
    
    test("correct type, primitive params", function() {
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            params: {
                "foo": 123,
                "bar": true,
                "foobar": "a string",
                "baz": null
            }
        }));
    });
    
    test("correct type, forbidden params", function() {
        assert.throws(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            params: {
                "foo": {}
            }
        }));
    });
    
    test("post-processing, correct name", function() {
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            post_processing: {
                "name": "emu-algify"
            }
        }));
    });
    
    test("post-processing, incorrect name", function() {
        assert.throws(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            post_processing: {
                "name": "foo"
            }
        }));
    });
    
    test("post-processing, missing name", function() {
        assert.throws(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            post_processing: {}
        }));
    });
    
    test("post-processing, correct config options", function() {
        assert.doesNotThrow(_ => Config.validate({
            src_file: "foo.bs",
            type: "respec",
            post_processing: {
                "name": "emu-algify",
                "config": {
                    "foo": 123,
                    "bar": [2, "foo", false],
                    "foobar": { foo: 123 },
                    "baz": null
                }
            }
        }));
    });
});

suite("Config validation, multiple specs", function() {
    test("an array of specs", function() {
        assert.doesNotThrow(_ => Config.validate([
            { src_file: "a.bs", type: "bikeshed" },
            { src_file: "b.html", type: "respec", name: "B" }
        ]));
    });

    test("every spec needs a src_file and a type of its own", function() {
        assert.throws(_ => Config.validate([{ src_file: "a.bs", type: "bikeshed" }, { src_file: "b.bs" }]),
            err => err.dismissalReason.startsWith(".pr-preview.json is invalid at /1:"));
    });

    test("an empty list of specs is invalid", function() {
        assert.throws(_ => Config.validate([]),
            err => err.dismissalReason == ".pr-preview.json is invalid: the list of specs is empty");
    });

    test("wattsi can't be one of several specs", function() {
        assert.throws(_ => Config.validate([{ src_file: "source", type: "wattsi" }]),
            err => err.noConfig && /wattsi/.test(err.dismissalReason));
    });

    test("two specs can't be previewed at the same path", function() {
        assert.throws(_ => Config.validate([
            { src_file: "a.bs", type: "bikeshed" },
            { src_file: "a.html", type: "respec" }
        ]), err => err.dismissalReason == ".pr-preview.json is invalid: /0 and /1 would both be previewed at a.html");
    });

    test("the fields of each spec are checked", function() {
        assert.throws(_ => Config.validate([{ src_file: "a.bs", type: "bikeshed", params: { foo: {} } }]),
            err => err.dismissalReason.startsWith(".pr-preview.json is invalid at /0/params/foo:"));
    });
});

suite("Config.specs", function() {
    test("a single-spec config is a list of one, with defaults", function() {
        assert.deepEqual(Config.specs({ src_file: "a.bs", type: "bikeshed" }), [
            { src_file: "a.bs", type: "bikeshed", params: { "md-warning": "not ready" } }
        ]);
    });

    test("each spec of an array gets its own defaults, and the config is left alone", function() {
        let config = [
            { src_file: "a.bs", type: "bikeshed", name: "A" },
            { src_file: "b.html", type: "respec", params: { foo: "bar" } }
        ];
        assert.deepEqual(Config.specs(config), [
            { src_file: "a.bs", type: "bikeshed", name: "A", params: { "md-warning": "not ready" } },
            { src_file: "b.html", type: "respec", params: { foo: "bar", isPreview: true } }
        ]);
        assert.deepEqual(config[1].params, { foo: "bar" });
    });

    test("outputPath swaps the extension for .html and keeps directories", function() {
        assert.equal(Config.outputPath("index.bs"), "index.html");
        assert.equal(Config.outputPath("index.html"), "index.html");
        assert.equal(Config.outputPath("css-grid-2/Overview.bs"), "css-grid-2/Overview.html");
        assert.equal(Config.outputPath("v1.0/spec"), "v1.0/spec.html");
    });
});

suite("Config.addDefault", function() {
    test("Defaults md-warning to 'not ready' for Bikeshed configs", function() {
        assert.deepEqual({
            type: "bikeshed",
            params: { "md-warning": "not ready" }
        }, Config.addDefault({ type: "bikeshed" }));
    });

    test("Default isPreview param to true for ReSpec configs", function() {
        assert.deepEqual({
            type: "respec",
            params: { isPreview: true }
        }, Config.addDefault({ type: "respec" }));
    });
    
    test("Defaults multipage param to true for Wattsi configs", function() {
        assert.deepEqual({
            type: "wattsi",
            multipage: true
        }, Config.addDefault({ type: "wattsi" }));
    });

    test("Defaults do not overide actual config", function() {
        assert.deepEqual({
            type: "bikeshed",
            params: { "md-warning": "boo" }
        }, Config.addDefault({ type: "bikeshed",  params: { "md-warning": "boo" } }));

        assert.deepEqual({
            type: "respec",
            params: { isPreview: false }
        }, Config.addDefault({ type: "respec", params: { isPreview: false } }));

        assert.deepEqual({
            type: "wattsi",
            multipage: false
        }, Config.addDefault({ type: "wattsi", multipage: false }));
    });
});

suite("Config.request", function() {
    test("should decode base64 content correctly", function() {
        // Create a mock PR object
        const mockPR = {
            request: function(api) {
                // Return a mock GitHub API response with base64 encoded JSON
                const configJson = { src_file: "test.bs", type: "respec" };
                const base64Content = Buffer.from(JSON.stringify(configJson)).toString('base64');
                return Promise.resolve({
                    type: "file",
                    content: base64Content
                });
            }
        };

        const config = new Config(mockPR);
        return config.request().then(result => {
            assert.equal(result.src_file, "test.bs");
            assert.equal(result.type, "respec");
            assert.equal(result.params, undefined); // Defaults are added per spec, by Config.specs()
        });
    });

    test("should handle invalid base64 content", function() {
        const mockPR = {
            request: function(api) {
                return Promise.resolve({
                    type: "file",
                    content: "invalid-base64-content"
                });
            }
        };

        const config = new Config(mockPR);
        return config.request().then(
            result => assert.fail("Should have thrown an error"),
            err => assert(err.message.includes("Unexpected token"))
        );
    });
});


suite("Config.request dismissal reasons", function() {
    const rejectingPR = err => ({ request: () => Promise.reject(err) });
    const resolvingPR = file => ({ request: () => Promise.resolve(file) });

    test("a missing config reads as an opt-out, not a failure", function() {
        const err = new Error("Not Found");
        err.url = "https://api.github.com/repos/w3c/wcag/contents/.pr-preview.json";

        return new Config(rejectingPR(err)).request().then(
            _ => assert.fail("Should have thrown an error"),
            err => {
                assert.equal(err.noConfig, true);
                assert.equal(err.dismissalReason,
                    "no .pr-preview.json, repo hasn't opted into previews");
            }
        );
    });

    test("a fetch that failed for another reason says which file, where, and why", function() {
        const err = new Error("API rate limit exceeded");
        err.url = "https://api.github.com/repos/w3c/wcag/contents/.pr-preview.json";

        return new Config(rejectingPR(err)).request().then(
            _ => assert.fail("Should have thrown an error"),
            err => assert.equal(err.dismissalReason,
                "couldn't read .pr-preview.json from " +
                "https://api.github.com/repos/w3c/wcag/contents/.pr-preview.json: " +
                "API rate limit exceeded")
        );
    });

    test("a failed fetch without a url still names the file", function() {
        return new Config(rejectingPR(new Error("Bad credentials"))).request().then(
            _ => assert.fail("Should have thrown an error"),
            err => assert.equal(err.dismissalReason,
                "couldn't read .pr-preview.json: Bad credentials")
        );
    });

    test("a directory where the config should be says so", function() {
        return new Config(resolvingPR({ type: "dir" })).request().then(
            _ => assert.fail("Should have thrown an error"),
            err => {
                assert.equal(err.noConfig, true);
                assert.equal(err.dismissalReason, ".pr-preview.json is a dir, not a file");
            }
        );
    });

    test("an invalid config says what the schema rejected", function() {
        const content = Buffer.from(JSON.stringify({
            src_file: "index.bs",
            type: "nope"
        })).toString("base64");

        return new Config(resolvingPR({ type: "file", content })).request().then(
            _ => assert.fail("Should have thrown an error"),
            err => {
                assert.equal(err.noConfig, true);
                assert(err.dismissalReason.startsWith(".pr-preview.json is invalid at /type:"),
                    `Unexpected reason: ${err.dismissalReason}`);
            }
        );
    });

    test("unparseable JSON is a real error, not a dismissal", function() {
        return new Config(resolvingPR({ type: "file", content: "invalid-base64-content" })).request().then(
            _ => assert.fail("Should have thrown an error"),
            err => {
                assert(!err.noConfig, "Broken JSON should be reported, not dismissed");
                assert(err.message.startsWith(".pr-preview.json is not valid JSON:"),
                    `Unexpected message: ${err.message}`);
            }
        );
    });
});
